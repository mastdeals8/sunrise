import "dotenv/config";
import { performance } from "perf_hooks";
import { db } from "../server/db";
import { estimates, estimateItems, stores } from "../shared/schema";
import { renderEstimatePdfBuffer } from "../server/utils/estimatePdfRenderer";
import {
  getEstimatePdfFilename,
  packagePdfsIntoZip,
} from "../client/src/pages/operations/utils/estimatePdfExport";
import { PDFDocument } from "pdf-lib";
import { eq } from "drizzle-orm";

async function measureBaseline(count: number) {
  console.log(`\n=============================================================`);
  console.log(`MEASURING BASELINE FOR ${count} ESTIMATES`);
  console.log(`=============================================================`);

  const allStores = await db.select().from(stores);
  const sampleEstimates = await db.select().from(estimates).limit(count);
  const actualCount = sampleEstimates.length;
  console.log(`Actual estimates available: ${actualCount}`);

  // 1. Measure items loading time (current sequential pattern)
  const tItemsStart = performance.now();
  const itemsMap: Record<number, any[]> = {};
  for (const est of sampleEstimates) {
    const items = await db
      .select()
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, est.id));
    itemsMap[est.id] = items;
  }
  const tItemsEnd = performance.now();
  const itemsLoadTimeMs = tItemsEnd - tItemsStart;
  console.log(`[Metric] Sequential items loading: ${itemsLoadTimeMs.toFixed(1)} ms (${(itemsLoadTimeMs / actualCount).toFixed(1)} ms/est)`);

  // 2. Measure PDF generation time (server Playwright sequential)
  const tPdfStart = performance.now();
  const pdfBytesMap: Record<string, Uint8Array> = {};
  const perEstimateTimes: number[] = [];

  for (let i = 0; i < actualCount; i++) {
    const est = sampleEstimates[i];
    const tSingleStart = performance.now();
    const result = await renderEstimatePdfBuffer({
      estimateId: est.id,
      scale: 100,
      density: "normal",
      layout: "portrait",
    });
    const tSingleEnd = performance.now();
    const singleMs = tSingleEnd - tSingleStart;
    perEstimateTimes.push(singleMs);

    const filename = getEstimatePdfFilename(est, allStores);
    pdfBytesMap[filename] = new Uint8Array(result.buffer);
    console.log(`  PDF ${i + 1}/${actualCount} (${est.estimateNumber}): ${singleMs.toFixed(1)} ms`);
  }
  const tPdfEnd = performance.now();
  const totalPdfTimeMs = tPdfEnd - tPdfStart;
  const avgPdfTimeMs = totalPdfTimeMs / actualCount;
  console.log(`[Metric] Total PDF generation time: ${totalPdfTimeMs.toFixed(1)} ms (avg ${avgPdfTimeMs.toFixed(1)} ms/est)`);

  // 3. Measure ZIP packaging time (fflate level 6)
  const tZipStart = performance.now();
  const zipBlob = packagePdfsIntoZip(pdfBytesMap);
  const tZipEnd = performance.now();
  const zipTimeMs = tZipEnd - tZipStart;
  console.log(`[Metric] ZIP packaging time: ${zipTimeMs.toFixed(1)} ms (size: ${(zipBlob.size / 1024).toFixed(1)} KB)`);

  // 4. Measure Combined PDF generation time (pdf-lib merge)
  const tCombinedStart = performance.now();
  const combinedDoc = await PDFDocument.create();
  combinedDoc.setTitle("Combined Estimates");
  for (const filename of Object.keys(pdfBytesMap)) {
    const single = await PDFDocument.load(pdfBytesMap[filename]);
    const pages = await combinedDoc.copyPages(single, single.getPageIndices());
    pages.forEach((p) => combinedDoc.addPage(p));
  }
  const combinedBytes = await combinedDoc.save();
  const tCombinedEnd = performance.now();
  const combinedTimeMs = tCombinedEnd - tCombinedStart;
  console.log(`[Metric] Combined PDF generation time: ${combinedTimeMs.toFixed(1)} ms (${combinedDoc.getPageCount()} pages, ${(combinedBytes.length / 1024).toFixed(1)} KB)`);

  const totalTimeMs = itemsLoadTimeMs + totalPdfTimeMs + zipTimeMs + combinedTimeMs;
  console.log(`[Metric] Total pipeline time: ${totalTimeMs.toFixed(1)} ms (${(totalTimeMs / 1000).toFixed(2)} s)`);

  return {
    count: actualCount,
    itemsLoadTimeMs,
    totalPdfTimeMs,
    avgPdfTimeMs,
    zipTimeMs,
    combinedTimeMs,
    totalTimeMs,
  };
}

async function run() {
  const results = [];
  for (const c of [1, 8, 20]) {
    results.push(await measureBaseline(c));
  }
  console.log("\n=============================================================");
  console.log("BASELINE MEASUREMENT SUMMARY");
  console.log("=============================================================");
  console.table(results);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
