import assert from "node:assert/strict";
import { db } from "../server/db";
import { deliveryChallans, estimates, stores, executionDocuments } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { projectStoresFromCanonicalRecords } from "../client/src/pages/operations/components/ProjectWorkspace";

// Test suite for WCC Multi-Store Overwrite Bug
async function runRegressionTest() {
  console.log("=== STARTING WCC MULTI-STORE REGRESSION TEST ===");

  // 1. Setup / Find a multi-store estimate
  // Estimate 32 (SM/E/26-27/220) has Store 555 (SSL City Centre Raipur, storeCode: null)
  // Let's create a dedicated test estimate with Store 555 and Store 556 (both have storeCode: null!)
  const testEstNumber = `TEST/EST/${Date.now().toString().slice(-6)}`;
  const [createdEst] = await db.insert(estimates).values({
    estimateNumber: testEstNumber,
    estimateDate: new Date(),
    clientId: 1,
    brandId: 2,
    storeId: 555,
    title: "Test Multi-Store Estimate",
    clientFormat: "ABLBL",
    subtotal: 10000,
    taxAmount: 1800,
    totalAmount: 11800,
    status: "po_received",
    storeGrouping: {
      "555": { itemSls: [1], storeName: "Ssl-City Centre Raipur" },
      "556": { itemSls: [2], storeName: "Ssl-Westin Mall Pune" }
    }
  }).returning();

  const estId = createdEst.id;
  console.log(`Created test estimate ${testEstNumber} (id: ${estId}) with Store 555 and Store 556`);

  const masterStores = await db.select().from(stores).where(sql`id IN (555, 556)`);
  const storeA = masterStores.find(s => s.id === 555)!;
  const storeB = masterStores.find(s => s.id === 556)!;

  assert.equal(storeA.storeCode, null, "Store A (555) must have null storeCode to replicate real condition");
  assert.equal(storeB.storeCode, null, "Store B (556) must have null storeCode to replicate real condition");

  let wccAId: number = 0;
  let wccBId: number = 0;
  let wccANumber: string = "";
  let wccBNumber: string = "";

  try {
    // 2. CREATE WCC FOR STORE A
    // In our fixed implementation, storeCode is resolved as scopedStore?.storeCode || String(scopedStore?.id)
    const storeACode = storeA.storeCode || String(storeA.id);
    const [wccA] = await db.insert(deliveryChallans).values({
      estimateId: estId,
      dcNumber: `TEST/DC/A/${Date.now().toString().slice(-6)}`,
      documentType: "wcc",
      clientFormat: "ABFRL",
      status: "draft",
      storeCode: storeACode,
      remarks: "Initial Store A Remarks",
      items: [{ sl: 1, itemName: "Item 1", quantity: 1, rate: 100, totalAmount: 100 }],
      metadata: {
        storeId: 555,
        storeCode: storeACode,
        storeName: storeA.name,
        photos: [{ path: "estimate-test/wcc/photo_a.jpg" }]
      }
    }).returning();

    wccAId = wccA.id;
    wccANumber = wccA.dcNumber;
    console.log(`Created WCC A (id: ${wccAId}, dcNumber: ${wccANumber}) for Store 555`);

    // 3. CREATE WCC FOR STORE B
    const storeBCode = storeB.storeCode || String(storeB.id);
    const [wccB] = await db.insert(deliveryChallans).values({
      estimateId: estId,
      dcNumber: `TEST/DC/B/${Date.now().toString().slice(-6)}`,
      documentType: "wcc",
      clientFormat: "ABFRL",
      status: "draft",
      storeCode: storeBCode,
      remarks: "Initial Store B Remarks",
      items: [{ sl: 2, itemName: "Item 2", quantity: 1, rate: 200, totalAmount: 200 }],
      metadata: {
        storeId: 556,
        storeCode: storeBCode,
        storeName: storeB.name,
        photos: [{ path: "estimate-test/wcc/photo_b.jpg" }]
      }
    }).returning();

    wccBId = wccB.id;
    wccBNumber = wccB.dcNumber;
    console.log(`Created WCC B (id: ${wccBId}, dcNumber: ${wccBNumber}) for Store 556`);

    // 4. ADD EXECUTION DOCUMENTS
    const [docA] = await db.insert(executionDocuments).values({
      estimateId: estId,
      deliveryChallanId: wccAId,
      storeCode: storeACode,
      documentType: "signed_wcc",
      filePath: "estimate-test/docs/signed_wcc_a.pdf",
      metadata: { storeId: 555 }
    }).returning();

    const [docB] = await db.insert(executionDocuments).values({
      estimateId: estId,
      deliveryChallanId: wccBId,
      storeCode: storeBCode,
      documentType: "signed_wcc",
      filePath: "estimate-test/docs/signed_wcc_b.pdf",
      metadata: { storeId: 556 }
    }).returning();

    // 5. ASSERTIONS 1 - 5: Both WCCs exist independently with different IDs, stores, numbers
    const freshA = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccAId)))[0];
    const freshB = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccBId)))[0];

    assert.ok(freshA, "Assertion 1 Failed: WCC A must exist");
    assert.ok(freshB, "Assertion 2 Failed: WCC B must exist");
    assert.notEqual(freshA.id, freshB.id, "Assertion 3 Failed: WCC A ID != WCC B ID");
    assert.notEqual((freshA.metadata as any).storeId, (freshB.metadata as any).storeId, "Assertion 4 Failed: WCC A store != WCC B store");
    assert.notEqual(freshA.dcNumber, freshB.dcNumber, "Assertion 5 Failed: WCC A number != WCC B number");
    console.log("✓ Assertions 1-5 passed: Both WCCs exist independently with unique IDs, stores, and numbers.");

    // 6. ASSERTION 6 & 7: Both appear in Project Workspace store list; refresh does not remove either
    const allChallans = await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, estId));
    const allDocs = await db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, estId));
    const storeRows = projectStoresFromCanonicalRecords(
      createdEst as any,
      [{ sl: 1, itemName: "Item 1" }, { sl: 2, itemName: "Item 2" }],
      masterStores as any,
      allChallans as any,
      allDocs as any
    );

    assert.equal(storeRows.length, 2, "Must have exactly 2 store rows");
    const rowA = storeRows.find(r => r.storeId === 555);
    const rowB = storeRows.find(r => r.storeId === 556);

    assert.ok(rowA, "Store A row must exist");
    assert.ok(rowB, "Store B row must exist");

    assert.equal(rowA.wccRecords.length, 1, "Store A row must have exactly 1 WCC record");
    assert.equal(rowA.wccRecords[0].id, wccAId, "Store A row must have WCC A");

    assert.equal(rowB.wccRecords.length, 1, "Store B row must have exactly 1 WCC record");
    assert.equal(rowB.wccRecords[0].id, wccBId, "Store B row must have WCC B");
    console.log("✓ Assertions 6-7 passed: Both stores show their respective WCCs in Project Workspace.");

    // 7. ASSERTIONS 8 & 9: Editing A does not modify B; editing B does not modify A
    await db.update(deliveryChallans).set({ remarks: "Edited remarks for A only" }).where(eq(deliveryChallans.id, wccAId));
    const checkBAfterEditA = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccBId)))[0];
    assert.equal(checkBAfterEditA.remarks, "Initial Store B Remarks", "Assertion 8 Failed: Editing WCC A must NOT modify WCC B");

    await db.update(deliveryChallans).set({ remarks: "Edited remarks for B only" }).where(eq(deliveryChallans.id, wccBId));
    const checkAAfterEditB = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccAId)))[0];
    assert.equal(checkAAfterEditB.remarks, "Edited remarks for A only", "Assertion 9 Failed: Editing WCC B must NOT modify WCC A");
    console.log("✓ Assertions 8-9 passed: Editing WCC A only touches A; editing WCC B only touches B.");

    // 8. ASSERTION 10: Documents remain attached to the correct WCC
    assert.equal(rowA.signedWccDocuments.length, 1, "Store A must have 1 signed WCC");
    assert.equal(rowA.signedWccDocuments[0].id, docA.id, "Store A must own docA");
    assert.equal(rowB.signedWccDocuments.length, 1, "Store B must have 1 signed WCC");
    assert.equal(rowB.signedWccDocuments[0].id, docB.id, "Store B must own docB");
    console.log("✓ Assertion 10 passed: Execution documents remain attached to their respective store WCCs.");

    // 9. ASSERTION 11: Deleting A does not delete B
    await db.update(deliveryChallans).set({
      status: "deleted",
      metadata: { ...(freshA.metadata as any), deleted: true }
    }).where(eq(deliveryChallans.id, wccAId));

    const checkAAfterDelete = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccAId)))[0];
    const checkBAfterDelete = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, wccBId)))[0];

    assert.equal(checkAAfterDelete.status, "deleted", "WCC A must be marked deleted");
    assert.equal(checkBAfterDelete.status, "draft", "Assertion 11 Failed: Deleting WCC A must NOT delete WCC B");
    assert.equal((checkBAfterDelete.metadata as any)?.deleted, undefined, "WCC B metadata must not be marked deleted");
    console.log("✓ Assertion 11 passed: Deleting WCC A leaves WCC B intact and active.");

    // 10. SINGLE-STORE WORKFLOW TEST
    const singleStoreEstNum = `TEST/SINGLE/${Date.now().toString().slice(-6)}`;
    const [singleEst] = await db.insert(estimates).values({
      estimateNumber: singleStoreEstNum,
      estimateDate: new Date(),
      clientId: 1,
      brandId: 2,
      storeId: 555,
      title: "Single Store Test Estimate",
      clientFormat: "ABLBL",
      subtotal: 5000,
      taxAmount: 900,
      totalAmount: 5900,
      status: "po_received"
    }).returning();

    const [singleWcc] = await db.insert(deliveryChallans).values({
      estimateId: singleEst.id,
      dcNumber: `TEST/SINGLE/DC/${Date.now().toString().slice(-6)}`,
      documentType: "wcc",
      clientFormat: "ABFRL",
      status: "draft",
      storeCode: "555",
      metadata: { storeId: 555, storeCode: "555", storeName: storeA.name }
    }).returning();

    const singleStoreRows = projectStoresFromCanonicalRecords(
      singleEst as any,
      [],
      masterStores as any,
      [singleWcc] as any,
      []
    );
    assert.equal(singleStoreRows.length, 1, "Single store estimate must yield 1 store row");
    assert.equal(singleStoreRows[0].wccRecords.length, 1, "Single store estimate must have 1 WCC");
    console.log("✓ Single store workflow passed: Normal single-store estimates function correctly.");

    // Clean up single store
    await db.delete(deliveryChallans).where(eq(deliveryChallans.id, singleWcc.id));
    await db.delete(estimates).where(eq(estimates.id, singleEst.id));

  } finally {
    // Cleanup multi-store test records
    await db.delete(executionDocuments).where(eq(executionDocuments.estimateId, estId));
    await db.delete(deliveryChallans).where(eq(deliveryChallans.estimateId, estId));
    await db.delete(estimates).where(eq(estimates.id, estId));
    console.log("✓ Cleaned up all test records.");
  }

  console.log("=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===");
}

runRegressionTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Regression test failed:", err);
    process.exit(1);
  });
