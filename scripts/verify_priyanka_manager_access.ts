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

async function main() {
  await client.connect();
  console.log('Connected to database for Priyanka Manager verification.');

  const PRIYANKA_AUTH_ID = 'fa23fc2f-ed63-45fe-a09f-4c38168efc6b';
  const PRIYANKA_EMAIL = 'pinks@sunrisemedia.in';

  let testClientId: number | null = null;
  let testBrandId: number | null = null;
  let testEstimateId: number | null = null;

  try {
    console.log('\n--- 1. VERIFY PRIYANKA AUTHENTICATION & PROFILE ---');
    // Set authenticated session as Priyanka
    await client.query(`
      SET LOCAL role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${PRIYANKA_AUTH_ID}';
      SET LOCAL request.jwt.claims = '{"sub": "${PRIYANKA_AUTH_ID}", "email": "${PRIYANKA_EMAIL}", "role": "authenticated"}';
    `);

    const ctxRes = await client.query(`
      SELECT public.get_current_user_id() as uid,
             public.is_super_admin() as is_super,
             public.user_has_company_access(2) as has_w2,
             public.user_has_company_access(1) as has_w1,
             public.user_has_company_access(3) as has_w3;
    `);
    const ctx = ctxRes.rows[0];
    console.log('Priyanka security context:', ctx);

    if (ctx.uid !== 12) throw new Error(`Expected uid 12, got ${ctx.uid}`);
    if (ctx.is_super !== false) throw new Error(`Priyanka must NOT be super_admin!`);
    if (ctx.has_w2 !== true) throw new Error(`Priyanka must have access to Workspace 2!`);
    if (ctx.has_w1 !== false) throw new Error(`Priyanka must NOT have access to Workspace 1!`);
    if (ctx.has_w3 !== false) throw new Error(`Priyanka must NOT have access to Workspace 3!`);
    console.log('✓ Security context verified: strictly scoped to Workspace 2, not super_admin.');

    const profRes = await client.query(`SELECT public.get_current_user_profile() as profile;`);
    const profile = profRes.rows[0].profile;
    console.log('Priyanka profile:', JSON.stringify(profile, null, 2));

    if (profile.role !== 'manager') throw new Error(`Expected role 'manager', got ${profile.role}`);
    if (profile.activeCompanyId !== 2) throw new Error(`Expected activeCompanyId 2, got ${profile.activeCompanyId}`);
    if (profile.memberships.length !== 1 || profile.memberships[0].companyId !== 2) {
      throw new Error(`Expected single membership for company 2!`);
    }
    console.log('✓ Profile verified: Manager role, activeCompanyId = 2, strictly 1 membership.');

    console.log('\n--- 2. VERIFY WORKSPACE 2 CLIENTS VISIBILITY (LEDURE LIGHTING) ---');
    const w2Clients = await client.query(`SELECT id, name, company_id FROM public.clients WHERE company_id = 2;`);
    console.log('Workspace 2 clients visible to Priyanka:', w2Clients.rows);
    const ledure = w2Clients.rows.find((c: any) => c.name === 'Ledure Lighting Limited');
    if (!ledure) {
      throw new Error('FAILURE: Ledure Lighting Limited (ID 22) is not visible to Priyanka in Workspace 2!');
    }
    console.log(`✓ Ledure Lighting Limited (ID ${ledure.id}) is visible in Workspace 2.`);

    console.log('\n--- 3. VERIFY STRICT ISOLATION FROM WORKSPACES 1 & 3 ---');
    const w1Clients = await client.query(`SELECT id, name, company_id FROM public.clients WHERE company_id = 1;`);
    console.log(`Workspace 1 clients visible to Priyanka (must be 0): count = ${w1Clients.rows.length}`);
    if (w1Clients.rows.length > 0) {
      throw new Error(`FAILURE: Priyanka can see Workspace 1 clients: ${JSON.stringify(w1Clients.rows)}`);
    }

    const w3Clients = await client.query(`SELECT id, name, company_id FROM public.clients WHERE company_id = 3;`);
    console.log(`Workspace 3 clients visible to Priyanka (must be 0): count = ${w3Clients.rows.length}`);
    if (w3Clients.rows.length > 0) {
      throw new Error(`FAILURE: Priyanka can see Workspace 3 clients: ${JSON.stringify(w3Clients.rows)}`);
    }
    console.log('✓ Strict isolation confirmed: 0 clients visible from Workspaces 1 & 3.');

    console.log('\n--- 4. TEST CREATE, UPDATE & BILLING PROFILE IN WORKSPACE 2 ---');
    // Create uniquely named test client in Workspace 2
    const testClientName = `Priyanka LiveTest Client ${Date.now()}`;
    const createRes = await client.query(`
      SELECT public.save_master_data_atomic(
        'clients',
        'POST',
        NULL,
        $1::jsonb
      ) as result;
    `, [JSON.stringify({
      name: testClientName,
      companyId: 2,
      city: 'New Delhi',
      email: 'priyanka.test@example.com'
    })]);
    const createdClient = createRes.rows[0].result;
    testClientId = createdClient.id;
    console.log('Created client in W2:', createdClient);

    if (createdClient.company_id !== 2 || createdClient.name !== testClientName) {
      throw new Error(`FAILURE: Client not created with company_id = 2!`);
    }
    console.log(`✓ Test client created with ID ${testClientId} and company_id = 2.`);

    // Verify visibility
    const checkCreated = await client.query(`SELECT id, name, company_id FROM public.clients WHERE id = $1;`, [testClientId]);
    if (checkCreated.rows.length !== 1) {
      throw new Error(`FAILURE: Newly created client not found via query!`);
    }
    console.log('✓ Newly created client verified visible to Priyanka.');

    // Update client
    const updateRes = await client.query(`
      SELECT public.save_master_data_atomic(
        'clients',
        'PATCH',
        $1,
        $2::jsonb
      ) as result;
    `, [testClientId, JSON.stringify({
      companyId: 2,
      city: 'Noida (Updated)'
    })]);
    console.log('Updated client result:', updateRes.rows[0].result);
    if (updateRes.rows[0].result.city !== 'Noida (Updated)') {
      throw new Error('FAILURE: Client update did not reflect!');
    }
    console.log('✓ Client successfully updated by Priyanka in Workspace 2.');

    // Add GST Billing Profile
    const bpRes = await client.query(`
      SELECT public.save_master_data_atomic(
        'billing-profiles',
        'POST',
        NULL,
        $1::jsonb
      ) as result;
    `, [JSON.stringify({
      clientId: testClientId,
      companyId: 2,
      legalCompanyName: 'Priyanka LiveTest Corp Delhi',
      gstin: '07AAAAA0000A1Z5',
      state: 'Delhi',
      stateCode: '07',
      billingAddress: 'Connaught Place, New Delhi'
    })]);
    const bp = bpRes.rows[0].result;
    console.log('Created billing profile:', bp);
    if (!bp.id || bp.client_id !== testClientId) {
      throw new Error('FAILURE: Billing profile not created!');
    }
    console.log('✓ GST billing profile successfully added to client.');

    // Verify billing profile query
    const bpQuery = await client.query(`SELECT id, legal_company_name FROM public.client_billing_profiles WHERE client_id = $1;`, [testClientId]);
    if (bpQuery.rows.length !== 1) {
      throw new Error('FAILURE: Billing profile query returned 0 rows!');
    }
    console.log('✓ GST billing profile verified visible to Priyanka.');

    console.log('\n--- 5. VERIFY UNAUTHORIZED CROSS-WORKSPACE OPERATIONS REJECTED ---');
    // Attempt create in Workspace 1 via RPC
    try {
      await client.query(`
        SELECT public.save_master_data_atomic(
          'clients',
          'POST',
          NULL,
          $1::jsonb
        ) as result;
      `, [JSON.stringify({
        name: 'Illegal W1 Client Attempt',
        companyId: 1
      })]);
      throw new Error('FAILURE: Unauthorized W1 create should have been rejected!');
    } catch (err: any) {
      if (err.message.includes('Access denied for company 1')) {
        console.log('✓ Unauthorized W1 create rejected with: Access denied for company 1');
      } else {
        throw err;
      }
    }

    // Attempt direct SQL insert into Workspace 1
    try {
      await client.query(`INSERT INTO public.clients (name, company_id) VALUES ('Illegal Direct W1', 1);`);
      throw new Error('FAILURE: Direct W1 insert should have been rejected by RLS!');
    } catch (err: any) {
      if (err.message.includes('row-level security policy')) {
        console.log('✓ Direct W1 insert rejected by RLS: violates row-level security policy');
      } else {
        throw err;
      }
    }

    // Attempt direct SQL update of Workspace 1 record (e.g. ID 1)
    const w1Upd = await client.query(`UPDATE public.clients SET name = 'Unauthorized Hack' WHERE id = 1;`);
    console.log(`Update on Workspace 1 client rows affected: ${w1Upd.rowCount}`);
    if (w1Upd.rowCount !== 0) {
      throw new Error('FAILURE: Priyanka was able to update a Workspace 1 client!');
    }
    console.log('✓ Direct W1 update rejected: 0 rows modified.');

    // Attempt direct SQL delete of Workspace 1 record (e.g. ID 1)
    const w1Del = await client.query(`DELETE FROM public.clients WHERE id = 1;`);
    console.log(`Delete on Workspace 1 client rows affected: ${w1Del.rowCount}`);
    if (w1Del.rowCount !== 0) {
      throw new Error('FAILURE: Priyanka was able to delete a Workspace 1 client!');
    }
    console.log('✓ Direct W1 delete rejected: 0 rows modified.');

    console.log('\n--- 6. VERIFY ESTIMATE CREATION & CLIENT SELECTION IN WORKSPACE 2 ---');
    // Create a brand in Workspace 2 for the client
    const brandRes = await client.query(`
      SELECT public.save_master_data_atomic(
        'brands',
        'POST',
        NULL,
        $1::jsonb
      ) as result;
    `, [JSON.stringify({
      name: 'Priyanka Test Brand W2',
      parentClientId: testClientId,
      companyId: 2
    })]);
    testBrandId = brandRes.rows[0].result.id;
    console.log(`Created brand in W2: ID ${testBrandId}`);

    // Create an estimate in Workspace 2 using this client & brand
    const estRes = await client.query(`
      SELECT public.create_estimate_atomic(
        $1::jsonb,
        $2::jsonb
      ) as result;
    `, [
      JSON.stringify({
        company_id: 2,
        client_id: testClientId,
        brand_id: testBrandId,
        title: 'Priyanka Live Estimate W2',
        subtotal: 1000,
        tax_amount: 180,
        total_amount: 1180,
        status: 'draft'
      }),
      JSON.stringify([
        {
          item_name: 'Signage Board Delhi',
          description: 'Test Item',
          quantity: 1,
          rate: 1000,
          total_price: 1000,
          total_amount: 1180,
          cgst_percent: 9,
          cgst_amount: 90,
          sgst_percent: 9,
          sgst_amount: 90
        }
      ])
    ]);
    const est = estRes.rows[0].result;
    testEstimateId = est.id;
    console.log(`Created estimate in W2 as Priyanka: ID ${testEstimateId}, Number: ${est.estimate_number}`);
    if (est.company_id !== 2 || est.client_id !== testClientId) {
      throw new Error('FAILURE: Estimate creation failed company isolation check!');
    }
    console.log('✓ Estimate created successfully for Priyanka in Workspace 2.');

  } finally {
    console.log('\n--- 7. CLEANUP TEST RECORDS ---');
    // Switch back to superuser for cleanup
    await client.query(`RESET role;`);
    if (testEstimateId) {
      await client.query(`DELETE FROM public.estimate_items WHERE estimate_id = $1;`, [testEstimateId]);
      await client.query(`DELETE FROM public.estimate_revisions WHERE estimate_id = $1;`, [testEstimateId]);
      await client.query(`DELETE FROM public.estimates WHERE id = $1;`, [testEstimateId]);
      console.log(`Cleaned up estimate ${testEstimateId}`);
    }
    if (testBrandId) {
      await client.query(`DELETE FROM public.brands WHERE id = $1;`, [testBrandId]);
      console.log(`Cleaned up brand ${testBrandId}`);
    }
    if (testClientId) {
      await client.query(`DELETE FROM public.client_billing_profiles WHERE client_id = $1;`, [testClientId]);
      await client.query(`DELETE FROM public.clients WHERE id = $1;`, [testClientId]);
      console.log(`Cleaned up test client ${testClientId}`);
    }
    console.log('Cleanup completed cleanly.');
  }

  console.log('\n--- 8. VERIFY ADMIN PERSPECTIVE ---');
  const adminW1 = await client.query(`SELECT count(*) FROM public.clients WHERE company_id = 1;`);
  const adminW2 = await client.query(`SELECT count(*) FROM public.clients WHERE company_id = 2;`);
  console.log(`Admin visible clients: W1 count = ${adminW1.rows[0].count}, W2 count = ${adminW2.rows[0].count}`);
  if (parseInt(adminW1.rows[0].count, 10) === 0 || parseInt(adminW2.rows[0].count, 10) === 0) {
    throw new Error('FAILURE: Admin visibility broken!');
  }
  console.log('✓ Admin retains full visibility across all authorized workspaces.');

  await client.end();
  console.log('\n======================================================');
  console.log('ALL LIVE PRIYANKA MANAGER ACCESS TESTS PASSED (100%)');
  console.log('======================================================');
}

main().catch(err => {
  console.error('\nVERIFICATION FAILED:', err);
  process.exit(1);
});
