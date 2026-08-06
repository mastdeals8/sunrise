// WCC / DC PDF export — captures the on-screen A4 canvas (.wcc-print-root)
// and produces a single-page (or multi-page) A4 PDF download using
// html2canvas + pdf-lib. No browser print dialog required.
//
// The canvas is already rendered at a fixed A4 aspect ratio by the editor,
// so we capture it at 2x scale for crispness and embed it into one or more
// A4 pages (210 x 297 mm). If the captured image is taller than one page
// (multi-store "Print All" mode), it is sliced across pages.

import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MM_PER_PX = 25.4 / 96; // CSS px → mm at 96 DPI

export async function exportWccCanvasToPdf(
  fileName: string,
  rootSelector = ".wcc-print-root",
): Promise<void> {
  const src = document.querySelector(rootSelector) as HTMLElement | null;
  if (!src) {
    alert("Nothing to export yet.");
    return;
  }

  // Render at 2x for crisp output.
  const canvas = await html2canvas(src, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgDataUrl = canvas.toDataURL("image/png");
  const imgBytes = await fetch(imgDataUrl).then((r) => r.arrayBuffer());

  const pdf = await PDFDocument.create();
  const pngImage = await pdf.embedPng(imgBytes);

  // A4 page size in points (1 mm = 2.834645669 pts).
  const MM_TO_PT = 2.834645669;
  const pageW = A4_WIDTH_MM * MM_TO_PT;
  const pageH = A4_HEIGHT_MM * MM_TO_PT;

  // Scale the captured image to fit the page width.
  const imgScale = pageW / pngImage.width;
  const scaledH = pngImage.height * imgScale;

  if (scaledH <= pageH) {
    // Single page — center vertically.
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(pngImage, {
      x: 0,
      y: pageH - scaledH,
      width: pageW,
      height: scaledH,
    });
  } else {
    // Multi-page: slice the source canvas vertically into A4-height chunks
    // and embed each chunk as its own page.
    const chunkHeightPx = Math.floor(pngImage.width * (pageH / pageW));
    let y = 0;
    while (y < pngImage.height) {
      const sliceH = Math.min(chunkHeightPx, pngImage.height - y);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = pngImage.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(
        canvas,
        0,
        y,
        pngImage.width,
        sliceH,
        0,
        0,
        pngImage.width,
        sliceH,
      );
      const sliceDataUrl = sliceCanvas.toDataURL("image/png");
      const sliceBytes = await fetch(sliceDataUrl).then((r) => r.arrayBuffer());
      const sliceImg = await pdf.embedPng(sliceBytes);
      const sliceScaledH = sliceImg.height * (pageW / sliceImg.width);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(sliceImg, {
        x: 0,
        y: pageH - sliceScaledH,
        width: pageW,
        height: sliceScaledH,
      });
      y += sliceH;
    }
  }

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Build a friendly file name for a WCC/DC, matching the existing
// printWccFileName convention: Challan_Store_Subject
export function wccExportFileName(parts: {
  storeName?: string;
  subject?: string;
  dcNumber?: string;
}): string {
  const storePart = parts.storeName
    ? String(parts.storeName).trim().split(/[ ,\-_/]+/)[0]
    : "";
  const subjectPart = parts.subject
    ? String(parts.subject).trim().split(/[ ,\-_/]+/)[0]
    : "";
  const segs = ["Challan", storePart, subjectPart].filter(Boolean);
  return segs.length > 1 ? segs.join("_") : parts.dcNumber || "Challan";
}

// Open WhatsApp Web / app with a pre-filled share message. The user
// attaches the just-downloaded PDF manually (browsers cannot attach
// files to WhatsApp directly). On mobile this opens the WhatsApp app
// via the wa.me intent URL.
export function shareWccOnWhatsApp(parts: {
  storeName?: string;
  subject?: string;
  dcNumber?: string;
  companyName?: string;
}): void {
  const lines = [
    `Hello,`,
    ``,
    `Please find the Work Completion Certificate (WCC) details below:`,
    ``,
    `Document: ${parts.dcNumber || "WCC"}`,
    parts.storeName ? `Store: ${parts.storeName}` : null,
    parts.subject ? `Project: ${parts.subject}` : null,
    parts.companyName ? `From: ${parts.companyName}` : null,
    ``,
    `The PDF is attached. Kindly acknowledge receipt.`,
  ].filter(Boolean);
  const text = encodeURIComponent(lines.join("\n"));
  // wa.me works on both desktop (WhatsApp Web) and mobile (app).
  window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
}
