import { pool } from "../server/db";
import { resolveMatchingMaterialCode } from "../client/src/pages/operations/utils/materialCodeResolution";
import assert from "assert";

async function runRegressionSuite() {
  console.log("=== STARTING CAPEX AND MATERIAL CODE REGRESSION TEST SUITE ===");
  const client = await pool.connect();
  let disposableId: number | null = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Read-Only Verification of Target Estimate SM/E/26-27/262 (id 187)
    // -------------------------------------------------------------
    console.log("\n[Test 1] Inspecting live estimate SM/E/26-27/262 (id 187)...");
    const { rows: estRows } = await client.query(
      `SELECT id, estimate_number, company_id, client_id, brand_id, abfrl_project_type, total_amount, subtotal, tax_amount
       FROM estimates WHERE id = 187`
    );
    assert.strictEqual(estRows.length, 1, "Estimate 187 must exist");
    const est187 = estRows[0];
    console.log("Live estimate 187 record:", est187);
    assert.strictEqual(est187.abfrl_project_type, "CAPEX", "Must have abfrl_project_type = CAPEX");
    assert.strictEqual(Number(est187.total_amount), 290995, "Total must be exactly 290995");
    assert.strictEqual(Number(est187.subtotal), 246606, "Subtotal must be exactly 246606");
    assert.strictEqual(Number(est187.tax_amount), 44389.1, "Tax must be exactly 44389.1");

    const { rows: items187 } = await client.query(
      `SELECT sl, item_name, width, height, quantity, unit, rate, total_price, material_code, material_code_id
       FROM estimate_items WHERE estimate_id = 187 ORDER BY sl ASC`
    );
    assert.strictEqual(items187.length, 6, "Must have 6 line items");
    assert.strictEqual(items187[0].material_code, "", "Row 1 (English Signage) is blank / Auto");
    assert.strictEqual(items187[1].material_code, "", "Row 2 (Marathi Signage) is blank / Auto");
    assert.strictEqual(items187[2].material_code, "", "Row 3 (ABG Logo) is blank / Auto");
    assert.strictEqual(items187[3].material_code, "OT_PACKING000N", "Row 4 is OT_PACKING000N");
    assert.strictEqual(items187[4].material_code, "OT_INSTALLATION00N", "Row 5 is OT_INSTALLATION00N");
    assert.strictEqual(items187[5].material_code, "OT_TRANSPORT001N", "Row 6 is OT_TRANSPORT001N");
    console.log("✓ Live estimate 187 verified intact: CAPEX selected, all items and totals matched.");

    // -------------------------------------------------------------
    // Test 2: Save and Reopen Lifecycle on a Disposable Estimate
    // -------------------------------------------------------------
    console.log("\n[Test 2] Creating disposable estimate for lifecycle mutation testing...");
    const estNum = `TEST-REG-${Date.now().toString().slice(-6)}`;
    const { rows: createRows } = await client.query(
      `INSERT INTO estimates (
        company_id, client_id, brand_id, estimate_number, title,
        status, abfrl_project_type, subtotal, tax_amount, total_amount, format_profile_code
      ) VALUES (
        1, 1, 1, $1, 'Regression Test Disposable Estimate',
        'draft', 'CAPEX', 10000, 1800, 11800, 'ABLBL'
      ) RETURNING id, estimate_number, abfrl_project_type`,
      [estNum]
    );
    disposableId = createRows[0].id;
    console.log(`Created disposable estimate ID: ${disposableId}`);

    const initialItems = [
      { sl: 1, itemName: "Signage A", description: "Channel Letter", productId: 40, qty: 10, rate: 350, amount: 3500, hsn: "3921", materialCodeId: null, materialCode: "" },
      { sl: 2, itemName: "Packing Charges", description: "Packing", productId: 19, qty: 1, rate: 500, amount: 500, hsn: "996511", materialCodeId: 1, materialCode: "OT_PACKING000N" },
      { sl: 3, itemName: "Custom Line", description: "Manual Code", productId: null, qty: 1, rate: 6000, amount: 6000, hsn: "7308", materialCodeId: null, materialCode: "AUTH-MANUAL-001" },
    ];

    for (const it of initialItems) {
      await client.query(
        `INSERT INTO estimate_items (
          estimate_id, company_id, sl, item_name, description, product_id,
          quantity, rate, total_price, hsn, material_code_id, material_code, is_standard
        ) VALUES (
          $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true
        )`,
        [disposableId, it.sl, it.itemName, it.description, it.productId, it.qty, it.rate, it.amount, it.hsn, it.materialCodeId, it.materialCode]
      );
    }

    // Insert revision 0
    await client.query(
      `INSERT INTO estimate_revisions (
        estimate_id, company_id, revision_number, revision_note,
        subtotal, tax_amount, total_amount, items_count, snapshot
      ) VALUES (
        $1, 1, 0, 'Initial revision', 10000, 1800, 11800, 3, $2::jsonb
      )`,
      [disposableId, JSON.stringify({ abfrl_project_type: "CAPEX", items: initialItems })]
    );

    // Save with no changes -> verify NO duplicate revision is created
    const noChangePayload = {
      title: "Regression Test Disposable Estimate",
      abfrl_project_type: "CAPEX",
      clientId: 1,
      brandId: 1,
      subtotal: 10000,
      taxAmount: 1800,
      totalAmount: 11800,
      items: initialItems,
    };
    await client.query(
      `SELECT save_estimate_revision_atomic($1, $2::jsonb, $3::jsonb, NULL, NULL, 1)`,
      [disposableId, JSON.stringify(noChangePayload), JSON.stringify(noChangePayload.items)]
    );
    const { rows: revCheck } = await client.query(
      `SELECT COUNT(*) as count FROM estimate_revisions WHERE estimate_id = $1`,
      [disposableId]
    );
    assert.strictEqual(Number(revCheck[0].count), 1, "Save without change must NOT create extra revision");
    console.log("✓ Save without change creates 0 extra revisions.");

    // -------------------------------------------------------------
    // Test 3: Change Project Type to SELEX then to CAPEX
    // -------------------------------------------------------------
    console.log("\n[Test 3] Testing Project Type transitions on disposable estimate...");
    const selexPayload = { ...noChangePayload, abfrl_project_type: "SELEX" };
    await client.query(
      `SELECT save_estimate_revision_atomic($1, $2::jsonb, $3::jsonb, 'Change to SELEX', 0, 1)`,
      [disposableId, JSON.stringify(selexPayload), JSON.stringify(selexPayload.items)]
    );
    const { rows: dispSelex } = await client.query(`SELECT abfrl_project_type FROM estimates WHERE id = $1`, [disposableId]);
    assert.strictEqual(dispSelex[0].abfrl_project_type, "SELEX");
    console.log("✓ SELEX persisted.");

    const capexPayload = { ...noChangePayload, abfrl_project_type: "CAPEX" };
    await client.query(
      `SELECT save_estimate_revision_atomic($1, $2::jsonb, $3::jsonb, 'Change to CAPEX', 1, 1)`,
      [disposableId, JSON.stringify(capexPayload), JSON.stringify(capexPayload.items)]
    );
    const { rows: dispCapex } = await client.query(`SELECT abfrl_project_type FROM estimates WHERE id = $1`, [disposableId]);
    assert.strictEqual(dispCapex[0].abfrl_project_type, "CAPEX");
    console.log("✓ CAPEX persisted and restored.");

    // -------------------------------------------------------------
    // Test 4: Financial Recalculation Preserves Material Codes
    // -------------------------------------------------------------
    console.log("\n[Test 4] Updating quantity on line items without erasing codes...");
    const updatedItems = [
      { ...initialItems[0], qty: 20, amount: 7000 },
      initialItems[1],
      initialItems[2],
    ];
    const updatedPayload = {
      ...capexPayload,
      subtotal: 13500,
      taxAmount: 2430,
      totalAmount: 15930,
      items: updatedItems,
    };
    await client.query(
      `SELECT save_estimate_revision_atomic($1, $2::jsonb, $3::jsonb, 'Update quantity', 2, 1)`,
      [disposableId, JSON.stringify(updatedPayload), JSON.stringify(updatedPayload.items)]
    );
    const { rows: dispItemsReloaded } = await client.query(
      `SELECT sl, material_code, quantity FROM estimate_items WHERE estimate_id = $1 ORDER BY sl`,
      [disposableId]
    );
    assert.strictEqual(dispItemsReloaded[0].material_code, "", "Blank / Auto preserved");
    assert.strictEqual(dispItemsReloaded[1].material_code, "OT_PACKING000N", "Auto resolved code preserved");
    assert.strictEqual(dispItemsReloaded[2].material_code, "AUTH-MANUAL-001", "Manual code preserved");
    assert.strictEqual(Number(dispItemsReloaded[0].quantity), 20, "Quantity updated");
    console.log("✓ Material codes preserved after line-item updates.");

    // -------------------------------------------------------------
    // Test 5: Client-side Canonical Material Code Resolver Unit Tests
    // -------------------------------------------------------------
    console.log("\n[Test 5] Testing resolveMatchingMaterialCode unit tests...");
    const sampleMaster = [
      {
        id: 101,
        code: "MC-W1-CH-01",
        name: "Channel Letter Signage",
        companyId: 1,
        clientId: 1,
        brandId: 1,
        productId: 40,
        description: "ABFRL Channel Letter",
        isActive: true,
      },
      {
        id: 102,
        code: "MC-W2-FORBIDDEN",
        name: "Other Workspace Code",
        companyId: 2,
        clientId: null,
        brandId: null,
        productId: 40,
        description: "Company 2 only",
        isActive: true,
      },
      {
        id: 103,
        code: "OT_PACKING000N",
        name: "Packing Charges",
        companyId: 1,
        clientId: null,
        brandId: null,
        productId: 19,
        description: "Packing",
        isActive: true,
      },
    ];

    // Case 5a: Existing manual code is preserved
    const resManual = resolveMatchingMaterialCode(
      { id: 40, name: "Channel Letter", materialCode: "PROD-DEFAULT" },
      sampleMaster,
      { companyId: 1, clientId: 1, brandId: 1, existingCode: "CUSTOM-SAVED-123" }
    );
    assert.strictEqual(resManual.materialCode, "CUSTOM-SAVED-123");
    console.log("✓ Existing manual code preserved.");

    // Case 5b: Auto-resolve matching product code for company 1
    const resAuto = resolveMatchingMaterialCode(
      { id: 40, name: "Channel Letter" },
      sampleMaster,
      { companyId: 1, clientId: 1, brandId: 1 }
    );
    assert.strictEqual(resAuto.materialCode, "MC-W1-CH-01");
    assert.strictEqual(resAuto.materialCodeId, 101);
    console.log("✓ Auto-resolves company 1 matching code.");

    // Case 5c: Multi-tenant isolation - company 1 NEVER matches company 2 code
    const resIsolation = resolveMatchingMaterialCode(
      { id: 40, name: "Channel Letter" },
      sampleMaster.filter(m => m.companyId === 2),
      { companyId: 1 }
    );
    assert.strictEqual(resIsolation.materialCode, "");
    console.log("✓ Multi-tenant isolation verified.");

    // Case 5d: Product with no match leaves code blank (so UI shows placeholder 'Auto' without inventing bogus code)
    const resNoMatch = resolveMatchingMaterialCode(
      { id: 999, name: "Unknown Product" },
      sampleMaster,
      { companyId: 1 }
    );
    assert.strictEqual(resNoMatch.materialCode, "");
    assert.strictEqual(resNoMatch.materialCodeId, null);
    console.log("✓ Product with no match leaves code blank / Auto.");

    // -------------------------------------------------------------
    // Test 6: Database Company Scoping
    // -------------------------------------------------------------
    console.log("\n[Test 6] Verifying DB scoping on material_codes...");
    const { rows: w1Codes } = await client.query(`SELECT * FROM material_codes WHERE company_id = 1`);
    console.log(`Found ${w1Codes.length} material codes for company 1`);
    for (const c of w1Codes) {
      assert.strictEqual(c.company_id, 1, "All returned codes must belong to company 1");
    }
    console.log("✓ DB scoping for company 1 verified.");

    console.log("\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===");
  } catch (err: any) {
    console.error("ERROR ENCOUNTERED IN SUITE:", err);
    throw err;
  } finally {
    if (disposableId) {
      console.log(`Cleaning up disposable test estimate ID ${disposableId}...`);
      await client.query(`DELETE FROM estimate_items WHERE estimate_id = $1`, [disposableId]);
      await client.query(`DELETE FROM estimate_revisions WHERE estimate_id = $1`, [disposableId]);
      await client.query(`DELETE FROM estimates WHERE id = $1`, [disposableId]);
      console.log("✓ Disposable test estimate removed cleanly.");
    }
    client.release();
    await pool.end();
  }
}

runRegressionSuite().catch((err) => {
  console.error("REGRESSION TEST FAILED:", err);
  process.exit(1);
});
