import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Loader2,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileText,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Estimate, Store, Client, Product, Brand } from "../types";
import EstimateDocument from "../../../components/EstimateDocument";
import { fetchEstimateItems } from "../../../lib/api";
import {
  getEstimatePdfFilename,
  fetchEstimateCanonicalPdf,
  packagePdfsIntoZip,
  downloadFileBlob,
} from "../utils/estimatePdfExport";
import { PDFDocument } from "pdf-lib";

interface BulkEstimatePdfRunnerProps {
  mode: "preview" | "zip" | "combined" | null;
  onClose: () => void;
  selectedEstimates: Estimate[];
  stores: Store[];
  clients: Client[];
  products?: Product[];
  brands?: Brand[];
  sellerProfile?: any;
  token: string | null;
  showSuccess?: (msg: string) => void;
}

export const BulkEstimatePdfRunner: React.FC<BulkEstimatePdfRunnerProps> = ({
  mode,
  onClose,
  selectedEstimates,
  stores,
  clients,
  products = [],
  brands = [],
  sellerProfile = {},
  token,
  showSuccess,
}) => {
  // Page Setup Controls (consistent with EstimatePreview)
  const [scale, setScale] = useState<number>(100);
  const [targetFitPages, setTargetFitPages] = useState<number | null>(null);
  const [density, setDensity] = useState<"normal" | "compact">("normal");

  // Preview navigation
  const [previewIdx, setPreviewIdx] = useState<number>(0);
  const [previewItems, setPreviewItems] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  // Bulk Generation Execution State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMode, setProcessMode] = useState<"zip" | "combined" | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [failures, setFailures] = useState<Array<{ estimate: Estimate; error: string }>>([]);
  const [isDone, setIsDone] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [combinedPdfBlobUrl, setCombinedPdfBlobUrl] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  // If opened directly with zip or combined mode from toolbar, trigger that mode
  useEffect(() => {
    if (mode === "zip" || mode === "combined") {
      setProcessMode(mode);
    }
  }, [mode]);

  // Load items for the currently previewed estimate
  useEffect(() => {
    if (!mode || selectedEstimates.length === 0) return;
    const currentEst = selectedEstimates[previewIdx] || selectedEstimates[0];
    if (!currentEst) return;

    let cancelled = false;
    setPreviewLoading(true);

    fetchEstimateItems(token, currentEst.id)
      .then((items) => {
        if (!cancelled) {
          setPreviewItems(items);
          setPreviewLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load estimate items for preview:", err);
        if (!cancelled) {
          setPreviewItems([]);
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewIdx, selectedEstimates, token, mode]);

  // Execute bulk export using the canonical individual PDF renderer
  const handleStartBulkExport = async (exportMode: "zip" | "combined") => {
    if (selectedEstimates.length === 0) return;

    cancelledRef.current = false;
    setIsProcessing(true);
    setProcessMode(exportMode);
    setIsDone(false);
    setFailures([]);
    setSuccessCount(0);
    setCombinedPdfBlobUrl(null);
    setCurrentIndex(0);

    const total = selectedEstimates.length;
    const failedList: Array<{ estimate: Estimate; error: string }> = [];
    const zipFiles: Record<string, Uint8Array> = {};
    let combinedPdfDoc: PDFDocument | null = null;

    if (exportMode === "combined") {
      combinedPdfDoc = await PDFDocument.create();
      combinedPdfDoc.setTitle("Combined Estimates");
      combinedPdfDoc.setAuthor("Sunrise Media");
      combinedPdfDoc.setCreator("Sunrise Media ERP");
      combinedPdfDoc.setProducer("Sunrise Media ERP");
      combinedPdfDoc.setCreationDate(new Date());
    }

    for (let i = 0; i < total; i++) {
      if (cancelledRef.current) break;

      const est = selectedEstimates[i];
      setCurrentIndex(i + 1);
      setStatusText(
        `Rendering estimate ${est.estimateNumber || `Estimate #${est.id}`} (${i + 1} of ${total})...`
      );

      try {
        const pdfBytes = await fetchEstimateCanonicalPdf(token, est.id, {
          scale,
          density,
          layout: "portrait",
        });

        if (cancelledRef.current) break;

        if (exportMode === "zip") {
          const filename = getEstimatePdfFilename(est, stores);

          // Handle collision safely if duplicates exist
          let uniqueFilename = filename;
          let counter = 2;
          while (zipFiles[uniqueFilename]) {
            uniqueFilename = filename.replace(/\.pdf$/i, `_${counter}.pdf`);
            counter++;
          }

          zipFiles[uniqueFilename] = pdfBytes;
        } else if (exportMode === "combined" && combinedPdfDoc) {
          const singleDoc = await PDFDocument.load(pdfBytes);
          const copiedPages = await combinedPdfDoc.copyPages(
            singleDoc,
            singleDoc.getPageIndices()
          );
          copiedPages.forEach((p) => combinedPdfDoc!.addPage(p));
        }
      } catch (renderErr: any) {
        console.error(`Failed to export estimate ${est.estimateNumber}:`, renderErr);
        failedList.push({
          estimate: est,
          error: renderErr.message || "Canonical PDF generation failed",
        });
      }
    }

    if (cancelledRef.current) {
      setIsProcessing(false);
      return;
    }

    setFailures(failedList);
    const completedCount = total - failedList.length;
    setSuccessCount(completedCount);
    setIsDone(true);
    setIsProcessing(false);

    if (exportMode === "zip") {
      if (Object.keys(zipFiles).length > 0) {
        setStatusText("Packaging PDFs into ZIP archive...");
        try {
          const zipBlob = packagePdfsIntoZip(zipFiles);
          downloadFileBlob(
            zipBlob,
            `Estimates_Export_${new Date().toISOString().slice(0, 10)}.zip`
          );
          if (showSuccess) {
            showSuccess(
              `Successfully exported ${Object.keys(zipFiles).length} estimate PDF(s).`
            );
          }
        } catch (zipErr: any) {
          console.error("ZIP creation failed:", zipErr);
          alert("Failed to create ZIP package: " + zipErr.message);
        }
      }
    } else if (exportMode === "combined" && combinedPdfDoc) {
      if (completedCount > 0) {
        try {
          const combinedBytes = await combinedPdfDoc.save();
          const blob = new Blob([combinedBytes], { type: "application/pdf" });
          const blobUrl = URL.createObjectURL(blob);
          setCombinedPdfBlobUrl(blobUrl);

          // Auto-open print preview via iframe
          const printIframe = document.createElement("iframe");
          printIframe.style.position = "fixed";
          printIframe.style.right = "0";
          printIframe.style.bottom = "0";
          printIframe.style.width = "0";
          printIframe.style.height = "0";
          printIframe.style.border = "0";
          printIframe.src = blobUrl;
          document.body.appendChild(printIframe);
          printIframe.onload = () => {
            setTimeout(() => {
              try {
                printIframe.contentWindow?.focus();
                printIframe.contentWindow?.print();
              } catch (e) {
                console.warn("Auto-print preview on iframe failed:", e);
              }
            }, 300);
          };
        } catch (combErr: any) {
          console.error("Combined PDF failed:", combErr);
          alert("Failed to build combined PDF: " + combErr.message);
        }
      }
    }
  };

  const handlePrintCurrent = () => {
    const cur = selectedEstimates[previewIdx];
    if (!cur) return;
    const oldTitle = document.title;
    const filename = getEstimatePdfFilename(cur, stores).replace(/\.pdf$/i, "");
    document.title = filename;

    // Apply canonical print classes matching EstimatePreview
    const scaleRatio = (Number(scale) || 100) / 100;
    let style = document.getElementById("estimate-print-options-style") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "estimate-print-options-style";
      document.head.appendChild(style);
    }
    style.textContent = `
      @media print {
        @page { size: A4 portrait; margin: 8mm; }
        .estimate-print {
          --estimate-print-zoom: ${scaleRatio} !important;
          zoom: ${scaleRatio} !important;
        }
      }
    `;
    document.body.classList.add("estimate-print-layout-portrait", `estimate-print-mode-${density}`);

    window.print();
    window.setTimeout(() => {
      document.title = oldTitle;
      document.body.classList.remove("estimate-print-layout-portrait", `estimate-print-mode-${density}`);
      document.getElementById("estimate-print-options-style")?.remove();
    }, 1000);
  };

  const handleFitToPages = (targetPages: number) => {
    setTargetFitPages(targetPages);
    const totalItems = previewItems.length || 20;
    const idealScale = Math.min(
      100,
      Math.max(50, Math.round(((targetPages * 22) / totalItems) * 100))
    );
    setScale(idealScale);
  };

  if (!mode) return null;

  const currentEst = selectedEstimates[previewIdx] || selectedEstimates[0];
  const scaleRatio = scale / 100;
  const currentStore = stores.find(
    (s) => s.id === currentEst?.storeId || String(s.id) === String(currentEst?.storeId)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-xs">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Bulk Estimate Print &amp; PDF Export
              </h2>
              <p className="text-xs text-slate-500">
                {selectedEstimates.length} estimate
                {selectedEstimates.length !== 1 ? "s" : ""} selected for bulk processing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar: Preview Navigator & Page Setup Controls */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Estimate navigator */}
          <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-2xs">
            <button
              type="button"
              onClick={() => setPreviewIdx((prev) => Math.max(0, prev - 1))}
              disabled={previewIdx === 0 || isProcessing}
              className="p-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Previous estimate"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-slate-700 min-w-[130px] text-center">
              {previewIdx + 1} of {selectedEstimates.length} —{" "}
              {currentEst?.estimateNumber || `#${currentEst?.id}`}
            </span>
            <button
              type="button"
              onClick={() =>
                setPreviewIdx((prev) =>
                  Math.min(selectedEstimates.length - 1, prev + 1)
                )
              }
              disabled={previewIdx >= selectedEstimates.length - 1 || isProcessing}
              className="p-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Next estimate"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Page Setup Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <label htmlFor="bulk-scale-input" className="text-slate-500 font-medium">Scale:</label>
              <input
                id="bulk-scale-input"
                type="range"
                min="50"
                max="120"
                step="5"
                value={scale}
                onChange={(e) => {
                  setScale(Number(e.target.value));
                  setTargetFitPages(null);
                }}
                disabled={isProcessing}
                className="w-20 accent-orange-600 cursor-pointer disabled:opacity-50"
              />
              <span className="font-bold text-slate-700 w-9 text-right">{scale}%</span>
            </div>

            <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => handleFitToPages(1)}
                disabled={isProcessing}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  targetFitPages === 1
                    ? "bg-orange-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Fit 1 Page
              </button>
              <button
                type="button"
                onClick={() => handleFitToPages(2)}
                disabled={isProcessing}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  targetFitPages === 2
                    ? "bg-orange-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Fit 2 Pages
              </button>
            </div>

            <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => setDensity("normal")}
                disabled={isProcessing}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  density === "normal"
                    ? "bg-orange-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setDensity("compact")}
                disabled={isProcessing}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  density === "compact"
                    ? "bg-orange-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Compact
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintCurrent}
              disabled={previewLoading || isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition disabled:opacity-50"
              title="Print current previewed estimate"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print ({scale}%</span>
            </button>

            <button
              type="button"
              onClick={() => handleStartBulkExport("zip")}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              title="Generate individual PDFs and download as ZIP"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Individual PDFs (ZIP)</span>
            </button>

            <button
              type="button"
              onClick={() => handleStartBulkExport("combined")}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-xs transition disabled:opacity-50"
              title="Combine all selected estimates into one PDF document"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Print Combined PDF</span>
            </button>
          </div>
        </div>

        {/* Progress / Status banner during processing or after completion */}
        {(isProcessing || isDone || failures.length > 0) && (
          <div className="px-5 py-3 border-b border-slate-200 bg-amber-50/70 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              {isProcessing ? (
                <Loader2 className="w-4 h-4 text-orange-600 animate-spin" />
              ) : failures.length > 0 ? (
                <AlertCircle className="w-4 h-4 text-rose-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
              <span className="font-medium text-slate-800">
                {isProcessing
                  ? statusText
                  : isDone
                  ? `Completed: ${successCount} of ${selectedEstimates.length} estimate PDF(s) generated successfully.`
                  : ""}
              </span>
              {failures.length > 0 && (
                <span className="text-rose-600 font-bold ml-1">
                  ({failures.length} failed)
                </span>
              )}
            </div>

            {isProcessing && (
              <button
                type="button"
                onClick={() => {
                  cancelledRef.current = true;
                  setIsProcessing(false);
                }}
                className="px-2 py-1 bg-white border border-rose-300 text-rose-700 rounded text-[11px] font-bold hover:bg-rose-50"
              >
                Cancel
              </button>
            )}

            {combinedPdfBlobUrl && !isProcessing && (
              <div className="flex items-center gap-2">
                <a
                  href={combinedPdfBlobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 bg-slate-800 text-white rounded font-bold hover:bg-slate-700 transition"
                >
                  Open Combined PDF
                </a>
                <a
                  href={combinedPdfBlobUrl}
                  download={`Combined_Estimates_${new Date().toISOString().slice(0, 10)}.pdf`}
                  className="px-2.5 py-1 bg-orange-600 text-white rounded font-bold hover:bg-orange-700 transition"
                >
                  Download Combined PDF
                </a>
              </div>
            )}
          </div>
        )}

        {/* Document Preview Viewport */}
        <div className="flex-1 overflow-auto bg-slate-200/80 p-6 flex justify-center">
          {previewLoading ? (
            <div className="w-full max-w-[733px] bg-white rounded-lg shadow-md p-16 text-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-orange-500" />
              <p className="text-sm font-semibold">Loading estimate items...</p>
            </div>
          ) : currentEst ? (
            <div
              className={`bg-white shadow-xl border border-slate-300 rounded-sm estimate-document-host estimate-print-mode-${density}`}
              style={{
                width: "733px",
                minHeight: "1036px",
                padding: "0",
                transformOrigin: "top center",
                zoom: scaleRatio,
              }}
            >
              <div data-print-document="true">
                <EstimateDocument
                  estimate={currentEst}
                  items={previewItems}
                  stores={stores}
                  clients={clients}
                  products={products}
                  brands={brands}
                  sellerProfile={sellerProfile}
                  assetToken={token}
                />
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-400">
              No estimate selected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkEstimatePdfRunner;
