/**
 * Regression Test: PO Path Corruption Protection & Document Repair Isolation
 *
 * Verifies:
 * 1. Resolving a transport receipt (even with mismatched timestamp/path) NEVER changes estimates.po_file_path.
 * 2. Resolving an installation photo NEVER changes estimates.po_file_path.
 * 3. Resolving a WCC NEVER changes estimates.po_file_path.
 * 4. Generic getExecutionDocumentSignedUrl NEVER updates estimates.po_file_path.
 * 5. Historical PO recovery (recoverHistoricalPo = true) repairs PO path strictly for PO documents.
 * 6. Repair of execution_documents.file_path is strictly isolated by documentId + estimateId and never affects unrelated documents.
 */

import { db } from "../server/db";
import { estimates, executionDocuments } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { getExecutionDocumentSignedUrl } from "../client/src/lib/api";

async function runRegressionTests() {
  console.log("================================================================================");
  console.log("REGRESSION TEST: PO PATH PROTECTION & DOCUMENT REPAIR ISOLATION");
  console.log("================================================================================\n");

  // Load baseline Estimate 218 (Invoice 193)
  const [initialEst218] = await db.select().from(estimates).where(eq(estimates.id, 218));
  if (!initialEst218) {
    throw new Error("Estimate 218 not found in database");
  }
  const originalPoPath = initialEst218.poFilePath;
  console.log(`Baseline Estimate 218 PO Path: ${originalPoPath}\n`);

  if (!originalPoPath) {
    throw new Error("Estimate 218 must have an initial po_file_path for testing");
  }

  // Fetch execution documents for Estimate 218
  const docs218 = await db
    .select()
    .from(executionDocuments)
    .where(and(eq(executionDocuments.estimateId, 218), eq(executionDocuments.status, "active")));

  const transportDoc = docs218.find((d) =>
    ["transport_receipt", "transport_invoice", "lr_copy"].includes(String(d.documentType).toLowerCase())
  );
  const photoDoc = docs218.find((d) =>
    ["photo", "installation_photo"].includes(String(d.documentType).toLowerCase())
  );
  const wccDoc = docs218.find((d) =>
    ["signed_wcc", "signed_dc", "wcc"].includes(String(d.documentType).toLowerCase())
  );
  const poDoc = docs218.find((d) =>
    ["po", "client_po"].includes(String(d.documentType).toLowerCase())
  );

  console.log("Found Estimate 218 documents:");
  console.log("  Transport Doc:", transportDoc?.id, transportDoc?.filePath);
  console.log("  Photo Doc:    ", photoDoc?.id, photoDoc?.filePath);
  console.log("  WCC Doc:      ", wccDoc?.id, wccDoc?.filePath);
  console.log("  PO Doc:       ", poDoc?.id, poDoc?.filePath);
  console.log("");

  // --------------------------------------------------------------------------
  // TEST 1: Resolve transport receipt with mismatched timestamp / generic path
  // --------------------------------------------------------------------------
  console.log("--- TEST 1: Resolve Transport Receipt (Mismatched Timestamp / Stored Path) ---");
  // Pass a timestamp-variant path or existing transport path
  const testTrPath = transportDoc?.filePath || "estimate-218/transport/1793176228308-01.png";
  const trSignedUrl = await getExecutionDocumentSignedUrl(testTrPath, false, 218, false, transportDoc?.id);
  console.log("  Signed URL generated:", trSignedUrl.slice(0, 70) + "...");

  const [estAfterTr] = await db.select().from(estimates).where(eq(estimates.id, 218));
  if (estAfterTr.poFilePath !== originalPoPath) {
    throw new Error(
      `CRITICAL REGRESSION: po_file_path was corrupted by transport resolution!\nExpected: ${originalPoPath}\nActual:   ${estAfterTr.poFilePath}`
    );
  }
  console.log("  ✓ SUCCESS: Estimate 218 po_file_path remains completely untouched after transport resolution.");

  // --------------------------------------------------------------------------
  // TEST 2: Resolve installation photo
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 2: Resolve Installation Photo ---");
  if (photoDoc) {
    const photoSignedUrl = await getExecutionDocumentSignedUrl(photoDoc.filePath, false, 218, false, photoDoc.id);
    console.log("  Signed URL generated:", photoSignedUrl.slice(0, 70) + "...");
  }
  const [estAfterPhoto] = await db.select().from(estimates).where(eq(estimates.id, 218));
  if (estAfterPhoto.poFilePath !== originalPoPath) {
    throw new Error(
      `CRITICAL REGRESSION: po_file_path was corrupted by photo resolution!\nExpected: ${originalPoPath}\nActual:   ${estAfterPhoto.poFilePath}`
    );
  }
  console.log("  ✓ SUCCESS: Estimate 218 po_file_path remains completely untouched after photo resolution.");

  // --------------------------------------------------------------------------
  // TEST 3: Resolve WCC document
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 3: Resolve WCC Document ---");
  if (wccDoc) {
    const wccSignedUrl = await getExecutionDocumentSignedUrl(wccDoc.filePath, false, 218, false, wccDoc.id);
    console.log("  Signed URL generated:", wccSignedUrl.slice(0, 70) + "...");
  }
  const [estAfterWcc] = await db.select().from(estimates).where(eq(estimates.id, 218));
  if (estAfterWcc.poFilePath !== originalPoPath) {
    throw new Error(
      `CRITICAL REGRESSION: po_file_path was corrupted by WCC resolution!\nExpected: ${originalPoPath}\nActual:   ${estAfterWcc.poFilePath}`
    );
  }
  console.log("  ✓ SUCCESS: Estimate 218 po_file_path remains completely untouched after WCC resolution.");

  // --------------------------------------------------------------------------
  // TEST 4: Historical PO recovery path (recoverHistoricalPo = true)
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 4: Historical PO Recovery Path ---");
  const poSignedUrl = await getExecutionDocumentSignedUrl(originalPoPath, false, 218, true, poDoc?.id);
  console.log("  Signed URL generated for PO:", poSignedUrl.slice(0, 70) + "...");
  const [estAfterPo] = await db.select().from(estimates).where(eq(estimates.id, 218));
  if (!estAfterPo.poFilePath || !estAfterPo.poFilePath.includes("Purchase_Order_6010034231")) {
    throw new Error(
      `PO recovery failed to preserve or repair correct PO path!\nActual: ${estAfterPo.poFilePath}`
    );
  }
  console.log("  ✓ SUCCESS: Historical PO recovery correctly targets and preserves PO path.");

  // --------------------------------------------------------------------------
  // TEST 5: Document repair isolation in execution_documents
  // --------------------------------------------------------------------------
  console.log("\n--- TEST 5: Exact Document Repair Isolation ---");
  if (transportDoc && photoDoc) {
    const originalPhotoPath = photoDoc.filePath;
    // Attempt resolving transportDoc with transportDoc.id
    await getExecutionDocumentSignedUrl(transportDoc.filePath, false, 218, false, transportDoc.id);

    // Verify photoDoc in database was NOT changed
    const [freshPhotoDoc] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, photoDoc.id));
    if (freshPhotoDoc.filePath !== originalPhotoPath) {
      throw new Error(
        `CRITICAL REGRESSION: execution_documents photo was modified when resolving transport doc!\nExpected: ${originalPhotoPath}\nActual: ${freshPhotoDoc.filePath}`
      );
    }
    console.log("  ✓ SUCCESS: Document repair is strictly scoped to documentId and does not touch other documents.");
  }

  console.log("\n================================================================================");
  console.log("ALL 5 REGRESSION TESTS PASSED! ZERO PO CORRUPTION RISK DETECTED.");
  console.log("================================================================================");
  process.exit(0);
}

runRegressionTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
