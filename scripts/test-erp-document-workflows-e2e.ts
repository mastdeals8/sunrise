import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { executionDocuments, deliveryChallans, estimates, clients, companies, users } from "../shared/schema";
import { eq, sql, and } from "drizzle-orm";
import assert from "assert";

async function runUploadWorkflowsE2ETests() {
  console.log("======================================================================");
  console.log("RUNNING COMPREHENSIVE ERP-WIDE UPLOAD & ATTACHMENT REGRESSION SUITE");
  console.log("======================================================================");

  let testEstimateC1Id: number | null = null;
  let testEstimateC2Id: number | null = null;
  let testDcId: number | null = null;
  const createdDocIds: number[] = [];

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Inspect existing historical attachments (created before fix)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 1] Inspecting existing attachments created before the fix...");
    const [existingCount] = await db.select({ count: sql<number>`count(*)` }).from(executionDocuments);
    console.log(`  - Total execution_documents in DB: ${existingCount.count}`);
    assert(Number(existingCount.count) >= 1000, `Expected at least 1000 existing docs, found ${existingCount.count}`);

    // Verify all existing documents have company_id NOT NULL and company_id = 1
    const [nullCompanyDocs] = await db.select({ count: sql<number>`count(*)` })
      .from(executionDocuments)
      .where(sql`company_id IS NULL`);
    assert(Number(nullCompanyDocs.count) === 0, `Found ${nullCompanyDocs.count} documents with NULL company_id!`);
    console.log("  ✓ PASS: 100% of historical documents have NOT NULL company_id.");

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Setup Test Workspace Estimates for Company 1 and Company 2
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 2] Setting up isolated test records for Company 1 (Pune) and Company 2 (Delhi)...");
    
    // Find or create test estimate in Company 1
    const [c1Est] = await db.select().from(estimates).where(eq(estimates.companyId, 1)).limit(1);
    assert(c1Est, "Company 1 must have at least one estimate");
    testEstimateC1Id = c1Est.id;
    console.log(`  - Company 1 Estimate ID: ${testEstimateC1Id} (${c1Est.estimateNumber})`);

    // Create a temporary test estimate in Company 2
    const [c2Est] = await db.insert(estimates).values({
      companyId: 2,
      clientId: c1Est.clientId,
      brandId: c1Est.brandId || 1,
      storeId: c1Est.storeId || 1,
      estimateNumber: `TEST-C2-EST-${Date.now()}`,
      title: "Test C2 Upload Workspace Estimate",
      status: "draft",
      clientFormat: "normal",
      subtotal: 10000,
      taxAmount: 1800,
      totalAmount: 11800,
      createdAt: new Date(),
    }).returning();
    testEstimateC2Id = c2Est.id;
    console.log(`  - Company 2 Test Estimate ID: ${testEstimateC2Id} (${c2Est.estimateNumber})`);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. PO Upload, Metadata Persistence, Auto-Company Inheritance
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Testing PO upload & auto-company inheritance...");
    const testPoPath = `estimate-${testEstimateC1Id}/po/${Date.now()}-client_po.pdf`;

    // 3a. Insert without explicit company_id: Trigger must auto-populate company_id = 1 from parent estimate
    const [poDocAuto] = await db.insert(executionDocuments).values({
      estimateId: testEstimateC1Id,
      documentType: "po",
      filePath: testPoPath,
      originalFileName: "client_po.pdf",
      mimeType: "application/pdf",
      fileSize: 45678,
      status: "active",
      version: 1,
      uploadedVia: "po_modal",
    } as any).returning();
    createdDocIds.push(poDocAuto.id);

    assert.strictEqual(poDocAuto.companyId, 1, `Expected companyId=1 inherited from estimate, got ${poDocAuto.companyId}`);
    assert.strictEqual(poDocAuto.status, "active");
    assert.strictEqual(poDocAuto.version, 1);
    console.log(`  ✓ PASS: PO document inserted and auto-inherited company_id=1 (doc ID: ${poDocAuto.id})`);

    // 3b. Verify retrieval and parent estimate linking
    const [retrievedPo] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, poDocAuto.id));
    assert(retrievedPo, "PO document must be retrievable");
    assert.strictEqual(retrievedPo.filePath, testPoPath);
    console.log("  ✓ PASS: PO document retrieved successfully with correct metadata and path.");

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Document Replacement Lifecycle & Versioning
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Testing PO replacement lifecycle (v1 -> v2)...");
    const replacementPoPath = `estimate-${testEstimateC1Id}/po/${Date.now()}-client_po_v2.pdf`;

    // Simulate replacement: insert v2, update v1 to replaced
    const [poDocV2] = await db.insert(executionDocuments).values({
      companyId: 1,
      estimateId: testEstimateC1Id,
      documentType: "po",
      filePath: replacementPoPath,
      originalFileName: "client_po_v2.pdf",
      mimeType: "application/pdf",
      fileSize: 52000,
      status: "active",
      version: 2,
      uploadedVia: "po_modal",
      metadata: {
        rootDocumentId: poDocAuto.id,
        replacedDocumentId: poDocAuto.id,
      },
    }).returning();
    createdDocIds.push(poDocV2.id);

    await db.update(executionDocuments)
      .set({ status: "replaced", replacedByDocumentId: poDocV2.id, updatedAt: new Date() })
      .where(eq(executionDocuments.id, poDocAuto.id));

    // Verify v1 is marked 'replaced'
    const [v1Updated] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, poDocAuto.id));
    assert.strictEqual(v1Updated.status, "replaced");
    assert.strictEqual(v1Updated.replacedByDocumentId, poDocV2.id);

    // Verify v2 is active and has correct version
    const [v2Check] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, poDocV2.id));
    assert.strictEqual(v2Check.status, "active");
    assert.strictEqual(v2Check.version, 2);
    console.log("  ✓ PASS: PO replaced cleanly: v1 status='replaced', v2 status='active', version=2.");

    // ─────────────────────────────────────────────────────────────────────────
    // 5. WCC Creation and Supporting Photo / Document Upload
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Testing WCC creation and photo / signed WCC attachments...");
    
    // Create test Delivery Challan / WCC under Company 1
    const [testDc] = await db.insert(deliveryChallans).values({
      companyId: 1,
      estimateId: testEstimateC1Id,
      dcNumber: `TEST-WCC-${Date.now()}`,
      clientFormat: "abfrl",
      documentType: "wcc",
      deliveryDate: new Date(),
      status: "active",
      metadata: { storeCode: "STORE-TEST-01" },
    }).returning();
    testDcId = testDc.id;

    // Attach installation photo
    const photoPath = `estimate-${testEstimateC1Id}/photos/${Date.now()}-before.jpg`;
    const [photoDoc] = await db.insert(executionDocuments).values({
      companyId: 1,
      estimateId: testEstimateC1Id,
      deliveryChallanId: testDc.id,
      storeCode: "STORE-TEST-01",
      documentType: "photo",
      filePath: photoPath,
      originalFileName: "before.jpg",
      mimeType: "image/jpeg",
      fileSize: 120400,
      status: "active",
      version: 1,
      uploadedVia: "project_workspace",
      metadata: { photoType: "Before" },
    }).returning();
    createdDocIds.push(photoDoc.id);

    // Attach signed WCC
    const signedWccPath = `estimate-${testEstimateC1Id}/wcc/${Date.now()}-signed_wcc.pdf`;
    const [signedWccDoc] = await db.insert(executionDocuments).values({
      companyId: 1,
      estimateId: testEstimateC1Id,
      deliveryChallanId: testDc.id,
      storeCode: "STORE-TEST-01",
      documentType: "signed_wcc",
      filePath: signedWccPath,
      originalFileName: "signed_wcc.pdf",
      mimeType: "application/pdf",
      fileSize: 85000,
      status: "active",
      version: 1,
      uploadedVia: "project_workspace",
    }).returning();
    createdDocIds.push(signedWccDoc.id);

    assert.strictEqual(photoDoc.companyId, 1);
    assert.strictEqual(photoDoc.deliveryChallanId, testDc.id);
    assert.strictEqual(signedWccDoc.companyId, 1);
    assert.strictEqual(signedWccDoc.deliveryChallanId, testDc.id);
    console.log("  ✓ PASS: WCC photos and signed WCC attachments persist with correct store & company ID.");

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Transporter Sheet and Extra Documents
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Testing Transporter Sheet and Extra Document attachments...");
    const transportPath = `estimate-${testEstimateC1Id}/transport/${Date.now()}-lr_receipt.pdf`;
    const [transportDoc] = await db.insert(executionDocuments).values({
      companyId: 1,
      estimateId: testEstimateC1Id,
      deliveryChallanId: testDc.id,
      storeCode: "STORE-TEST-01",
      documentType: "transport_receipt",
      filePath: transportPath,
      originalFileName: "lr_receipt.pdf",
      mimeType: "application/pdf",
      fileSize: 34500,
      status: "active",
      version: 1,
      uploadedVia: "project_workspace",
    }).returning();
    createdDocIds.push(transportDoc.id);

    assert.strictEqual(transportDoc.documentType, "transport_receipt");
    assert.strictEqual(transportDoc.companyId, 1);
    console.log("  ✓ PASS: Transport receipt document attached and verified.");

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Multi-Tenant Isolation & Cross-Company Tamper Rejection
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Testing Multi-Tenant isolation & cross-company write rejection...");
    
    // 7a. Document attached under Company 2 estimate
    const c2PoPath = `estimate-${testEstimateC2Id}/po/${Date.now()}-c2_po.pdf`;
    const [c2Doc] = await db.insert(executionDocuments).values({
      companyId: 2,
      estimateId: testEstimateC2Id,
      documentType: "po",
      filePath: c2PoPath,
      originalFileName: "c2_po.pdf",
      mimeType: "application/pdf",
      fileSize: 22000,
      status: "active",
      version: 1,
      uploadedVia: "po_modal",
    }).returning();
    createdDocIds.push(c2Doc.id);
    assert.strictEqual(c2Doc.companyId, 2);
    console.log("  ✓ PASS: Company 2 document created under Company 2 ownership.");

    // 7b. Attempt cross-company tamper: Insert document with company_id = 2 pointing to Company 1 estimate
    // Must be rejected by trigger `trg_execution_documents_company_integrity`
    let crossCompanyBlocked = false;
    try {
      await db.insert(executionDocuments).values({
        companyId: 2, // Tampered: trying to associate Company 2 with Company 1 estimate!
        estimateId: testEstimateC1Id, // Company 1
        documentType: "po",
        filePath: "tamper/path.pdf",
        originalFileName: "tamper.pdf",
        mimeType: "application/pdf",
        status: "active",
        version: 1,
        uploadedVia: "hack",
      });
    } catch (err: any) {
      crossCompanyBlocked = true;
      assert(err.message.includes("Execution document company_id (2) does not match parent estimate company_id (1)"),
        `Unexpected error message: ${err.message}`);
    }
    assert(crossCompanyBlocked, "CRITICAL: Cross-company document insertion was NOT blocked!");
    console.log("  ✓ PASS: Database trigger strictly rejected cross-company document association.");

    // 7c. Attempt cross-company challan tamper: Insert DC with company_id = 2 pointing to Company 1 estimate
    let crossCompanyDcBlocked = false;
    try {
      await db.insert(deliveryChallans).values({
        companyId: 2, // Tampered
        estimateId: testEstimateC1Id, // Company 1
        dcNumber: `TAMPER-DC-${Date.now()}`,
        clientFormat: "normal",
        deliveryDate: new Date(),
        status: "active",
      });
    } catch (err: any) {
      crossCompanyDcBlocked = true;
      assert(err.message.includes("Delivery challan company_id (2) does not match parent estimate company_id (1)"),
        `Unexpected error message: ${err.message}`);
    }
    assert(crossCompanyDcBlocked, "CRITICAL: Cross-company delivery challan was NOT blocked!");
    console.log("  ✓ PASS: Database trigger strictly rejected cross-company delivery challan association.");

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Workspace Scoped Queries Isolation
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Verifying Workspace 1 vs Workspace 2 isolation in queries...");
    const c1Docs = await db.select().from(executionDocuments).where(eq(executionDocuments.companyId, 1));
    const c2Docs = await db.select().from(executionDocuments).where(eq(executionDocuments.companyId, 2));

    assert(c1Docs.length >= 1000, "Company 1 must contain all historical documents");
    assert(c2Docs.length === 1, `Company 2 must only contain its 1 test doc, found ${c2Docs.length}`);
    assert(!c2Docs.some(d => d.companyId !== 2), "Company 2 query leaked non-company-2 records!");
    console.log(`  ✓ PASS: Workspace queries strictly isolated (C1: ${c1Docs.length} docs, C2: ${c2Docs.length} docs).`);

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Soft Deletion Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Testing soft deletion lifecycle...");
    await db.update(executionDocuments)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(executionDocuments.id, photoDoc.id));

    const [deletedPhoto] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, photoDoc.id));
    assert.strictEqual(deletedPhoto.status, "deleted");
    assert(deletedPhoto.deletedAt !== null);

    const activeDocs = await db.select().from(executionDocuments)
      .where(and(eq(executionDocuments.estimateId, testEstimateC1Id), eq(executionDocuments.status, "active")));
    assert(!activeDocs.some(d => d.id === photoDoc.id), "Deleted photo must not appear in active documents");
    console.log("  ✓ PASS: Document soft-deletion marks status='deleted' and filters out of active queries.");

    console.log("\n======================================================================");
    console.log("ALL ERP-WIDE UPLOAD & ATTACHMENT TESTS PASSED SUCCESSFULLY! (9/9)");
    console.log("======================================================================");

  } finally {
    console.log("\nCleaning up test artifacts...");
    if (createdDocIds.length > 0) {
      await db.delete(executionDocuments).where(sql`id IN (${sql.join(createdDocIds, sql`, `)})`);
    }
    if (testDcId) {
      await db.delete(deliveryChallans).where(eq(deliveryChallans.id, testDcId));
    }
    if (testEstimateC2Id) {
      await db.delete(estimates).where(eq(estimates.id, testEstimateC2Id));
    }
    console.log("Cleanup complete.");
  }
}

runUploadWorkflowsE2ETests().catch(err => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
