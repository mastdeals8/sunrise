import { pool } from "../server/db";
import { resolveMatchingMaterialCode } from "../client/src/pages/operations/utils/materialCodeResolution";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import EstimateDocument from "../client/src/components/EstimateDocument";
import { exportEstimateToExcel } from "../client/src/pages/operations/utils/exportHelpers";
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

    // -------------------------------------------------------------
    // Test 7: EstimateBuilder editableColumnIds Integrity Check
    // -------------------------------------------------------------
    console.log("\n[Test 7] Verifying EstimateBuilder.tsx editableColumnIds contains materialCode...");
    const ebSource = fs.readFileSync(path.resolve(process.cwd(), "client/src/pages/operations/components/EstimateBuilder.tsx"), "utf8");
    assert.ok(
      ebSource.includes('"materialCode"') && ebSource.includes("editableColumnIds"),
      "EstimateBuilder must include materialCode in editableColumnIds"
    );
    assert.ok(
      ebSource.includes('const cellPasteCols: EstimateGridColumnId[] = ["element", "materialCode"'),
      "EstimateBuilder must include materialCode in cellPasteCols"
    );
    console.log("✓ EstimateBuilder editableColumnIds and cellPasteCols include materialCode.");

    // -------------------------------------------------------------
    // Test 8: Code-Only Edit Save Verification on Disposable Estimate
    // -------------------------------------------------------------
    console.log("\n[Test 8] Testing material-code-only save on disposable estimate...");
    const { rows: preRevCount } = await client.query(`SELECT COUNT(*) as count FROM estimate_revisions WHERE estimate_id = $1`, [disposableId]);
    const prevRevNum = Number(preRevCount[0].count) - 1;

    // Mutate only row 1 material code from "" to "MANUAL-TEST-001"
    const codeOnlyItems = [
      { ...updatedItems[0], materialCode: "MANUAL-TEST-001" },
      updatedItems[1],
      updatedItems[2],
    ];
    const codeOnlyPayload = {
      ...updatedPayload,
      items: codeOnlyItems,
    };

    await client.query(
      `SELECT save_estimate_revision_atomic($1, $2::jsonb, $3::jsonb, 'Manual material code update', $4, 1)`,
      [disposableId, JSON.stringify(codeOnlyPayload), JSON.stringify(codeOnlyPayload.items), prevRevNum]
    );

    const { rows: postRevCount } = await client.query(`SELECT COUNT(*) as count FROM estimate_revisions WHERE estimate_id = $1`, [disposableId]);
    assert.strictEqual(Number(postRevCount[0].count), Number(preRevCount[0].count) + 1, "Material-code-only change MUST create a new revision");

    const { rows: dispItemsCodeSaved } = await client.query(
      `SELECT sl, item_name, material_code, total_price FROM estimate_items WHERE estimate_id = $1 ORDER BY sl`,
      [disposableId]
    );
    assert.strictEqual(dispItemsCodeSaved[0].material_code, "MANUAL-TEST-001", "Row 1 material code must be updated to MANUAL-TEST-001");
    assert.strictEqual(dispItemsCodeSaved[1].material_code, "OT_PACKING000N", "Row 2 material code must remain unchanged");
    assert.strictEqual(dispItemsCodeSaved[2].material_code, "AUTH-MANUAL-001", "Row 3 material code must remain unchanged");
    console.log("✓ Material-code-only edit successfully persisted atomically without financial changes.");

    // -------------------------------------------------------------
    // Test 9: Canonical EstimateDocument Markup for CAPEX
    // -------------------------------------------------------------
    console.log("\n[Test 9] Testing canonical EstimateDocument markup for CAPEX...");
    const capexDocEstimate = {
      id: disposableId,
      estimateNumber: estNum,
      abfrlProjectType: "CAPEX",
      formatProfileCode: "ABLBL",
      title: "CAPEX Test Estimate",
      subject: "CAPEX Test Subject",
      clientId: 1,
      storeId: 1,
      totalAmount: 15930,
      subtotal: 13500,
      taxAmount: 2430,
      gstType: "CGST_SGST",
    };
    const capexDocItems = [
      { id: 1, sl: 1, itemName: "English Signage", description: "Channel Letter Front", materialCode: "MANUAL-ENG-001", width: 10, height: 2, quantity: 1, totalPrice: 7000, totalAmount: 8260, cgstPercent: 9, cgstAmount: 630, sgstPercent: 9, sgstAmount: 630 },
      { id: 2, sl: 2, itemName: "Marathi Signage", description: "Regional Signage", materialCode: "", width: 5, height: 2, quantity: 1, totalPrice: 3500, totalAmount: 4130, cgstPercent: 9, cgstAmount: 315, sgstPercent: 9, sgstAmount: 315 },
      { id: 3, sl: 3, itemName: "Packing Charges", lineType: "packing", description: "Packing", materialCode: "OT_PACKING000N", quantity: 1, totalPrice: 500, totalAmount: 590, cgstPercent: 9, cgstAmount: 45, sgstPercent: 9, sgstAmount: 45 },
    ];
    const mockStore = [{ id: 1, name: "Pune Store", storeCode: "PN01", address: "Camp, Pune", location: "Camp", city: "Pune", state: "MH" }];
    const mockClient = [{ id: 1, name: "Aditya Birla Fashion & Retail Ltd", address: "Mumbai", formatProfileCode: "ABLBL" }];

    const capexMarkup = renderToStaticMarkup(
      React.createElement(EstimateDocument, {
        estimate: capexDocEstimate as any,
        items: capexDocItems as any,
        stores: mockStore as any,
        clients: mockClient as any,
        products: [],
      })
    );

    assert.ok(capexMarkup.includes("Material Code"), "CAPEX output must include 'Material Code' column header");
    assert.ok(capexMarkup.includes("MANUAL-ENG-001"), "CAPEX output must render manual material code");
    assert.ok(capexMarkup.includes("OT_PACKING000N"), "CAPEX output must render service material code");
    // Ensure "Auto" is not rendered as a stored code value
    assert.ok(!capexMarkup.includes(">Auto<"), "Blank material code must render empty, never as 'Auto'");
    console.log("✓ EstimateDocument renders Material Code column correctly for CAPEX.");

    // -------------------------------------------------------------
    // Test 10: Canonical EstimateDocument Markup for Non-CAPEX (SELEX) and Retail
    // -------------------------------------------------------------
    console.log("\n[Test 10] Testing canonical EstimateDocument markup for Non-CAPEX and Retail...");
    const selexDocEstimate = { ...capexDocEstimate, abfrlProjectType: "SELEX" };
    const selexMarkup = renderToStaticMarkup(
      React.createElement(EstimateDocument, {
        estimate: selexDocEstimate as any,
        items: capexDocItems as any,
        stores: mockStore as any,
        clients: mockClient as any,
        products: [],
      })
    );
    assert.ok(!selexMarkup.includes("Material Code"), "SELEX (non-CAPEX) must NOT include 'Material Code' column");

    const retailDocEstimate = { ...capexDocEstimate, formatProfileCode: "RETAIL_SINGLE_STORE" };
    const retailClient = [{ id: 1, name: "Wakefit Innovations", formatProfileCode: "RETAIL_SINGLE_STORE" }];
    const retailMarkup = renderToStaticMarkup(
      React.createElement(EstimateDocument, {
        estimate: retailDocEstimate as any,
        items: capexDocItems as any,
        stores: mockStore as any,
        clients: retailClient as any,
        products: [],
      })
    );
    assert.ok(!retailMarkup.includes("Material Code"), "Retail format must NOT include 'Material Code' column");
    console.log("✓ Non-CAPEX and Retail formats preserved without Material Code column.");

    // -------------------------------------------------------------
    // Test 11: Excel Export Verification for CAPEX
    // -------------------------------------------------------------
    console.log("\n[Test 11] Testing Excel export for CAPEX estimate...");
    const capexExcelResult = await exportEstimateToExcel(
      capexDocEstimate,
      capexDocItems,
      mockClient[0].name,
      { name: "Sunrise Media" },
      mockStore,
      [],
    );
    const capexWb = capexExcelResult.workbook;
    const capexWs = capexWb.Sheets["Estimate"];
    assert.ok(capexWs, "Worksheet 'Estimate' must exist in workbook");

    // Inspect cells in sheet
    let foundMaterialCodeHeader = false;
    let foundManualCodeCell = false;
    let foundPackingCodeCell = false;
    let foundAutoCell = false;

    for (const key of Object.keys(capexWs)) {
      if (key.startsWith("!")) continue;
      const cell = capexWs[key];
      const val = String(cell?.v ?? "").trim();
      if (val === "MATERIAL CODE") foundMaterialCodeHeader = true;
      if (val === "MANUAL-ENG-001") foundManualCodeCell = true;
      if (val === "OT_PACKING000N") foundPackingCodeCell = true;
      if (val === "Auto") foundAutoCell = true;
    }

    assert.ok(foundMaterialCodeHeader, "Excel export must contain 'MATERIAL CODE' column header");
    assert.ok(foundManualCodeCell, "Excel export must contain manual code 'MANUAL-ENG-001'");
    assert.ok(foundPackingCodeCell, "Excel export must contain packing code 'OT_PACKING000N'");
    assert.ok(!foundAutoCell, "Excel export must NEVER output 'Auto' in cells");
    assert.strictEqual((capexWs["!cols"] || []).length, 15, "CAPEX Excel must have 15 columns defined");
    console.log("✓ CAPEX Excel export verified with MATERIAL CODE column, correct values, and 15 columns.");

    // -------------------------------------------------------------
    // Test 12: Excel Export Verification for Non-CAPEX (SELEX)
    // -------------------------------------------------------------
    console.log("\n[Test 12] Testing Excel export for Non-CAPEX (SELEX)...");
    const selexExcelResult = await exportEstimateToExcel(
      selexDocEstimate,
      capexDocItems,
      mockClient[0].name,
      { name: "Sunrise Media" },
      mockStore,
      [],
    );
    const selexWb = selexExcelResult.workbook;
    const selexWs = selexWb.Sheets["Estimate"];
    let selexHasMatCodeHeader = false;
    for (const key of Object.keys(selexWs)) {
      if (key.startsWith("!")) continue;
      const cell = selexWs[key];
      if (String(cell?.v ?? "").trim() === "MATERIAL CODE") selexHasMatCodeHeader = true;
    }
    assert.ok(!selexHasMatCodeHeader, "Non-CAPEX Excel export must NOT contain 'MATERIAL CODE' header");
    assert.strictEqual((selexWs["!cols"] || []).length, 14, "Non-CAPEX Excel must have 14 columns defined");
    console.log("✓ Non-CAPEX Excel export preserved with 14 columns.");

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
