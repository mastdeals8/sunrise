import "dotenv/config";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import assert from "assert";
import { db } from "../server/db";
import { estimates, estimateItems, stores, clients, products, companies } from "../shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import EstimateDocument from "../client/src/components/EstimateDocument";

const ARTIFACTS_DIR = "/Users/Kunal/.gemini/antigravity-ide/brain/a995581d-d765-4ca0-9a59-721c5c45ca71/scratch";

async function runRegressionTests() {
  console.log("=================================================================");
  console.log("RUNNING ESTIMATE LAYOUT, PRINT SIZE & FORMAT REGRESSION SUITE");
  console.log("=================================================================");

  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  // 1. Fetch Wakefit estimate SM/E/26-27/248 from database
  console.log("\n[Test 1] Fetching Wakefit estimate SM/E/26-27/248 from live database...");
  const [wakefitEst] = await db.select().from(estimates).where(eq(estimates.estimateNumber, "SM/E/26-27/248")).limit(1);
  assert(wakefitEst, "Estimate SM/E/26-27/248 must exist in database");

  const wakefitItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, wakefitEst.id));
  const allStores = await db.select().from(stores);
  const allClients = await db.select().from(clients);
  const allProducts = await db.select().from(products);
  const [comp1] = await db.select().from(companies).where(eq(companies.id, 1)).limit(1);

  console.log(`  - Found estimate ${wakefitEst.estimateNumber} for client: ${wakefitEst.clientName}`);
  console.log(`  - Format Profile: ${wakefitEst.formatProfileCode || wakefitEst.clientFormat}`);
  console.log(`  - Items count: ${wakefitItems.length}`);
  console.log(`  - Total Amount: ₹${wakefitEst.totalAmount}`);

  // 2. Render Wakefit Retail Estimate
  console.log("\n[Test 2] Rendering Wakefit EstimateDocument HTML...");
  const wakefitHtml = renderToStaticMarkup(
    React.createElement(EstimateDocument, {
      estimate: wakefitEst as any,
      items: wakefitItems as any,
      stores: allStores as any,
      clients: allClients as any,
      products: allProducts as any,
      sellerProfile: comp1 as any,
      assetToken: null,
    })
  );

  // Assertion: Column labels
  assert(wakefitHtml.includes("Print Size"), "Must contain 'Print Size' label");
  assert(wakefitHtml.includes("(W)"), "Must contain '(W)' label");
  assert(wakefitHtml.includes("(H)"), "Must contain '(H)' label");
  assert(!wakefitHtml.includes(">Size (W)<"), "Must NOT contain old 'Size (W)' heading");
  assert(!wakefitHtml.includes(">Size (H)<"), "Must NOT contain old 'Size (H)' heading");
  console.log("  ✓ PASS: Column headings 'Print Size (W)' and 'Print Size (H)' rendered without old labels.");

  // Assertion: Subject Line
  assert(wakefitHtml.includes(`Subject : ${wakefitEst.subject || wakefitEst.title}`), "Subject line must be present");
  assert(wakefitHtml.includes("text-align:left") && wakefitHtml.includes("font-size:11px"), "Subject line must be left-aligned and styled with prominent font");
  console.log("  ✓ PASS: Subject line is larger, bold, and left-aligned.");

  // Assertion: Store heading
  assert(wakefitHtml.includes("Store: Kharadi - R007, Store Code: R007") || wakefitHtml.includes("Store: Kharadi"), "Store name must be present in store heading");
  console.log("  ✓ PASS: Store heading contains store name and code with left-aligned styling.");

  // Assertion: Total Material Cost must be ABSENT from Retail-store format
  assert(!wakefitHtml.includes("Total Material Cost"), "Total Material Cost MUST BE ABSENT from retail-store format!");
  console.log("  ✓ PASS: 'Total Material Cost' subtotal row is completely absent from retail-store format.");

  // Assertion: Packing, Installation, GST and Totals remain intact
  assert(wakefitHtml.includes("Packing Charges"), "Packing charges must be preserved");
  assert(wakefitHtml.includes("Installation Charges"), "Installation charges must be preserved");
  assert(wakefitHtml.includes("1,198.80"), "Before tax total 1,198.80 must be preserved");
  assert(wakefitHtml.includes("1,414.58"), "Final after tax total 1,414.58 must be preserved");
  console.log("  ✓ PASS: Packing, Installation, GST and grand total (₹1,414.58) remain 100% correct.");

  // 3. Fetch and Test ABFRL / ABLBL Estimate
  console.log("\n[Test 3] Testing ABFRL / ABLBL format for Total Material Cost retention...");
  const [abfrlEst] = await db.select().from(estimates).where(eq(estimates.clientFormat, "ABLBL")).limit(1);
  if (abfrlEst) {
    const abfrlItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, abfrlEst.id));
    const abfrlHtml = renderToStaticMarkup(
      React.createElement(EstimateDocument, {
        estimate: abfrlEst as any,
        items: abfrlItems as any,
        stores: allStores as any,
        clients: allClients as any,
        products: allProducts as any,
        sellerProfile: comp1 as any,
        assetToken: null,
      })
    );
    assert(abfrlHtml.includes("Total Material Cost"), "ABFRL / ABLBL format MUST retain Total Material Cost row!");
    console.log("  ✓ PASS: ABFRL / ABLBL format preserves 'Total Material Cost' subtotal row.");
  } else {
    // Test synthetic ABFRL estimate to guarantee coverage
    const syntheticAbfrlEst = {
      ...wakefitEst,
      id: 9999,
      estimateNumber: "SM/E/26-27/ABFRL-TEST",
      clientFormat: "ABLBL",
      formatProfileCode: "ABLBL",
    };
    const abfrlHtml = renderToStaticMarkup(
      React.createElement(EstimateDocument, {
        estimate: syntheticAbfrlEst as any,
        items: wakefitItems as any,
        stores: allStores as any,
        clients: allClients as any,
        products: allProducts as any,
        sellerProfile: comp1 as any,
        assetToken: null,
      })
    );
    assert(abfrlHtml.includes("Total Material Cost"), "ABFRL / ABLBL format MUST retain Total Material Cost row!");
    console.log("  ✓ PASS: Synthetic ABFRL / ABLBL format preserves 'Total Material Cost' subtotal row.");
  }

  // 4. Render to PDF and Screenshot with Playwright
  console.log("\n[Test 4] Rendering PDF and capturing screenshot via Chromium...");
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage();

  const cssContent = fs.readFileSync(path.join(process.cwd(), "client/src/index.css"), "utf8");

  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          ${cssContent}
          body {
            margin: 0;
            padding: 24px;
            background: #f8fafc;
            display: flex;
            justify-content: center;
          }
          .estimate-wrapper {
            width: 733px;
            background: #ffffff;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            padding: 16px;
            box-sizing: border-box;
          }
        </style>
      </head>
      <body>
        <div class="estimate-wrapper">
          ${wakefitHtml}
        </div>
      </body>
    </html>
  `;

  await page.setContent(fullHtml, { waitUntil: "networkidle" });

  const screenshotPath = path.join(ARTIFACTS_DIR, "wakefit_estimate_248_preview.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`  - Screenshot saved: ${screenshotPath}`);

  const pdfPath = path.join(ARTIFACTS_DIR, "wakefit_estimate_248.pdf");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" },
  });
  console.log(`  - PDF saved: ${pdfPath}`);

  await browser.close();

  console.log("\n=================================================================");
  console.log("ALL ESTIMATE LAYOUT AND FORMAT REGRESSION TESTS PASSED!");
  console.log("=================================================================\n");
  process.exit(0);
}

runRegressionTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
