import { chromium } from "playwright";

async function run() {
  console.log("Benchmarking multi-page large estimates on sunriseapp.bolt.host...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Generating") || text.includes("elapsed") || text.includes("Completed")) {
      console.log(`[Browser Console] ${text}`);
    }
  });

  await page.goto("https://sunriseapp.bolt.host", { waitUntil: "networkidle" });
  await page.fill('input[placeholder="admin"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  await page.waitForSelector('text="Estimate Register"', { timeout: 15000 });
  await page.click('text="Estimate Register"');
  await page.waitForTimeout(2000);

  // Navigate to page 2
  console.log("Navigating to page 2...");
  const page2Btn = await page.$('button:has-text("2")');
  if (page2Btn) {
    await page2Btn.click();
    await page.waitForTimeout(1500);
  }

  // Target large estimates on page 2: 202, 213, 226, 210, 203, 216
  const targetEstNumbers = [
    "SM/E/26-27/202",
    "SM/E/26-27/213",
    "SM/E/26-27/226",
    "SM/E/26-27/210",
    "SM/E/26-27/203",
    "SM/E/26-27/216"
  ];

  console.log("Looking for target estimates on page 2:", targetEstNumbers);
  let checkedCount = 0;
  for (const estNum of targetEstNumbers) {
    const row = await page.$(`tr:has-text("${estNum}")`);
    if (row) {
      const checkbox = await row.$('input[type="checkbox"]');
      if (checkbox) {
        await checkbox.click();
        checkedCount++;
        console.log(`Checked ${estNum} (${checkedCount} selected)`);
        await page.waitForTimeout(150);
      }
    } else {
      console.log(`Row for ${estNum} not found`);
    }
  }

  if (checkedCount === 0) {
    throw new Error("No target estimates found on page 2");
  }

  console.log(`Selected ${checkedCount} large estimates. Opening Bulk Export modal...`);
  const exportBtn = await page.waitForSelector('button:has-text("Print / Export PDFs")', { timeout: 5000 });
  await exportBtn.click();
  await page.waitForTimeout(1000);

  console.log("Clicking Export Individual PDFs (ZIP)...");
  const zipBtn = await page.waitForSelector('button:has-text("Export Individual PDFs (ZIP)")', { timeout: 5000 });
  const exportStartTime = performance.now();

  const downloadPromise = page.waitForEvent("download", { timeout: 600000 }).catch((e) => {
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
            t.includes("Packaging")
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
