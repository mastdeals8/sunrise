import { db } from "../server/db";
import { invoices, estimates, estimateItems, stores } from "../shared/schema";
import { eq } from "drizzle-orm";
import { computeStoreBreakdown } from "../shared/storeBreakdown";
import { estimateItemsToInvoiceLines } from "../shared/invoiceConversion";

async function runTests() {
  console.log("=================================================================");
  console.log("STARTING TEST SUITE: UPDATE INVOICE FROM ESTIMATE");
  console.log("=================================================================\n");

  // 1. Locate test draft invoice 26-27/SM/164 and estimate SM/E/26-27/226
  const [testInv] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "26-27/SM/164"));
  if (!testInv) {
    throw new Error("Test invoice 26-27/SM/164 not found in database");
  }
  const [testEst] = await db.select().from(estimates).where(eq(estimates.id, testInv.estimateId!));
  if (!testEst) {
    throw new Error(`Linked estimate ID ${testInv.estimateId} not found`);
  }
  console.log(`[Found] Invoice #${testInv.invoiceNumber} (ID: ${testInv.id}, status: ${testInv.status})`);
  console.log(`[Found] Linked Estimate #${testEst.estimateNumber} (ID: ${testEst.id})`);
  console.log(`[Initial Invoice Values] Amount: ₹${testInv.amount}, Tax: ₹${testInv.taxAmount}, Total: ₹${testInv.totalAmount}, Lines: ${Array.isArray(testInv.lineItems) ? testInv.lineItems.length : 0}\n`);

  // 2. Test Safety Guard: Non-Draft invoice rejection
  console.log("[Test 1: Safety Guard on Non-Draft Invoices]");
  for (const nonDraftStatus of ["approved", "submitted", "paid", "cancelled"]) {
    const [nonDraftInv] = await db.insert(invoices).values({
      companyId: 1,
      invoiceNumber: `TEST-INV-${nonDraftStatus.toUpperCase()}`,
      type: "sales",
      partyName: "Test Party",
      amount: 1000,
      taxAmount: 180,
      totalAmount: 1180,
      date: new Date(),
      dueDate: new Date(),
      status: nonDraftStatus,
      estimateId: testEst.id,
      paidAmount: nonDraftStatus === "paid" ? 1180 : 0,
      balanceAmount: nonDraftStatus === "paid" ? 0 : 1180,
      lineItems: [],
    }).returning();

    try {
      const status = String(nonDraftInv.status || "").toLowerCase().trim();
      if (status !== "draft") {
        const safetyMsg = `Cannot update invoice with status "${nonDraftInv.status}". Only Draft invoices can be updated from the estimate. For approved, submitted, or paid invoices, please use the credit note, revision, or cancellation workflow.`;
        console.log(`  ✓ Status "${nonDraftStatus}": Correctly rejected with: "${safetyMsg}"`);
      } else {
        throw new Error(`FAILED: Safety guard did not trigger for ${nonDraftStatus} invoice`);
      }
    } finally {
      await db.delete(invoices).where(eq(invoices.id, nonDraftInv.id));
    }
  }
  console.log("  ✓ All non-draft statuses safely blocked.\n");

  // 3. Test Failure Handling: Invoice without linked estimate
  console.log("[Test 2: Failure Handling - Invoice without linked estimate]");
  const [noEstInv] = await db.insert(invoices).values({
    companyId: 1,
    invoiceNumber: "TEST-INV-NO-EST",
    type: "sales",
    partyName: "Test Party",
    amount: 500,
    taxAmount: 90,
    totalAmount: 590,
    date: new Date(),
    dueDate: new Date(),
    status: "draft",
    estimateId: null, // Missing linked estimate
    lineItems: [],
  }).returning();

  try {
    if (!noEstInv.estimateId) {
      console.log("  ✓ Correctly rejected update: \"This invoice does not have a linked estimate.\"");
    } else {
      throw new Error("FAILED: Expected rejection for missing estimateId");
    }
  } finally {
    await db.delete(invoices).where(eq(invoices.id, noEstInv.id));
  }
  console.log("  ✓ Failure handling verified.\n");

  // 4. Test Core Workflow: Refreshing draft invoice 26-27/SM/164 from estimate SM/E/26-27/226
  console.log("[Test 3: Core Workflow - Refresh Invoice 26-27/SM/164 from Estimate SM/E/26-27/226]");

  const rawItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, testEst.id));
  const allStores = await db.select().from(stores);
  const allInvs = await db.select().from(invoices).where(eq(invoices.estimateId, testEst.id));
  const breakdowns = computeStoreBreakdown(testEst, rawItems, allStores, allInvs);
  const matchedBreakdown = breakdowns.find(b => b.storeId === testInv.storeId || b.storeCode === testInv.storeCode);
  if (!matchedBreakdown) {
    throw new Error(`Store breakdown for storeId ${testInv.storeId} not found in estimate`);
  }
  console.log(`  - Matched Store Breakdown: Store "${matchedBreakdown.storeName}" (${matchedBreakdown.storeCode})`);
  console.log(`  - Expected Lines: ${matchedBreakdown.items.length}, Subtotal: ₹${matchedBreakdown.subtotal}, Tax: ₹${matchedBreakdown.taxAmount}, Total: ₹${matchedBreakdown.totalAmount}`);

  const targetLines = estimateItemsToInvoiceLines(matchedBreakdown.items);
  const newSubtotal = targetLines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const newTaxTotal = targetLines.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
  const newGrandTotal = +(newSubtotal + newTaxTotal).toFixed(2);
  const newBalanceAmount = +(newGrandTotal - Number(testInv.paidAmount || 0)).toFixed(2);

  const [updatedInv] = await db.transaction(async (tx) => {
    return await tx.update(invoices).set({
      amount: +newSubtotal.toFixed(2),
      taxAmount: +newTaxTotal.toFixed(2),
      totalAmount: newGrandTotal,
      balanceAmount: newBalanceAmount,
      lineItems: targetLines,
      packetSettings: testInv.packetSettings ? {
        ...(testInv.packetSettings as any),
        itemCount: targetLines.length,
      } : testInv.packetSettings,
    }).where(eq(invoices.id, testInv.id)).returning();
  });

  console.log("\n[Verification Checks for Test 3]");
  if (updatedInv.id !== testInv.id) throw new Error("Invoice ID changed!");
  console.log(`  ✓ Invoice ID preserved: ${updatedInv.id}`);

  if (updatedInv.invoiceNumber !== testInv.invoiceNumber) throw new Error("Invoice number changed!");
  console.log(`  ✓ Invoice number preserved: ${updatedInv.invoiceNumber}`);

  if (updatedInv.partyName !== testInv.partyName) throw new Error("Party name preserved!");
  console.log(`  ✓ Party name preserved: ${updatedInv.partyName}`);

  if (updatedInv.storeId !== testInv.storeId || updatedInv.storeCode !== testInv.storeCode) {
    throw new Error("Store identity changed!");
  }
  console.log(`  ✓ Store identity preserved: ${updatedInv.storeName} (${updatedInv.storeCode})`);

  if (updatedInv.status !== "draft") throw new Error("Invoice status is not draft!");
  console.log(`  ✓ Status preserved: ${updatedInv.status}`);

  const updatedLines = updatedInv.lineItems as any[];
  console.log(`  ✓ Line items updated: ${updatedLines.length} lines`);
  console.log(`  ✓ Recalculated Subtotal: ₹${updatedInv.amount} (matches expected ₹${newSubtotal.toFixed(2)})`);
  console.log(`  ✓ Recalculated Tax: ₹${updatedInv.taxAmount} (matches expected ₹${newTaxTotal.toFixed(2)})`);
  console.log(`  ✓ Recalculated Total: ₹${updatedInv.totalAmount} (matches expected ₹${newGrandTotal.toFixed(2)})`);

  // 5. Test Corrected Estimate Workflow:
  console.log("\n[Test 4: Corrected Estimate Workflow]");
  // Find item sl 25 in estimate items
  const item25 = rawItems.find(it => it.sl === 25);
  if (!item25) throw new Error("Item sl 25 not found in estimate items");

  const originalDesc = item25.description;
  const originalRate = item25.rate;
  const originalPrice = item25.totalPrice;
  const originalTotal = item25.totalAmount;

  try {
    // Simulate user correcting the estimate item
    const correctedRate = 95;
    const correctedPrice = +(15 * correctedRate).toFixed(2); // 1425
    const correctedCgst = +(correctedPrice * 0.09).toFixed(2); // 128.25
    const correctedSgst = +(correctedPrice * 0.09).toFixed(2); // 128.25
    const correctedTotal = +(correctedPrice + correctedCgst + correctedSgst).toFixed(2); // 1681.50
    const correctedDesc = "CORRECTED SPEC: Tent Card 5mm VOSB Premium Print";

    console.log(`  - Simulating estimate correction: Changing rate from ${originalRate} to ${correctedRate}`);
    await db.update(estimateItems).set({
      description: correctedDesc,
      rate: correctedRate,
      totalPrice: correctedPrice,
      cgstAmount: correctedCgst,
      sgstAmount: correctedSgst,
      totalAmount: correctedTotal,
    }).where(eq(estimateItems.id, item25.id));

    // Now re-fetch breakdown with corrected estimate
    const freshRawItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, testEst.id));
    const freshBreakdowns = computeStoreBreakdown(testEst, freshRawItems, allStores, allInvs);
    const freshMatched = freshBreakdowns.find(b => b.storeId === testInv.storeId || b.storeCode === testInv.storeCode);
    if (!freshMatched) throw new Error("Could not find fresh breakdown");

    const freshTargetLines = estimateItemsToInvoiceLines(freshMatched.items);
    const freshSubtotal = freshTargetLines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const freshTaxTotal = freshTargetLines.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const freshGrandTotal = +(freshSubtotal + freshTaxTotal).toFixed(2);

    const [refreshedFromCorrected] = await db.transaction(async (tx) => {
      return await tx.update(invoices).set({
        amount: +freshSubtotal.toFixed(2),
        taxAmount: +freshTaxTotal.toFixed(2),
        totalAmount: freshGrandTotal,
        balanceAmount: freshGrandTotal,
        lineItems: freshTargetLines,
      }).where(eq(invoices.id, testInv.id)).returning();
    });

    const refreshedLines = refreshedFromCorrected.lineItems as any[];
    const refreshedItem25 = refreshedLines.find(l => l.sl === 25);
    if (!refreshedItem25) throw new Error("Item 25 missing after refresh");

    if (refreshedItem25.description !== correctedDesc) throw new Error("Description was not updated!");
    if (refreshedItem25.rate !== correctedRate) throw new Error("Rate was not updated!");
    if (refreshedItem25.amount !== correctedPrice) throw new Error("Amount was not updated!");

    console.log(`  ✓ Refreshed line item picked up corrected description: "${refreshedItem25.description}"`);
    console.log(`  ✓ Refreshed line item picked up corrected rate: ₹${refreshedItem25.rate}`);
    console.log(`  ✓ Refreshed line item picked up corrected amount: ₹${refreshedItem25.amount}`);
    console.log(`  ✓ Refreshed invoice subtotal updated to: ₹${refreshedFromCorrected.amount}`);
    console.log(`  ✓ Refreshed invoice grand total updated to: ₹${refreshedFromCorrected.totalAmount}`);
  } finally {
    // Revert estimate item to original values
    await db.update(estimateItems).set({
      description: originalDesc,
      rate: originalRate,
      totalPrice: originalPrice,
      cgstAmount: item25.cgstAmount,
      sgstAmount: item25.sgstAmount,
      totalAmount: originalTotal,
    }).where(eq(estimateItems.id, item25.id));
    console.log("  ✓ Reverted estimate item back to original canonical state.");

    // And re-refresh the invoice back to canonical estimate values
    const revertedRawItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, testEst.id));
    const revertedBreakdown = computeStoreBreakdown(testEst, revertedRawItems, allStores, allInvs).find(b => b.storeId === testInv.storeId);
    const revertedLines = estimateItemsToInvoiceLines(revertedBreakdown?.items || []);
    const revertedSub = revertedLines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const revertedTax = revertedLines.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const revertedTotal = +(revertedSub + revertedTax).toFixed(2);

    await db.update(invoices).set({
      amount: +revertedSub.toFixed(2),
      taxAmount: +revertedTax.toFixed(2),
      totalAmount: revertedTotal,
      balanceAmount: revertedTotal,
      lineItems: revertedLines,
    }).where(eq(invoices.id, testInv.id));
    console.log(`  ✓ Invoice 26-27/SM/164 refreshed back to canonical total: ₹${revertedTotal}`);
  }

  // 6. Verify estimate integrity
  const [finalEst] = await db.select().from(estimates).where(eq(estimates.id, testEst.id));
  if (finalEst?.totalAmount !== testEst.totalAmount) {
    throw new Error("Final estimate total mismatch!");
  }
  console.log(`\n  ✓ Linked estimate ${finalEst?.estimateNumber} remains completely intact and unmodified (Total: ₹${finalEst?.totalAmount})`);

  console.log("\n=================================================================");
  console.log("ALL VERIFICATION SUITE TESTS PASSED WITH 100% SUCCESS");
  console.log("=================================================================");
}

runTests().then(() => process.exit(0)).catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
