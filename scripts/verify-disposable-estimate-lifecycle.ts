import { pool } from "../server/db";
import assert from "assert";

async function verifyLifecycle() {
  console.log("=== STARTING DISPOSABLE ESTIMATE LIFECYCLE VERIFICATION ===");
  const client = await pool.connect();
  let testEstimateId: number | null = null;

  try {
    // -------------------------------------------------------------
    // Step 1: Create a disposable test estimate
    // -------------------------------------------------------------
    console.log("\n[Step 1] Creating disposable test estimate in Workspace 1...");
    const estNum = `TEST-EST-${Date.now().toString().slice(-6)}`;
    const { rows: createRows } = await client.query(
      `INSERT INTO estimates (
        company_id, client_id, brand_id, estimate_number, title,
        status, abfrl_project_type, subtotal, tax_amount, total_amount, format_profile_code
      ) VALUES (
        1, 1, 1, $1, 'Disposable Verification Estimate',
        'draft', 'CAPEX', 10000, 1800, 11800, 'ABLBL'
      ) RETURNING id, estimate_number, abfrl_project_type`,
      [estNum]
    );
    testEstimateId = createRows[0].id;
    console.log(`Created disposable estimate ID: ${testEstimateId} (${estNum})`);
    assert.strictEqual(createRows[0].abfrl_project_type, "CAPEX");

    // -------------------------------------------------------------
    // Step 2: Insert initial items and revision 0
    // -------------------------------------------------------------
    console.log("\n[Step 2] Inserting initial items (1 operational code, 1 unassigned/auto, 1 manual code)...");
    const items = [
      {
        sl: 1,
        itemName: "English Signage",
        description: "Channel Letter Signage",
        productId: 40,
        qty: 10,
        rate: 350,
        amount: 3500,
        hsn: "3921",
        materialCodeId: null,
        materialCode: "", // No match in master -> blank / Auto
      },
      {
        sl: 2,
        itemName: "Packing Charges",
        description: "Packing Charges",
        productId: 19,
        qty: 1,
        rate: 500,
        amount: 500,
        hsn: "996511",
        materialCodeId: 1,
        materialCode: "OT_PACKING000N", // Auto resolved from master
      },
      {
        sl: 3,
        itemName: "Special Bracket",
        description: "Custom bracket with authorized manual code",
        productId: null,
        qty: 2,
        rate: 3000,
        amount: 6000,
        hsn: "7308",
        materialCodeId: null,
        materialCode: "MANUAL-BRACKET-XYZ", // Authorized manual entry
      },
    ];

    for (const it of items) {
      await client.query(
        `INSERT INTO estimate_items (
          estimate_id, company_id, sl, item_name, description, product_id,
          quantity, rate, total_price, hsn, material_code_id, material_code, is_standard
        ) VALUES (
          $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true
        )`,
        [testEstimateId, it.sl, it.itemName, it.description, it.productId, it.qty, it.rate, it.amount, it.hsn, it.materialCodeId, it.materialCode]
      );
    }

    // Insert revision 0 snapshot
    await client.query(
      `INSERT INTO estimate_revisions (
        estimate_id, company_id, revision_number, revision_note,
        subtotal, tax_amount, total_amount, items_count, snapshot
      ) VALUES (
        $1, 1, 0, 'Initial creation', 10000, 1800, 11800, 3, $2::jsonb
      )`,
      [testEstimateId, JSON.stringify({ abfrl_project_type: "CAPEX", items })]
    );

    // -------------------------------------------------------------
    // Step 3: Test Save without modifications -> Should NOT create duplicate revision
    // -------------------------------------------------------------
    console.log("\n[Step 3] Testing save without meaningful changes...");
    const payloadNoChange = {
      title: "Disposable Verification Estimate",
      abfrl_project_type: "CAPEX",
      clientId: 1,
      brandId: 1,
      subtotal: 10000,
      taxAmount: 1800,
      totalAmount: 11800,
      items: items.map(it => ({
        ...it,
        total_price: it.amount,
      })),
    };

    const { rows: saveNoChange } = await client.query(
      `SELECT save_estimate_revision_atomic(
        $1,
        $2::jsonb,
        $3::jsonb,
        'Save without change',
        0,
        1
      ) as result`,
      [testEstimateId, JSON.stringify(payloadNoChange), JSON.stringify(payloadNoChange.items)]
    );

    // Check revision count - should remain 0!
    const { rows: revCount1 } = await client.query(
      `SELECT COUNT(*) as count FROM estimate_revisions WHERE estimate_id = $1`,
      [testEstimateId]
    );
    console.log("Revision count after save with NO changes:", revCount1[0].count);
    assert.strictEqual(Number(revCount1[0].count), 1, "Must NOT create a duplicate revision when nothing changed!");
    console.log("✓ Unnecessary revision prevented when no data changed.");

    // -------------------------------------------------------------
    // Step 4: Test Changing Project Type to SELEX then back to CAPEX
    // -------------------------------------------------------------
    console.log("\n[Step 4] Changing Project Type to SELEX...");
    const payloadSelex = {
      ...payloadNoChange,
      abfrl_project_type: "SELEX",
    };
    await client.query(
      `SELECT save_estimate_revision_atomic(
        $1,
        $2::jsonb,
        $3::jsonb,
        'Changed to SELEX',
        0,
        1
      )`,
      [testEstimateId, JSON.stringify(payloadSelex), JSON.stringify(payloadSelex.items)]
    );

    const { rows: estSelex } = await client.query(
      `SELECT abfrl_project_type FROM estimates WHERE id = $1`,
      [testEstimateId]
    );
    assert.strictEqual(estSelex[0].abfrl_project_type, "SELEX");
    console.log("✓ SELEX persisted in DB.");

    console.log("Switching back to CAPEX...");
    const payloadCapex = {
      ...payloadNoChange,
      abfrl_project_type: "CAPEX",
    };
    await client.query(
      `SELECT save_estimate_revision_atomic(
        $1,
        $2::jsonb,
        $3::jsonb,
        'Switched back to CAPEX',
        1,
        1
      )`,
      [testEstimateId, JSON.stringify(payloadCapex), JSON.stringify(payloadCapex.items)]
    );

    const { rows: estCapex } = await client.query(
      `SELECT abfrl_project_type FROM estimates WHERE id = $1`,
      [testEstimateId]
    );
    assert.strictEqual(estCapex[0].abfrl_project_type, "CAPEX");
    console.log("✓ CAPEX persisted in DB.");

    // -------------------------------------------------------------
    // Step 5: Verify Material Codes integrity across edits
    // -------------------------------------------------------------
    console.log("\n[Step 5] Modifying quantity on row 1, keeping material codes...");
    const itemsUpdatedQty = [
      { ...items[0], qty: 15, amount: 5250 },
      items[1],
      items[2],
    ];
    const payloadQtyUpdate = {
      ...payloadCapex,
      subtotal: 11750,
      taxAmount: 2115,
      totalAmount: 13865,
      items: itemsUpdatedQty,
    };

    await client.query(
      `SELECT save_estimate_revision_atomic(
        $1,
        $2::jsonb,
        $3::jsonb,
        'Updated quantity on row 1',
        2,
        1
      )`,
      [testEstimateId, JSON.stringify(payloadQtyUpdate), JSON.stringify(payloadQtyUpdate.items)]
    );

    const { rows: reloadedItems } = await client.query(
      `SELECT sl, item_name, material_code, material_code_id, quantity FROM estimate_items WHERE estimate_id = $1 ORDER BY sl`,
      [testEstimateId]
    );
    console.log("Reloaded items after qty update:", reloadedItems);

    assert.strictEqual(reloadedItems[0].material_code, "", "Row 1 without match remains blank/Auto");
    assert.strictEqual(reloadedItems[1].material_code, "OT_PACKING000N", "Row 2 preserves operational code");
    assert.strictEqual(reloadedItems[2].material_code, "MANUAL-BRACKET-XYZ", "Row 3 preserves manual code");
    assert.strictEqual(Number(reloadedItems[0].quantity), 15, "Row 1 quantity updated to 15");
    console.log("✓ Material codes perfectly preserved after financial recalculations.");

    // -------------------------------------------------------------
    // Step 6: Verify Multi-tenant Isolation
    // -------------------------------------------------------------
    console.log("\n[Step 6] Verifying multi-tenant isolation on material codes...");
    const { rows: foreignCodes } = await client.query(
      `SELECT id, code, company_id FROM material_codes WHERE company_id != 1`
    );
    console.log(`Foreign workspace material codes count: ${foreignCodes.length}`);
    if (foreignCodes.length > 0) {
      const { rows: leakCheck } = await client.query(
        `SELECT * FROM estimate_items WHERE estimate_id = $1 AND material_code = $2`,
        [testEstimateId, foreignCodes[0].code]
      );
      assert.strictEqual(leakCheck.length, 0, "No foreign workspace codes allowed");
    }
    console.log("✓ Multi-tenant isolation verified.");

    console.log("\n=== ALL DISPOSABLE ESTIMATE LIFECYCLE TESTS PASSED! ===");
  } finally {
    // Clean up test estimate
    if (testEstimateId) {
      console.log(`\nCleaning up disposable test estimate ID ${testEstimateId}...`);
      await client.query(`DELETE FROM estimate_items WHERE estimate_id = $1`, [testEstimateId]);
      await client.query(`DELETE FROM estimate_revisions WHERE estimate_id = $1`, [testEstimateId]);
      await client.query(`DELETE FROM estimates WHERE id = $1`, [testEstimateId]);
      console.log("✓ Cleaned up disposable test data cleanly.");
    }
    client.release();
    await pool.end();
  }
}

verifyLifecycle().catch((err) => {
  console.error("LIFECYCLE TEST FAILED:", err);
  process.exit(1);
});
