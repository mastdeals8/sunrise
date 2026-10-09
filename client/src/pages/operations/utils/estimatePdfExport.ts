// Estimate PDF Export utilities
// Uses the canonical EstimateDocument renderer, html2canvas, and pdf-lib
// to generate individual A4 PDFs or combined print PDFs without altering
// estimate data or numbering.

import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";

const A4_W = 595.28;
const A4_H = 841.89;
const PRINT_MARGIN = 14.17; // ~5mm margin
const PRINTABLE_W = A4_W - PRINT_MARGIN * 2;
const PRINTABLE_H = A4_H - PRINT_MARGIN * 2;

/**
 * Sanitize strings for cross-platform filesystem compatibility.
 * Replaces spaces and special characters with underscores, collapsing repeats.
 */
export function sanitizeFilename(str: string): string {
  return String(str || "")
    .trim()
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build canonical estimate PDF filename:
 * - Single store: EstimateNo_StoreName.pdf
 * - Multi store: EstimateNo_Multi-Store.pdf
 */
export function getEstimatePdfFilename(est: any, stores: any[] = []): string {
  const estNumberSanitized = sanitizeFilename(est?.estimateNumber || `Estimate-${est?.id || "draft"}`);

  // Check if estimate has multiple stores in storeGrouping or is marked multi-store format
  const groupKeys = est?.storeGrouping && typeof est.storeGrouping === "object"
    ? Object.keys(est.storeGrouping).filter(k => k && k !== "undefined" && k !== "null")
    : [];

  const isMultiStoreFormat = est?.formatProfileCode === "ABFRL_MULTI_STORE" ||
    (typeof est?.formatProfileCode === "string" && est.formatProfileCode.includes("MULTI"));

  if (groupKeys.length > 1 || (isMultiStoreFormat && !est?.storeId && groupKeys.length === 0)) {
    return `${estNumberSanitized}_Multi-Store.pdf`;
  }

  let storeName = "";
  if (groupKeys.length === 1) {
    const sid = groupKeys[0];
    const s = stores.find((st: any) => String(st.id) === sid || String(st.storeCode) === sid);
    storeName = s?.name || est.storeGrouping[sid]?.storeName || s?.storeCode || "";
  } else if (est?.storeId) {
    const s = stores.find((st: any) => st.id === est.storeId || String(st.id) === String(est.storeId));
    storeName = s?.name || est?.storeName || est?.store_name || s?.storeCode || est?.storeCode || est?.store_code || "";
  } else if (est?.storeName || est?.store_name) {
    storeName = est?.storeName || est?.store_name;
  } else if (est?.storeCode || est?.store_code) {
    storeName = est?.storeCode || est?.store_code;
  }

  if (storeName) {
    const sanitizedStore = sanitizeFilename(storeName);
    if (sanitizedStore) {
      return `${estNumberSanitized}_${sanitizedStore}.pdf`;
    }
  }

  return `${estNumberSanitized}.pdf`;
}

/**
 * Convert a base64 data URL to Uint8Array.
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Wait for all images inside an element to finish loading.
 */
export async function waitForImages(element: HTMLElement, timeoutMs = 1200): Promise<void> {
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
 * Renders an on-DOM EstimateDocument element into A4 pages on a PDFDocument.
 * If pdfDoc is provided, appends pages to it. Otherwise creates a new PDFDocument.
 */
export async function renderEstimateElementToPdf(
  docEl: HTMLElement,
  pdfDoc?: PDFDocument,
  docTitle = "Estimate"
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
  const fitsSinglePage = rawDrawH <= PRINTABLE_H * 1.05;

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
        "[data-pdf-row], .invoice-footer-block, .estimate-footer-block, .estimate-store-section"
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

  // Set document metadata if this is a fresh document
  if (!pdfDoc) {
    pdf.setTitle(docTitle);
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
export function packagePdfsIntoZip(
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

/**
 * Trigger browser file download for a Blob.
 */
export function downloadFileBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
