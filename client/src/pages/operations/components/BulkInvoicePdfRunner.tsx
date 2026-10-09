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
import InvoiceDocument from "../../../components/InvoiceDocument";
import { fetchInvoiceById } from "../../../lib/api";
import {
  getInvoicePdfFilename,
  renderInvoiceElementToPdf,
  packageInvoicesIntoZip,
} from "../utils/invoicePdfExport";
import { downloadFileBlob } from "../utils/estimatePdfExport";
import { PDFDocument } from "pdf-lib";

interface BulkInvoicePdfRunnerProps {
  mode: "preview" | "zip" | "combined" | null;
  onClose: () => void;
  selectedInvoices: any[];
  estimates: any[];
  stores: any[];
  clients: any[];
  products?: any[];
  sellerProfile?: any;
  token?: string | null;
  showSuccess?: (msg: string) => void;
}

export const BulkInvoicePdfRunner: React.FC<BulkInvoicePdfRunnerProps> = ({
  mode,
  onClose,
  selectedInvoices,
  estimates,
  stores,
  clients,
  products = [],
  sellerProfile = {},
  token,
  showSuccess,
}) => {
  // Page Setup Controls
  const [scale, setScale] = useState<number>(100);
  const [targetFitPages, setTargetFitPages] = useState<number | null>(null);
  const [density, setDensity] = useState<"normal" | "compact">("normal");

  // Preview navigation
  const [previewIdx, setPreviewIdx] = useState<number>(0);
  const [fullInvoiceData, setFullInvoiceData] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  // Bulk Generation Execution State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMode, setProcessMode] = useState<"zip" | "combined" | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [failures, setFailures] = useState<Array<{ invoice: any; error: string }>>([]);
  const [isDone, setIsDone] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [combinedPdfBlobUrl, setCombinedPdfBlobUrl] = useState<string | null>(null);

  // Off-screen rendering host data
  const [currentRenderData, setCurrentRenderData] = useState<{
    invoice: any;
    estimate: any;
    client: any;
  } | null>(null);

  const cancelledRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Load detailed invoice data for current preview item if needed
  useEffect(() => {
    if (!mode || selectedInvoices.length === 0) return;
    const curInv = selectedInvoices[previewIdx] || selectedInvoices[0];
    if (!curInv) return;

    let cancelled = false;
    setPreviewLoading(true);

    // If invoice already has complete line_items, reuse it; otherwise fetch
    if (Array.isArray(curInv.lineItems || curInv.line_items) && (curInv.lineItems || curInv.line_items).length > 0) {
      setFullInvoiceData(curInv);
      setPreviewLoading(false);
      return;
    }

    fetchInvoiceById(token || null, curInv.id)
      .then((invRes: any) => {
        if (!cancelled) {
          const invData = invRes?.invoice || invRes || curInv;
          setFullInvoiceData(invData);
          setPreviewLoading(false);
        }
      })
      .catch((err: any) => {
        console.warn("Could not fetch complete invoice details, using summary:", err);
        if (!cancelled) {
          setFullInvoiceData(curInv);
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewIdx, selectedInvoices, token, mode]);

  // Execute bulk export
  const handleStartBulkExport = async (exportMode: "zip" | "combined") => {
    if (selectedInvoices.length === 0) return;

    cancelledRef.current = false;
    setIsProcessing(true);
    setProcessMode(exportMode);
    setIsDone(false);
    setFailures([]);
    setSuccessCount(0);
    setCombinedPdfBlobUrl(null);
    setCurrentIndex(0);

    const total = selectedInvoices.length;
    const failedList: Array<{ invoice: any; error: string }> = [];
    const zipFiles: Record<string, Uint8Array> = {};
    let combinedPdfDoc: PDFDocument | null = null;

    if (exportMode === "combined") {
      combinedPdfDoc = await PDFDocument.create();
      combinedPdfDoc.setTitle("Combined Invoices");
      combinedPdfDoc.setAuthor("Sunrise Media");
      combinedPdfDoc.setCreator("Sunrise Media ERP");
      combinedPdfDoc.setProducer("Sunrise Media ERP");
      combinedPdfDoc.setCreationDate(new Date());
    }

    for (let i = 0; i < total; i++) {
      if (cancelledRef.current) break;

      const rawInv = selectedInvoices[i];
      setCurrentIndex(i + 1);
      setStatusText(`Loading details for ${rawInv.invoiceNumber || `Invoice #${rawInv.id}`} (${i + 1} of ${total})...`);

      let inv = rawInv;
      try {
        if (!Array.isArray(rawInv.lineItems || rawInv.line_items) || (rawInv.lineItems || rawInv.line_items).length === 0) {
          const fetched = await fetchInvoiceById(token || null, rawInv.id);
          inv = fetched?.invoice || fetched || rawInv;
        }
      } catch (fErr: any) {
        console.warn(`Could not load full invoice ${rawInv.invoiceNumber}, using cached row:`, fErr);
      }

      const linkedEst = estimates.find((e: any) => e.id === inv.estimateId);
      const linkedClient = clients.find((c: any) => c.id === (inv.clientId || linkedEst?.clientId));

      if (cancelledRef.current) break;

      // Mount into off-screen container
      setStatusText(`Rendering invoice ${inv.invoiceNumber} (${i + 1} of ${total})...`);
      setCurrentRenderData({
        invoice: inv,
        estimate: linkedEst,
        client: linkedClient,
      });

      // Allow React a frame to commit DOM
      await new Promise((resolve) => setTimeout(resolve, 150));

      if (cancelledRef.current) break;

      try {
        const docEl = hostRef.current?.querySelector(".invoice-print") as HTMLElement | null;
        if (!docEl) {
          throw new Error("Invoice document element failed to render in container");
        }

        if (exportMode === "zip") {
          const singlePdf = await renderInvoiceElementToPdf(
            docEl,
            undefined,
            inv.invoiceNumber || "Tax Invoice",
            targetFitPages
          );
          const pdfBytes = await singlePdf.save();
          const filename = getInvoicePdfFilename(inv, stores);

          let uniqueFilename = filename;
          let counter = 2;
          while (zipFiles[uniqueFilename]) {
            uniqueFilename = filename.replace(/\.pdf$/i, `_${counter}.pdf`);
            counter++;
          }

          zipFiles[uniqueFilename] = pdfBytes;
        } else if (exportMode === "combined" && combinedPdfDoc) {
          await renderInvoiceElementToPdf(
            docEl,
            combinedPdfDoc,
            "Combined Invoices",
            targetFitPages
          );
        }
      } catch (renderErr: any) {
        console.error(`Failed to render invoice ${inv.invoiceNumber}:`, renderErr);
        failedList.push({
          invoice: inv,
          error: renderErr.message || "PDF canvas rendering failed",
        });
      }
    }

    setCurrentRenderData(null);

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
          const zipBlob = packageInvoicesIntoZip(zipFiles);
          downloadFileBlob(zipBlob, `Invoices_Export_${new Date().toISOString().slice(0, 10)}.zip`);
          if (showSuccess) {
            showSuccess(`Successfully exported ${Object.keys(zipFiles).length} invoice PDF(s).`);
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

          const iframe = document.createElement("iframe");
          iframe.style.position = "fixed";
          iframe.style.top = "-10000px";
          iframe.style.left = "-10000px";
          iframe.style.width = "1px";
          iframe.style.height = "1px";
          iframe.src = blobUrl;
          document.body.appendChild(iframe);
          iframe.onload = () => {
            setTimeout(() => {
              try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
              } catch (e) {
                window.open(blobUrl, "_blank");
              }
            }, 300);
          };
          window.setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          }, 120000);

          if (showSuccess) {
            showSuccess(`Successfully compiled combined PDF for ${completedCount} invoice(s).`);
          }
        } catch (combErr: any) {
          console.error("Combined PDF failed:", combErr);
          alert("Failed to build combined PDF: " + combErr.message);
        }
      }
    }
  };

  const handlePrintCurrent = () => {
    const cur = fullInvoiceData || selectedInvoices[previewIdx];
    if (!cur) return;
    const oldTitle = document.title;
    const filename = getInvoicePdfFilename(cur, stores).replace(/\.pdf$/i, "");
    document.title = filename;
    window.print();
    window.setTimeout(() => {
      document.title = oldTitle;
    }, 1000);
  };

  if (!mode) return null;

  const currentInv = fullInvoiceData || selectedInvoices[previewIdx] || selectedInvoices[0];
  const linkedEst = estimates.find((e: any) => e.id === currentInv?.estimateId);
  const linkedClient = clients.find((c: any) => c.id === (currentInv?.clientId || linkedEst?.clientId));
  const scaleRatio = scale / 100;
  const currentStore = stores.find(
    (s) => s.id === currentInv?.storeId || String(s.id) === String(currentInv?.storeId)
  );

  return (
    <>
      {/* Hidden off-screen container for canonical InvoiceDocument rendering */}
      <div
        ref={hostRef}
        className={`invoice-print-canvas invoice-print-mode-${density}`}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          width: "740px",
          zIndex: -9999,
          pointerEvents: "none",
          background: "#ffffff",
          overflow: "hidden",
          zoom: scaleRatio,
        }}
        aria-hidden="true"
      >
        {currentRenderData && (
          <InvoiceDocument
            invoice={currentRenderData.invoice}
            estimate={currentRenderData.estimate}
            client={currentRenderData.client}
            sellerProfile={sellerProfile}
            assetToken={token}
            products={products}
            stores={stores}
          />
        )}
      </div>

      {/* Main Preview & Settings Modal */}
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
                  Bulk Invoice Print &amp; PDF Export
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedInvoices.length} invoice{selectedInvoices.length !== 1 ? "s" : ""} selected for bulk processing
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Controls Bar: Carousel Navigator + Page Setup Toolbar + Bulk Action Buttons */}
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 select-none">
            {/* Carousel / Navigation */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Preview:
              </span>
              <button
                type="button"
                onClick={() => setPreviewIdx((p) => Math.max(0, p - 1))}
                disabled={previewIdx === 0 || isProcessing}
                className="p-1 rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 transition"
                title="Previous invoice"
              >
                <ChevronLeft className="w-4 h-4 text-slate-700" />
              </button>

              <span className="text-xs font-semibold text-slate-700 px-1">
                {previewIdx + 1} of {selectedInvoices.length}
                {currentInv?.invoiceNumber && (
                  <span className="font-mono text-blue-700 ml-1.5 font-bold">
                    {currentInv.invoiceNumber}
                  </span>
                )}
                {(currentInv?.storeName || currentStore?.name) && (
                  <span className="text-slate-500 text-xs ml-1">
                    ({currentInv?.storeName || currentStore?.name})
                  </span>
                )}
              </span>

              <button
                type="button"
                onClick={() => setPreviewIdx((p) => Math.min(selectedInvoices.length - 1, p + 1))}
                disabled={previewIdx >= selectedInvoices.length - 1 || isProcessing}
                className="p-1 rounded bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 transition"
                title="Next invoice"
              >
                <ChevronRight className="w-4 h-4 text-slate-700" />
              </button>
            </div>

            {/* Page Setup Presets */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 font-bold text-slate-600 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5 text-orange-600" />
                <span className="text-[11px] uppercase tracking-wider">Page Setup:</span>
              </div>

              {/* Scale Presets */}
              <div className="flex items-center gap-0.5 bg-white p-0.5 rounded border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-400 font-bold px-1 uppercase">Scale:</span>
                {[100, 90, 85, 75, 70].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setScale(s);
                      setTargetFitPages(null);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition ${
                      scale === s && targetFitPages === null
                        ? "bg-orange-600 text-white shadow-xs"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {s}%
                  </button>
                ))}
              </div>

              {/* Density */}
              <div className="flex items-center gap-0.5 bg-white p-0.5 rounded border border-slate-200 shadow-xs">
                <span className="text-[10px] text-slate-400 font-bold px-1 uppercase">Density:</span>
                <button
                  type="button"
                  onClick={() => setDensity("normal")}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition ${
                    density === "normal" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("compact")}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition ${
                    density === "compact" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
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
                title="Print current previewed invoice"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print ({scale}%)</span>
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
                title="Combine all selected invoices into one PDF document"
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
                    ? `Completed: ${successCount} of ${selectedInvoices.length} invoice PDF(s) generated successfully.`
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
                    download={`Combined_Invoices_${new Date().toISOString().slice(0, 10)}.pdf`}
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
              <div className="w-full max-w-[740px] bg-white rounded-lg shadow-md p-16 text-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-orange-500" />
                <p className="text-sm font-semibold">Loading invoice details...</p>
              </div>
            ) : currentInv ? (
              <div
                className={`bg-white shadow-xl border border-slate-300 rounded-sm invoice-print-mode-${density}`}
                style={{
                  width: "740px",
                  minHeight: "1040px",
                  padding: "0",
                  transformOrigin: "top center",
                  zoom: scaleRatio,
                }}
              >
                <InvoiceDocument
                  invoice={currentInv}
                  estimate={linkedEst}
                  client={linkedClient}
                  sellerProfile={sellerProfile}
                  assetToken={token}
                  products={products}
                  stores={stores}
                />
              </div>
            ) : (
              <div className="text-center py-20 text-slate-400">
                No invoice selected.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default BulkInvoicePdfRunner;
