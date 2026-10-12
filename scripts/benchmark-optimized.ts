import "dotenv/config";
import { performance } from "perf_hooks";
import assert from "assert";
import { db } from "../server/db";
import { estimates, estimateItems, stores } from "../shared/schema";
import { renderEstimatePdfBuffer, renderEstimatePdfsBatch, getMasterData } from "../server/utils/estimatePdfRenderer";
import {
  getEstimatePdfFilename,
  packagePdfsIntoZip,
} from "../client/src/pages/operations/utils/estimatePdfExport";
import { PDFDocument } from "pdf-lib";
import { inArray } from "drizzle-orm";

async function measureOptimized(count: number) {
  console.log(`\n=============================================================`);
  console.log(`MEASURING OPTIMIZED PIPELINE FOR ${count} ESTIMATES`);
  console.log(`=============================================================`);

  const masterData = await getMasterData();
  const allStores = masterData.stores;
  const sampleEstimates = await db.select().from(estimates).limit(count);
  const actualCount = sampleEstimates.length;
  console.log(`Estimates under test: ${actualCount}`);

  // 1. Measure batch items loading time (optimized in-query)
  const tItemsStart = performance.now();
  const estimateIds = sampleEstimates.map((e) => e.id);
  const allRows = await db
    .select()
    .from(estimateItems)
    .where(inArray(estimateItems.estimateId, estimateIds));

  const itemsMap: Record<number, any[]> = {};
  for (const id of estimateIds) itemsMap[id] = [];
  for (const row of allRows) {
    if (!itemsMap[row.estimateId]) itemsMap[row.estimateId] = [];
    itemsMap[row.estimateId].push(row);
  }
  const tItemsEnd = performance.now();
  const itemsLoadTimeMs = tItemsEnd - tItemsStart;
  console.log(`[Metric] Batch items loading: ${itemsLoadTimeMs.toFixed(1)} ms (${(itemsLoadTimeMs / actualCount).toFixed(2)} ms/est)`);

  // 2. Measure PDF generation time with optimized renderer and controlled concurrency
  const tPdfStart = performance.now();
  const results = await renderEstimatePdfsBatch(estimateIds, {
    scale: 100,
    density: "normal",
    layout: "portrait",
    concurrency: 4,
  });
  const tPdfEnd = performance.now();
  const totalPdfTimeMs = tPdfEnd - tPdfStart;
  const avgPdfTimeMs = totalPdfTimeMs / actualCount;
  console.log(`[Metric] Concurrent PDF generation (concurrency=4): ${totalPdfTimeMs.toFixed(1)} ms (avg ${avgPdfTimeMs.toFixed(1)} ms/est)`);

  // Verify all returned valid buffers
  assert.strictEqual(results.length, actualCount);
  const pdfBytesMap: Record<string, Uint8Array> = {};
  for (let i = 0; i < actualCount; i++) {
    const res = results[i];
    assert(res.buffer.length > 0, `PDF ${i + 1} buffer must not be empty`);
    pdfBytesMap[res.filename] = new Uint8Array(res.buffer);
  }

  // 3. Measure optimized ZIP packaging time (level 1)
  const tZipStart = performance.now();
  const zipBlob = packagePdfsIntoZip(pdfBytesMap);
  const tZipEnd = performance.now();
  const zipTimeMs = tZipEnd - tZipStart;
  console.log(`[Metric] Optimized ZIP packaging: ${zipTimeMs.toFixed(1)} ms (size: ${(zipBlob.size / 1024).toFixed(1)} KB)`);

  // 4. Measure Combined PDF generation time
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
  console.log(`[Metric] Combined PDF generation: ${combinedTimeMs.toFixed(1)} ms (${combinedDoc.getPageCount()} pages, ${(combinedBytes.length / 1024).toFixed(1)} KB)`);

  const totalTimeMs = itemsLoadTimeMs + totalPdfTimeMs + zipTimeMs + combinedTimeMs;
  console.log(`[Metric] Total pipeline time: ${totalTimeMs.toFixed(1)} ms (${(totalTimeMs / 1000).toFixed(2)} s)`);

  return {
    count: actualCount,
    itemsLoadTimeMs: Number(itemsLoadTimeMs.toFixed(1)),
    totalPdfTimeMs: Number(totalPdfTimeMs.toFixed(1)),
    avgPdfTimeMs: Number(avgPdfTimeMs.toFixed(1)),
    zipTimeMs: Number(zipTimeMs.toFixed(1)),
    combinedTimeMs: Number(combinedTimeMs.toFixed(1)),
    totalTimeMs: Number(totalTimeMs.toFixed(1)),
  };
}

async function run() {
  const testCounts = [1, 8, 20, 44];
  const results = [];

  for (const c of testCounts) {
    results.push(await measureOptimized(c));
  }

  console.log("\n=============================================================");
  console.log("OPTIMIZED BENCHMARK SUMMARY");
  console.log("=============================================================");
  console.table(results);
  process.exit(0);
}

run().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
