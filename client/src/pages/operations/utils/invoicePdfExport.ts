// Invoice PDF Export utilities
// Uses the canonical InvoiceDocument renderer, html2canvas, and pdf-lib
// to generate individual A4 PDFs or combined print PDFs without altering
// invoice data or numbering.

import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";
import { sanitizeFilenamePart } from "./estimatePdfExport";

const A4_W = 595.28;
const A4_H = 841.89;
const PRINT_MARGIN = 17.01; // ~6mm print margin matching InvoicePacket.tsx
const PRINTABLE_W = A4_W - PRINT_MARGIN * 2; // ~561.26 pt
const PRINTABLE_H = A4_H - PRINT_MARGIN * 2; // ~807.87 pt

/**
 * Format invoice PDF filename:
 * Inv_InvoiceNo_StoreName.pdf
 * Example: Inv_26-27_SM_165_Kharadi-R007.pdf
 */
export function getInvoicePdfFilename(inv: any, stores: any[] = []): string {
  const rawInvNo = String(inv?.invoiceNumber || `INV-${inv?.id || "draft"}`).trim();
  // Replace slashes with underscores for invoice numbers (e.g. 26-27/SM/165 -> 26-27_SM_165)
  const cleanInvNo = rawInvNo
    .replace(/[/]/g, "_")
    .replace(/[\\?%*:|"<>]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  let storeName = "";
  if (inv?.storeId) {
    const s = stores.find((st: any) => st.id === Number(inv.storeId) || String(st.id) === String(inv.storeId));
    storeName = s?.name || inv.storeName || inv.store_name || s?.storeCode || inv.storeCode || "";
  } else if (inv?.packetSettings?.storeName) {
    storeName = inv.packetSettings.storeName;
  } else if (inv?.storeName || inv?.store_name) {
    storeName = inv.storeName || inv.store_name;
  } else if (inv?.storeCode || inv?.store_code) {
    storeName = inv.storeCode || inv.store_code;
  }

  if (storeName) {
    const cleanStore = sanitizeFilenamePart(storeName);
    if (cleanStore) {
      return `Inv_${cleanInvNo}_${cleanStore}.pdf`;
    }
  }

  return `Inv_${cleanInvNo}.pdf`;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function waitForImages(element: HTMLElement, timeoutMs = 1500): Promise<void> {
  const imgs = Array.from(element.querySelectorAll("img"));
  if (imgs.length === 0) return;

  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const timer = setTimeout(resolve, timeoutMs);
          img.onload = () => {
            clearTimeout(timer);
            resolve();
          };
          img.onerror = () => {
            clearTimeout(timer);
            resolve();
          };
        })
    )
  );
}

/**
 * Renders an on-DOM InvoiceDocument element into A4 pages on a PDFDocument.
 * If pdfDoc is provided, appends pages to it. Otherwise creates a new PDFDocument.
 */
export async function renderInvoiceElementToPdf(
  docEl: HTMLElement,
  pdfDoc?: PDFDocument,
  docTitle = "Tax Invoice",
  targetFitPages?: number | null
): Promise<PDFDocument> {
  const pdf = pdfDoc || (await PDFDocument.create());

  await waitForImages(docEl);

  const canvas = await html2canvas(docEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    scrollX: 0,
    scrollY: 0,
  });

  const cW = canvas.width;
  const cH = canvas.height;
  const a4Aspect = PRINTABLE_H / PRINTABLE_W;
  const pageCanvasH = Math.round(cW * a4Aspect);
  const rawDrawH = PRINTABLE_W * (cH / cW);

  // Check if document fits comfortably on a single A4 page
  const fitsSinglePage = (targetFitPages === 1 && rawDrawH <= PRINTABLE_H * 1.35) || rawDrawH <= PRINTABLE_H * 1.05;

  if (fitsSinglePage) {
    const fitScale = Math.min(1, PRINTABLE_H / rawDrawH);
    const drawW = PRINTABLE_W * fitScale;
    const drawH = rawDrawH * fitScale;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const bytes = dataUrlToBytes(dataUrl);
    const img = await pdf.embedJpg(bytes);

    const page = pdf.addPage([A4_W, A4_H]);
    page.drawImage(img, {
      x: PRINT_MARGIN + (PRINTABLE_W - drawW) / 2,
      y: A4_H - PRINT_MARGIN - drawH,
      width: drawW,
      height: drawH,
    });
  } else {
    // Multi-page slicing at clean row boundaries
    const docRect = docEl.getBoundingClientRect();
    const rowEls = Array.from(
      docEl.querySelectorAll(
        "[data-pdf-row], .invoice-footer-block, [data-pdf-store-heading='true']"
      )
    );
    const scaleFactor = cH / (docRect.height || 1);
    const rowBottoms = rowEls
      .map((el) => {
        const r = el.getBoundingClientRect();
        return Math.round((r.bottom - docRect.top) * scaleFactor);
      })
      .filter((y) => y > 0 && y < cH)
      .sort((a, b) => a - b);

    // Capture the table column header row to repeat on continuation pages
    const colHeaderEl = docEl.querySelector("[data-pdf-col-header='true']");
    let colHeaderCanvas: HTMLCanvasElement | null = null;
    let colHeaderH = 0;
    if (colHeaderEl) {
      const chRect = colHeaderEl.getBoundingClientRect();
      const chTop = Math.round((chRect.top - docRect.top) * scaleFactor);
      colHeaderH = Math.round(chRect.height * scaleFactor);
      if (colHeaderH > 0 && chTop >= 0 && chTop + colHeaderH <= cH) {
        colHeaderCanvas = document.createElement("canvas");
        colHeaderCanvas.width = cW;
        colHeaderCanvas.height = colHeaderH;
        const chCtx = colHeaderCanvas.getContext("2d");
        if (chCtx) {
          chCtx.fillStyle = "#ffffff";
          chCtx.fillRect(0, 0, cW, colHeaderH);
          chCtx.drawImage(canvas, 0, chTop, cW, colHeaderH, 0, 0, cW, colHeaderH);
        }
      }
    }

    const slices: { startY: number; height: number; isContinuation: boolean }[] = [];
    let currentY = 0;

    while (currentY < cH) {
      const isContinuation = currentY > 0;
      const repeatH = isContinuation && colHeaderCanvas ? colHeaderH : 0;
      const availableContentH = pageCanvasH - repeatH;
      const remainingH = cH - currentY;

      if (remainingH <= availableContentH * 1.05) {
        slices.push({ startY: currentY, height: remainingH, isContinuation });
        break;
      }

      const targetSplitY = currentY + availableContentH;
      const candidate = rowBottoms
        .filter((b) => b > currentY + availableContentH * 0.55 && b <= targetSplitY)
        .pop();
      const splitY = candidate || targetSplitY;
      const sliceH = splitY - currentY;
      slices.push({ startY: currentY, height: sliceH, isContinuation });
      currentY = splitY;
    }

    for (const slice of slices) {
      const sliceRepeatH = slice.isContinuation && colHeaderCanvas ? colHeaderH : 0;
      const totalSliceH = slice.height + sliceRepeatH;

      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = cW;
      sliceCanvas.height = totalSliceH;
      const sCtx = sliceCanvas.getContext("2d");
      if (sCtx) {
        sCtx.fillStyle = "#ffffff";
        sCtx.fillRect(0, 0, cW, totalSliceH);

        if (sliceRepeatH > 0 && colHeaderCanvas) {
          sCtx.drawImage(colHeaderCanvas, 0, 0);
        }
        sCtx.drawImage(canvas, 0, slice.startY, cW, slice.height, 0, sliceRepeatH, cW, slice.height);
      }

      const dataUrl = sliceCanvas.toDataURL("image/jpeg", 0.95);
      const bytes = dataUrlToBytes(dataUrl);
      const img = await pdf.embedJpg(bytes);

      const drawW = PRINTABLE_W;
      const drawH = PRINTABLE_W * (totalSliceH / cW);
      const page = pdf.addPage([A4_W, A4_H]);
      page.drawImage(img, {
        x: PRINT_MARGIN,
        y: A4_H - PRINT_MARGIN - drawH,
        width: drawW,
        height: drawH,
      });
    }
  }

  if (!pdfDoc) {
    pdf.setTitle(docTitle);
    pdf.setSubject("Tax Invoice");
    pdf.setAuthor("Sunrise Media");
    pdf.setCreator("Sunrise Media ERP");
    pdf.setProducer("Sunrise Media ERP");
    pdf.setCreationDate(new Date());
  }

  return pdf;
}

/**
 * Packages a dictionary or array of filenames and Uint8Array bytes into a ZIP Blob.
 */
export function packageInvoicesIntoZip(
  files: Record<string, Uint8Array> | Array<{ filename: string; bytes: Uint8Array }>
): Blob {
  const fileMap: Record<string, Uint8Array> = {};
  if (Array.isArray(files)) {
    for (const item of files) {
      if (item && item.filename && item.bytes) {
        fileMap[item.filename] = item.bytes;
      }
    }
  } else if (files && typeof files === "object") {
    Object.assign(fileMap, files);
  }
  const zipBytes = zipSync(fileMap, { level: 6 });
  return new Blob([zipBytes], { type: "application/zip" });
}
