import "dotenv/config";
import assert from "assert";
import { PDFDocument } from "pdf-lib";
import { db } from "../server/db";
import { estimates, estimateItems, stores } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";
import { renderEstimatePdfBuffer } from "../server/utils/estimatePdfRenderer";
import {
  getEstimatePdfFilename,
  packagePdfsIntoZip,
  sanitizeFilenamePart,
} from "../client/src/pages/operations/utils/estimatePdfExport";

async function main() {
  console.log("=================================================================");
  console.log("TESTING BULK ESTIMATE 8-ESTIMATE EXPORT & PRINT PIPELINE");
  console.log("=================================================================\n");

  const allStores = await db.select().from(stores);
  const sampleEstimates = await db.select().from(estimates).limit(8);

  console.log(`Found ${sampleEstimates.length} estimates for testing:`);
  assert(sampleEstimates.length >= 1, "At least 1 estimate must exist in DB");

  const zipFiles: Record<string, Uint8Array> = {};
  const combinedDoc = await PDFDocument.create();
  combinedDoc.setTitle("Combined Estimates");

  let successCount = 0;
  const failures: Array<{ estimateId: number; error: string }> = [];

  for (let i = 0; i < sampleEstimates.length; i++) {
    const est = sampleEstimates[i];
    const filename = getEstimatePdfFilename(est, allStores);
    console.log(`[${i + 1}/${sampleEstimates.length}] Processing Estimate ID ${est.id} (${est.estimateNumber})...`);
    console.log(`  -> Canonical Filename: ${filename}`);

    try {
      // 1. Verify filename structure: EstimateNo_StoreName.pdf
      assert(filename.endsWith(".pdf"), "Filename must end with .pdf");
      const estPart = sanitizeFilenamePart(est.estimateNumber || `Estimate-${est.id}`);
      assert(filename.startsWith(estPart), `Filename must start with estimate number ${estPart}`);

      // 2. Render canonical PDF
      const result = await renderEstimatePdfBuffer({
        estimateId: est.id,
        scale: 100,
        density: "normal",
        layout: "portrait",
      });

      assert(result.buffer.length > 0, "PDF buffer must not be empty");
      console.log(`  -> Rendered PDF bytes: ${result.buffer.length}`);

      // 3. Inspect individual PDF
      const singleDoc = await PDFDocument.load(result.buffer);
      const pageCount = singleDoc.getPageCount();
      console.log(`  -> Page count: ${pageCount}`);
      assert(pageCount >= 1, "Must have at least 1 page");

      // Verify A4 dimensions
      const p0 = singleDoc.getPage(0);
      assert(Math.abs(p0.getWidth() - 595.28) < 5, "Width must match A4 (595 pt)");
      assert(Math.abs(p0.getHeight() - 841.89) < 5, "Height must match A4 (842 pt)");

      // 4. Add to ZIP map
      let uniqueName = filename;
      let counter = 2;
      while (zipFiles[uniqueName]) {
        uniqueName = filename.replace(/\.pdf$/i, `_${counter}.pdf`);
        counter++;
      }
      zipFiles[uniqueName] = new Uint8Array(result.buffer);

      // 5. Append to combined document (each estimate starts on a new page)
      const copiedPages = await combinedDoc.copyPages(
        singleDoc,
        singleDoc.getPageIndices()
      );
      copiedPages.forEach((p) => combinedDoc.addPage(p));

      successCount++;
    } catch (err: any) {
      console.error(`  -> FAILED: ${err.message}`);
      failures.push({ estimateId: est.id, error: err.message });
    }
  }

  console.log(`\nResults: ${successCount} succeeded, ${failures.length} failed.`);
  assert.strictEqual(failures.length, 0, `All estimates must succeed, but got ${failures.length} failures: ${JSON.stringify(failures)}`);

  // Verify ZIP packaging
  const zipBlob = packagePdfsIntoZip(zipFiles);
  assert(zipBlob.size > 0, "ZIP blob must not be empty");
  console.log(`✓ Successfully packaged ${Object.keys(zipFiles).length} files into ZIP archive (${zipBlob.size} bytes)`);

  // Verify Combined PDF
  const combinedBytes = await combinedDoc.save();
  assert(combinedBytes.length > 0, "Combined PDF bytes must not be empty");
  console.log(`✓ Successfully built combined PDF with ${combinedDoc.getPageCount()} pages (${combinedBytes.length} bytes)`);

  console.log("\n=================================================================");
  console.log("ALL 8-ESTIMATE VERIFICATIONS PASSED WITH 100% SUCCESS");
  console.log("=================================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
