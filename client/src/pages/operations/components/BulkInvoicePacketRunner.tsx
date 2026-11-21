import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Loader2,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileText,
  Package,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import InvoiceDocument from "../../../components/InvoiceDocument";
import EstimateDocument from "../../../components/EstimateDocument";
import {
  fetchInvoiceById,
  fetchEstimateById,
  fetchEstimateItems,
  fetchDeliveryChallansForEstimate,
  fetchExecutionDocuments,
  fetchInvoicePacketRequirements,
  fetchBrands,
  getActiveCompanyId,
  getExecutionDocumentSignedUrl,
  isActiveDeliveryChallan,
  isWccDeliveryChallan,
} from "../../../lib/api";
import {
  packageInvoicesIntoZip,
  renderInvoiceElementToPdf,
} from "../utils/invoicePdfExport";
import { downloadFileBlob, sanitizeFilename } from "../utils/estimatePdfExport";
import { PDFDocument, rgb } from "pdf-lib";
import { getEstimateScopedStores, getInvoiceScopedStores } from "../../../../../shared/storeScoping";
import {
  InvoicePacketRequirements,
  DEFAULT_INVOICE_PACKET_REQUIREMENTS,
  resolveInvoicePacketRequirements,
} from "../../../../../shared/packetRequirements";
import { isInstallationPhotoDoc, isSignedWccDoc } from "../../../../../shared/invoiceReadiness";
import { isBoltMode } from "../../../lib/supabase";

interface BulkInvoicePacketRunnerProps {
  isOpen: boolean;
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

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 42;

function fitText(text: string, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.substring(0, maxLen - 1) + "…" : text;
}

async function compressImageForPdf(
  buf: Uint8Array,
  mimeType: string,
  maxDimension = 1600,
  quality = 0.82
): Promise<{ bytes: Uint8Array; isJpg: boolean }> {
  try {
    const blob = new Blob([buf], { type: mimeType });
    const imgUrl = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = imgUrl;
    });

    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(imgUrl);
      return { bytes: buf, isJpg: !mimeType.includes("png") };
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(imgUrl);

    const compDataUrl = canvas.toDataURL("image/jpeg", quality);
    const commaIdx = compDataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? compDataUrl.slice(commaIdx + 1) : compDataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, isJpg: true };
  } catch {
    return { bytes: buf, isJpg: !mimeType.includes("png") };
  }
}

export const BulkInvoicePacketRunner: React.FC<BulkInvoicePacketRunnerProps> = ({
  isOpen,
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [failures, setFailures] = useState<Array<{ invoice: any; error: string }>>([]);
  const [isDone, setIsDone] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  // Off-screen rendering host data
  const [renderData, setRenderData] = useState<{
    invoice: any;
    estimate: any;
    estimateItems: any[];
    client: any;
  } | null>(null);

  const cancelledRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleStartBulkExport = async () => {
    if (selectedInvoices.length === 0) return;

    cancelledRef.current = false;
    setIsProcessing(true);
    setIsDone(false);
    setFailures([]);
    setSuccessCount(0);
    setCurrentIndex(0);

    const total = selectedInvoices.length;
    const failedList: Array<{ invoice: any; error: string }> = [];
    const zipFiles: Record<string, Uint8Array> = {};

    // Pre-load company requirements and brands list once
    const activeCompId = getActiveCompanyId();
    let allRequirements: any[] = [];
    let allBrandsList: any[] = [];
    try {
      [allRequirements, allBrandsList] = await Promise.all([
        fetchInvoicePacketRequirements(token || null, activeCompId).catch(() => []),
        fetchBrands(token || null).catch(() => []),
      ]);
    } catch {
      /* ignore */
    }

    for (let i = 0; i < total; i++) {
      if (cancelledRef.current) break;

      const rawInv = selectedInvoices[i];
      setCurrentIndex(i + 1);
      const invoiceLabel = rawInv.invoiceNumber || `Invoice #${rawInv.id}`;
      setStatusText(`Assembling packet ${i + 1} of ${total}: ${invoiceLabel}...`);

      try {
        // 1. Fetch complete invoice details
        let inv = rawInv;
        if (!Array.isArray(inv.lineItems || inv.line_items) || (inv.lineItems || inv.line_items).length === 0) {
          const invRes = await fetchInvoiceById(token || null, rawInv.id).catch(() => null);
          if (invRes) inv = invRes.invoice || invRes || rawInv;
        }

        const estId = inv.estimateId || null;
        let est = estId ? estimates.find((e: any) => e.id === estId) : null;
        if (!est && estId) {
          est = await fetchEstimateById(token || null, estId).catch(() => null);
        }

        let estItems: any[] = [];
        if (estId) {
          estItems = await fetchEstimateItems(token || null, estId).catch(() => []);
        }

        let challans: any[] = [];
        if (estId) {
          challans = (await fetchDeliveryChallansForEstimate(token || null, estId).catch(() => []))
            .filter((c: any) => c.status !== "deleted" && !c.metadata?.deleted);
        }

        let execDocs: any[] = [];
        if (estId) {
          execDocs = (await fetchExecutionDocuments(token || null, estId).catch(() => []))
            .filter((d: any) => d.status !== "deleted" && !d.deletedAt);
        }

        const client = clients.find((c: any) => c.id === (inv.clientId || est?.clientId)) || null;

        // 2. Resolve requirements
        const invCompId = inv.companyId || est?.companyId || activeCompId;
        const targetBrandId = est?.brandId || inv.brandId || null;
        const targetBrand = allBrandsList.find((b: any) => Number(b.id) === Number(targetBrandId));
        const { requirements: reqs } = resolveInvoicePacketRequirements(allRequirements, {
          companyId: invCompId,
          brandId: targetBrandId,
          clientId: inv.clientId || est?.clientId,
          parentBrandName: targetBrand?.parentBrand,
          allBrands: allBrandsList,
        });

        // 3. Resolve scoped stores
        const estScopedStores = getEstimateScopedStores(est, estItems, stores, challans);
        const activeScopedStores = getInvoiceScopedStores(estScopedStores, inv, stores);
        const scopedStoreCodes = new Set(activeScopedStores.map(s => s.storeCode.toLowerCase()).filter(Boolean));
        const scopedStoreIds = new Set(activeScopedStores.map(s => s.storeId).filter((id): id is number => id != null));

        const scopedChallans = challans.filter((dc: any) => {
          const dcCode = String(dc.storeCode || "").trim().toLowerCase();
          const dcSid = dc.storeId || dc.metadata?.storeId ? Number(dc.storeId || dc.metadata?.storeId) : null;
          if (dcCode && scopedStoreCodes.has(dcCode)) return true;
          if (dcSid && scopedStoreIds.has(dcSid)) return true;
          return activeScopedStores.length === 0;
        });
        const scopedChallanIds = new Set(scopedChallans.map((c: any) => Number(c.id)));

        // Mount documents in offscreen host for HTML2Canvas capture
        setRenderData({
          invoice: inv,
          estimate: est,
          estimateItems: estItems,
          client,
        });
        // Give browser frame to render
        await new Promise((r) => setTimeout(r, 120));

        // Create PDF Document for this invoice packet
        const packetPdf = await PDFDocument.create();

        // Page 1+: Tax Invoice Document
        const hostEl = hostRef.current;
        if (hostEl) {
          const invoiceEl = hostEl.querySelector(".invoice-print-container") as HTMLElement | null;
          if (invoiceEl) {
            await renderInvoiceElementToPdf(invoiceEl, packetPdf, "Tax Invoice");
          }
        }

        // PO Document
        const poStoragePath = est?.poFilePath || execDocs.find((d: any) => String(d.documentType || "").toLowerCase() === "po" || String(d.documentType || "").toLowerCase() === "client_po")?.filePath;
        if (poStoragePath) {
          try {
            const poUrl = isBoltMode && !poStoragePath.startsWith("http")
              ? await getExecutionDocumentSignedUrl(token || null, poStoragePath, estId || 0)
              : poStoragePath;
            if (poUrl) {
              const res = await fetch(poUrl);
              if (res.ok) {
                const buf = new Uint8Array(await res.arrayBuffer());
                const contentType = (res.headers.get("content-type") || "").toLowerCase();
                const isPdf = contentType.includes("pdf") || /\.pdf$/i.test(poStoragePath);
                if (isPdf) {
                  const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
                  const copied = await packetPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                  copied.forEach(p => packetPdf.addPage(p));
                } else {
                  const { bytes: compBytes, isJpg } = await compressImageForPdf(buf, contentType || "image/jpeg");
                  const img = isJpg ? await packetPdf.embedJpg(compBytes) : await packetPdf.embedPng(compBytes);
                  const p = packetPdf.addPage([A4_W, A4_H]);
                  const scale = Math.min((A4_W - MARGIN * 2) / img.width, (A4_H - MARGIN * 2) / img.height);
                  p.drawImage(img, {
                    x: (A4_W - img.width * scale) / 2,
                    y: (A4_H - img.height * scale) / 2,
                    width: img.width * scale,
                    height: img.height * scale,
                  });
                }
              }
            }
          } catch (poErr) {
            console.warn("Could not embed PO for invoice:", invoiceLabel, poErr);
          }
        }

        // Estimate Copy (if estimate present)
        if (est && hostEl) {
          const estimateEl = hostEl.querySelector(".estimate-print-container") as HTMLElement | null;
          if (estimateEl) {
            await renderInvoiceElementToPdf(estimateEl, packetPdf, `Estimate ${est.estimateNumber || ""}`);
          }
        }

        // Scoped Store Documents (WCC, Photos, Transport Receipts)
        for (const store of activeScopedStores) {
          const sc = store.storeCode.toLowerCase();
          const storeLabel = store.storeName || (store.storeCode ? `Store ${store.storeCode}` : "Store");

          // 1. Signed WCC / Generated WCC
          const storeChallans = scopedChallans.filter((c: any) => String(c.storeCode || "").toLowerCase() === sc);
          const storeChallanIdList = storeChallans.map((c: any) => Number(c.id));
          const signedWccDocs = execDocs.filter((d: any) =>
            isSignedWccDoc(d) &&
            ((d.storeCode && d.storeCode.toLowerCase() === sc) || (d.deliveryChallanId && storeChallanIdList.includes(Number(d.deliveryChallanId))))
          );

          // Embed signed WCC documents
          for (const doc of signedWccDocs) {
            try {
              const docUrl = isBoltMode && !doc.filePath.startsWith("http")
                ? await getExecutionDocumentSignedUrl(token || null, doc.filePath, estId || 0)
                : doc.filePath;
              if (docUrl) {
                const res = await fetch(docUrl);
                if (res.ok) {
                  const buf = new Uint8Array(await res.arrayBuffer());
                  const isPdf = /\.pdf$/i.test(doc.filePath) || (res.headers.get("content-type") || "").includes("pdf");
                  if (isPdf) {
                    const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
                    const copied = await packetPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                    copied.forEach(p => packetPdf.addPage(p));
                  } else {
                    const { bytes: compBytes, isJpg } = await compressImageForPdf(buf, "image/jpeg");
                    const img = isJpg ? await packetPdf.embedJpg(compBytes) : await packetPdf.embedPng(compBytes);
                    const p = packetPdf.addPage([A4_W, A4_H]);
                    const scale = Math.min((A4_W - MARGIN * 2) / img.width, (A4_H - MARGIN * 2) / img.height);
                    p.drawText(fitText(`${storeLabel} — Signed WCC`, 72), { x: MARGIN, y: A4_H - 50, size: 12, color: rgb(0.1, 0.15, 0.2) });
                    p.drawImage(img, {
                      x: (A4_W - img.width * scale) / 2,
                      y: (A4_H - 60 - img.height * scale) / 2,
                      width: img.width * scale,
                      height: img.height * scale,
                    });
                  }
                }
              }
            } catch (wccErr) {
              console.warn("Could not embed signed WCC for store:", sc, wccErr);
            }
          }

          // 2. Installation Photos
          const storePhotos = execDocs.filter((d: any) =>
            isInstallationPhotoDoc(d) &&
            ((d.storeCode && d.storeCode.toLowerCase() === sc) || (d.deliveryChallanId && storeChallanIdList.includes(Number(d.deliveryChallanId))))
          );

          for (const photo of storePhotos) {
            try {
              const photoUrl = isBoltMode && !photo.filePath.startsWith("http")
                ? await getExecutionDocumentSignedUrl(token || null, photo.filePath, estId || 0)
                : photo.filePath;
              if (photoUrl) {
                const res = await fetch(photoUrl);
                if (res.ok) {
                  const buf = new Uint8Array(await res.arrayBuffer());
                  const { bytes: compBytes, isJpg } = await compressImageForPdf(buf, "image/jpeg");
                  const img = isJpg ? await packetPdf.embedJpg(compBytes) : await packetPdf.embedPng(compBytes);
                  const p = packetPdf.addPage([A4_W, A4_H]);
                  const maxW = A4_W - MARGIN * 2;
                  const maxH = A4_H - 180;
                  const scale = Math.min(maxW / img.width, maxH / img.height);
                  const drawW = img.width * scale;
                  const drawH = img.height * scale;

                  const sapSuffix = store.sapCode ? ` | SAP: ${store.sapCode}` : "";
                  p.drawText(fitText(`${storeLabel} | ${store.storeCode || "—"}${sapSuffix}`, 72), {
                    x: MARGIN,
                    y: A4_H - 60,
                    size: 13,
                    color: rgb(0.08, 0.12, 0.18),
                  });
                  p.drawText("Installation Photo Verification", {
                    x: MARGIN,
                    y: A4_H - 78,
                    size: 9,
                    color: rgb(0.4, 0.45, 0.52),
                  });

                  if (photo.caption) {
                    p.drawText(fitText(photo.caption, 90), { x: MARGIN, y: 50, size: 9, color: rgb(0.35, 0.4, 0.45) });
                  }

                  p.drawImage(img, {
                    x: (A4_W - drawW) / 2,
                    y: 70 + (maxH - drawH) / 2,
                    width: drawW,
                    height: drawH,
                  });
                }
              }
            } catch (photoErr) {
              console.warn("Could not embed photo for store:", sc, photoErr);
            }
          }

          // 3. Transport Receipts
          const storeTransportDocs = execDocs.filter((d: any) =>
            String(d.documentType || "").toLowerCase() === "transport_receipt" &&
            ((d.storeCode && d.storeCode.toLowerCase() === sc) || (d.deliveryChallanId && storeChallanIdList.includes(Number(d.deliveryChallanId))))
          );
          for (const doc of storeTransportDocs) {
            try {
              const docUrl = isBoltMode && !doc.filePath.startsWith("http")
                ? await getExecutionDocumentSignedUrl(token || null, doc.filePath, estId || 0)
                : doc.filePath;
              if (docUrl) {
                const res = await fetch(docUrl);
                if (res.ok) {
                  const buf = new Uint8Array(await res.arrayBuffer());
                  const isPdf = /\.pdf$/i.test(doc.filePath) || (res.headers.get("content-type") || "").includes("pdf");
                  if (isPdf) {
                    const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
                    const copied = await packetPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                    copied.forEach(p => packetPdf.addPage(p));
                  } else {
                    const { bytes: compBytes, isJpg } = await compressImageForPdf(buf, "image/jpeg");
                    const img = isJpg ? await packetPdf.embedJpg(compBytes) : await packetPdf.embedPng(compBytes);
                    const p = packetPdf.addPage([A4_W, A4_H]);
                    const scale = Math.min((A4_W - MARGIN * 2) / img.width, (A4_H - MARGIN * 2) / img.height);
                    p.drawText(fitText(`${storeLabel} — Transport Receipt / LR`, 72), { x: MARGIN, y: A4_H - 50, size: 12, color: rgb(0.1, 0.15, 0.2) });
                    p.drawImage(img, {
                      x: (A4_W - img.width * scale) / 2,
                      y: (A4_H - 60 - img.height * scale) / 2,
                      width: img.width * scale,
                      height: img.height * scale,
                    });
                  }
                }
              }
            } catch (transErr) {
              console.warn("Could not embed transport receipt for store:", sc, transErr);
            }
          }
        }

        // Save packet PDF bytes
        const pdfBytes = await packetPdf.save();
        const cleanInvPart = sanitizeFilename(inv.invoiceNumber || `INV-${inv.id}`);
        const filename = `Invoice_${cleanInvPart}_Packet.pdf`;

        zipFiles[filename] = pdfBytes;
        setSuccessCount(c => c + 1);
      } catch (err: any) {
        console.error(`Error generating packet for invoice ${invoiceLabel}:`, err);
        failedList.push({ invoice: rawInv, error: err?.message || "Packet assembly failed" });
      }
    }

    setFailures(failedList);
    setIsProcessing(false);
    setIsDone(true);
    setRenderData(null);

    // Download ZIP if at least 1 packet was generated successfully
    const generatedCount = Object.keys(zipFiles).length;
    if (generatedCount > 0) {
      setStatusText("Packaging invoice packets into ZIP archive...");
      try {
        const zipBlob = packageInvoicesIntoZip(zipFiles);
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadFileBlob(zipBlob, `Sunrise_Invoice_Packets_${dateStr}.zip`);
        showSuccess?.(`Successfully generated and downloaded ${generatedCount} invoice packet(s).`);
      } catch (zipErr: any) {
        console.error("ZIP packaging error:", zipErr);
        alert("Failed to create ZIP package: " + zipErr.message);
      }
    }
  };

  const pct = selectedInvoices.length > 0 ? Math.round((currentIndex / selectedInvoices.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      {/* Hidden off-screen host for rendering Invoice and Estimate to canvas */}
      <div
        ref={hostRef}
        style={{
          position: "fixed",
          left: "-9999px",
          top: 0,
          width: "794px",
          opacity: 0,
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        {renderData && (
          <div>
            <div className="invoice-print-container" style={{ width: "794px" }}>
              <InvoiceDocument
                invoice={renderData.invoice}
                estimate={renderData.estimate}
                client={renderData.client}
                sellerProfile={sellerProfile}
                products={products}
                stores={stores}
                assetToken={token}
              />
            </div>
            {renderData.estimate && (
              <div className="estimate-print-container" style={{ width: "794px" }}>
                <EstimateDocument
                  estimate={renderData.estimate}
                  items={renderData.estimateItems || []}
                  stores={stores}
                  clients={clients}
                  products={products}
                  sellerProfile={sellerProfile}
                  assetToken={token}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-100 text-orange-700">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800">Download Invoice Packets</h3>
              <p className="text-[11px] text-slate-500">
                {selectedInvoices.length} invoice{selectedInvoices.length > 1 ? "s" : ""} selected for packet export
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              cancelledRef.current = true;
              onClose();
            }}
            disabled={isProcessing}
            className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {!isProcessing && !isDone && (
            <div className="space-y-3">
              <p className="text-slate-600 leading-relaxed">
                This process will sequentially assemble a complete, independent packet PDF for each of the{" "}
                <span className="font-bold text-slate-900">{selectedInvoices.length}</span> selected invoices (including Tax Invoice, PO, Estimate, store WCCs, installation photos, and transport receipts according to brand requirements).
              </p>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-[11px] space-y-1">
                <p className="font-bold">Output Specification:</p>
                <p>• Archive: <code className="font-mono bg-white/80 px-1 py-0.5 rounded">Sunrise_Invoice_Packets_{new Date().toISOString().slice(0, 10)}.zip</code></p>
                <p>• Packet filenames: <code className="font-mono bg-white/80 px-1 py-0.5 rounded">Invoice_193_Packet.pdf</code></p>
                <p>• Company-scoped documents and brand requirement compliance are strictly enforced.</p>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>{statusText}</span>
                <span className="text-orange-600 font-mono">{pct}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-orange-600 h-2.5 rounded-full transition-all duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Processing sequentially to preserve browser memory and stability...
              </p>
            </div>
          )}

          {isDone && (
            <div className="space-y-3">
              {successCount > 0 ? (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-start gap-2.5 text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-xs">Export Complete!</p>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Successfully packaged <span className="font-bold">{successCount}</span> invoice packet{successCount > 1 ? "s" : ""} into ZIP. The download has started automatically.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2.5 text-rose-900">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-xs">Export Failed</p>
                    <p className="text-[11px] text-rose-700 mt-0.5">
                      No invoice packets could be created. Please review the errors below.
                    </p>
                  </div>
                </div>
              )}

              {failures.length > 0 && (
                <div className="space-y-2">
                  <p className="font-bold text-xs text-rose-800">
                    Failed Invoices ({failures.length}):
                  </p>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-rose-50/60 rounded-lg border border-rose-200 text-[11px]">
                    {failures.map((f, idx) => (
                      <div key={idx} className="text-rose-900">
                        <span className="font-bold">{f.invoice.invoiceNumber || `Invoice #${f.invoice.id}`}:</span>{" "}
                        <span className="text-rose-700">{f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
          {!isProcessing && !isDone && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartBulkExport}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-md transition"
              >
                <Download className="w-3.5 h-3.5" />
                Start Export ({selectedInvoices.length})
              </button>
            </>
          )}

          {isProcessing && (
            <button
              type="button"
              onClick={() => {
                cancelledRef.current = true;
              }}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition"
            >
              Cancel Process
            </button>
          )}

          {isDone && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkInvoicePacketRunner;
