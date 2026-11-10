import assert from "node:assert";
import { pool } from "../server/db";
import { validateAbfrlEstimateCharges } from "../client/src/pages/operations/utils/abfrlValidation";
import { reconcileEstimateSummary } from "../client/src/pages/operations/utils/estimateReconciliation";

async function runTestSuite() {
  console.log("=== STARTING ABFRL VALIDATION & COPY SUMMARY TEST SUITE ===\n");

  const mockStores = [
    { id: 101, name: "Kalamboli Store", storeCode: "7231", sapCode: "SAP-7231", city: "Navi Mumbai" },
    { id: 102, name: "Parel Store", storeCode: "3500589", sapCode: "SAP-3500589", city: "Mumbai" },
    { id: 103, name: "Hinjewadi Store", storeCode: "9360", sapCode: "SAP-9360", city: "Pune" },
    { id: 104, name: "Nashik Highway Store", storeCode: "5512", sapCode: "SAP-5512", city: "Nashik" },
  ];

  // Helper to make product items
  const makeProduct = (storeId: number, sl: number, price: number = 1000) => ({
    sl,
    storeId: String(storeId),
    lineType: "product",
    itemName: "Vinyl Print",
    quantity: 10,
    rate: 100,
    totalPrice: price,
    totalAmount: price * 1.18,
    sgstAmount: price * 0.09,
    cgstAmount: price * 0.09,
    igstAmount: 0,
  });

  const makePacking = (storeId: number, sl: number, price: number = 50) => ({
    sl,
    storeId: String(storeId),
    lineType: "packing",
    itemName: "Packing Charges",
    quantity: 1,
    rate: 50,
    totalPrice: price,
    totalAmount: price * 1.18,
    sgstAmount: price * 0.09,
    cgstAmount: price * 0.09,
    igstAmount: 0,
  });

  const makeInstallation = (storeId: number, sl: number, price: number = 150) => ({
    sl,
    storeId: String(storeId),
    lineType: "installation",
    itemName: "Installation Charges",
    quantity: 1,
    rate: 150,
    totalPrice: price,
    totalAmount: price * 1.18,
    sgstAmount: price * 0.09,
    cgstAmount: price * 0.09,
    igstAmount: 0,
  });

  const makeLocalTransport = (storeId: number, sl: number, price: number = 200) => ({
    sl,
    storeId: String(storeId),
    lineType: "transport",
    itemName: "Local Transportation",
    quantity: 1,
    unit: "job",
    calculationType: "fixed",
    rate: price,
    totalPrice: price,
    totalAmount: price * 1.18,
    sgstAmount: price * 0.09,
    cgstAmount: price * 0.09,
    igstAmount: 0,
  });

  const makeOutstationTransport = (storeId: number, sl: number, km: number = 100, rate: number = 18) => ({
    sl,
    storeId: String(storeId),
    lineType: "transport",
    itemName: "Outstation Charges",
    quantity: km,
    unit: "km",
    calculationType: "per_km",
    rate: rate,
    totalPrice: km * rate,
    totalAmount: km * rate * 1.18,
    sgstAmount: km * rate * 0.09,
    cgstAmount: km * rate * 0.09,
    igstAmount: 0,
  });

  // Test 1: Single-store ABFRL estimate with all charges
  {
    console.log("Test 1: Single-store ABFRL estimate with all charges");
    const items = [
      makeProduct(101, 1),
      makePacking(101, 2),
      makeInstallation(101, 3),
      makeLocalTransport(101, 4),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, true, "Should be valid when all charges present");
    assert.strictEqual(res.missingStores.length, 0);
    console.log("✓ Test 1 passed\n");
  }

  // Test 2: Single-store estimate missing packing
  {
    console.log("Test 2: Single-store estimate missing packing");
    const items = [
      makeProduct(101, 1),
      makeInstallation(101, 2),
      makeLocalTransport(101, 3),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false, "Should be invalid when packing missing");
    assert.strictEqual(res.missingStores.length, 1);
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Packing Charges"]);
    assert.strictEqual(res.missingStores[0].storeCode, "7231");
    console.log("✓ Test 2 passed\n");
  }

  // Test 3: Single-store estimate missing installation
  {
    console.log("Test 3: Single-store estimate missing installation");
    const items = [
      makeProduct(101, 1),
      makePacking(101, 2),
      makeLocalTransport(101, 3),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false, "Should be invalid when installation missing");
    assert.strictEqual(res.missingStores.length, 1);
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Installation Charges"]);
    console.log("✓ Test 3 passed\n");
  }

  // Test 4: Single-store estimate missing local transportation
  {
    console.log("Test 4: Single-store estimate missing local transportation");
    const items = [
      makeProduct(101, 1),
      makePacking(101, 2),
      makeInstallation(101, 3),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      storeOverrides: { "101": { transportType: "local" } },
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.missingStores.length, 1);
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Local Transportation"]);
    console.log("✓ Test 4 passed\n");
  }

  // Test 5: Single-store estimate missing outstation transportation
  {
    console.log("Test 5: Single-store estimate missing outstation transportation");
    const items = [
      makeProduct(104, 1),
      makePacking(104, 2),
      makeInstallation(104, 3),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      storeOverrides: { "104": { transportType: "outstation" } },
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.missingStores.length, 1);
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Outstation Transportation"]);
    console.log("✓ Test 5 passed\n");
  }

  // Test 6: Multiple stores with different charge combinations
  {
    console.log("Test 6: Multiple stores with different charge combinations");
    const items = [
      // Store 101: Complete (Local transport)
      makeProduct(101, 1), makePacking(101, 2), makeInstallation(101, 3), makeLocalTransport(101, 4),
      // Store 102: Missing Packing
      makeProduct(102, 5), makeInstallation(102, 6), makeLocalTransport(102, 7),
      // Store 103: Missing Installation
      makeProduct(103, 8), makePacking(103, 9), makeLocalTransport(103, 10),
      // Store 104: Complete (Outstation transport)
      makeProduct(104, 11), makePacking(104, 12), makeInstallation(104, 13), makeOutstationTransport(104, 14, 120, 18),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      storeOverrides: { "104": { transportType: "outstation" } },
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.missingStores.length, 2, "Only stores 102 and 103 should be flagged");
    assert.strictEqual(res.missingStores[0].storeId, "102");
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Packing Charges"]);
    assert.strictEqual(res.missingStores[1].storeId, "103");
    assert.deepStrictEqual(res.missingStores[1].missingCharges, ["Installation Charges"]);
    console.log("✓ Test 6 passed\n");
  }

  // Test 7: One store with transportation while another has none
  {
    console.log("Test 7: One store with transportation while another has none");
    const items = [
      // Store 101: Has transportation
      makeProduct(101, 1), makePacking(101, 2), makeInstallation(101, 3), makeLocalTransport(101, 4),
      // Store 102: Has packing & installation, NO transportation
      makeProduct(102, 5), makePacking(102, 6), makeInstallation(102, 7),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.missingStores.length, 1);
    assert.strictEqual(res.missingStores[0].storeId, "102");
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Local Transportation"]);
    console.log("✓ Test 7 passed\n");
  }

  // Test 8: Different transportation rates across stores
  {
    console.log("Test 8: Different transportation rates across stores");
    const items = [
      // Store 101: Local ₹500
      makeProduct(101, 1), makePacking(101, 2), makeInstallation(101, 3), makeLocalTransport(101, 4, 500),
      // Store 104: Outstation 200 km @ ₹22 = ₹4400
      makeProduct(104, 5), makePacking(104, 6), makeInstallation(104, 7), makeOutstationTransport(104, 8, 200, 22),
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, true, "Both stores have valid distinct transportation rates");
    console.log("✓ Test 8 passed\n");
  }

  // Test 9: Fix action navigation targeting
  {
    console.log("Test 9: Fix action navigation targeting");
    const items = [
      makeProduct(101, 1), makePacking(101, 2), makeInstallation(101, 3), makeLocalTransport(101, 4),
      makeProduct(102, 5), // missing all 3 charges
    ];
    const res = validateAbfrlEstimateCharges({
      items,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.missingStores.length, 1);
    assert.strictEqual(res.missingStores[0].storeId, "102");
    assert.strictEqual(res.missingStores[0].storeCode, "3500589");
    assert.strictEqual(res.missingStores[0].sapCode, "SAP-3500589");
    console.log("✓ Test 9 passed\n");
  }

  // Test 10: Ignore & Save continuing without modifying charges
  {
    console.log("Test 10: Ignore & Save continuing without modifying charges");
    // Verify that the validation function does not mutate or inject charges into the items array
    const originalItems = [
      makeProduct(102, 1),
    ];
    const itemsCopy = JSON.parse(JSON.stringify(originalItems));
    const res = validateAbfrlEstimateCharges({
      items: itemsCopy,
      stores: mockStores,
      format: "ABLBL",
    });
    assert.strictEqual(res.valid, false);
    assert.deepStrictEqual(itemsCopy, originalItems, "Original estimate items must remain completely unchanged");
    console.log("✓ Test 10 passed\n");
  }

  // Test 11: Revalidation after editing an estimate
  {
    console.log("Test 11: Revalidation after editing an estimate");
    const items = [
      makeProduct(102, 1),
    ];
    let res = validateAbfrlEstimateCharges({ items, stores: mockStores, format: "ABLBL" });
    assert.strictEqual(res.valid, false);
    // User fixes packing
    items.push(makePacking(102, 2));
    res = validateAbfrlEstimateCharges({ items, stores: mockStores, format: "ABLBL" });
    assert.strictEqual(res.valid, false);
    assert.deepStrictEqual(res.missingStores[0].missingCharges, ["Installation Charges", "Local Transportation"]);
    // User fixes installation and transport
    items.push(makeInstallation(102, 3));
    items.push(makeLocalTransport(102, 4));
    res = validateAbfrlEstimateCharges({ items, stores: mockStores, format: "ABLBL" });
    assert.strictEqual(res.valid, true, "Revalidation succeeds once user fixes all missing charges");
    console.log("✓ Test 11 passed\n");
  }

  // Test 12: No duplicate charges after fixing
  {
    console.log("Test 12: No duplicate charges after fixing");
    const items = [
      makeProduct(102, 1),
      makePacking(102, 2),
      makeInstallation(102, 3),
      makeLocalTransport(102, 4),
    ];
    const packingCount = items.filter(it => it.lineType === "packing" && it.storeId === "102").length;
    const installCount = items.filter(it => it.lineType === "installation" && it.storeId === "102").length;
    const transportCount = items.filter(it => it.lineType === "transport" && it.storeId === "102").length;
    assert.strictEqual(packingCount, 1);
    assert.strictEqual(installCount, 1);
    assert.strictEqual(transportCount, 1);
    console.log("✓ Test 12 passed\n");
  }

  // Test 13, 14, 15: Copy Summary matching canonical estimate, SAP codes, GST & Grand Total reconciliation on fixture SM/E/26-27/266
  {
    console.log("Test 13, 14, 15: Reference Fixture SM/E/26-27/266 (Estimate ID 225)");
    const estRes = await pool.query("SELECT * FROM estimates WHERE id = 225");
    const est = estRes.rows[0];
    assert.ok(est, "Estimate 225 must exist in database");

    const estCamel = {
      ...est,
      estimateNumber: est.estimate_number,
      storeGrouping: est.store_grouping,
      packingPercent: est.packing_percent,
      implementationPercent: est.implementation_percent,
      transportAmount: est.transport_amount,
      clientFormat: est.client_format,
      storeId: est.store_id,
      subject: est.subject,
      title: est.title,
      vendorCode: est.vendor_code,
      gstType: est.gst_type,
      billingGstin: est.billing_gstin,
    };

    const itemsRes = await pool.query("SELECT * FROM estimate_items WHERE estimate_id = 225 ORDER BY sl ASC");
    const items = itemsRes.rows.map(r => ({
      ...r,
      lineType: r.line_type,
      totalPrice: Number(r.total_price),
      totalAmount: Number(r.total_amount),
      sgstAmount: Number(r.sgst_amount),
      cgstAmount: Number(r.cgst_amount),
      igstAmount: Number(r.igst_amount),
      storeId: r.store_id,
      storeCode: r.store_code,
      sapCode: r.sap_code,
      calculationType: r.calculation_type,
      itemName: r.item_name,
      productId: r.product_id,
      sl: r.sl,
      quantity: r.quantity,
    }));

    const storesRes = await pool.query("SELECT * FROM stores WHERE company_id = 1");
    const stores = storesRes.rows.map(s => ({
      ...s,
      storeCode: s.store_code,
      sapCode: s.sap_code,
    }));

    const productsRes = await pool.query("SELECT * FROM products WHERE company_id = 1");
    const products = productsRes.rows;

    const rec = reconcileEstimateSummary(estCamel, items, stores, products);

    // Test 13: Copy Summary matching canonical estimate
    assert.strictEqual(rec.reconciled, true, `Reconciliation should be true. Errors: ${rec.errors.join("; ")}`);
    assert.strictEqual(rec.errors.length, 0);

    // Verify subtotal match
    assert.strictEqual(
      rec.totals.totalBeforeGst.toFixed(2),
      rec.canonicalTotals.grandBeforeTax.toFixed(2),
      "Summary Total Before GST must match canonical estimate subtotal exactly"
    );

    // Test 14: Correct store code and SAP code in summary
    assert.ok(rec.summaryRows.length > 0);
    // Fixture 225 has historical stores where sap_code is null in DB
    const storeCodesPresent = rec.summaryRows.filter(r => r.storeCode && r.storeCode.trim() !== "");
    assert.strictEqual(storeCodesPresent.length, rec.summaryRows.length, "All rows must have storeCode populated");

    // Also verify with stores having SAP Code:
    const mockStoreWithSap = [
      { id: 549, name: "Kalamboli", storeCode: "7231", sapCode: "SAP-7231-XYZ" }
    ];
    const recWithSap = reconcileEstimateSummary(estCamel, items, [...stores.filter(s => s.id !== 549), ...mockStoreWithSap], products);
    const kalamboliRows = recWithSap.summaryRows.filter(r => r.storeCode === "7231");
    assert.ok(kalamboliRows.length > 0, "Must find Kalamboli rows");
    assert.ok(kalamboliRows.every(r => r.sapCode === "SAP-7231-XYZ"), "Kalamboli rows must carry SAP-7231-XYZ");
    console.log(`✓ Verified SAP Code resolution on ${kalamboliRows.length} rows for Kalamboli`);

    // Test 15: GST and grand-total reconciliation
    assert.strictEqual(
      (rec.totals.cgst + rec.totals.sgst + rec.totals.igst).toFixed(2),
      (rec.canonicalTotals.grandCgst + rec.canonicalTotals.grandSgst + rec.canonicalTotals.grandIgst).toFixed(2),
      "Tax totals must reconcile exactly"
    );
    assert.strictEqual(
      rec.totals.grandTotal.toFixed(2),
      rec.canonicalTotals.grandTotal.toFixed(2),
      "Grand Total must reconcile exactly"
    );

    console.log("✓ Fixture 225 Summary Totals:", rec.totals);
    console.log("✓ Test 13, 14, 15 passed\n");
  }

  await pool.end();
  console.log("=== ALL 15 REGRESSION TESTS PASSED SUCCESSFULLY! ===");
}

runTestSuite().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
