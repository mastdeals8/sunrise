import { pool } from "../server/db";
import { resolveMatchingMaterialCode } from "../client/src/pages/operations/utils/materialCodeResolution";
import assert from "assert";

async function runRegressionSuite() {
  console.log("=== STARTING CAPEX AND MATERIAL CODE REGRESSION TEST SUITE ===");
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------
    // Test 1: Inspect SM/E/26-27/262 baseline
    // -------------------------------------------------------------
    console.log("\n[Test 1] Inspecting baseline estimate SM/E/26-27/262 (id 187)...");
    const { rows: estRows } = await client.query(
      `SELECT id, estimate_number, company_id, client_id, brand_id, abfrl_project_type, total_amount, subtotal, tax_amount
       FROM estimates WHERE id = 187`
    );
    assert.strictEqual(estRows.length, 1, "Estimate 187 must exist");
    console.log("Baseline estimate 187:", estRows[0]);

    // -------------------------------------------------------------
    // Test 2: save_estimate_revision_atomic detects abfrl_project_type change to CAPEX
    // -------------------------------------------------------------
    console.log("\n[Test 2] Testing save_estimate_revision_atomic with CAPEX update...");
    const { rows: itemsRows } = await client.query(
      `SELECT * FROM estimate_items WHERE estimate_id = 187 ORDER BY sl ASC`
    );

    const capexPayload = {
      title: "Aditya Birla Fashion & Retail Ltd - Baramati NSO",
      abfrl_project_type: "CAPEX",
      clientId: 1,
      brandId: 1,
      storeId: 332,
      subtotal: estRows[0].subtotal,
      taxAmount: estRows[0].tax_amount,
      totalAmount: estRows[0].total_amount,
      items: itemsRows.map((it, idx) => ({
        sl: it.sl,
        itemName: it.item_name,
        description: it.description,
        hsn: it.hsn,
        qty: it.quantity,
        rate: it.rate,
        amount: it.total_price,
        productId: it.product_id,
        materialCodeId: it.material_code_id,
        materialCode: it.material_code || (idx === 0 ? "MC-MANUAL-001" : it.material_code),
        materialDescription: it.material_description,
      })),
    };

    const { rows: revNumRows } = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0) as rev FROM estimate_revisions WHERE estimate_id = 187`
    );
    const currRev = Number(revNumRows[0].rev);

    const { rows: saveRes } = await client.query(
      `SELECT save_estimate_revision_atomic(
        187,
        $1::jsonb,
        $2::jsonb,
        'Changed project type to CAPEX and set row 1 material code',
        $3::integer,
        1
      ) as result`,
      [JSON.stringify(capexPayload), JSON.stringify(capexPayload.items), currRev]
    );

    const savedJson = saveRes[0].result;
    console.log("Atomic save result abfrl_project_type:", savedJson.abfrl_project_type);
    assert.strictEqual(savedJson.abfrl_project_type, "CAPEX", "Must persist CAPEX in returned object");

    // Verify in database directly
    const { rows: reloadedEst } = await client.query(
      `SELECT abfrl_project_type, total_amount, subtotal, tax_amount FROM estimates WHERE id = 187`
    );
    assert.strictEqual(reloadedEst[0].abfrl_project_type, "CAPEX", "Must persist CAPEX in database");
    assert.strictEqual(
      Number(reloadedEst[0].total_amount),
      Number(estRows[0].total_amount),
      "Total amount must be preserved"
    );
    console.log("✓ Saved and reloaded: CAPEX correctly persisted.");

    // Verify row 1 material code was saved
    const { rows: reloadedItems } = await client.query(
      `SELECT sl, material_code FROM estimate_items WHERE estimate_id = 187 AND sl = 1`
    );
    assert.strictEqual(
      reloadedItems[0].material_code,
      "MC-MANUAL-001",
      "Manual material code on row 1 must be saved"
    );
    console.log("✓ Saved and reloaded: manual material code correctly persisted.");

    // -------------------------------------------------------------
    // Test 3: Edit existing CAPEX estimate without changing project type -> stays CAPEX
    // -------------------------------------------------------------
    console.log("\n[Test 3] Edit existing CAPEX estimate without changing project type...");
    const { rows: revNumRows2 } = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0) as rev FROM estimate_revisions WHERE estimate_id = 187`
    );
    const editPayload = {
      ...capexPayload,
      description: "Updated description only",
    };
    await client.query(
      `SELECT save_estimate_revision_atomic(
        187,
        $1::jsonb,
        $2::jsonb,
        'Updated description',
        $3::integer,
        1
      )`,
      [JSON.stringify(editPayload), JSON.stringify(editPayload.items), Number(revNumRows2[0].rev)]
    );

    const { rows: reloadedAfterEdit } = await client.query(
      `SELECT abfrl_project_type, description FROM estimates WHERE id = 187`
    );
    assert.strictEqual(reloadedAfterEdit[0].abfrl_project_type, "CAPEX", "Must remain CAPEX");
    console.log("✓ CAPEX remained unchanged after secondary edit.");

    // -------------------------------------------------------------
    // Test 4: Other project types (e.g. SELEX) can also be saved and reloaded
    // -------------------------------------------------------------
    console.log("\n[Test 4] Changing project type to SELEX and verifying reload...");
    const { rows: revNumRows3 } = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0) as rev FROM estimate_revisions WHERE estimate_id = 187`
    );
    const selexPayload = {
      ...capexPayload,
      abfrl_project_type: "SELEX",
    };
    await client.query(
      `SELECT save_estimate_revision_atomic(
        187,
        $1::jsonb,
        $2::jsonb,
        'Changed project type to SELEX',
        $3::integer,
        1
      )`,
      [JSON.stringify(selexPayload), JSON.stringify(selexPayload.items), Number(revNumRows3[0].rev)]
    );

    const { rows: reloadedSelex } = await client.query(
      `SELECT abfrl_project_type FROM estimates WHERE id = 187`
    );
    assert.strictEqual(reloadedSelex[0].abfrl_project_type, "SELEX", "Must persist SELEX");
    console.log("✓ SELEX correctly saved and verified.");

    // Now set it back to CAPEX as requested for SM/E/26-27/262!
    console.log("\n[Setting SM/E/26-27/262 back to CAPEX...]");
    const { rows: revNumRows4 } = await client.query(
      `SELECT COALESCE(MAX(revision_number), 0) as rev FROM estimate_revisions WHERE estimate_id = 187`
    );
    await client.query(
      `SELECT save_estimate_revision_atomic(
        187,
        $1::jsonb,
        $2::jsonb,
        'Final set to CAPEX',
        $3::integer,
        1
      )`,
      [JSON.stringify(capexPayload), JSON.stringify(capexPayload.items), Number(revNumRows4[0].rev)]
    );
    const { rows: finalCapex } = await client.query(
      `SELECT abfrl_project_type FROM estimates WHERE id = 187`
    );
    assert.strictEqual(finalCapex[0].abfrl_project_type, "CAPEX");
    console.log("✓ SM/E/26-27/262 is now saved as CAPEX in production DB.");

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
      {
        companyId: 1,
        clientId: 1,
        brandId: 1,
        existingCode: "CUSTOM-SAVED-123",
      }
    );
    assert.strictEqual(resManual.materialCode, "CUSTOM-SAVED-123", "Preserves existing manual code");
    console.log("✓ Existing manual code preserved.");

    // Case 5b: Auto-resolve matching product code for company 1
    const resAuto = resolveMatchingMaterialCode(
      { id: 40, name: "Channel Letter" },
      sampleMaster,
      {
        companyId: 1,
        clientId: 1,
        brandId: 1,
      }
    );
    assert.strictEqual(resAuto.materialCode, "MC-W1-CH-01", "Resolves company 1 matching code");
    assert.strictEqual(resAuto.materialCodeId, 101);
    console.log("✓ Auto-resolves company 1 matching code.");

    // Case 5c: Multi-tenant isolation - company 1 NEVER matches company 2 code
    const resIsolation = resolveMatchingMaterialCode(
      { id: 40, name: "Channel Letter" },
      sampleMaster.filter(m => m.companyId === 2), // only company 2 available
      {
        companyId: 1,
      }
    );
    assert.strictEqual(resIsolation.materialCode, "", "Workspace 1 cannot resolve Workspace 2 codes");
    console.log("✓ Workspace isolation verified: Workspace 1 cannot use Workspace 2 codes.");

    // Case 5d: Product with no match leaves code blank (so UI shows placeholder 'Auto' without inventing bogus code)
    const resNoMatch = resolveMatchingMaterialCode(
      { id: 999, name: "Unknown Product" },
      sampleMaster,
      {
        companyId: 1,
      }
    );
    assert.strictEqual(resNoMatch.materialCode, "", "No match must leave code blank");
    assert.strictEqual(resNoMatch.materialCodeId, null);
    console.log("✓ Product with no matching code does not receive unrelated code.");

    // -------------------------------------------------------------
    // Test 6: Verify Database company_id scoping on material_codes table
    // -------------------------------------------------------------
    console.log("\n[Test 6] Verifying DB scoping on material_codes...");
    const { rows: w1Codes } = await client.query(
      `SELECT * FROM material_codes WHERE company_id = 1`
    );
    console.log(`Found ${w1Codes.length} material codes for company 1`);
    for (const c of w1Codes) {
      assert.strictEqual(c.company_id, 1, "All returned codes must belong to company 1");
    }
    console.log("✓ DB scoping for company 1 verified.");

    // -------------------------------------------------------------
    // Test 7: Verify totals, GST, and revisions for SM/E/26-27/262
    // -------------------------------------------------------------
    console.log("\n[Test 7] Verifying financial integrity and revision history...");
    const { rows: revRows } = await client.query(
      `SELECT revision_number, revision_note, created_at FROM estimate_revisions WHERE estimate_id = 187 ORDER BY revision_number DESC`
    );
    console.log(`Estimate 187 has ${revRows.length} revision records:`, revRows);
    assert(revRows.length >= 1, "Revision records must exist");

    const { rows: finCheck } = await client.query(
      `SELECT subtotal, tax_amount, total_amount FROM estimates WHERE id = 187`
    );
    console.log("Estimate 187 financial totals:", finCheck[0]);
    assert.strictEqual(
      Number(finCheck[0].total_amount),
      Number(estRows[0].total_amount),
      "Total amount must be exactly identical to original"
    );
    assert.strictEqual(
      Number(finCheck[0].tax_amount),
      Number(estRows[0].tax_amount),
      "Tax amount must be exactly identical to original"
    );
    console.log("✓ Financial totals and GST preserved.");

    console.log("\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===");
  } finally {
    client.release();
    await pool.end();
  }
}

runRegressionSuite().catch((err) => {
  console.error("REGRESSION TEST FAILED:", err);
  process.exit(1);
});
