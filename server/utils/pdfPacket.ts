/**
 * Server-side Invoice Packet PDF builder.
 *
 * Assembly order:
 *   1. Tax Invoice  — playwright renders the existing EstimateDocument/InvoiceFrontPage
 *   2. PO PDF       — all pages copied exactly via pdf-lib copyPages()
 *   3. Estimate     — playwright renders the existing EstimateDocument
 *   4. Per DC (non-deleted), in creation order:
 *      a. Transport receipt  — image → A4 page  |  PDF → copyPages
 *      b. Signed WCC/challan — image → A4 page  |  PDF → copyPages
 *      c. Installation photo — image → A4 page
 *
 * All uploaded PDFs and images are read directly from disk.
 * No iframes, no object/embed, no browser rendering of attachments.
 */

import { chromium } from "playwright-core";
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { JWT_SECRET, UPLOAD_DIR } from "../config.js";
import { storage } from "../storage.js";

// ---------------------------------------------------------------------------
// Chrome detection
// CHROME_EXECUTABLE env var overrides all auto-detection paths.
// Mac: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
// Linux (Railway/Render/Fly): /usr/bin/google-chrome or install via:
//   apt-get install -y chromium-browser   OR
//   npx playwright install chromium
// ---------------------------------------------------------------------------

const CHROME_PATHS = [
  // env var override — highest priority
  process.env.CHROME_EXECUTABLE,
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Linux (Railway, Render, Fly.io)
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/local/bin/chromium",
  // Playwright's own installed Chromium (if `npx playwright install chromium` was run)
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
].filter(Boolean) as string[];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "No Chrome/Chromium found for PDF rendering.\n" +
    "  Mac: Install Google Chrome at /Applications/Google Chrome.app\n" +
    "  Linux: apt-get install -y chromium-browser  OR  npx playwright install chromium\n" +
    "  Any platform: set CHROME_EXECUTABLE=/path/to/chrome in .env"
  );
}

// ---------------------------------------------------------------------------
// Short-lived JWT for playwright auth
// ---------------------------------------------------------------------------

function issueRenderToken(userId: number, username: string, role: string): string {
  return jwt.sign({ id: userId, username, role }, JWT_SECRET as string, { expiresIn: "5m" });
}

// ---------------------------------------------------------------------------
// Playwright: render one page type to PDF bytes
// type: "invoice" | "estimate"
// ---------------------------------------------------------------------------

async function renderPageToPdf(
  invoiceId: number,
  pageType: "invoice" | "estimate",
  userId: number,
  username: string,
  role: string,
  port: number
): Promise<Buffer> {
  const token = issueRenderToken(userId, username, role);
  // PUBLIC_BASE_URL lets production environments override the self-render URL.
  // playwright connects to the same process (localhost), which works on all
  // platforms — Railway/Render/Fly all route localhost to the same container.
  const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
  const executablePath = findChrome();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Seed auth token so the React AuthContext picks it up
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.evaluate((t) => localStorage.setItem("sunrise_token", t), token);

    // Navigate to the packet page in the specific render mode
    await page.goto(`${baseUrl}/invoice-packet?id=${invoiceId}&pdfMode=${pageType}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Wait for the component to signal render completion
    await page.waitForSelector("[data-pdf-ready='true']", { timeout: 25000 });

    const pdfBytes = await page.pdf({
      format: "A4",
      // Enough margin so the bottom letterhead / signature section is not clipped
      margin: { top: "10mm", bottom: "14mm", left: "10mm", right: "10mm" },
      printBackground: true,
    });

    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// pdf-lib helpers
// ---------------------------------------------------------------------------

// Resolve a stored URL path (/uploads/foo.PDF) to the absolute disk path.
function resolveUploadPath(filePath: string): string {
  const filename = path.basename(filePath);
  return path.join(UPLOAD_DIR, filename);
}

// Append all pages of an uploaded PDF file into the merged document.
// Returns the number of pages appended, or 0 if the file is missing/invalid.
async function appendPdfFile(
  merged: PDFDocument,
  filePath: string,
  label: string,
  pageLog: string[]
): Promise<number> {
  const diskPath = resolveUploadPath(filePath);
  if (!fs.existsSync(diskPath)) {
    console.warn(`[pdfPacket] MISSING FILE — ${label}: ${diskPath}`);
    pageLog.push(`  ⚠ SKIPPED (file not found): ${label}`);
    return 0;
  }
  try {
    const bytes = fs.readFileSync(diskPath);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const count = doc.getPageCount();
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
    pageLog.push(`  ✓ ${label} — ${count} page${count !== 1 ? "s" : ""} (PDF, copyPages)`);
    return count;
  } catch (err) {
    console.error(`[pdfPacket] Failed to embed PDF ${diskPath}:`, err);
    pageLog.push(`  ⚠ SKIPPED (PDF load error): ${label}`);
    return 0;
  }
}

// Append an image file as a single centred A4 page in the merged document.
// Returns 1 on success, 0 if the file is missing/invalid.
async function appendImageFile(
  merged: PDFDocument,
  filePath: string,
  label: string,
  pageLog: string[]
): Promise<number> {
  const diskPath = resolveUploadPath(filePath);
  if (!fs.existsSync(diskPath)) {
    console.warn(`[pdfPacket] MISSING FILE — ${label}: ${diskPath}`);
    pageLog.push(`  ⚠ SKIPPED (file not found): ${label}`);
    return 0;
  }
  try {
    const imgBytes = fs.readFileSync(diskPath);
    const lower = diskPath.toLowerCase();
    const img = lower.endsWith(".png")
      ? await merged.embedPng(imgBytes)
      : await merged.embedJpg(imgBytes);

    // A4 at 72 dpi = 595.28 × 841.89 pt
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 36; // 0.5 inch
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = PAGE_H - MARGIN * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;

    const page = merged.addPage([PAGE_W, PAGE_H]);
    page.drawImage(img, {
      x: (PAGE_W - drawW) / 2,
      y: (PAGE_H - drawH) / 2,
      width: drawW,
      height: drawH,
    });

    pageLog.push(`  ✓ ${label} — 1 page (image, fitted A4)`);
    return 1;
  } catch (err) {
    console.error(`[pdfPacket] Failed to embed image ${diskPath}:`, err);
    pageLog.push(`  ⚠ SKIPPED (image load error): ${label}`);
    return 0;
  }
}

// Dispatch a file attachment to the correct handler based on extension.
async function appendAttachment(
  merged: PDFDocument,
  filePath: string,
  label: string,
  pageLog: string[]
): Promise<number> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return appendPdfFile(merged, filePath, label, pageLog);
  }
  if (/\.(png|jpe?g|jpg|gif|webp)$/.test(lower)) {
    return appendImageFile(merged, filePath, label, pageLog);
  }
  // Unknown type — skip
  pageLog.push(`  ⚠ SKIPPED (unsupported type): ${label} (${filePath})`);
  return 0;
}

// Copy pages from a playwright-rendered PDF buffer into the merged document.
async function appendRenderedPdf(
  merged: PDFDocument,
  pdfBuffer: Buffer,
  label: string,
  pageLog: string[]
): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  const count = doc.getPageCount();
  const copied = await merged.copyPages(doc, doc.getPageIndices());
  copied.forEach((p) => merged.addPage(p));
  pageLog.push(`  ✓ ${label} — ${count} page${count !== 1 ? "s" : ""} (browser-rendered)`);
  return count;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface PacketBuildResult {
  buffer: Buffer;
  pageLog: string[];
  totalPages: number;
}

/**
 * Build the complete invoice packet PDF server-side.
 *
 * Page order:
 *   1. Tax Invoice (browser-rendered)
 *   2. Purchase Order PDF (pdf-lib copyPages, ALL original pages)
 *   3. Estimate (browser-rendered)
 *   4. Per non-deleted DC:
 *      a. Transport receipt
 *      b. Signed WCC / Signed challan
 *      c. Installation photo
 *      d. Extra doc (if any)
 */
export async function buildInvoicePacketPdf(params: {
  invoiceId: number;
  userId: number;
  username: string;
  role: string;
  port: number;
}): Promise<PacketBuildResult> {
  const { invoiceId, userId, username, role, port } = params;

  // ------------------------------------------------------------------
  // 1. Load invoice, estimate, DCs from DB
  // ------------------------------------------------------------------
  const allInvoices = await storage.getAllInvoices();
  const invoice = (allInvoices as any[]).find((i) => i.id === invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  let estimate: any = null;
  let challans: any[] = [];

  if (invoice.estimateId) {
    estimate = await storage.getEstimate(invoice.estimateId);
    if (estimate) {
      const allDc = await storage.getAllDeliveryChallans();
      challans = (allDc as any[]).filter(
        (d) =>
          d.estimateId === estimate.id &&
          d.status !== "deleted" &&
          !(d.metadata as any)?.deleted
      );
    }
  }

  const merged = await PDFDocument.create();
  const pageLog: string[] = [];
  let totalPages = 0;

  pageLog.push("=== Invoice Packet PDF — page sequence ===");

  // ------------------------------------------------------------------
  // 2. Tax Invoice (browser-rendered via playwright)
  // ------------------------------------------------------------------
  pageLog.push("\n[Section 1] Tax Invoice");
  try {
    const invBuffer = await renderPageToPdf(invoiceId, "invoice", userId, username, role, port);
    totalPages += await appendRenderedPdf(merged, invBuffer, "Tax Invoice", pageLog);
  } catch (err: any) {
    console.error("[pdfPacket] Failed to render Tax Invoice:", err.message);
    pageLog.push(`  ⚠ FAILED to render Tax Invoice: ${err.message}`);
  }

  // ------------------------------------------------------------------
  // 3. Purchase Order PDF (pdf-lib copyPages — all original pages)
  // ------------------------------------------------------------------
  if (estimate?.poFilePath) {
    pageLog.push("\n[Section 2] Purchase Order");
    totalPages += await appendPdfFile(merged, estimate.poFilePath, `PO (${estimate.poNumber || "PO"})`, pageLog);
  } else {
    pageLog.push("\n[Section 2] Purchase Order — no PO attached, skipped");
  }

  // ------------------------------------------------------------------
  // 4. Estimate (browser-rendered via playwright)
  // ------------------------------------------------------------------
  if (estimate) {
    pageLog.push("\n[Section 3] Estimate");
    try {
      const estBuffer = await renderPageToPdf(invoiceId, "estimate", userId, username, role, port);
      totalPages += await appendRenderedPdf(merged, estBuffer, `Estimate ${estimate.estimateNumber}`, pageLog);
    } catch (err: any) {
      console.error("[pdfPacket] Failed to render Estimate:", err.message);
      pageLog.push(`  ⚠ FAILED to render Estimate: ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // 5. Per DC (non-deleted): transport → signed → photos → extra
  // ------------------------------------------------------------------
  if (challans.length > 0) {
    pageLog.push(`\n[Section 4] DC / WCC Attachments (${challans.length} non-deleted)`);
    for (const dc of challans) {
      const dcRef = dc.dcNumber || dc.id;
      pageLog.push(`\n  DC: ${dcRef}`);

      if (dc.transportReceiptPath) {
        totalPages += await appendAttachment(
          merged,
          dc.transportReceiptPath,
          `Transport Receipt (${dcRef})`,
          pageLog
        );
      }

      if (dc.signedChallanPath) {
        totalPages += await appendAttachment(
          merged,
          dc.signedChallanPath,
          `Signed WCC/Challan (${dcRef})`,
          pageLog
        );
      }

      if (dc.photoPath) {
        totalPages += await appendAttachment(
          merged,
          dc.photoPath,
          `Installation Photo (${dcRef})`,
          pageLog
        );
      }

      if (dc.extraDocPath) {
        totalPages += await appendAttachment(
          merged,
          dc.extraDocPath,
          `Extra Doc (${dcRef})`,
          pageLog
        );
      }
    }
  } else {
    pageLog.push("\n[Section 4] No non-deleted DCs attached");
  }

  pageLog.push(`\n=== Total pages in final PDF: ${totalPages} ===`);
  console.log(pageLog.join("\n"));

  return {
    buffer: Buffer.from(await merged.save()),
    pageLog,
    totalPages,
  };
}
