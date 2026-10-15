import { chromium } from "playwright";

async function run() {
  console.log("Launching browser to benchmark live production on sunriseapp.bolt.host...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    console.log(`[Browser Console] ${msg.type()}: ${text}`);
  });

  page.on("pageerror", (err) => {
    console.log(`[Browser PageError]`, err);
  });

  const t0 = performance.now();
  console.log("Navigating to https://sunriseapp.bolt.host ...");
  await page.goto("https://sunriseapp.bolt.host", { waitUntil: "networkidle" });
  console.log(`Loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);

  // Log in
  console.log("Logging in as admin...");
  await page.fill('input[placeholder="admin"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  console.log("Waiting for app navigation...");
  await page.waitForSelector('text="Estimate Register"', { timeout: 15000 });
  console.log("Logged in successfully!");

  // Navigate to Estimate Register
  console.log("Navigating to Estimate Register...");
  await page.click('text="Estimate Register"');
  await page.waitForTimeout(2000);

  // In the table, find estimate rows and select 6 checkboxes
  console.log("Selecting first 6 estimates...");
  await page.waitForSelector("tbody tr input[type='checkbox']", { timeout: 10000 });
  const rowCheckboxes = await page.$$("tbody tr input[type='checkbox']");
  console.log(`Found ${rowCheckboxes.length} row checkboxes`);
  const countToSelect = Math.min(6, rowCheckboxes.length);

  for (let i = 0; i < countToSelect; i++) {
    // Re-query checkboxes because selection may re-render toolbar
    const currentBoxes = await page.$$("tbody tr input[type='checkbox']");
    if (currentBoxes[i]) {
      await currentBoxes[i].click();
      await page.waitForTimeout(200);
    }
  }

  // Click Print / Export PDFs toolbar button
  console.log("Clicking Print / Export PDFs toolbar button...");
  const exportBtn = await page.waitForSelector('button:has-text("Print / Export PDFs")', { timeout: 5000 });
  await exportBtn.click();
  await page.waitForTimeout(1000);

  // In the modal, locate the "Export Individual PDFs (ZIP)" button
  console.log("Modal opened. Finding Export Individual PDFs (ZIP) button...");
  const zipBtn = await page.waitForSelector('button:has-text("Export Individual PDFs (ZIP)")', { timeout: 5000 });

  // Instrument the page by monkey-patching or wrapping renderEstimateElementToPdf / html2canvas in window
  await page.evaluate(() => {
    (window as any).__exportMetrics = [];
    const origHtml2Canvas = (window as any).html2canvas;
    // We can observe DOM changes or timing via MutationObserver or console
    console.log("[Instrumentation] Page ready for benchmark measurement");
  });

  const exportStartTime = performance.now();
  console.log("Starting bulk export at", new Date().toISOString());

  // Listen for download
  const downloadPromise = page.waitForEvent("download", { timeout: 350000 }).catch((e) => {
    console.log("Download wait error/timeout:", e.message);
    return null;
  });

  await zipBtn.click();

  let lastStatus = "";
  const interval = setInterval(async () => {
    try {
      const text = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll("div, p, span"));
        for (const el of elements) {
          const t = el.textContent || "";
          if (
            t.includes("Generating PDF") ||
            t.includes("Completed:") ||
            t.includes("Packaging") ||
            t.includes("Preparing")
          ) {
            return t.trim();
          }
        }
        return "";
      });
      if (text && text !== lastStatus) {
        lastStatus = text;
        const elapsed = ((performance.now() - exportStartTime) / 1000).toFixed(1);
        console.log(`[Status @ ${elapsed}s]: ${text}`);
      }
    } catch {}
  }, 1000);

  const download = await downloadPromise;
  clearInterval(interval);
  const totalElapsed = ((performance.now() - exportStartTime) / 1000).toFixed(2);

  if (download) {
    const filename = download.suggestedFilename();
    console.log(`\n======================================================`);
    console.log(`>>> BENCHMARK FINISHED: Downloaded ${filename} in ${totalElapsed}s`);
    console.log(`======================================================\n`);
  } else {
    console.log(`\n======================================================`);
    console.log(`>>> BENCHMARK FAILED or timed out after ${totalElapsed}s`);
    console.log(`======================================================\n`);
  }

  await browser.close();
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
