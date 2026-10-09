import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Loader2,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import type { Estimate, Store, Client, Product, Brand } from "../types";
import EstimateDocument from "../../../components/EstimateDocument";
import { fetchEstimateItems } from "../../../lib/api";
import {
  getEstimatePdfFilename,
  renderEstimateElementToPdf,
  packagePdfsIntoZip,
  downloadFileBlob,
} from "../utils/estimatePdfExport";
import { PDFDocument } from "pdf-lib";

interface BulkEstimatePdfRunnerProps {
  mode: "zip" | "combined" | null;
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
  const [currentEstimateData, setCurrentEstimateData] = useState<{
    estimate: Estimate;
    items: any[];
  } | null>(null);

  const [statusText, setStatusText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [failures, setFailures] = useState<Array<{ estimate: Estimate; error: string }>>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [combinedPdfBlobUrl, setCombinedPdfBlobUrl] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mode || selectedEstimates.length === 0) return;

    cancelledRef.current = false;
    setIsProcessing(true);
    setIsDone(false);
    setFailures([]);
    setSuccessCount(0);
    setCombinedPdfBlobUrl(null);
    setCurrentIndex(0);

    const runExport = async () => {
      const total = selectedEstimates.length;
      const failedList: Array<{ estimate: Estimate; error: string }> = [];
      const zipFiles: Record<string, Uint8Array> = {};
      let combinedPdfDoc: PDFDocument | null = null;

      if (mode === "combined") {
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
        setStatusText(`Loading items for ${est.estimateNumber || `Estimate #${est.id}`} (${i + 1} of ${total})...`);

        let items: any[] = [];
        try {
          items = await fetchEstimateItems(token, est.id);
        } catch (fetchErr: any) {
          console.error(`Failed to fetch items for estimate ${est.estimateNumber}:`, fetchErr);
          failedList.push({
            estimate: est,
            error: fetchErr.message || "Failed to load estimate items",
          });
          continue;
        }

        if (cancelledRef.current) break;

        // Mount the estimate into the off-screen host
        setStatusText(`Rendering estimate ${est.estimateNumber} (${i + 1} of ${total})...`);
        setCurrentEstimateData({ estimate: est, items });

        // Allow React a frame to commit the DOM
        await new Promise((resolve) => setTimeout(resolve, 150));

        if (cancelledRef.current) break;

        try {
          const docEl = hostRef.current?.querySelector(".estimate-print") as HTMLElement | null;
          if (!docEl) {
            throw new Error("Estimate document element failed to render in container");
          }

          if (mode === "zip") {
            const singlePdf = await renderEstimateElementToPdf(docEl, undefined, est.estimateNumber || "Estimate");
            const pdfBytes = await singlePdf.save();
            const filename = getEstimatePdfFilename(est, stores);

            // Handle filename collision if duplicate estimate numbers exist
            let uniqueFilename = filename;
            let counter = 2;
            while (zipFiles[uniqueFilename]) {
              uniqueFilename = filename.replace(/\.pdf$/i, `_${counter}.pdf`);
              counter++;
            }

            zipFiles[uniqueFilename] = pdfBytes;
          } else if (mode === "combined" && combinedPdfDoc) {
            await renderEstimateElementToPdf(docEl, combinedPdfDoc, "Combined Estimates");
          }
        } catch (renderErr: any) {
          console.error(`Failed to render PDF for estimate ${est.estimateNumber}:`, renderErr);
          failedList.push({
            estimate: est,
            error: renderErr.message || "Failed to render estimate PDF",
          });
        }
      }

      // Cleanup rendered element
      setCurrentEstimateData(null);

      if (cancelledRef.current) {
        setIsProcessing(false);
        onClose();
        return;
      }

      const succeeded = total - failedList.length;
      setSuccessCount(succeeded);
      setFailures(failedList);

      if (mode === "zip") {
        if (Object.keys(zipFiles).length > 0) {
          setStatusText("Packaging PDFs into ZIP...");
          const zipBlob = packagePdfsIntoZip(zipFiles);
          const zipName = `Estimates_Export_${new Date().toISOString().slice(0, 10)}.zip`;
          downloadFileBlob(zipBlob, zipName);
          showSuccess?.(`Exported ${Object.keys(zipFiles).length} estimate PDFs in ZIP file.`);
        }

        setIsProcessing(false);
        setIsDone(true);
        if (failedList.length === 0) {
          onClose();
        }
      } else if (mode === "combined" && combinedPdfDoc) {
        if (succeeded > 0) {
          setStatusText("Finalizing combined PDF...");
          const combinedBytes = await combinedPdfDoc.save();
          const blob = new Blob([combinedBytes], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          setCombinedPdfBlobUrl(url);

          // Attempt to open in a new tab for native printing/preview
          try {
            window.open(url, "_blank");
          } catch {}

          showSuccess?.(`Combined PDF generated for ${succeeded} estimates.`);
        }

        setIsProcessing(false);
        setIsDone(true);
      }
    };

    runExport();

    return () => {
      cancelledRef.current = true;
    };
  }, [mode]);

  if (!mode) return null;

  const total = selectedEstimates.length;
  const percent = total > 0 ? Math.round((currentIndex / total) * 100) : 0;

  return (
    <>
      {/* Hidden off-screen container for canonical EstimateDocument rendering */}
      <div
        ref={hostRef}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "794px",
          zIndex: -9999,
          pointerEvents: "none",
          background: "#ffffff",
          overflow: "hidden",
        }}
        aria-hidden="true"
      >
        {currentEstimateData && (
          <EstimateDocument
            estimate={currentEstimateData.estimate}
            items={currentEstimateData.items}
            stores={stores}
            clients={clients}
            products={products}
            brands={brands}
            sellerProfile={sellerProfile}
            assetToken={token}
          />
        )}
      </div>

      {/* Modal / Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
        <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col p-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-xs">
                {mode === "zip" ? (
                  <Download className="w-5 h-5" />
                ) : (
                  <Printer className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {mode === "zip" ? "Export Individual PDFs" : "Print Combined PDF"}
                </h3>
                <p className="text-xs text-slate-500">
                  {isProcessing
                    ? `Processing ${currentIndex} of ${total} estimates...`
                    : isDone
                    ? `Completed (${successCount} successful)`
                    : "Preparing export..."}
                </p>
              </div>
            </div>
            {!isProcessing && (
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="py-6 space-y-4">
            {isProcessing && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-2 text-orange-700">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {statusText}
                  </span>
                  <span>{percent}%</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-orange-600 to-amber-500 h-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}

            {isDone && (
              <div className="space-y-3">
                {successCount > 0 && (
                  <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                    <span>
                      {mode === "zip"
                        ? `Successfully generated ${successCount} estimate PDF${
                            successCount === 1 ? "" : "s"
                          } packaged in ZIP.`
                        : `Combined PDF successfully generated for ${successCount} estimate${
                            successCount === 1 ? "" : "s"
                          }.`}
                    </span>
                  </div>
                )}

                {failures.length > 0 && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{failures.length} estimate(s) failed to export:</span>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 pl-5 list-disc">
                      {failures.map((f, i) => (
                        <div key={i} className="text-[11px]">
                          • <span className="font-semibold">{f.estimate.estimateNumber || `#${f.estimate.id}`}:</span> {f.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mode === "combined" && combinedPdfBlobUrl && (
                  <div className="flex items-center gap-2 pt-2">
                    <a
                      href={combinedPdfBlobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs rounded-lg transition shadow-xs"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Open / Print Combined PDF
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = combinedPdfBlobUrl;
                        link.download = `Combined_Estimates_${new Date().toISOString().slice(0, 10)}.pdf`;
                        link.click();
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download PDF
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            {isProcessing ? (
              <button
                type="button"
                onClick={() => {
                  cancelledRef.current = true;
                  setIsProcessing(false);
                  onClose();
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
