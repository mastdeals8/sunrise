import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { isAblblFormat } from "../../../shared/textFormat";
import { Package, Search, Printer, Loader as Loader2, FileDown, TriangleAlert as AlertTriangle, SlidersHorizontal } from "lucide-react";
import { PDFDocument, rgb } from "pdf-lib";
import html2canvas from "html2canvas";
import EstimateDocument from "../components/EstimateDocument";
import InvoiceDocument from "../components/InvoiceDocument";
import type { Client, Product, Store } from "./operations/types";
import { isBoltMode } from "../lib/supabase";
import { fetchInvoices, fetchCompanySettings, fetchEstimateById, fetchEstimateItems, fetchDeliveryChallansForEstimate, fetchPaymentsForInvoice, fetchClients, fetchStores, fetchProducts, fetchExecutionDocuments, fetchExecutionStores, getExecutionDocumentSignedUrl } from "../lib/api";

interface Invoice {
  id: number;
  invoiceNumber: string;
  partyName: string;
  totalAmount: number;
  paidAmount?: number;
  date: string;
  dueDate: string;
  status: string;
  estimateId?: number | null;
  clientId?: number | null;
  remarks?: string | null;
  amount?: number;
  taxAmount?: number;
  lineItems?: any[];
  poNumber?: string | null;
}

interface PacketData {
  invoice: Invoice;
  estimate: any;
  estimateItems: any[];
  challans: any[];
  client: any;
  payments: any[];
  stores?: Store[];
  clients?: Client[];
  products?: Product[];
  executionDocuments?: any[];
  executionStores?: any[];
}

interface PacketPage {
  id: string;
  label: string;
  kind: "invoice" | "po" | "estimate" | "project" | "photo" | "wcc" | "store-file";
  filePath?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  storeCode?: string | null;
  storeName?: string | null;
  caption?: string | null;
  included: boolean;
}

// 194 mm is the printable width of the normal Estimate A4 flow: A4 less its
// standard 8 mm print margins, expressed at the browser's 96 CSS dpi.
const STANDARD_PRINTABLE_CSS_WIDTH = 733;

const fitText = (value: unknown, max = 80) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const estimatePrintMode = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem("sunrise_estimate_print_options") || "{}");
    return saved?.mode === "normal" ? "normal" : "compact";
  } catch {
    return "compact";
  }
};

const SafeImage: React.FC<React.ImgHTMLAttributes<HTMLImageElement> & { fallback?: string }> = ({ fallback = "Image unavailable", ...props }) => {
  const [failed, setFailed] = useState(!props.src);
  if (failed) return <div className="flex items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-slate-500 text-xs rounded p-6">{fallback}</div>;
  return <img {...props} onError={(event) => { props.onError?.(event); setFailed(true); }} />;
};

import { orderedStoreKeysFromGrouping } from "./operations/utils/estimateOrdering";

const docTypeLabel = (type: string) => ({
  photo: "Installation Photo", installation_photo: "Installation Photo", execution_photo: "Completion Photo",
  completion_photo: "Completion Photo", additional_photo: "Additional Photo",
  signed_wcc: "Signed WCC", signed_dc: "Signed Delivery Challan", transport_receipt: "Transport Receipt",
  lr_copy: "LR Copy", courier_receipt: "Courier Receipt", gate_pass: "Gate Pass", eway_bill: "E-Way Bill",
  extra: "Other Project Document", field_upload: "Project Document", client_po: "Purchase Order", po: "Purchase Order",
} as Record<string, string>)[type] || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

const storeCodeFor = (value: any) => String(value?.storeCode || value?.metadata?.storeCode || "").trim();
const isPhotoType = (type: string) => ["photo", "installation_photo", "execution_photo", "completion_photo", "additional_photo"].includes(type);
const isSignedType = (type: string) => ["signed_wcc", "signed_dc"].includes(type);
const isPoType = (type: string) => ["po", "client_po"].includes(type);
// wcc_photo is the photo uploaded in WCC builder / draft WCC — not wanted in the client packet.
// The client packet only includes the signed WCC that was stamped and uploaded, plus true installation photos.
const isExcludedType = (type: string) => ["wcc", "wcc_photo"].includes(type);
const isExcludedDoc = (doc: any) =>
  isExcludedType(doc?.documentType) ||
  doc?.metadata?.source === "delivery_challans.metadata.photos" ||
  doc?.metadata?.source === "delivery_challans.photoPath";
const isStoreScopeDoc = (doc: any) => Boolean(storeCodeFor(doc) || doc?.deliveryChallanId);

async function signPacketDocument(doc: any, estimateId: number): Promise<PacketPage | null> {
  const storagePath = String(doc.storagePath || doc.filePath || "");
  if (!storagePath) return null;
  try {
    const filePath = await getExecutionDocumentSignedUrl(storagePath, false, estimateId, doc.kind === "po");
    return { ...doc, filePath, storagePath } as PacketPage;
  } catch (error) {
    console.warn("[invoice-packet] document unavailable", storagePath, error);
    return { ...doc, filePath: null, storagePath } as PacketPage;
  }
}


const InvoicePacketPage: React.FC = () => {
  const { token } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [packet, setPacket] = useState<PacketData | null>(null);
  const [pages, setPages] = useState<PacketPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sellerProfile, setSellerProfile] = useState<any>({});
  const [fromUrl, setFromUrl] = useState(false);
  const [pdfMode, setPdfMode] = useState<string | null>(null);
  const [generatedPacketPdf, setGeneratedPacketPdf] = useState<Blob | null>(null);

  const [targetFitPages, setTargetFitPages] = useState<number | null>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      return saved?.fitPages !== undefined ? saved.fitPages : null;
    } catch {
      return null;
    }
  });

  const [printScale, setPrintScale] = useState<number>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      return saved?.scale || 100;
    } catch {
      return 100;
    }
  });

  const [printMode, setPrintMode] = useState<"normal" | "compact">(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      return saved?.mode || "normal";
    } catch {
      return "normal";
    }
  });

  const applyPacketPrintStyles = (scalePct: number, mode: "normal" | "compact") => {
    const scaleRatio = scalePct / 100;
    document.documentElement.style.setProperty("--packet-print-zoom", String(scaleRatio));
    let styleEl = document.getElementById("packet-dynamic-print-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "packet-dynamic-print-style";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      @media print {
        @page {
          size: A4 portrait;
          margin: 6mm !important;
        }
        .invoice-print, .estimate-print {
          zoom: ${scaleRatio} !important;
          width: 100% !important;
        }
        .invoice-table td, .estimate-table td {
          padding: ${mode === "compact" ? "4.5px 5.5px" : "5.5px 7px"} !important;
          vertical-align: middle !important;
          line-height: 1.35 !important;
        }
      }
    `;
  };

  useEffect(() => {
    applyPacketPrintStyles(printScale, printMode);
  }, [printScale, printMode]);

  const handleUpdatePrintScale = (scalePct: number, clearFit = true) => {
    setPrintScale(scalePct);
    if (clearFit) {
      setTargetFitPages(null);
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      window.localStorage.setItem("sunrise_packet_print_options", JSON.stringify({ ...saved, scale: scalePct, ...(clearFit ? { fitPages: null } : {}) }));
    } catch { /* ignore */ }
  };

  const handleUpdatePrintMode = (mode: "normal" | "compact") => {
    setPrintMode(mode);
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      window.localStorage.setItem("sunrise_packet_print_options", JSON.stringify({ ...saved, mode }));
    } catch { /* ignore */ }
  };

  const handleFitToPages = (targetPages: number) => {
    setTargetFitPages(targetPages);
    try {
      const saved = JSON.parse(window.localStorage.getItem("sunrise_packet_print_options") || "{}");
      window.localStorage.setItem("sunrise_packet_print_options", JSON.stringify({ ...saved, fitPages: targetPages }));
    } catch { /* ignore */ }
    const totalItems = (packet?.estimateItems?.length || 0) + (packet?.invoice?.lineItems?.length || 0);
    if (targetPages === 1) {
      handleUpdatePrintScale(totalItems > 15 ? 70 : 85, false);
      handleUpdatePrintMode("compact");
    } else if (targetPages === 2) {
      handleUpdatePrintScale(totalItems > 45 ? 75 : 85, false);
      handleUpdatePrintMode("compact");
    } else {
      handleUpdatePrintScale(totalItems > 60 ? 75 : 85, false);
      handleUpdatePrintMode("compact");
    }
  };

  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const id = u.get("id");
    if (id) {
      setSelectedId(parseInt(id, 10));
      setFromUrl(true);
    }
    const mode = u.get("pdfMode");
    if (mode) setPdfMode(mode);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        if (isBoltMode) {
          const [settings, invs] = await Promise.all([fetchCompanySettings(token), fetchInvoices(token)]);
          if (settings) setSellerProfile(settings);
          setInvoices(invs as Invoice[]);
        } else {
          const settingsRes = await fetch("/api/company-settings", { headers: { Authorization: `Bearer ${token}` } });
          if (settingsRes.ok) setSellerProfile(await settingsRes.json());
          const res = await fetch("/api/finance/invoices", { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) setInvoices(await res.json());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  useEffect(() => {
    if (!selectedId) {
      setPacket(null); setPages([]); setGeneratedPacketPdf(null);
      return;
    }
    const load = async () => {
      try {
        let data: PacketData | null = null;
        if (isBoltMode) {
          // Client-side packet assembly from Supabase
          const inv = invoices.find((i: any) => i.id === selectedId);
          if (!inv) return;
          const estimateId = inv.estimateId ?? null;
          const [estimate, estimateItems, challans, payments, clients, stores, products, executionDocuments, executionStores] = await Promise.all([
            estimateId ? fetchEstimateById(token, estimateId) : Promise.resolve(null),
            estimateId ? fetchEstimateItems(token, estimateId) : Promise.resolve([]),
            estimateId ? fetchDeliveryChallansForEstimate(token, estimateId) : Promise.resolve([]),
            fetchPaymentsForInvoice(token, selectedId),
            fetchClients(token),
            fetchStores(token),
            fetchProducts(token),
            estimateId ? fetchExecutionDocuments(token, estimateId) : Promise.resolve([]),
            estimateId ? fetchExecutionStores(token, estimateId) : Promise.resolve([]),
          ]);
          const client = clients.find((c: any) => c.id === inv.clientId);
          data = { invoice: inv, estimate, estimateItems, challans, client, payments, stores, clients, products, executionDocuments, executionStores };
        } else {
          const res = await fetch(`/api/finance/invoice-packet/${selectedId}`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) data = await res.json();
        }
        if (data) {
          // A generated PDF is the immutable source used by both Download and
          // Print. Invalidate it whenever a different packet is assembled.
          setGeneratedPacketPdf(null);
          setPacket(data);
          const estimateId = Number(data.estimate?.id || 0);
          const docs = (data.executionDocuments || []).filter((d: any) => d.status !== "deleted" && d.status !== "replaced");
          type PacketEntry = { type: "static"; page: PacketPage } | { type: "file"; page: Omit<PacketPage, "included"> };
          const entries: PacketEntry[] = [];
          const seen = new Set<string>();
          const byUploadTime = (a: any, b: any) => new Date(a.uploadedAt || a.createdAt || 0).getTime() - new Date(b.uploadedAt || b.createdAt || 0).getTime();

          const queueFile = (page: Omit<PacketPage, "included">) => {
            const raw = String(page.storagePath || page.filePath || "");
            if (!raw || seen.has(raw)) return;
            seen.add(raw);
            entries.push({ type: "file", page });
          };

          entries.push({ type: "static", page: { id: "inv", label: "Client Billing Invoice", kind: "invoice", included: true } });

          // Prefer the Estimate's PO reference, then fall back to the active PO
          // upload row used by the existing documents workflow.
          const poUpload = docs.filter((doc: any) => isPoType(doc.documentType)).sort(byUploadTime)[0];
          const poStoragePath = data.estimate?.poFilePath || poUpload?.storagePath || poUpload?.filePath;
          if (poStoragePath) {
            queueFile({ id: "po", label: `Purchase Order (${data.estimate?.poNumber || "PO"})`, kind: "po", storagePath: poStoragePath, mimeType: poUpload?.mimeType });
          }

          if (data.estimate) {
            entries.push({ type: "static", page: { id: "est", label: `Estimate ${data.estimate.estimateNumber}`, kind: "estimate", included: true } });
          }

          // Transport/project uploads are the final packet section. Preserve
          // their existing upload/store order without changing their source.
          const projectDocs = docs
            .filter((doc: any) => !isPoType(doc.documentType) && !isExcludedDoc(doc) && !isSignedType(doc.documentType) && !isPhotoType(doc.documentType) && !isStoreScopeDoc(doc))
            .sort(byUploadTime);
          const legacyProjectDocs = (data.challans || []).flatMap((dc: any) => [
            dc.transportReceiptPath && { id: `legacy-transport-${dc.id}`, documentType: "transport_receipt", storagePath: dc.transportReceiptPath, createdAt: dc.createdAt },
            dc.extraDocPath && { id: `legacy-extra-${dc.id}`, documentType: "extra", storagePath: dc.extraDocPath, createdAt: dc.createdAt },
          ]).filter(Boolean).sort(byUploadTime) as any[];
          for (const doc of [...projectDocs, ...legacyProjectDocs].sort(byUploadTime)) {
            queueFile({
              id: `project-${doc.id}`,
              label: docTypeLabel(doc.documentType),
              kind: "project",
              storagePath: doc.storagePath || doc.filePath,
              mimeType: doc.mimeType,
              caption: doc.caption || doc.description || doc.notes || null,
            });
          }

          // Order stores by the Estimate's store sequence (the master order),
          // never alphabetical, by store ID, by WCC/DC number, or by upload
          // date. Fall back to challan id for legacy data.
          const estimateGrouping = (data.estimate?.storeGrouping || {}) as Record<string, any>;
          const estimateOrderedSids = orderedStoreKeysFromGrouping(estimateGrouping);
          const estimateStoreCodeOrder = new Map<string, number>();
          estimateOrderedSids.forEach((sid, i) => {
            const masterStore = (data.stores || []).find((s: any) => s.id === Number(sid));
            const code = String(masterStore?.storeCode || (masterStore as any)?.code || "").trim();
            if (code) estimateStoreCodeOrder.set(code, i);
          });
          const execOrder = new Map<string, number>();
          (data.executionStores || []).forEach((s: any, i: number) => {
            const code = String(s.code || s.storeCode || "");
            if (code && !estimateStoreCodeOrder.has(code)) execOrder.set(code, estimateOrderedSids.length + i);
          });
          const storeRank = (code: string): number => {
            const er = estimateStoreCodeOrder.get(code);
            if (er !== undefined) return er;
            const xr = execOrder.get(code);
            if (xr !== undefined) return xr;
            return Infinity;
          };
          const challans = [...(data.challans || [])].sort((a: any, b: any) => {
            const oa = storeRank(storeCodeFor(a));
            const ob = storeRank(storeCodeFor(b));
            if (oa !== ob) return oa - ob;
            return Number(a.id) - Number(b.id);
          });
          const storeContexts: { storeCode: string; challans: any[] }[] = [];
          const ensureStore = (storeCode: string) => {
            if (!storeCode || storeContexts.some(row => row.storeCode === storeCode)) return;
            storeContexts.push({ storeCode, challans: challans.filter(dc => storeCodeFor(dc) === storeCode) });
          };
          // First: stores in Estimate order
          estimateOrderedSids.forEach(sid => {
            const masterStore = (data.stores || []).find((s: any) => s.id === Number(sid));
            const code = String(masterStore?.storeCode || (masterStore as any)?.code || "").trim();
            if (code) ensureStore(code);
          });
          // Then: any execution stores not in the estimate grouping (legacy)
          [...(data.executionStores || [])]
            .sort((a: any, b: any) => storeRank(String(a.storeCode || a.code || "").trim()) - storeRank(String(b.storeCode || b.code || "").trim()))
            .forEach((row: any) => ensureStore(String(row.storeCode || row.code || "").trim()));
          // Then: any challans/docs whose store wasn't seen yet
          challans.forEach((dc: any) => ensureStore(storeCodeFor(dc)));
          docs.filter(isStoreScopeDoc).forEach((doc: any) => ensureStore(storeCodeFor(doc)));
          if (challans.some((dc: any) => !storeCodeFor(dc)) || docs.some((doc: any) => (isSignedType(doc.documentType) || isPhotoType(doc.documentType) || isStoreScopeDoc(doc)) && !storeCodeFor(doc))) {
            storeContexts.push({ storeCode: "", challans: challans.filter((dc: any) => !storeCodeFor(dc)) });
          }

          for (const context of storeContexts) {
            const storeCode = context.storeCode;
            const store = (data.stores || []).find((s: any) => String(s.code || s.storeCode || "") === storeCode);
            const storeLabel = store?.name ? `${store.name}${storeCode ? ` (${storeCode})` : ""}` : (storeCode || "Project");
            const challanIds = new Set(context.challans.map(dc => Number(dc.id)));
            const owned = docs.filter((d: any) => (
              challanIds.has(Number(d.deliveryChallanId))
              || (storeCode ? storeCodeFor(d) === storeCode : (!d.deliveryChallanId && !storeCodeFor(d)))
            ) && !isPoType(d.documentType) && !isExcludedDoc(d));
            const legacy = context.challans.flatMap((dc: any) => [
              dc.signedChallanPath && { id: `legacy-signed-${dc.id}`, documentType: isAblblFormat(dc.clientFormat) ? "signed_wcc" : "signed_dc", storagePath: dc.signedChallanPath },
            ]).filter(Boolean) as any[];
            // Per store: signed WCC, photos, then any other store attachment.
            const ordered = [...owned, ...legacy].sort((a: any, b: any) => {
              const rank = (d: any) => isSignedType(d.documentType) ? 0
                : ["photo", "installation_photo"].includes(d.documentType) ? 1
                : ["execution_photo", "completion_photo"].includes(d.documentType) ? 2
                : d.documentType === "additional_photo" ? 3
                : isPhotoType(d.documentType) ? 4 : 5;
              return rank(a) - rank(b) || new Date(a.uploadedAt || a.createdAt).getTime() - new Date(b.uploadedAt || b.createdAt).getTime();
            });
            for (const doc of ordered) {
              queueFile({
                id: `exec-${doc.id}`,
                label: isPhotoType(doc.documentType)
                  ? `${store?.name || "Store"} — ${storeCode || "—"}`
                  : `${storeLabel} — ${docTypeLabel(doc.documentType)}`,
                kind: isPhotoType(doc.documentType) ? "photo" : isSignedType(doc.documentType) ? "wcc" : "store-file",
                storagePath: doc.storagePath || doc.filePath,
                mimeType: doc.mimeType,
                storeCode,
                storeName: store?.name || storeLabel,
                caption: doc.caption || doc.description || doc.notes || null,
              });
            }
          }

          const resolvedPages = await Promise.all(
            entries.map(async (entry) => {
              if (entry.type === "static") return entry.page;
              return signPacketDocument({ ...entry.page, included: true }, estimateId);
            })
          );
          setPages(resolvedPages.filter(Boolean) as PacketPage[]);
        }
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [selectedId, token, invoices]);

  // Retained for the existing legacy deployment path. Bolt packet generation
  // remains entirely client-side and does not call this route mode.
  useEffect(() => {
    if (!pdfMode || !packet) return;
    // For invoice mode, wait for the InvoiceDocument to signal that logo and
    // signature images have been converted to base64 data URLs. For estimate
    // mode, use the original fixed delay.
    if (pdfMode === "invoice") {
      const checkReady = () => {
        if (document.documentElement.getAttribute("data-invoice-images-ready") === "true") {
          document.documentElement.setAttribute("data-pdf-ready", "true");
        } else {
          window.setTimeout(checkReady, 200);
        }
      };
      const timer = window.setTimeout(checkReady, 300);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => document.documentElement.setAttribute("data-pdf-ready", "true"), 1200);
    return () => window.clearTimeout(timer);
  }, [pdfMode, packet, sellerProfile]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(i => i.invoiceNumber.toLowerCase().includes(q) || i.partyName.toLowerCase().includes(q));
  }, [invoices, search]);

  const [building, setBuilding] = useState(false);
  const [missingDocs, setMissingDocs] = useState<{ store: string; missing: string[] }[] | null>(null);

  const computeMissing = (): { store: string; missing: string[] }[] => {
    const gaps: { store: string; missing: string[] }[] = [];
    const coreMissing: string[] = [];
    if (!packet?.invoice) coreMissing.push("Invoice");
    if (!pages.some(p => p.kind === "po" && p.filePath)) coreMissing.push("Purchase Order");
    if (!pages.some(p => p.kind === "estimate")) coreMissing.push("Estimate");
    if (coreMissing.length) gaps.push({ store: "Project-level", missing: coreMissing });
    const estimateGrouping = (packet?.estimate?.storeGrouping || {}) as Record<string, any>;
    const estimateOrderedSids = orderedStoreKeysFromGrouping(estimateGrouping);
    const estimateOrderedStoreCodes = estimateOrderedSids
      .map(sid => {
        const masterStore = (packet?.stores || []).find((store: any) => store.id === Number(sid));
        return String(masterStore?.storeCode || (masterStore as any)?.code || "").trim();
      })
      .filter(Boolean);
    const storeCodes = Array.from(new Set([
      ...estimateOrderedStoreCodes,
      ...pages.map(p => p.storeCode),
      ...(packet?.executionStores || []).map((row: any) => String(row.storeCode || row.code || "").trim()),
      ...(packet?.challans || []).map((dc: any) => storeCodeFor(dc)),
    ].filter((value): value is string => Boolean(value))));
    for (const sc of storeCodes) {
      const masterStore = (packet?.stores || []).find((store: any) => String(store.storeCode || store.code || "") === sc);
      const storeLabel = pages.find(p => p.storeCode === sc)?.label?.split(" — ")[0] || masterStore?.name || sc || "Store";
      const storeMissing: string[] = [];
      if (!pages.some(p => p.storeCode === sc && p.kind === "wcc" && p.filePath)) storeMissing.push("Signed WCC");
      if (!pages.some(p => p.storeCode === sc && p.kind === "photo" && p.filePath)) storeMissing.push("Installation Photos");
      if (storeMissing.length) gaps.push({ store: storeLabel, missing: storeMissing });
    }
    return gaps;
  };

async function compressImageForPdf(buf: Uint8Array, mimeType: string, maxDimension = 1600, quality = 0.82): Promise<{ bytes: Uint8Array; isJpg: boolean }> {
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

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const binary = atob(dataUrl.split(",")[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, isJpg: true };
  } catch (err) {
    console.warn("Image compression fallback:", err);
    return { bytes: buf, isJpg: !mimeType.includes("png") };
  }
}

const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  const binary = atob(dataUrl.split(",")[1]);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

  const buildInvoicePacketPdf = async (scope: "all" | "invoice" = "all"): Promise<Blob> => {
    if (!packet) throw new Error("No invoice packet is loaded");
    const pdf = await PDFDocument.create();
    const A4_W = 595.28;
    const A4_H = 841.89;
    const MARGIN = 42;
    const PRINT_MARGIN = 20; // Exact A4 margins
    const PRINTABLE_W = A4_W - PRINT_MARGIN * 2;
    const PRINTABLE_H = A4_H - PRINT_MARGIN * 2;
    const PRINTABLE_CSS_W = STANDARD_PRINTABLE_CSS_WIDTH;

    const targetPages = scope === "invoice"
      ? pages.filter(p => p.kind === "invoice")
      : pages.filter(p => p.included);

    const addUnavailablePage = (label: string) => {
      const page = pdf.addPage([A4_W, A4_H]);
      page.drawRectangle({ x: MARGIN, y: 300, width: A4_W - MARGIN * 2, height: 180, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.8, 0.84, 0.88), borderWidth: 1 });
      page.drawText("DOCUMENT UNAVAILABLE", { x: MARGIN + 24, y: 405, size: 17, color: rgb(0.15, 0.2, 0.28) });
      page.drawText(fitText(label, 70), { x: MARGIN + 24, y: 375, size: 10, color: rgb(0.4, 0.45, 0.52) });
      page.drawText("The packet was generated without this missing attachment.", { x: MARGIN + 24, y: 345, size: 9, color: rgb(0.4, 0.45, 0.52) });
    };

    for (const p of targetPages) {
      try {
        if (p.storagePath) {
          if (!p.filePath) { addUnavailablePage(p.label); continue; }
          const res = await fetch(p.filePath);
          if (!res.ok) { addUnavailablePage(p.label); continue; }
          const buf = new Uint8Array(await res.arrayBuffer());
          let pathname = p.storagePath || p.filePath;
          try { pathname = decodeURIComponent(new URL(p.filePath).pathname); } catch { /* storage key */ }
          const contentType = String(p.mimeType || res.headers.get("content-type") || "").split(";")[0].toLowerCase();
          const isPdf = contentType === "application/pdf" || /\.pdf$/i.test(pathname);
          const isPng = contentType === "image/png" || /\.png$/i.test(pathname);
          const isJpg = contentType === "image/jpeg" || /\.(jpe?g)$/i.test(pathname);

          if (isPdf) {
            const srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
            const copied = await pdf.copyPages(srcDoc, srcDoc.getPageIndices());
            copied.forEach(page => pdf.addPage(page));
          } else if (isPng || isJpg) {
            const { bytes: compBytes, isJpg: compIsJpg } = await compressImageForPdf(buf, contentType || (isPng ? "image/png" : "image/jpeg"));
            const img = compIsJpg ? await pdf.embedJpg(compBytes) : await pdf.embedPng(compBytes);
            const maxW = A4_W - MARGIN * 2;
            const isPhoto = p.kind === "photo";
            const maxH = A4_H - (isPhoto ? 230 : MARGIN * 2);
            const scale = Math.min(maxW / img.width, maxH / img.height);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const page = pdf.addPage([A4_W, A4_H]);
            if (isPhoto) {
              page.drawText(
                fitText(`${p.storeName || "Store"} — ${p.storeCode || "—"}`, 72),
                { x: MARGIN, y: A4_H - 72, size: 13, color: rgb(0.08, 0.12, 0.18) },
              );
              if (p.caption) page.drawText(fitText(p.caption, 90), { x: MARGIN, y: 52, size: 9, color: rgb(0.35, 0.39, 0.45) });
            }
            page.drawImage(img, { x: (A4_W - drawW) / 2, y: isPhoto ? 70 + (maxH - drawH) / 2 : (A4_H - drawH) / 2, width: drawW, height: drawH });
          } else {
            throw new Error(`Unsupported packet file type: ${contentType || pathname}`);
          }
        } else {
          const pageContainer = document.querySelector(`[data-packet-page="${p.id}"]`) as HTMLElement | null;
          if (!pageContainer) throw new Error(`Missing rendered document page: ${p.label}`);

          const docEl = (pageContainer.querySelector(".invoice-print, .estimate-print") as HTMLElement) || pageContainer;
          const imgs = Array.from(docEl.querySelectorAll("img"));
          await Promise.all(imgs.map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(resolve, 800);
            });
          }));

          const prevScrollY = window.scrollY;
          const prevScrollX = window.scrollX;
          window.scrollTo(0, 0);

          const canvas = await html2canvas(docEl, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
            scrollX: 0,
            scrollY: 0,
          });

          window.scrollTo(prevScrollX, prevScrollY);

          const cW = canvas.width;
          const cH = canvas.height;
          const a4Aspect = PRINTABLE_H / PRINTABLE_W;
          const pageCanvasH = Math.round(cW * a4Aspect);
          const rawDrawH = PRINTABLE_W * (cH / cW);

          // Check if this document should be fitted onto a single page:
          // 1. User selected targetFitPages === 1 AND document height is reasonably within 1 page (<= 35% overflow)
          // 2. Document naturally fits on 1 page (<= 4% overflow)
          const shouldFitSinglePage = (targetFitPages === 1 && rawDrawH <= PRINTABLE_H * 1.35) || rawDrawH <= PRINTABLE_H * 1.04;

          if (shouldFitSinglePage) {
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
            const rowEls = Array.from(docEl.querySelectorAll("[data-pdf-row], .invoice-footer-block, .estimate-footer-block, .estimate-store-section"));
            const scaleFactor = cH / (docRect.height || 1);
            const rowBottoms = rowEls.map(el => {
              const r = el.getBoundingClientRect();
              return Math.round((r.bottom - docRect.top) * scaleFactor);
            }).filter(y => y > 0 && y < cH).sort((a, b) => a - b);

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
              const repeatH = (isContinuation && colHeaderCanvas) ? colHeaderH : 0;
              const availableContentH = pageCanvasH - repeatH;
              const remainingH = cH - currentY;

              if (remainingH <= availableContentH * 1.05) {
                slices.push({ startY: currentY, height: remainingH, isContinuation });
                break;
              }

              const targetSplitY = currentY + availableContentH;
              const candidate = rowBottoms.filter(b => b > currentY + availableContentH * 0.55 && b <= targetSplitY).pop();
              const splitY = candidate || targetSplitY;
              const sliceH = splitY - currentY;
              slices.push({ startY: currentY, height: sliceH, isContinuation });
              currentY = splitY;
            }

            for (const slice of slices) {
              const sliceRepeatH = (slice.isContinuation && colHeaderCanvas) ? colHeaderH : 0;
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
        }
      } catch (err) {
        console.warn(`[packet-pdf] Failed to add page ${p.label}:`, err);
        if (p.kind === "estimate" || p.kind === "invoice") throw err;
        addUnavailablePage(p.label);
      }
    }

    if (pdf.getPageCount() === 0) {
      throw new Error("No pages could be assembled into a PDF. Check that documents are loaded.");
    }

    pdf.setTitle(scope === "invoice" ? `Tax Invoice - ${packet.invoice?.invoiceNumber || selectedId}` : `Invoice Packet - ${packet.invoice?.invoiceNumber || selectedId}`);
    pdf.setAuthor("Sunrise Media");
    pdf.setCreator("Sunrise Media ERP");
    pdf.setProducer("Sunrise Media ERP");

    const pdfBytes = await pdf.save();
    return new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  };

  const runPacketAction = async (action: "download" | "print", force = false, scope: "all" | "invoice" = "all") => {
    if (!packet) return;
    if (scope === "all") {
      const gaps = computeMissing();
      if (gaps.length) {
        setMissingDocs(gaps);
      } else {
        setMissingDocs(null);
      }
    }

    // Open the print target during the user's click so popup protection does
    // not turn Print into a second DOM/CSS rendering path.
    const printWindow = action === "print" ? window.open("about:blank", "_blank") : null;
    if (printWindow) {
      printWindow.document.title = scope === "invoice" ? "Preparing invoice PDF…" : "Preparing invoice packet…";
      printWindow.document.body.textContent = scope === "invoice" ? "Preparing invoice PDF…" : "Preparing invoice packet…";
    }

    setBuilding(true);
    try {
      const blob = await buildInvoicePacketPdf(scope);
      const url = URL.createObjectURL(blob);
      if (action === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = scope === "invoice"
          ? `Invoice_${packet.invoice?.invoiceNumber || selectedId}.pdf`
          : `Invoice_Packet_${packet.invoice?.invoiceNumber || selectedId}.pdf`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (printWindow) {
        printWindow.location.replace(url);
        window.setTimeout(() => {
          try { printWindow.print(); } catch { /* PDF viewer owns print */ }
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }, 1000);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err: any) {
      printWindow?.close();
      alert("PDF generation failed: " + (err?.message || err));
    } finally {
      setBuilding(false);
    }
  };

  const included = pages.filter(p => p.included);

  if (pdfMode === "invoice" || pdfMode === "estimate") {
    return <div style={{ background: "white", padding: 0, margin: 0 }}>
      {!packet ? <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading…</div>
        : pdfMode === "invoice" ? <InvoicePacketDocument packet={packet} sellerProfile={sellerProfile} assetToken={token} />
        : <EstimatePacketPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
    </div>;
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="print:hidden">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Package className="w-7 h-7 text-orange-600" /> Invoice Packet Builder
        </h1>
        <p className="text-slate-500 text-sm mt-1">Select an invoice → auto-collect PO, estimate, DC, photos → generate one client-ready PDF.</p>
      </div>

      <div className="packet-layout grid grid-cols-1 lg:grid-cols-12 gap-6 print:block">
        {/* Sidebar: invoice picker + page list (hidden on print) */}
        <div className={`${fromUrl ? "lg:col-span-3" : "lg:col-span-4"} space-y-3 print:hidden`}>
          {!fromUrl && (
            <>
              <div className="glass-panel p-3 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / party" className="bg-transparent border-0 outline-none text-sm flex-1" />
              </div>

              <div className="glass-panel overflow-hidden max-h-[40vh] overflow-y-auto">
                {loading ? (
                  <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">No invoices</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filtered.map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => {
                          setSelectedId(inv.id);
                          const u = new URL(window.location.href);
                          u.searchParams.set("id", String(inv.id));
                          window.history.replaceState(null, "", u.toString());
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-slate-50 transition ${selectedId === inv.id ? "bg-orange-50" : ""}`}
                      >
                        <p className="font-mono text-xs font-bold">{inv.invoiceNumber}</p>
                        <p className="text-xs text-slate-600 truncate">{inv.partyName}</p>
                        <p className="text-xs text-slate-400">{formatCurrency(inv.totalAmount)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {packet && (
            <div className="glass-panel overflow-hidden">
              <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-700">Tax Invoice</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => runPacketAction("print", false, "invoice")}
                      disabled={building}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white text-xs font-semibold"
                      title="Print Tax Invoice (A4 Portrait)"
                    >
                      <Printer className="w-3 h-3" /> Print
                    </button>
                    <button
                      onClick={() => runPacketAction("download", false, "invoice")}
                      disabled={building}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold"
                      title="Download Tax Invoice PDF"
                    >
                      <FileDown className="w-3 h-3" /> Invoice PDF
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                  <span className="font-bold text-xs text-slate-700">Packet ({included.length})</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => runPacketAction("print", true, "all")}
                      disabled={building}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white text-xs font-semibold"
                      title="Print Invoice Packet (all pages)"
                    >
                      <Printer className="w-3 h-3" /> Print Packet
                    </button>
                    <button
                      onClick={() => runPacketAction("download", true, "all")}
                      disabled={building}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-xs font-semibold"
                      title="Generate a single client-ready PDF in submission order"
                    >
                      {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />} Packet PDF
                    </button>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                {pages.map((p, idx) => (
                  <div key={p.id} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 text-xs truncate" title={p.label}>{idx + 1}. {p.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main: packet preview */}
        <div className={`packet-preview-column ${fromUrl ? "lg:col-span-9" : "lg:col-span-8"} print:col-span-12`}>
          {!selectedId ? (
            <div className="glass-panel p-12 text-center text-slate-500 print:hidden">
              <Package className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              Select an invoice to assemble its packet.
            </div>
          ) : !packet ? (
            <div className="glass-panel p-8 text-center text-slate-500">Loading packet…</div>
          ) : (
            <div className="space-y-6 packet-print-root" data-print-document="true">
              {missingDocs && missingDocs.length > 0 && (
                <div className="glass-panel p-5 border border-amber-200 bg-amber-50 rounded-xl print:hidden">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-amber-900">Missing documents</h3>
                      <p className="text-xs text-amber-700 mt-1 mb-3">Review these gaps by store before creating the client handover.</p>
                      <ul className="grid gap-2 text-xs text-amber-900">
                        {missingDocs.map((g, i) => (
                          <li key={i} className="rounded-lg bg-white/70 border border-amber-200 p-3"><b className="block mb-1">{g.store}</b>{g.missing.map(item => <span key={item} className="block text-rose-700">✕ {item}</span>)}</li>
                        ))}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => runPacketAction("print", true, "all")} className="px-3 py-2 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" /> Print Anyway</button>
                        <button onClick={() => runPacketAction("download", true, "all")} className="px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1.5"><FileDown className="w-3.5 h-3.5" /> Generate Anyway</button>
                        <button onClick={() => window.location.href = packet.estimate?.id ? `/operations?estimateId=${packet.estimate.id}#documents` : "/operations#documents"} className="px-3 py-2 rounded-md border border-amber-300 bg-white text-amber-900 text-xs font-semibold">Go Upload Documents</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* Excel/Word-style Page Setup Toolbar */}
              <div className="glass-panel p-3 border border-slate-200 bg-slate-50/90 rounded-xl mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 tracking-wider">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-orange-600" />
                    <span>PAGE SETUP:</span>
                  </div>

                  {/* Scale Presets */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 px-1.5">Scale:</span>
                    {[100, 90, 85, 75, 70].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleUpdatePrintScale(s, true)}
                        className={`px-2 py-0.5 text-xs font-semibold rounded transition ${
                          printScale === s && targetFitPages === null
                            ? "bg-orange-500 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {s}%
                      </button>
                    ))}
                  </div>

                  {/* Quick Fit Presets */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleFitToPages(1)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition ${
                        targetFitPages === 1
                          ? "bg-orange-500 text-white border-orange-600 shadow-sm"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300"
                      }`}
                    >
                      Fit to 1 Page
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFitToPages(2)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition ${
                        targetFitPages === 2
                          ? "bg-orange-500 text-white border-orange-600 shadow-sm"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300"
                      }`}
                    >
                      Fit to 2 Pages
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFitToPages(3)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition ${
                        targetFitPages === 3
                          ? "bg-orange-500 text-white border-orange-600 shadow-sm"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300"
                      }`}
                    >
                      Fit to 3 Pages
                    </button>
                  </div>

                  {/* Density toggle */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 px-1.5">Density:</span>
                    <button
                      type="button"
                      onClick={() => handleUpdatePrintMode("normal")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded transition ${
                        printMode === "normal" ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      Normal
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePrintMode("compact")}
                      className={`px-2 py-0.5 text-xs font-semibold rounded transition ${
                        printMode === "compact" ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      Compact
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runPacketAction("print", true, "all")}
                    disabled={building}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-xs font-bold shadow-sm transition"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Packet ({targetFitPages ? `Fit to ${targetFitPages} Page${targetFitPages > 1 ? "s" : ""}` : `${printScale}%`})</span>
                  </button>
                </div>
              </div>

              {included.map((p, idx) => (
                <div key={p.id} className={`packet-page bg-white border border-slate-200 print:border-0 rounded-lg shadow-sm print:shadow-none ${idx < included.length - 1 ? "packet-page-break" : ""}`}>
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between print:hidden">
                    <span>Page {idx + 1}: {p.label}</span>
                    {p.kind === "invoice" && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => runPacketAction("print", false, "invoice")}
                          disabled={building}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <Printer className="w-3 h-3" /> Print Invoice
                        </button>
                        <button
                          onClick={() => runPacketAction("download", false, "invoice")}
                          disabled={building}
                          className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <FileDown className="w-3 h-3" /> Invoice PDF
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="p-6 print:p-0" data-packet-page={p.id}>
                    {p.kind === "invoice" && (
                      <div style={{ maxWidth: "800px", margin: "0 auto", overflowX: "auto" }}>
                        <InvoicePacketDocument packet={packet} sellerProfile={sellerProfile} assetToken={token} />
                      </div>
                    )}
                    {p.kind === "estimate" && (
                      <div style={{ maxWidth: "800px", margin: "0 auto", overflowX: "auto" }}>
                        <EstimatePacketPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />
                      </div>
                    )}
                    {(p.kind === "po" || p.kind === "project" || p.kind === "photo" || p.kind === "wcc" || p.kind === "store-file") && (
                      <DocumentPreview label={p.label} filePath={p.filePath} mimeType={p.mimeType} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const InvoicePacketDocument: React.FC<{ packet: PacketData; sellerProfile: any; assetToken?: string | null }> = ({ packet, sellerProfile, assetToken }) => <InvoiceDocument invoice={packet.invoice} estimate={packet.estimate} client={packet.client} sellerProfile={sellerProfile} assetToken={assetToken} products={packet.products || []} stores={packet.stores || []} />;

// Estimate page (inside a packet) — same A4 template, "Estimate" labeling.
const EstimatePacketPage: React.FC<{ packet: PacketData; sellerProfile: any; assetToken?: string | null }> = ({ packet, sellerProfile, assetToken }) => {
  const est = packet.estimate;
  if (!est) return <div className="text-center text-slate-500 text-sm">No estimate linked.</div>;
  return (
    <EstimateDocument
      estimate={est}
      items={packet.estimateItems || []}
      stores={packet.stores || []}
      clients={packet.clients || (packet.client ? [packet.client] : [])}
      products={packet.products || []}
      sellerProfile={sellerProfile}
      assetToken={assetToken}
    />
  );
};

const DocumentPreview: React.FC<{ label: string; filePath?: string | null; mimeType?: string | null }> = ({ label, filePath, mimeType }) => {
  if (!filePath) return <div className="text-center text-slate-500 text-sm p-4 border border-dashed border-slate-200 rounded">{label}: Document not found</div>;
  let pathname = filePath;
  try { pathname = decodeURIComponent(new URL(filePath).pathname); } catch { /* storage key */ }
  const isImage = Boolean(mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(pathname));
  const isPdf = Boolean(mimeType === "application/pdf" || /\.pdf$/i.test(pathname));
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase text-slate-500 mb-2 print:hidden">{label}</p>
      {isImage ? (
        <SafeImage src={filePath} alt={label} className="document-image max-h-[80vh] max-w-full object-contain mx-auto border border-slate-200 rounded" />
      ) : isPdf ? (
        <iframe
          src={filePath}
          title={label}
          className="w-full border border-slate-200 rounded doc-preview-frame"
          style={{ height: "80vh" }}
        />
      ) : (
        <a href={filePath} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline">
          Open {filePath.split("/").pop()}
        </a>
      )}
    </div>
  );
};

export default InvoicePacketPage;
