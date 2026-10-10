/**
 * Canonical Estimate PDF Renderer
 * Uses the exact EstimateDocument React component, canonical print styles,
 * and Playwright Chromium to produce 100% visual parity with individual
 * Print / Save as PDF exports.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { chromium, type Browser } from "playwright";
import { db } from "../db.js";
import { estimates, estimateItems, stores, clients, products, brands, companies } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import EstimateDocument from "../../client/src/components/EstimateDocument";
import { getEstimatePdfFilename } from "../../client/src/pages/operations/utils/estimatePdfExport";

const CHROME_PATHS = [
  process.env.CHROME_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/local/bin/chromium",
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
].filter(Boolean) as string[];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chrome/Chromium found for PDF rendering.");
}

let browserInstance: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  if (browserPromise) {
    return browserPromise;
  }
  browserPromise = (async () => {
    const executablePath = findChrome();
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    browserInstance = browser;
    browserPromise = null;
    return browser;
  })();
  return browserPromise;
}

// In-memory cache of print stylesheet
let cachedCss: string | null = null;
function getPrintCss(): string {
  if (cachedCss) return cachedCss;
  const cssPath = path.join(process.cwd(), "client/src/index.css");
  if (fs.existsSync(cssPath)) {
    cachedCss = fs.readFileSync(cssPath, "utf8");
    return cachedCss;
  }
  return "";
}

export interface RenderEstimatePdfOptions {
  estimateId: number;
  scale?: number;
  density?: "normal" | "compact";
  layout?: "portrait" | "landscape";
}

export interface RenderEstimatePdfResult {
  buffer: Buffer;
  filename: string;
  estimateNumber: string;
  title: string;
}

export async function renderEstimatePdfBuffer(
  opts: RenderEstimatePdfOptions
): Promise<RenderEstimatePdfResult> {
  const { estimateId, scale = 100, density = "normal", layout = "portrait" } = opts;

  // 1. Fetch estimate and associated relational entities
  const [est] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);

  if (!est) {
    throw new Error(`Estimate with ID ${estimateId} not found`);
  }

  const [items, allStores, allClients, allProducts, allBrands] = await Promise.all([
    db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId)),
    db.select().from(stores),
    db.select().from(clients),
    db.select().from(products),
    db.select().from(brands),
  ]);

  const companyId = est.companyId || 1;
  const [comp] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const filename = getEstimatePdfFilename(est, allStores);

  // 2. Render static markup of the canonical EstimateDocument
  const docMarkup = renderToStaticMarkup(
    React.createElement(
      "div",
      { "data-print-document": "true" },
      React.createElement(EstimateDocument, {
        estimate: est as any,
        items: items as any,
        stores: allStores as any,
        clients: allClients as any,
        products: allProducts as any,
        brands: allBrands as any,
        sellerProfile: comp || {},
        assetToken: null,
      })
    )
  );

  const scaleRatio = (Number(scale) || 100) / 100;
  const indexCss = getPrintCss();
  const printTitle = `Estimate_${(est.estimateNumber || "").replace(/[\/\\:*?"<>|]+/g, "-")}`;

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <base href="http://localhost:5000/" />
  <title>${printTitle}</title>
  <style>
    ${indexCss}
    @page {
      size: A4 ${layout};
      margin: 8mm;
    }
    .estimate-print {
      --estimate-print-zoom: ${scaleRatio} !important;
      zoom: ${scaleRatio} !important;
    }
  </style>
</head>
<body class="estimate-print-layout-${layout} estimate-print-mode-${density}">
  ${docMarkup}
</body>
</html>`;

  // 3. Render PDF via Chromium
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Intercept image assets to serve directly from client/public/brand or uploads/
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("/brand/")) {
        const filePart = url.split("/brand/").pop()?.split("?")[0];
        const diskPath = path.join(process.cwd(), "client/public/brand", filePart || "");
        if (fs.existsSync(diskPath)) {
          return route.fulfill({
            status: 200,
            contentType: "image/png",
            body: fs.readFileSync(diskPath),
          });
        }
      }
      if (url.includes("/uploads/")) {
        const filePart = url.split("/uploads/").pop()?.split("?")[0];
        const diskPath = path.join(process.cwd(), "uploads", filePart || "");
        if (fs.existsSync(diskPath)) {
          return route.fulfill({
            status: 200,
            contentType: "image/png",
            body: fs.readFileSync(diskPath),
          });
        }
      }
      route.continue();
    });

    await page.setContent(fullHtml, { waitUntil: "networkidle", timeout: 15000 });

    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" },
      printBackground: true,
    });

    return {
      buffer: Buffer.from(pdfBuffer),
      filename,
      estimateNumber: est.estimateNumber,
      title: est.title || "",
    };
  } finally {
    await page.close();
  }
}
