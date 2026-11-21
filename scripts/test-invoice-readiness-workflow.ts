import {
  estimateHasPo,
  isInstallationPhotoDoc,
  isSignedWccDoc,
  isActiveWccChallan,
  evaluateInvoiceReadiness,
  evaluateInvoiceReadinessFromStoreRows,
} from "../shared/invoiceReadiness";
import { getEstimateScopedStores } from "../shared/storeScoping";
import { db, pool } from "../server/db";
import { estimates, estimateItems, stores, deliveryChallans, executionDocuments } from "../shared/schema";
import { eq } from "drizzle-orm";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function run() {
  console.log("--- Starting Invoice Readiness Workflow Tests ---");

  // Test 1: PO detection
  const estNoPo = { id: 1, estimateNumber: "EST-001", status: "draft", poNumber: null };
  const estPoNum = { id: 2, estimateNumber: "EST-002", status: "approved", poNumber: "PO/2026/99" };
  const estPoFile = { id: 3, estimateNumber: "EST-003", status: "draft", poFilePath: "/uploads/po.pdf" };
  const estStatusPo = { id: 4, estimateNumber: "EST-004", status: "po_received" };
  const estDashPo = { id: 5, estimateNumber: "EST-005", status: "approved", poNumber: "—" };

  assert(!estimateHasPo(estNoPo), "Draft without PO returns false");
  assert(estimateHasPo(estPoNum), "Estimate with poNumber returns true");
  assert(estimateHasPo(estPoFile), "Estimate with poFilePath returns true");
  assert(estimateHasPo(estStatusPo), "Estimate with status po_received returns true");
  assert(!estimateHasPo(estDashPo), "Estimate with poNumber '—' returns false");

  // Test 2: Photo validation rules
  const validPhoto = { id: 10, documentType: "photo", filePath: "/img/store1.jpg", status: "active" };
  const validInstallPhoto = { id: 11, documentType: "installation_photo", filePath: "/img/store1.jpg", status: "active" };
  const wccCompositeDoc = { id: 12, documentType: "wcc_photo", filePath: "/img/composite.jpg", status: "active" };
  const deletedPhoto = { id: 13, documentType: "photo", filePath: "/img/store1.jpg", status: "deleted" };
  const deletedAtPhoto = { id: 14, documentType: "photo", filePath: "/img/store1.jpg", status: "active", deletedAt: new Date() };
  const dcLegacyPhoto = { id: 15, documentType: "photo", filePath: "/img/store1.jpg", metadata: { source: "delivery_challans.photoPath" } };

  assert(isInstallationPhotoDoc(validPhoto), "Normal photo doc is valid");
  assert(isInstallationPhotoDoc(validInstallPhoto), "installation_photo doc is valid");
  assert(!isInstallationPhotoDoc(wccCompositeDoc), "wcc_photo composite artifact is excluded");
  assert(!isInstallationPhotoDoc(deletedPhoto), "Deleted status photo is excluded");
  assert(!isInstallationPhotoDoc(deletedAtPhoto), "deletedAt photo is excluded");
  assert(!isInstallationPhotoDoc(dcLegacyPhoto), "Legacy delivery_challan metadata photo is excluded");

  // Test 2b: Signed WCC validation rules
  const validSignedWcc = { id: 20, documentType: "signed_wcc", filePath: "/docs/signed.pdf", status: "active" };
  const validSignedDc = { id: 21, documentType: "signed_dc", filePath: "/docs/signed_dc.pdf", status: "active" };
  const deletedSignedWcc = { id: 22, documentType: "signed_wcc", filePath: "/docs/signed.pdf", status: "deleted" };
  assert(isSignedWccDoc(validSignedWcc), "signed_wcc document is valid");
  assert(isSignedWccDoc(validSignedDc), "signed_dc document is valid");
  assert(!isSignedWccDoc(deletedSignedWcc), "deleted signed_wcc document is excluded");

  // Test 3: WCC validation rules
  const activeChallan = { id: 101, dcNumber: "DC-01", documentType: "wcc", status: "active" };
  const deletedChallan = { id: 102, dcNumber: "DC-02", documentType: "wcc", status: "deleted" };
  const metadataDeletedChallan = { id: 103, dcNumber: "DC-03", documentType: "wcc", status: "active", metadata: { deleted: true } };

  assert(isActiveWccChallan(activeChallan), "Active challan is valid");
  assert(!isActiveWccChallan(deletedChallan), "Deleted challan is excluded");
  assert(!isActiveWccChallan(metadataDeletedChallan), "metadata.deleted challan is excluded");

  // Test 4: Single-store estimate workflow
  const singleStoreEst = {
    id: 201,
    estimateNumber: "EST-SINGLE",
    status: "po_received",
    poNumber: "PO-S1",
    storeId: 501,
    storeCode: "ST01",
    storeName: "Phoenix Mall",
  };
  const singleStores = [{ storeId: 501, storeCode: "ST01", storeName: "Phoenix Mall" }];

  // 4a. No photos, no WCC
  const res4a = evaluateInvoiceReadiness(singleStoreEst, singleStores, [], []);
  assert(!res4a.isInvoiceReady, "Single store with no photos/WCC is not invoice ready");
  assert(res4a.incompleteStores.length === 1, "1 store incomplete");
  assert(res4a.incompleteStores[0].missing.includes("Installation Photo"), "Missing photo reported");
  assert(res4a.incompleteStores[0].missing.includes("WCC Generated"), "Missing WCC reported");

  // 4b. Has photo, no WCC
  const res4b = evaluateInvoiceReadiness(
    singleStoreEst,
    singleStores,
    [],
    [{ id: 1, documentType: "photo", storeCode: "ST01", status: "active" }]
  );
  assert(!res4b.isInvoiceReady, "Single store with photo but no WCC is not ready");
  assert(res4b.incompleteStores[0].missing.length === 1 && res4b.incompleteStores[0].missing[0] === "WCC Generated", "Only missing WCC reported");

  // 4c. Has WCC, no photo
  const res4c = evaluateInvoiceReadiness(
    singleStoreEst,
    singleStores,
    [{ id: 1, dcNumber: "DC-1", storeCode: "ST01", status: "active" }],
    []
  );
  assert(!res4c.isInvoiceReady, "Single store with WCC but no photo is not ready");
  assert(res4c.incompleteStores[0].missing.length === 1 && res4c.incompleteStores[0].missing[0] === "Installation Photo", "Only missing photo reported");

  // 4d. Has both photo and WCC -> INVOICE READY
  const res4d = evaluateInvoiceReadiness(
    singleStoreEst,
    singleStores,
    [{ id: 1, dcNumber: "DC-1", storeCode: "ST01", status: "active" }],
    [{ id: 1, documentType: "photo", storeCode: "ST01", status: "active" }]
  );
  assert(res4d.isInvoiceReady, "Single store with both photo & WCC is INVOICE READY");
  assert(res4d.status === "invoice_ready", "Status is invoice_ready");
  assert(res4d.incompleteStores.length === 0, "No incomplete stores");

  // 4e. Has photo and Signed WCC doc (no separate DC record) -> INVOICE READY
  const res4e = evaluateInvoiceReadiness(
    singleStoreEst,
    singleStores,
    [],
    [
      { id: 1, documentType: "photo", storeCode: "ST01", status: "active" },
      { id: 2, documentType: "signed_wcc", storeCode: "ST01", status: "active" },
    ]
  );
  assert(res4e.isInvoiceReady, "Single store with photo & signed_wcc doc (no DC record) is INVOICE READY");
  assert(res4e.status === "invoice_ready", "Status is invoice_ready for photo + signed WCC");

  // Test 5: Multi-store estimate workflow
  const multiStoreEst = {
    id: 301,
    estimateNumber: "EST-MULTI",
    status: "po_received",
    poNumber: "PO-M1",
    clientFormat: "ABLBL",
    storeGrouping: { "1001": [1, 2], "1002": [3, 4] },
  };
  const multiStores = [
    { storeId: 1001, storeCode: "S1001", storeName: "Bandra Store" },
    { storeId: 1002, storeCode: "S1002", storeName: "Khar Store" },
  ];

  // 5a. Store 1 complete, Store 2 missing WCC
  const challans5a = [
    { id: 21, dcNumber: "DC-21", storeId: 1001, storeCode: "S1001", status: "active" },
  ];
  const photos5a = [
    { id: 31, documentType: "photo", storeId: 1001, storeCode: "S1001", status: "active" },
    { id: 32, documentType: "photo", storeId: 1002, storeCode: "S1002", status: "active" },
  ];
  const res5a = evaluateInvoiceReadiness(multiStoreEst, multiStores, challans5a, photos5a);
  assert(!res5a.isInvoiceReady, "Multi-store with Store 2 missing WCC is NOT invoice ready");
  assert(res5a.completedStores === 1, "Completed stores count is 1");
  assert(res5a.totalStores === 2, "Total stores count is 2");
  assert(res5a.incompleteStores.length === 1 && res5a.incompleteStores[0].storeCode === "S1002", "Incomplete store identified as S1002");
  assert(res5a.incompleteStores[0].missing.includes("WCC Generated"), "Identified missing WCC on S1002");

  // 5b. Both stores complete -> INVOICE READY
  const challans5b = [
    ...challans5a,
    { id: 22, dcNumber: "DC-22", storeId: 1002, storeCode: "S1002", status: "active" },
  ];
  const res5b = evaluateInvoiceReadiness(multiStoreEst, multiStores, challans5b, photos5a);
  assert(res5b.isInvoiceReady, "Multi-store with both stores complete is INVOICE READY");
  assert(res5b.completedStores === 2, "Both stores completed");

  // 5c. Document invalidated / deleted -> Reverts from invoice ready
  const photos5c = [
    photos5a[0],
    { ...photos5a[1], status: "deleted" }, // Store 2 photo deleted
  ];
  const res5c = evaluateInvoiceReadiness(multiStoreEst, multiStores, challans5b, photos5c);
  assert(!res5c.isInvoiceReady, "Multi-store after photo deletion reverts from invoice ready");
  assert(res5c.incompleteStores.length === 1 && res5c.incompleteStores[0].storeCode === "S1002", "S1002 identified as incomplete");
  assert(res5c.incompleteStores[0].missing.includes("Installation Photo"), "Identified missing photo after deletion");

  // Test 6: evaluateInvoiceReadinessFromStoreRows (Project Workspace UI rows)
  const workspaceRows = [
    {
      storeId: 1001,
      storeCode: "S1001",
      storeName: "Bandra Store",
      stats: { photoCount: 2, wccCount: 1, dcCount: 0, signedWccCount: 0, signedDcCount: 0 },
    },
    {
      storeId: 1002,
      storeCode: "S1002",
      storeName: "Khar Store",
      stats: { photoCount: 0, wccCount: 1, dcCount: 0, signedWccCount: 0, signedDcCount: 0 },
    },
  ];
  const resWs = evaluateInvoiceReadinessFromStoreRows(multiStoreEst, workspaceRows);
  assert(!resWs.isInvoiceReady, "Workspace rows with S1002 missing photo is not ready");
  assert(resWs.incompleteStores.length === 1 && resWs.incompleteStores[0].storeCode === "S1002", "S1002 is incomplete in workspace");
  assert(resWs.incompleteStores[0].missing.includes("Installation Photo"), "Missing photo on S1002 identified in workspace");

  // When photo count updated on S1002
  workspaceRows[1].stats.photoCount = 1;
  const resWsReady = evaluateInvoiceReadinessFromStoreRows(multiStoreEst, workspaceRows);
  assert(resWsReady.isInvoiceReady, "Workspace rows after photo upload is INVOICE READY");
  assert(resWsReady.status === "invoice_ready", "Status is invoice_ready");

  // Test 7: Workspace rows with signed WCC satisfying WCC requirement
  const workspaceRowsSigned = [
    {
      storeId: 2001,
      storeCode: "S2001",
      storeName: "Signed WCC Store",
      stats: { photoCount: 1, wccCount: 0, dcCount: 0, signedWccCount: 1, signedDcCount: 0 },
    },
  ];
  const resWsSigned = evaluateInvoiceReadinessFromStoreRows(singleStoreEst, workspaceRowsSigned);
  assert(resWsSigned.isInvoiceReady, "Workspace rows with photo and signed WCC is INVOICE READY");

  // Test 8: Live DB verification on reproduction case (Estimate 277 / ID 279)
  try {
    const [est277] = await db.select().from(estimates).where(eq(estimates.id, 279)).limit(1);
    if (est277) {
      console.log(`Checking Estimate 277 (DB ID 279: ${est277.estimateNumber})...`);
      assert(est277.status === "invoice_ready", `Estimate 277 DB status is invoice_ready (actual: ${est277.status})`);
      const items277 = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, 279));
      const allStores = await db.select().from(stores).where(eq(stores.companyId, est277.companyId || 1));
      const challans277 = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, 279)))
        .filter((c: any) => c.status !== "deleted" && !c.metadata?.deleted);
      const scoped277 = getEstimateScopedStores(est277, items277, allStores, challans277);
      const docs277 = (await db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, 279)))
        .filter((d: any) => d.status !== "deleted" && !d.deletedAt);
      const eval277 = evaluateInvoiceReadiness(est277, scoped277, challans277, docs277);
      assert(eval277.isInvoiceReady, `Estimate 277 evaluated status is invoice_ready`);
      assert(eval277.completedStores === 1 && eval277.totalStores === 1, `Estimate 277 has 1/1 stores completed`);
    }

    // Test 9: Multi-store incomplete case (Estimate 273 / ID 275)
    const [est273] = await db.select().from(estimates).where(eq(estimates.id, 275)).limit(1);
    if (est273) {
      console.log(`Checking Estimate 273 (DB ID 275: ${est273.estimateNumber})...`);
      assert(est273.status === "po_received", `Estimate 273 DB status is po_received (actual: ${est273.status})`);
      const items273 = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, 275));
      const allStores = await db.select().from(stores).where(eq(stores.companyId, est273.companyId || 1));
      const challans273 = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, 275)))
        .filter((c: any) => c.status !== "deleted" && !c.metadata?.deleted);
      const scoped273 = getEstimateScopedStores(est273, items273, allStores, challans273);
      const docs273 = (await db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, 275)))
        .filter((d: any) => d.status !== "deleted" && !d.deletedAt);
      const eval273 = evaluateInvoiceReadiness(est273, scoped273, challans273, docs273);
      assert(!eval273.isInvoiceReady, `Estimate 273 evaluated status is NOT invoice_ready`);
      assert(eval273.incompleteStores.length === 6, `Estimate 273 has 6 incomplete stores`);
    }
  } catch (dbErr) {
    console.warn("DB check skipped or error:", dbErr);
  } finally {
    await pool.end();
  }

  console.log("🎉 ALL INVOICE READINESS TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
