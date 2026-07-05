import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

const sanitizeFilenamePart = (value: string) =>
  value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Unnamed";

export async function exportWccPagesToZip(pages: HTMLElement[]) {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (let i = 0; i < pages.length; i++) {
    const el = pages[i];
    const dcNumber = sanitizeFilenamePart(el.dataset.dcNumber || `WCC-${i + 1}`);
    const storeName = sanitizeFilenamePart(el.dataset.storeName || "Unknown Store");
    const base = `${dcNumber} - ${storeName}`;
    let filename = `${base}.pdf`;
    let duplicateCount = 1;

    while (usedNames.has(filename)) {
      filename = `${base} (${++duplicateCount}).pdf`;
    }
    usedNames.add(filename);

    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "JPEG", 0, 0, 210, 297);
    zip.file(filename, pdf.output("blob"));
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `WCCs-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
