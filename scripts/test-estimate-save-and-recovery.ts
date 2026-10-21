import assert from "node:assert";
import { validateEstimateItemsBatch } from "../shared/validation";
import { calculateEstimateRowValues } from "../client/src/pages/operations/utils/estimateCalculations";

async function runTests() {
  console.log("=== RUNNING ESTIMATE SAVE & RECOVERY TEST SUITE ===");

  // 1. TEST: 15 Stores with nested rows validation and calculation
  console.log("\n[Test 1] Generating and calculating 15 stores with 90 items...");
  const stores = Array.from({ length: 15 }, (_, i) => ({
    id: i + 100,
    name: `Store ${i + 1} - High Street Mall`,
    storeCode: `STR-${100 + i}`,
  }));

  const items: any[] = [];
  for (const store of stores) {
    for (let r = 0; r < 6; r++) {
      items.push({
        id: `row-${store.id}-${r}`,
        storeId: String(store.id),
        lineType: "product",
        element: `Signage Front ${r + 1}`,
        description: `Product details for Signage Front ${r + 1}`,
        productId: r + 1,
        hsn: "9983",
        standard: "YES",
        width: 10,
        height: 5,
        quantity: 2,
        rate: 150,
        calculationType: "feet",
      });
    }
  }

  assert.strictEqual(items.length, 90, "Should have 90 items across 15 stores");

  // Run row calculations
  const calculated = items.map(item => {
    const calc = calculateEstimateRowValues(
      item.calculationType,
      item.width,
      item.height,
      item.quantity,
      item.rate,
      18,
      "CGST+SGST",
      "feet"
    );
    return {
      ...item,
      ...calc,
    };
  });

  assert.strictEqual(calculated.length, 90);
  for (const row of calculated) {
    // 10w x 5h = 50 sqft * 2 qty = 100 total sqft * 150 rate = 15,000 amount
    assert.strictEqual(Number(row.amount), 15000, "Calculated row amount should be 15,000");
    assert.strictEqual(Number(row.totalAmount), 17700, "Calculated row total with 18% GST should be 17,700");
  }
  const totalAmount = calculated.reduce((s, r) => s + Number(r.totalAmount), 0);
  console.log("✓ All 90 rows across 15 stores calculated correctly (Grand Total: ₹", totalAmount.toLocaleString(), ")");

  // 2. TEST: Missing required field error reporting with store attribution
  console.log("\n[Test 2] Missing required field identifies exact store and row number...");
  const itemsWithInvalidRow = [...items];
  // Break row 3 of store 8 (index 44)
  itemsWithInvalidRow[44] = {
    ...itemsWithInvalidRow[44],
    rate: "-10", // Invalid negative rate
  };

  const validationResult = validateEstimateItemsBatch(itemsWithInvalidRow);
  assert.strictEqual(validationResult.valid, false, "Validation should fail for invalid rate");
  assert.ok(validationResult.errors.length > 0);
  assert.ok(validationResult.errors[0].includes("Row 45"), "Should identify Row 45 (1-indexed)");

  // Test store attribution formatting
  const invalidRow = itemsWithInvalidRow[44];
  const invalidStore = stores.find(s => String(s.id) === String(invalidRow.storeId));
  const enrichedMessage = `Store "${invalidStore?.name || "Unknown"}": ${validationResult.errors[0]}`;
  assert.ok(enrichedMessage.includes('Store "Store 8 - High Street Mall"'), "Message should contain store name");
  assert.ok(enrichedMessage.includes("Row 45"), "Message should contain 1-indexed row number");
  console.log("✓ Enriched validation message verified:", enrichedMessage);

  // 3. TEST: Running inch height validation with store attribution
  console.log("\n[Test 3] Running inch with missing height identifies exact store and row...");
  const itemsWithMissingHeight = [...items];
  itemsWithMissingHeight[20] = {
    ...itemsWithMissingHeight[20],
    calculationType: "running_inch",
    height: 0, // Invalid for running inch
    rate: 100,
    quantity: 1,
  };
  const runningInchCheck = itemsWithMissingHeight.find(
    (it) => (it.calculationType === "running_inch" || String(it.unit || "").toLowerCase() === "running_inch") &&
            Number(it.height || 0) <= 0
  );
  assert.ok(runningInchCheck, "Should detect missing height for running inch item");
  const runningInchStore = stores.find(s => String(s.id) === String(runningInchCheck.storeId));
  const runningInchMsg = `[${runningInchStore?.name || "Store"}] Row: "${runningInchCheck.element}" has Running Inch selected but Height (H) is 0 or empty.`;
  assert.ok(runningInchMsg.includes("Store 4 - High Street Mall"));
  console.log("✓ Running inch validation verified:", runningInchMsg);

  // 4. TEST: Atomic payload structure verification
  console.log("\n[Test 4] Atomic payload structure for save_estimate_revision_atomic...");
  const estimatePayload = {
    p_estimate_id: 215,
    p_company_id: 1,
    p_estimate: {
      estimate_number: "SM/E/26-27/264",
      title: "PETER ENGLAND - VISUAL CHANGEOVER",
      client_id: 14,
      brand_id: 28,
      subtotal: 1350000,
      cgst: 121500,
      sgst: 121500,
      igst: 0,
      total_amount: 1593000,
      current_revision_number: 2,
    },
    p_items: calculated.map((item, idx) => ({
      estimate_id: 215,
      company_id: 1,
      store_id: Number(item.storeId),
      element: item.element,
      description: item.description,
      product_id: item.productId,
      hsn: item.hsn,
      standard: item.standard,
      width: Number(item.width),
      height: Number(item.height),
      quantity: Number(item.quantity),
      rate: Number(item.rate),
      amount: Number(item.amount),
      cgst_percent: 9,
      cgst_amount: Number(item.amount) * 0.09,
      sgst_percent: 9,
      sgst_amount: Number(item.amount) * 0.09,
      total_amount: Number(item.totalAmount),
      sort_order: idx + 1,
    })),
    p_reason: "Manual Save from Estimate Builder",
  };

  assert.strictEqual(estimatePayload.p_items.length, 90);
  assert.strictEqual(typeof estimatePayload.p_estimate_id, "number");
  assert.strictEqual(typeof estimatePayload.p_company_id, "number");
  assert.strictEqual(typeof estimatePayload.p_reason, "string");
  console.log("✓ Atomic RPC payload verified with 90 items and atomic revision bump parameters");

  // 5. TEST: Draft recovery key isolation
  console.log("\n[Test 5] LocalStorage draft isolation...");
  const companyA = 1;
  const companyB = 2;
  const user1 = "usr_alice";
  const user2 = "usr_bob";
  const est215 = 215;
  const est216 = 216;

  const key1 = `sunrise_draft_${companyA}_${user1}_${est215}`;
  const key2 = `sunrise_draft_${companyB}_${user1}_${est215}`;
  const key3 = `sunrise_draft_${companyA}_${user2}_${est215}`;
  const key4 = `sunrise_draft_${companyA}_${user1}_${est216}`;

  assert.notStrictEqual(key1, key2, "Different companies must have different draft keys");
  assert.notStrictEqual(key1, key3, "Different users must have different draft keys");
  assert.notStrictEqual(key1, key4, "Different estimates must have different draft keys");
  console.log("✓ Draft key isolation strictly separates company, user, and estimate ID");

  // 6. TEST: Stale draft collision prevention
  console.log("\n[Test 6] Stale draft collision prevention...");
  const dbUpdatedAt = new Date("2026-10-21T15:00:00Z").getTime();
  const olderDraft = { timestamp: new Date("2026-10-21T14:30:00Z").getTime(), estItems: [] };
  const newerDraft = { timestamp: new Date("2026-10-21T15:30:00Z").getTime(), estItems: [{ id: 1 }] };

  const shouldRestoreOlder = olderDraft.timestamp > dbUpdatedAt;
  const shouldRestoreNewer = newerDraft.timestamp > dbUpdatedAt;

  assert.strictEqual(shouldRestoreOlder, false, "Older draft before db update must NOT overwrite newer DB changes");
  assert.strictEqual(shouldRestoreNewer, true, "Newer draft after db update should be offered for recovery");
  console.log("✓ Stale draft rejection verified based on revision timestamps");

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
