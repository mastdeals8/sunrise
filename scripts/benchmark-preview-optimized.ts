import { chromium } from "playwright";

interface BenchmarkResult {
  mode: string;
  count: number;
  totalTimeSec: number;
  perEstimateAvgSec: number;
  memoryUsageMb?: number;
  statusText: string;
  success: boolean;
}

async function runBenchmark(baseUrl: string) {
  console.log(`\n======================================================`);
  console.log(`STARTING BULK ESTIMATE PDF EXPORT BENCHMARK ON: ${baseUrl}`);
  console.log(`======================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Generating") || text.includes("Packaging") || text.includes("Completed:") || text.includes("elapsed")) {
      console.log(`  [Console] ${text}`);
    }
  });

  console.log("1. Navigating to application...");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="admin"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  await page.waitForSelector('text="Estimate Register"', { timeout: 15000 });
  await page.click('text="Estimate Register"');
  await page.waitForTimeout(2000);

  const results: BenchmarkResult[] = [];

  // ==========================================
  // BENCHMARK 1: SINGLE ESTIMATE PDF GENERATION
  // ==========================================
  console.log("\n>>> RUNNING TEST 1: Single-estimate PDF generation");
  // Select 1 estimate
  await page.waitForSelector("tbody tr input[type='checkbox']", { timeout: 10000 });
  const boxes = await page.$$("tbody tr input[type='checkbox']");
  await boxes[0].click();
  await page.waitForTimeout(300);

  let exportBtn = await page.waitForSelector('button:has-text("Print / Export PDFs")', { timeout: 5000 });
  await exportBtn.click();
  await page.waitForTimeout(500);

  let zipBtn = await page.waitForSelector('button:has-text("Export Individual PDFs (ZIP)")', { timeout: 5000 });
  let t0 = performance.now();
  let dlPromise = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  await zipBtn.click();
  let dl = await dlPromise;
  let elapsed1 = (performance.now() - t0) / 1000;
  console.log(`Test 1 finished in ${elapsed1.toFixed(2)}s (Downloaded: ${dl?.suggestedFilename()})`);
  results.push({
    mode: "Single Estimate PDF",
    count: 1,
    totalTimeSec: Number(elapsed1.toFixed(2)),
    perEstimateAvgSec: Number(elapsed1.toFixed(2)),
    statusText: dl ? "Success" : "Failed",
    success: !!dl,
  });

  // Close modal
  await page.click('button[aria-label="Close"], div[role="dialog"] button:has-text("×"), div[role="dialog"] button:has(.lucide-x)');
  await page.waitForTimeout(500);
  // Clear selection
  const clearBtn = await page.$('button:has-text("Clear Selection")');
  if (clearBtn) await clearBtn.click();
  await page.waitForTimeout(500);

  // ==========================================
  // BENCHMARK 2: SIX INDIVIDUAL PDFS & ZIP EXPORT
  // ==========================================
  console.log("\n>>> RUNNING TEST 2: Six individual PDFs and ZIP export");
  const rowCheckboxes = await page.$$("tbody tr input[type='checkbox']");
  for (let i = 0; i < 6; i++) {
    const currentBoxes = await page.$$("tbody tr input[type='checkbox']");
    if (currentBoxes[i]) {
      await currentBoxes[i].click();
      await page.waitForTimeout(100);
    }
  }

  exportBtn = await page.waitForSelector('button:has-text("Print / Export PDFs")', { timeout: 5000 });
  await exportBtn.click();
  await page.waitForTimeout(500);

  zipBtn = await page.waitForSelector('button:has-text("Export Individual PDFs (ZIP)")', { timeout: 5000 });
  t0 = performance.now();
  dlPromise = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  await zipBtn.click();
  dl = await dlPromise;
  let elapsed2 = (performance.now() - t0) / 1000;
  console.log(`Test 2 finished in ${elapsed2.toFixed(2)}s (Downloaded: ${dl?.suggestedFilename()})`);
  results.push({
    mode: "6 Individual PDFs (ZIP)",
    count: 6,
    totalTimeSec: Number(elapsed2.toFixed(2)),
    perEstimateAvgSec: Number((elapsed2 / 6).toFixed(2)),
    statusText: dl ? "Success" : "Failed",
    success: !!dl,
  });

  // ==========================================
  // BENCHMARK 3: SIX ESTIMATE COMBINED PDF EXPORT
  // ==========================================
  console.log("\n>>> RUNNING TEST 3: Six-estimate Combined PDF export");
  // In the same modal or re-opened modal, click "Print Combined PDF"
  const combBtn = await page.waitForSelector('button:has-text("Print Combined PDF")', { timeout: 5000 });
  t0 = performance.now();
  await combBtn.click();
  // Wait for status text to indicate combined assembly done
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes("Assembling combined PDF") || text.includes("Completed:");
  }, { timeout: 60000 });
  // Wait until completed
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes("Completed:") && !text.includes("Generating PDF");
  }, { timeout: 60000 });
  let elapsed3 = (performance.now() - t0) / 1000;
  console.log(`Test 3 finished in ${elapsed3.toFixed(2)}s`);
  results.push({
    mode: "6 Estimates Combined PDF",
    count: 6,
    totalTimeSec: Number(elapsed3.toFixed(2)),
    perEstimateAvgSec: Number((elapsed3 / 6).toFixed(2)),
    statusText: "Success",
    success: true,
  });

  console.log("\n======================================================");
  console.log("BENCHMARK RESULTS SUMMARY");
  console.log("======================================================");
  console.table(results);

  await browser.close();
  return results;
}

runBenchmark("http://localhost:5005").catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
