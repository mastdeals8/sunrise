import { config } from 'dotenv';
config();
import { Client } from 'pg';

const connStr = (process.env.DATABASE_URL || '').split('?')[0];
if (!connStr) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false }
});

async function runRegressionSuite() {
  await client.connect();
  console.log('Connected to live database:', client.database);

  const cleanupIds: {
    clients: number[];
    brands: number[];
    products: number[];
    stores: number[];
    material_codes: number[];
    estimates: number[];
  } = {
    clients: [],
    brands: [],
    products: [],
    stores: [],
    material_codes: [],
    estimates: []
  };

  try {
    console.log('\n--- TEST 1: Default company_id must NOT exist on key tables ---');
    const defaultCheck = await client.query(`
      SELECT table_name, column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'company_id'
        AND table_name IN ('clients', 'brands', 'stores', 'products', 'material_codes', 'customer_rate_cards', 'estimates', 'invoices', 'payments')
      ORDER BY table_name;
    `);
    let hasDefault = false;
    for (const row of defaultCheck.rows) {
      console.log(`Table ${row.table_name}: default = ${row.column_default}, nullable = ${row.is_nullable}`);
      if (row.column_default !== null) {
        hasDefault = true;
      }
    }
    if (hasDefault) {
      throw new Error('FAILURE: One or more tables still have a column_default on company_id!');
    }
    console.log('PASS: No default company_id on any critical table. Inserts without company_id will fail.');

    console.log('\n--- TEST 2: Attempting insert without company_id must be rejected by PostgreSQL ---');
    try {
      await client.query(`INSERT INTO clients (name) VALUES ('Illegal Client Without Company') RETURNING id;`);
      throw new Error('FAILURE: Insert without company_id should have been rejected!');
    } catch (err: any) {
      if (err.message.includes('not-null constraint') || err.message.includes('null value in column "company_id"')) {
        console.log('PASS: Insert without company_id rejected with NOT NULL constraint violation:', err.message);
      } else {
        throw err;
      }
    }

    console.log('\n--- TEST 3: Create unique test client in Workspace 2 (Delhi Company) ---');
    const testClientW2 = await client.query(`
      INSERT INTO clients (name, company_id)
      VALUES ('AutoTest Client W2 ' || gen_random_uuid(), 2)
      RETURNING id, name, company_id;
    `);
    const c2Id = testClientW2.rows[0].id;
    const c2Name = testClientW2.rows[0].name;
    cleanupIds.clients.push(c2Id);
    console.log(`Created Client in Workspace 2: ID=${c2Id}, Name=${c2Name}, Company=${testClientW2.rows[0].company_id}`);

    // Query for Workspace 1
    const w1ClientQuery = await client.query(`SELECT id, name FROM clients WHERE company_id = 1 AND id = $1;`, [c2Id]);
    if (w1ClientQuery.rows.length > 0) {
      throw new Error(`FAILURE: Client created in Workspace 2 appeared under Workspace 1!`);
    }
    console.log('PASS: Client is absent in Workspace 1 query.');

    // Query for Workspace 2
    const w2ClientQuery = await client.query(`SELECT id, name FROM clients WHERE company_id = 2 AND id = $1;`, [c2Id]);
    if (w2ClientQuery.rows.length !== 1) {
      throw new Error(`FAILURE: Client created in Workspace 2 not found in Workspace 2 query!`);
    }
    console.log('PASS: Client exists and is isolated to Workspace 2.');

    // Query for Workspace 3
    const w3ClientQuery = await client.query(`SELECT id, name FROM clients WHERE company_id = 3 AND id = $1;`, [c2Id]);
    if (w3ClientQuery.rows.length > 0) {
      throw new Error(`FAILURE: Client created in Workspace 2 appeared under Workspace 3!`);
    }
    console.log('PASS: Client is absent in Workspace 3 query.');

    console.log('\n--- TEST 4: Repeat isolation test for Workspace 3 (Rika Store) ---');
    const testClientW3 = await client.query(`
      INSERT INTO clients (name, company_id)
      VALUES ('AutoTest Client W3 ' || gen_random_uuid(), 3)
      RETURNING id, name, company_id;
    `);
    const c3Id = testClientW3.rows[0].id;
    cleanupIds.clients.push(c3Id);
    console.log(`Created Client in Workspace 3: ID=${c3Id}, Company=${testClientW3.rows[0].company_id}`);

    const w1Check3 = await client.query(`SELECT id FROM clients WHERE company_id = 1 AND id = $1;`, [c3Id]);
    const w2Check3 = await client.query(`SELECT id FROM clients WHERE company_id = 2 AND id = $1;`, [c3Id]);
    const w3Check3 = await client.query(`SELECT id FROM clients WHERE company_id = 3 AND id = $1;`, [c3Id]);
    if (w1Check3.rows.length > 0 || w2Check3.rows.length > 0 || w3Check3.rows.length !== 1) {
      throw new Error(`FAILURE: Workspace 3 isolation failed!`);
    }
    console.log('PASS: Workspace 3 client is strictly isolated to Workspace 3.');

    console.log('\n--- TEST 5: Brands, Products, Stores, Material Codes isolation in Workspace 2 ---');
    // Brand
    const bRes = await client.query(`INSERT INTO brands (parent_client_id, name, company_id) VALUES ($1, 'AutoTest Brand W2', 2) RETURNING id;`, [c2Id]);
    const bId = bRes.rows[0].id;
    cleanupIds.brands.push(bId);

    // Product
    const pRes = await client.query(`INSERT INTO products (name, unit, rate, hsn_sac, company_id) VALUES ('AutoTest Product W2', 'sqft', 150, '9983', 2) RETURNING id;`);
    const pId = pRes.rows[0].id;
    cleanupIds.products.push(pId);

    // Store
    const sRes = await client.query(`INSERT INTO stores (client_id, brand_id, name, store_code, city, state, company_id) VALUES ($1, $2, 'AutoTest Store W2', 'STR-W2', 'Delhi', 'Delhi', 2) RETURNING id;`, [c2Id, bId]);
    const sId = sRes.rows[0].id;
    cleanupIds.stores.push(sId);

    // Material Code
    const mRes = await client.query(`INSERT INTO material_codes (client_id, code, description, company_id) VALUES ($1, 'MC-W2-TEST', 'AutoTest Material W2', 2) RETURNING id;`, [c2Id]);
    const mId = mRes.rows[0].id;
    cleanupIds.material_codes.push(mId);

    // Verify absent in W1 and present in W2
    const w1Brand = await client.query(`SELECT id FROM brands WHERE company_id = 1 AND id = $1;`, [bId]);
    const w1Prod = await client.query(`SELECT id FROM products WHERE company_id = 1 AND id = $1;`, [pId]);
    const w1Store = await client.query(`SELECT id FROM stores WHERE company_id = 1 AND id = $1;`, [sId]);
    const w1Mat = await client.query(`SELECT id FROM material_codes WHERE company_id = 1 AND id = $1;`, [mId]);

    if (w1Brand.rows.length || w1Prod.rows.length || w1Store.rows.length || w1Mat.rows.length) {
      throw new Error(`FAILURE: Workspace 2 master data leaked into Workspace 1!`);
    }
    console.log('PASS: Brands, Products, Stores, Material Codes created in Workspace 2 are absent in Workspace 1.');

    console.log('\n--- TEST 6: Estimates, Document Numbering, and Atomic Creation in Workspace 2 ---');
    // Generate document number via next_sunrise_document_number
    const docNumRes = await client.query(`SELECT next_sunrise_document_number('estimate', CURRENT_DATE, 2) as doc_no;`);
    const docNo = docNumRes.rows[0].doc_no;
    console.log(`Generated Document Number for Workspace 2: ${docNo}`);

    // Create estimate atomic
    const estRes = await client.query(`
      SELECT create_estimate_atomic(
        $1::jsonb,
        $2::jsonb
      ) as estimate_record;
    `, [
      JSON.stringify({
        company_id: 2,
        client_id: c2Id,
        brand_id: bId,
        store_id: sId,
        title: 'AutoTest Estimate W2',
        subtotal: 15000,
        tax_amount: 2700,
        total_amount: 17700,
        status: 'draft'
      }),
      JSON.stringify([
        {
          product_id: pId,
          store_id: sId,
          description: 'Test Item W2',
          width: 10,
          height: 10,
          sqft: 100,
          rate: 150,
          taxable_amount: 15000,
          gst_percent: 18,
          gst_amount: 2700,
          total_amount: 17700,
          hsn_sac: '9983'
        }
      ])
    ]);
    const estRecord = estRes.rows[0].estimate_record;
    const estId = estRecord.id;
    cleanupIds.estimates.push(estId);
    console.log(`Created Estimate Atomic in Workspace 2: ID=${estId}, DocNo=${estRecord.estimate_number}`);

    // Check estimate company_id, items company_id, and revisions company_id
    const estCheck = await client.query(`SELECT id, company_id, estimate_number, total_amount FROM estimates WHERE id = $1;`, [estId]);
    const estItemCheck = await client.query(`SELECT id, company_id, estimate_id, total_amount FROM estimate_items WHERE estimate_id = $1;`, [estId]);
    const estRevCheck = await client.query(`SELECT id, company_id, estimate_id, revision_number FROM estimate_revisions WHERE estimate_id = $1;`, [estId]);
    console.log(`Estimate record:`, estCheck.rows[0]);
    console.log(`Estimate item record:`, estItemCheck.rows[0]);
    console.log(`Estimate revision record:`, estRevCheck.rows[0]);

    if (estCheck.rows[0].company_id !== 2 || estItemCheck.rows[0].company_id !== 2 || estRevCheck.rows[0].company_id !== 2) {
      throw new Error(`FAILURE: Estimate, items, or revisions did not inherit company_id 2!`);
    }
    console.log('PASS: Estimate, items, and revisions strictly isolated in Workspace 2.');

    // Test cross-company mismatch rejection in create_estimate_atomic
    console.log('\n--- TEST 7: Cross-company mismatch rejection in create_estimate_atomic ---');
    try {
      // Trying to create an estimate for Company 1 using Company 2 client
      await client.query(`
        SELECT create_estimate_atomic(
          $1::jsonb,
          '[]'::jsonb
        );
      `, [
        JSON.stringify({
          company_id: 1, // Workspace 1
          client_id: c2Id, // Belongs to Workspace 2
          brand_id: bId,
          title: 'Illegal Cross-Company Estimate'
        })
      ]);
      throw new Error('FAILURE: create_estimate_atomic should have rejected client belonging to another company!');
    } catch (err: any) {
      if (err.message.includes('does not belong to company 1')) {
        console.log('PASS: create_estimate_atomic rejected cross-company client with expected message:', err.message);
      } else {
        throw err;
      }
    }

    console.log('\n--- TEST 8: Explicit Cross-Workspace Copy Feature ---');
    // Copy Client c2Id from Workspace 2 to Workspace 3
    const copyRes = await client.query(`
      SELECT copy_record_to_workspace(
        'clients'::text,
        $1::integer,
        3::integer,
        '{"copyBillingProfiles": true}'::jsonb
      ) as result;
    `, [c2Id]);
    const copyData = copyRes.rows[0].result;
    console.log('Copy result:', copyData);
    if (!copyData.destinationId || copyData.destinationCompanyId !== 3) {
      throw new Error(`FAILURE: copy_record_to_workspace returned invalid result!`);
    }
    const newClientW3Id = copyData.destinationId;
    cleanupIds.clients.push(newClientW3Id);

    // Verify source record unchanged
    const sourceCheck = await client.query(`SELECT id, name, company_id FROM clients WHERE id = $1;`, [c2Id]);
    if (sourceCheck.rows[0].company_id !== 2) {
      throw new Error(`FAILURE: Source client company_id was altered!`);
    }
    console.log(`PASS: Source client remains intact in Workspace 2 (ID ${c2Id}, Company ${sourceCheck.rows[0].company_id}).`);

    // Verify destination record created with target ownership
    const destCheck = await client.query(`SELECT id, name, company_id FROM clients WHERE id = $1;`, [newClientW3Id]);
    if (destCheck.rows[0].company_id !== 3 || destCheck.rows[0].name !== c2Name) {
      throw new Error(`FAILURE: Destination client is invalid!`);
    }
    console.log(`PASS: Destination client independently created in Workspace 3 (ID ${newClientW3Id}, Company ${destCheck.rows[0].company_id}).`);

    console.log('\n--- TEST 9: Verify Client ID 22 ("Ledure Lighting Limited") current status ---');
    const ledureCheck = await client.query(`SELECT id, name, company_id FROM clients WHERE id = 22;`);
    console.log('Client 22 status:', ledureCheck.rows[0]);
    if (ledureCheck.rows[0].company_id !== 2) {
      throw new Error('FAILURE: Client 22 is not assigned to Workspace 2!');
    }
    console.log('PASS: Client 22 ("Ledure Lighting Limited") is correctly assigned to Workspace 2.');

  } finally {
    console.log('\n--- CLEANUP: Removing test records ---');
    if (cleanupIds.estimates.length) {
      await client.query(`DELETE FROM estimate_items WHERE estimate_id = ANY($1);`, [cleanupIds.estimates]);
      await client.query(`DELETE FROM estimates WHERE id = ANY($1);`, [cleanupIds.estimates]);
    }
    if (cleanupIds.material_codes.length) {
      await client.query(`DELETE FROM material_codes WHERE id = ANY($1);`, [cleanupIds.material_codes]);
    }
    if (cleanupIds.stores.length) {
      await client.query(`DELETE FROM stores WHERE id = ANY($1);`, [cleanupIds.stores]);
    }
    if (cleanupIds.products.length) {
      await client.query(`DELETE FROM products WHERE id = ANY($1);`, [cleanupIds.products]);
    }
    if (cleanupIds.brands.length) {
      await client.query(`DELETE FROM brands WHERE id = ANY($1);`, [cleanupIds.brands]);
    }
    if (cleanupIds.clients.length) {
      await client.query(`DELETE FROM clients WHERE id = ANY($1);`, [cleanupIds.clients]);
    }
    console.log('Cleanup completed successfully.');
    await client.end();
  }

  console.log('\n========================================');
  console.log('ALL REGRESSION TESTS PASSED SUCCESSFULLY');
  console.log('========================================');
}

runRegressionSuite().catch(err => {
  console.error('\nREGRESSION TEST FAILED:', err);
  process.exit(1);
});
