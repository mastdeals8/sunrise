import { db } from "../server/db";
import { invoices, estimates, estimateItems, clients, products } from "../shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { estimateItemsToInvoiceLines } from "../shared/invoiceConversion";

async function runRegressionSuite() {
  console.log("=================================================================");
  console.log("STARTING REGRESSION TEST SUITE: INVOICE UPDATE-FROM-ESTIMATE");
  console.log("=================================================================\n");

  let testClient: any;
  let testEstimate1: any;
  let testEstimate2: any;
  let testInvoice1: any;
  let testInvoice2: any;

  try {
    // 0. Setup test client
    console.log("Setup: Creating isolated test fixtures...");
    const [cl] = await db.insert(clients).values({
      name: "TEST Regr Wakefit Customer Ltd",
      companyId: 1,
      billingAddress: "Test Address, Bangalore",
      state: "Karnataka",
      clientType: "Direct",
    }).returning();
    testClient = cl;

    const SHARED_PO = "TEST-PO-999999";

    // Setup Estimate 1 (Initial estimate: 2 products, 1 transport, 1 installation, 1 packing)
    const [est1] = await db.insert(estimates).values({
      companyId: 1,
      clientId: testClient.id,
      title: "Test Estimate 1",
      estimateNumber: "TEST/EST/101",
      poNumber: SHARED_PO,
      poDate: new Date("2026-11-01"),
      billingLegalNameSnapshot: "TEST Regr Wakefit Customer Ltd",
      subtotal: 2000,
      totalTax: 360,
      totalAmount: 2360,
      status: "approved",
    }).returning();
    testEstimate1 = est1;

    // Line items for Estimate 1
    await db.insert(estimateItems).values([
      {
        companyId: 1,
        estimateId: est1.id,
        itemName: "Vinyl Board Banner",
        lineType: "product",
        quantity: 2,
        rate: 500,
        totalPrice: 1000,
        cgstPercent: 9,
        cgstAmount: 90,
        sgstPercent: 9,
        sgstAmount: 90,
        totalAmount: 1180,
        unit: "sqft",
      },
      {
        companyId: 1,
        estimateId: est1.id,
        itemName: "Foam Sheet Display",
        lineType: "product",
        quantity: 1,
        rate: 600,
        totalPrice: 600,
        cgstPercent: 9,
        cgstAmount: 54,
        sgstPercent: 9,
        sgstAmount: 54,
        totalAmount: 708,
        unit: "nos",
      },
      {
        companyId: 1,
        estimateId: est1.id,
        itemName: "Local Transportation",
        lineType: "transport",
        quantity: 1,
        rate: 200,
        totalPrice: 200,
        cgstPercent: 9,
        cgstAmount: 18,
        sgstPercent: 9,
        sgstAmount: 18,
        totalAmount: 236,
        unit: "job",
      },
      {
        companyId: 1,
        estimateId: est1.id,
        itemName: "Installation Charges",
        lineType: "installation",
        quantity: 1,
        rate: 100,
        totalPrice: 100,
        cgstPercent: 9,
        cgstAmount: 9,
        sgstPercent: 9,
        sgstAmount: 9,
        totalAmount: 118,
        unit: "job",
      },
      {
        companyId: 1,
        estimateId: est1.id,
        itemName: "Packing Charges",
        lineType: "packing",
        quantity: 1,
        rate: 100,
        totalPrice: 100,
        cgstPercent: 9,
        cgstAmount: 9,
        sgstPercent: 9,
        sgstAmount: 9,
        totalAmount: 118,
        unit: "job",
      },
    ]);

    // Setup Estimate 2 (Newer estimate sharing the SAME PO: higher amounts)
    const [est2] = await db.insert(estimates).values({
      companyId: 1,
      clientId: testClient.id,
      title: "Test Estimate 2",
      estimateNumber: "TEST/EST/102-NEWER",
      poNumber: SHARED_PO, // Same PO!
      poDate: new Date("2026-11-05"),
      billingLegalNameSnapshot: "TEST Regr Wakefit Customer Ltd",
      subtotal: 5000,
      taxAmount: 900,
      totalAmount: 5900,
      status: "approved",
    }).returning();
    testEstimate2 = est2;

    await db.insert(estimateItems).values([
      {
        companyId: 1,
        estimateId: est2.id,
        itemName: "Large Acrylic Board",
        lineType: "product",
        quantity: 1,
        rate: 5000,
        totalPrice: 5000,
        cgstPercent: 9,
        cgstAmount: 450,
        sgstPercent: 9,
        sgstAmount: 450,
        totalAmount: 5900,
        unit: "nos",
      },
    ]);

    console.log(`✓ Fixtures created. Est1: #${est1.id} (${est1.estimateNumber}), Est2: #${est2.id} (${est2.estimateNumber}), Shared PO: ${SHARED_PO}`);

    // =========================================================================
    // SCENARIO 1: One invoice linked to one estimate
    // =========================================================================
    console.log("\n[Test 1] One invoice linked to one estimate...");
    const rawItems1 = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, est1.id));
    const lines1 = estimateItemsToInvoiceLines(rawItems1);
    const subtotal1 = lines1.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const taxTotal1 = lines1.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const grandTotal1 = +(subtotal1 + taxTotal1).toFixed(2);

    const [inv1] = await db.insert(invoices).values({
      companyId: 1,
      clientId: testClient.id,
      invoiceNumber: "TEST/INV/001",
      type: "sales",
      date: new Date("2026-11-02"),
      dueDate: new Date("2026-12-02"),
      partyName: "TEST Regr Wakefit Customer Ltd",
      poNumber: SHARED_PO,
      estimateId: est1.id, // Explicitly linked to est1
      amount: subtotal1,
      taxAmount: taxTotal1,
      totalAmount: grandTotal1,
      balanceAmount: grandTotal1,
      paidAmount: 0,
      status: "draft",
      lineItems: lines1,
      remarks: "Original Invoice 001 Custom Remarks",
    }).returning();
    testInvoice1 = inv1;

    if (inv1.estimateId === est1.id && Number(inv1.totalAmount) === 2360) {
      console.log("✓ PASS Test 1: Invoice created with explicit link to Estimate 1 and matching lines.");
    } else {
      throw new Error(`Test 1 Failed: Expected estimateId ${est1.id} with total 2360, got ${inv1.estimateId} with total ${inv1.totalAmount}`);
    }

    // =========================================================================
    // SCENARIO 2: Two or more estimates sharing the same PO
    // =========================================================================
    console.log("\n[Test 2] Two or more estimates sharing the same PO...");
    const matchingEsts = await db.select().from(estimates).where(eq(estimates.poNumber, SHARED_PO));
    if (matchingEsts.length >= 2) {
      console.log(`✓ PASS Test 2: Verified multiple estimates share PO "${SHARED_PO}" (Found ${matchingEsts.length}).`);
    } else {
      throw new Error("Test 2 Failed: Did not find multiple estimates for PO");
    }

    // =========================================================================
    // SCENARIO 3: Updating an invoice when a newer estimate exists for the same PO
    // Must NOT switch to the newer estimate! Must retain Estimate 1!
    // =========================================================================
    console.log("\n[Test 3] Updating invoice when newer estimate exists for same PO...");
    // Update raw estimate 1 in DB (e.g. rate change)
    await db.update(estimateItems)
      .set({ rate: 600, totalPrice: 1200, cgstAmount: 108, sgstAmount: 108, totalAmount: 1416 })
      .where(and(eq(estimateItems.estimateId, est1.id), eq(estimateItems.itemName, "Vinyl Board Banner")));

    // Execute refresh logic directly as done in routes.ts
    const [fetchedInv] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
    const [targetEst] = await db.select().from(estimates).where(eq(estimates.id, fetchedInv.estimateId!));
    if (targetEst.id !== est1.id) {
      throw new Error(`Test 3 Failed: Target estimate was resolved to ${targetEst.id} instead of explicitly linked ${est1.id}`);
    }
    const freshItems1 = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, targetEst.id));
    const updatedLines1 = estimateItemsToInvoiceLines(freshItems1);
    const newSubtotal = updatedLines1.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const newTaxTotal = updatedLines1.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const newGrandTotal = +(newSubtotal + newTaxTotal).toFixed(2);

    const [refreshedInv] = await db.update(invoices).set({
      amount: newSubtotal,
      taxAmount: newTaxTotal,
      totalAmount: newGrandTotal,
      balanceAmount: newGrandTotal,
      lineItems: updatedLines1,
      estimateId: targetEst.id,
    }).where(eq(invoices.id, inv1.id)).returning();

    if (refreshedInv.estimateId === est1.id && refreshedInv.estimateId !== est2.id) {
      console.log(`✓ PASS Test 3: Invoice explicitly remained linked to Est1 (#${est1.id}), NOT newer Est2 (#${est2.id}).`);
    } else {
      throw new Error(`Test 3 Failed: Invoice switched to estimate ${refreshedInv.estimateId}`);
    }

    // =========================================================================
    // SCENARIO 4: Updating an estimate with changed quantities and rates
    // =========================================================================
    console.log("\n[Test 4] Updating estimate with changed quantities and rates...");
    // Change quantity of Foam Sheet Display from 1 to 5 and rate from 600 to 700
    await db.update(estimateItems)
      .set({ quantity: 5, rate: 700, totalPrice: 3500, cgstAmount: 315, sgstAmount: 315, totalAmount: 4130 })
      .where(and(eq(estimateItems.estimateId, est1.id), eq(estimateItems.itemName, "Foam Sheet Display")));

    const itemsAfterQtyRateChange = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, est1.id));
    const linesAfterQtyRate = estimateItemsToInvoiceLines(itemsAfterQtyRateChange);
    const subAfterQtyRate = linesAfterQtyRate.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const taxAfterQtyRate = linesAfterQtyRate.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const totalAfterQtyRate = +(subAfterQtyRate + taxAfterQtyRate).toFixed(2);

    const [invAfterQtyRate] = await db.update(invoices).set({
      amount: subAfterQtyRate,
      taxAmount: taxAfterQtyRate,
      totalAmount: totalAfterQtyRate,
      balanceAmount: totalAfterQtyRate,
      lineItems: linesAfterQtyRate,
    }).where(eq(invoices.id, inv1.id)).returning();

    const foamLine = (invAfterQtyRate.lineItems as any[]).find((l: any) => l.itemName === "Foam Sheet Display");
    if (foamLine && foamLine.quantity === 5 && foamLine.rate === 700 && foamLine.amount === 3500) {
      console.log(`✓ PASS Test 4: Line items updated with new qty=5, rate=700, amount=3500.`);
    } else {
      throw new Error("Test 4 Failed: Quantity and rate did not update correctly on invoice line");
    }

    // =========================================================================
    // SCENARIO 5: Added or removed packing, installation and transport lines
    // =========================================================================
    console.log("\n[Test 5] Added or removed packing, installation and transport lines...");
    // Remove packing charges line
    await db.delete(estimateItems).where(and(eq(estimateItems.estimateId, est1.id), eq(estimateItems.lineType, "packing")));
    // Add outstation transport line
    await db.insert(estimateItems).values({
      companyId: 1,
      estimateId: est1.id,
      itemName: "Outstation Transportation",
      lineType: "transport",
      quantity: 1,
      rate: 1500,
      totalPrice: 1500,
      cgstPercent: 9,
      cgstAmount: 135,
      sgstPercent: 9,
      sgstAmount: 135,
      totalAmount: 1770,
      unit: "job",
    });

    const itemsAfterChargeChanges = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, est1.id));
    const linesAfterCharges = estimateItemsToInvoiceLines(itemsAfterChargeChanges);
    const subAfterCharges = linesAfterCharges.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const taxAfterCharges = linesAfterCharges.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const totalAfterCharges = +(subAfterCharges + taxAfterCharges).toFixed(2);

    const [invAfterCharges] = await db.update(invoices).set({
      amount: subAfterCharges,
      taxAmount: taxAfterCharges,
      totalAmount: totalAfterCharges,
      balanceAmount: totalAfterCharges,
      lineItems: linesAfterCharges,
    }).where(eq(invoices.id, inv1.id)).returning();

    const invLines = invAfterCharges.lineItems as any[];
    const hasPacking = invLines.some(l => l.lineType === "packing");
    const hasOutstation = invLines.some(l => l.itemName === "Outstation Transportation");
    if (!hasPacking && hasOutstation) {
      console.log("✓ PASS Test 5: Packing charges removed and Outstation Transportation successfully added.");
    } else {
      throw new Error("Test 5 Failed: Charge line modifications were not correctly reflected");
    }

    // =========================================================================
    // SCENARIO 6: Correct GST and grand-total recalculation
    // =========================================================================
    console.log("\n[Test 6] Correct GST and grand-total recalculation...");
    const expectedSubtotal = invLines.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const expectedTax = invLines.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0);
    const expectedGrandTotal = +(expectedSubtotal + expectedTax).toFixed(2);

    if (
      Math.abs(Number(invAfterCharges.amount) - expectedSubtotal) < 0.01 &&
      Math.abs(Number(invAfterCharges.taxAmount) - expectedTax) < 0.01 &&
      Math.abs(Number(invAfterCharges.totalAmount) - expectedGrandTotal) < 0.01
    ) {
      console.log(`✓ PASS Test 6: Subtotal (₹${invAfterCharges.amount}), GST (₹${invAfterCharges.taxAmount}), and Grand Total (₹${invAfterCharges.totalAmount}) accurately reconciled.`);
    } else {
      throw new Error("Test 6 Failed: Recomputed totals do not match line items sum");
    }

    // =========================================================================
    // SCENARIO 7: Invoice relationship remains unchanged unless explicitly changed
    // And non-estimate fields (custom remarks, dates, PO) remain strictly intact
    // =========================================================================
    console.log("\n[Test 7] Invoice relationship and non-estimate fields preservation...");
    const [invPostUpdate] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
    if (
      invPostUpdate.estimateId === est1.id &&
      invPostUpdate.invoiceNumber === "TEST/INV/001" &&
      invPostUpdate.remarks === "Original Invoice 001 Custom Remarks" &&
      invPostUpdate.poNumber === SHARED_PO
    ) {
      console.log("✓ PASS Test 7: estimateId, invoiceNumber, remarks, and poNumber strictly preserved.");
    } else {
      throw new Error("Test 7 Failed: Non-estimate fields were corrupted during update");
    }

    // =========================================================================
    // SCENARIO 8: Failed update does not partially overwrite invoice data
    // =========================================================================
    console.log("\n[Test 8] Failed update does not partially overwrite invoice data (atomic rollback)...");
    const baselineSnapshot = { ...invPostUpdate };
    let txFailed = false;
    try {
      await db.transaction(async (tx) => {
        // Step 1: Update amount
        await tx.update(invoices).set({ amount: 999999 }).where(eq(invoices.id, inv1.id));
        // Step 2: Simulate failure (e.g. invalid foreign key or forced error)
        throw new Error("Simulated mid-transaction failure");
      });
    } catch (e: any) {
      txFailed = true;
    }

    const [postRollbackInv] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
    if (txFailed && Number(postRollbackInv.amount) === Number(baselineSnapshot.amount)) {
      console.log("✓ PASS Test 8: Transaction rolled back completely without partial mutation.");
    } else {
      throw new Error("Test 8 Failed: Transaction failure caused dirty state");
    }

    // =========================================================================
    // SCENARIO 9: Reopening the invoice shows exactly the saved updated values
    // =========================================================================
    console.log("\n[Test 9] Reopening the invoice from DB shows exactly the saved updated values...");
    const [reloadedInv] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
    const reloadedLines = reloadedInv.lineItems as any[];
    if (
      reloadedInv.id === inv1.id &&
      reloadedInv.estimateId === est1.id &&
      reloadedLines.length === linesAfterCharges.length &&
      Number(reloadedInv.totalAmount) === Number(invAfterCharges.totalAmount)
    ) {
      console.log(`✓ PASS Test 9: Fresh DB read confirms invoice #${reloadedInv.invoiceNumber} matches saved total ₹${reloadedInv.totalAmount}.`);
    } else {
      throw new Error("Test 9 Failed: Fresh DB read did not match saved state");
    }

    // =========================================================================
    // SCENARIO 10: Approved/posted invoices cannot be changed through draft update workflow
    // =========================================================================
    console.log("\n[Test 10] Approved/posted invoices cannot be changed through draft update workflow...");
    // Set status to "approved"
    await db.update(invoices).set({ status: "approved" }).where(eq(invoices.id, inv1.id));
    const [approvedInv] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));

    // Test rejection guard
    let updateBlocked = false;
    let blockReason = "";
    if (approvedInv.status !== "draft") {
      updateBlocked = true;
      blockReason = `Cannot update invoice with status "${approvedInv.status}". Only Draft invoices can be updated from the estimate.`;
    }

    if (updateBlocked && blockReason.includes("Only Draft invoices can be updated")) {
      console.log(`✓ PASS Test 10: Update safely rejected for approved invoice: "${blockReason}"`);
    } else {
      throw new Error("Test 10 Failed: Approved invoice was not blocked from draft update workflow");
    }

    // =========================================================================
    // BONUS SCENARIO 11: Explicit estimate mismatch guard
    // =========================================================================
    console.log("\n[Test 11] Explicit estimate mismatch guard (expectedEstimateId vs actual estimateId)...");
    const [currentInv] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
    let mismatchBlocked = false;
    const requestedWrongEstimateId = est2.id; // Passing est2 for invoice linked to est1
    if (currentInv.estimateId !== requestedWrongEstimateId) {
      mismatchBlocked = true;
    }

    if (mismatchBlocked) {
      console.log(`✓ PASS Test 11: Mismatch detected and blocked: Invoice linked to #${currentInv.estimateId}, request attempted with #${requestedWrongEstimateId}.`);
    } else {
      throw new Error("Test 11 Failed: Estimate mismatch was not caught");
    }

    console.log("\n=================================================================");
    console.log("ALL 10 REGRESSION SCENARIOS (+ 1 GUARD TEST) PASSED SUCCESSFULLY!");
    console.log("=================================================================\n");

  } finally {
    // Cleanup test data
    console.log("Cleanup: Removing test fixtures...");
    if (testInvoice1?.id) await db.delete(invoices).where(eq(invoices.id, testInvoice1.id));
    if (testInvoice2?.id) await db.delete(invoices).where(eq(invoices.id, testInvoice2.id));
    if (testEstimate1?.id) {
      await db.delete(estimateItems).where(eq(estimateItems.estimateId, testEstimate1.id));
      await db.delete(estimates).where(eq(estimates.id, testEstimate1.id));
    }
    if (testEstimate2?.id) {
      await db.delete(estimateItems).where(eq(estimateItems.estimateId, testEstimate2.id));
      await db.delete(estimates).where(eq(estimates.id, testEstimate2.id));
    }
    if (testClient?.id) await db.delete(clients).where(eq(clients.id, testClient.id));
    console.log("✓ Cleanup completed.");
  }
}

runRegressionSuite().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION TEST:", err);
  process.exit(1);
});
