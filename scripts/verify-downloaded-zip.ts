import { chromium } from "playwright";
import * as fflate from "fflate";
import { PDFDocument } from "pdf-lib";
import * as assert from "assert";

async function verifyLiveZip() {
  console.log("Verifying live ZIP file contents from sunriseapp.bolt.host...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });

  await page.goto("https://sunriseapp.bolt.host", { waitUntil: "networkidle" });
  await page.fill('input[placeholder="admin"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  await page.waitForSelector('text="Estimate Register"', { timeout: 15000 });
  await page.click('text="Estimate Register"');
  await page.waitForTimeout(2000);

  // Select first 6
  await page.waitForSelector("tbody tr input[type='checkbox']", { timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    const boxes = await page.$$("tbody tr input[type='checkbox']");
    if (boxes[i]) await boxes[i].click();
  }

  const exportBtn = await page.waitForSelector('button:has-text("Print / Export PDFs")', { timeout: 5000 });
  await exportBtn.click();
  await page.waitForTimeout(500);

  const zipBtn = await page.waitForSelector('button:has-text("Export Individual PDFs (ZIP)")', { timeout: 5000 });
  const dlPromise = page.waitForEvent("download", { timeout: 60000 });
  await zipBtn.click();
  const dl = await dlPromise;

  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);
  console.log(`Downloaded ZIP size: ${(zipBuffer.length / 1024).toFixed(1)} KB`);

  const unzipped = fflate.unzipSync(new Uint8Array(zipBuffer));
  const filenames = Object.keys(unzipped);
  console.log(`Files inside ZIP (${filenames.length}):`);
  for (const fn of filenames) {
    console.log(` - ${fn} (${(unzipped[fn].length / 1024).toFixed(1)} KB)`);
    assert.strictEqual(fn.endsWith(".pdf"), true, "Must have .pdf extension");
    // Verify each PDF is valid with pdf-lib
    const pdfDoc = await PDFDocument.load(unzipped[fn]);
    assert.ok(pdfDoc.getPageCount() >= 1, `PDF ${fn} must have at least 1 page`);
    console.log(`   Valid PDF with ${pdfDoc.getPageCount()} page(s)`);
  }

  assert.strictEqual(filenames.length, 6, "Must contain exactly 6 PDFs");
  console.log("\n>>> ALL 6 ESTIMATE PDFS IN ZIP ARE VALID AND UNCORRUPTED!");

  await browser.close();
}

verifyLiveZip().catch((e) => {
  console.error(e);
  process.exit(1);
});
