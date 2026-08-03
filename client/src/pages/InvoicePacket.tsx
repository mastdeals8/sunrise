import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { isAblblFormat } from "../../../shared/textFormat";
import { isServiceLineType } from "./operations/utils/estimateCalculations";
import { companyAssetUrl } from "../utils/companyAssets";
import { Package, Search, Printer, Loader as Loader2, FileDown, TriangleAlert as AlertTriangle } from "lucide-react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import html2canvas from "html2canvas";
import EstimateDocument from "../components/EstimateDocument";
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
  caption?: string | null;
  included: boolean;
}

const fitText = (value: unknown, max = 80) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const SafeImage: React.FC<React.ImgHTMLAttributes<HTMLImageElement> & { fallback?: string }> = ({ fallback = "Image unavailable", ...props }) => {
  const [failed, setFailed] = useState(!props.src);
  if (failed) return <div className="flex items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-slate-500 text-xs rounded p-6">{fallback}</div>;
  return <img {...props} onError={(event) => { props.onError?.(event); setFailed(true); }} />;
};

const docTypeLabel = (type: string) => ({
  photo: "Installation Photos", installation_photo: "Installation Photos", execution_photo: "Completion Photos",
  completion_photo: "Completion Photos", additional_photo: "Additional Photos",
  signed_wcc: "Signed WCC", signed_dc: "Signed Delivery Challan", transport_receipt: "Transport Receipt",
  lr_copy: "LR Copy", courier_receipt: "Courier Receipt", gate_pass: "Gate Pass", eway_bill: "E-Way Bill",
  extra: "Other Project Document", field_upload: "Project Document", client_po: "Purchase Order", po: "Purchase Order",
} as Record<string, string>)[type] || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

const storeCodeFor = (value: any) => String(value?.storeCode || value?.metadata?.storeCode || "").trim();
const isPhotoType = (type: string) => ["photo", "installation_photo", "execution_photo", "completion_photo", "additional_photo"].includes(type);
const isSignedType = (type: string) => ["signed_wcc", "signed_dc"].includes(type);
const isPoType = (type: string) => ["po", "client_po"].includes(type);
// wcc_photo is the unsigned WCC photo captured in the field — not wanted in the client packet.
// The client packet only includes the signed WCC that was stamped and uploaded.
const isExcludedType = (type: string) => ["wcc", "wcc_photo"].includes(type);
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


const amountInWords = (num: number): string => {
  if (!num) return "Zero";
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const n = Math.floor(num);
  if (n.toString().length > 9) return "Overflow";
  const padded = ('000000000' + n).slice(-9);
  const m = padded.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!m) return "";
  let str = "";
  str += (Number(m[1]) !== 0) ? (a[Number(m[1])] || b[Number(m[1][0])] + ' ' + a[Number(m[1][1])]) + 'Crore ' : '';
  str += (Number(m[2]) !== 0) ? (a[Number(m[2])] || b[Number(m[2][0])] + ' ' + a[Number(m[2][1])]) + 'Lakh ' : '';
  str += (Number(m[3]) !== 0) ? (a[Number(m[3])] || b[Number(m[3][0])] + ' ' + a[Number(m[3][1])]) + 'Thousand ' : '';
  str += (Number(m[4]) !== 0) ? (a[Number(m[4])] || b[Number(m[4][0])] + ' ' + a[Number(m[4][1])]) + 'Hundred ' : '';
  str += (Number(m[5]) !== 0) ? ((str !== "") ? 'and ' : '') + (a[Number(m[5])] || b[Number(m[5][0])] + ' ' + a[Number(m[5][1])]) : '';
  return str.trim() + " Only";
};

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
  // pdfMode is the value of ?pdfMode= URL param: "invoice" | "estimate" | null
  const [pdfMode, setPdfMode] = useState<string | null>(null);

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
      setPacket(null); setPages([]);
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
          setPacket(data);
          const estimateId = Number(data.estimate?.id || 0);
          const docs = (data.executionDocuments || []).filter((d: any) => d.status !== "deleted" && d.status !== "replaced");
          const seen = new Set<string>();
          const list: PacketPage[] = [{ id: "inv", label: "Client Billing Invoice", kind: "invoice", included: true }];
          const byUploadTime = (a: any, b: any) => new Date(a.uploadedAt || a.createdAt || 0).getTime() - new Date(b.uploadedAt || b.createdAt || 0).getTime();
          const addFile = async (page: Omit<PacketPage, "included">) => {
            const raw = String(page.storagePath || page.filePath || "");
            if (!raw || seen.has(raw)) return;
            seen.add(raw);
            const signed = await signPacketDocument({ ...page, included: true }, estimateId);
            if (signed) list.push(signed);
          };

          // Prefer the Estimate's PO reference, then fall back to the active PO
          // upload row used by the existing documents workflow.
          const poUpload = docs.filter((doc: any) => isPoType(doc.documentType)).sort(byUploadTime)[0];
          const poStoragePath = data.estimate?.poFilePath || poUpload?.storagePath || poUpload?.filePath;
          if (poStoragePath) await addFile({ id: "po", label: `Purchase Order (${data.estimate?.poNumber || "PO"})`, kind: "po", storagePath: poStoragePath, mimeType: poUpload?.mimeType });
          if (data.estimate) list.push({ id: "est", label: `Estimate ${data.estimate.estimateNumber}`, kind: "estimate", included: true });

          // Project-level uploads sit after the Estimate and before store
          // execution. Preserve the same order in which users uploaded them.
          const projectDocs = docs
            .filter((doc: any) => !isPoType(doc.documentType) && !isExcludedType(doc.documentType) && !isSignedType(doc.documentType) && !isPhotoType(doc.documentType) && !isStoreScopeDoc(doc))
            .sort(byUploadTime);
          const legacyProjectDocs = (data.challans || []).flatMap((dc: any) => [
            dc.transportReceiptPath && { id: `legacy-transport-${dc.id}`, documentType: "transport_receipt", storagePath: dc.transportReceiptPath, createdAt: dc.createdAt },
            dc.extraDocPath && { id: `legacy-extra-${dc.id}`, documentType: "extra", storagePath: dc.extraDocPath, createdAt: dc.createdAt },
          ]).filter(Boolean).sort(byUploadTime) as any[];
          for (const doc of [...projectDocs, ...legacyProjectDocs].sort(byUploadTime)) {
            await addFile({
              id: `project-${doc.id}`,
              label: docTypeLabel(doc.documentType),
              kind: "project",
              storagePath: doc.storagePath || doc.filePath,
              mimeType: doc.mimeType,
              caption: doc.caption || doc.description || doc.notes || null,
            });
          }

          // Order stores by execution-workflow order (the order they were added to the
          // project), never alphabetical. Fall back to challan id for legacy data.
          const execOrder = new Map<string, number>();
          (data.executionStores || []).forEach((s: any, i: number) => {
            const code = String(s.code || s.storeCode || "");
            if (code) execOrder.set(code, i);
          });
          const challans = [...(data.challans || [])].sort((a: any, b: any) => {
            const oa = execOrder.get(storeCodeFor(a));
            const ob = execOrder.get(storeCodeFor(b));
            if (oa !== undefined && ob !== undefined) return oa - ob;
            if (oa !== undefined) return -1;
            if (ob !== undefined) return 1;
            return Number(a.id) - Number(b.id);
          });
          const storeContexts: { storeCode: string; challans: any[] }[] = [];
          const ensureStore = (storeCode: string) => {
            if (!storeCode || storeContexts.some(row => row.storeCode === storeCode)) return;
            storeContexts.push({ storeCode, challans: challans.filter(dc => storeCodeFor(dc) === storeCode) });
          };
          [...(data.executionStores || [])]
            .sort((a: any, b: any) => Number(a.id || 0) - Number(b.id || 0))
            .forEach((row: any) => ensureStore(String(row.storeCode || row.code || "").trim()));
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
            ) && !isPoType(d.documentType) && !isExcludedType(d.documentType));
            const legacy = context.challans.flatMap((dc: any) => [
              dc.signedChallanPath && { id: `legacy-signed-${dc.id}`, documentType: isAblblFormat(dc.clientFormat) ? "signed_wcc" : "signed_dc", storagePath: dc.signedChallanPath },
              dc.photoPath && { id: `legacy-photo-${dc.id}`, documentType: "photo", storagePath: dc.photoPath },
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
            for (const doc of ordered) await addFile({
              id: `exec-${doc.id}`,
              label: `${storeLabel} — ${docTypeLabel(doc.documentType)}`,
              kind: isPhotoType(doc.documentType) ? "photo" : isSignedType(doc.documentType) ? "wcc" : "store-file",
              storagePath: doc.storagePath || doc.filePath,
              mimeType: doc.mimeType,
              storeCode,
              caption: doc.caption || doc.description || doc.notes || null,
            });
          }
          setPages(list);
        }
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [selectedId, token, invoices]);

  // Signal playwright that the page is ready for PDF capture.
  // Only fires when pdfMode is "invoice" or "estimate" and packet data is loaded.
  useEffect(() => {
    if (pdfMode && packet && sellerProfile) {
      // Wait for fonts + images to settle before signalling playwright
      const t = setTimeout(() => {
        document.documentElement.setAttribute("data-pdf-ready", "true");
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [pdfMode, packet, sellerProfile]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(i => i.invoiceNumber.toLowerCase().includes(q) || i.partyName.toLowerCase().includes(q));
  }, [invoices, search]);

  const doPrint = () => window.print();

  const [building, setBuilding] = useState(false);
  const [missingDocs, setMissingDocs] = useState<{ store: string; missing: string[] }[] | null>(null);

  const computeMissing = (): { store: string; missing: string[] }[] => {
    const gaps: { store: string; missing: string[] }[] = [];
    const coreMissing: string[] = [];
    if (!packet?.invoice) coreMissing.push("Invoice");
    if (!pages.some(p => p.kind === "po" && p.filePath)) coreMissing.push("Purchase Order");
    if (!pages.some(p => p.kind === "estimate")) coreMissing.push("Estimate");
    if (coreMissing.length) gaps.push({ store: "Project-level", missing: coreMissing });
    const storeCodes = Array.from(new Set([
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

  const generateInvoicePacket = async (force = false) => {
    if (!packet) return;
    const gaps = computeMissing();
    if (gaps.length && !force) {
      setMissingDocs(gaps);
      return;
    }
    setMissingDocs(null);
    setBuilding(true);
    try {
      const pdf = await PDFDocument.create();
      const A4_W = 595.28;
      const A4_H = 841.89;
      const MARGIN = 42;
      const invNum = packet.invoice?.invoiceNumber || String(selectedId);

      const addUnavailablePage = (label: string) => {
        const page = pdf.addPage([A4_W, A4_H]);
        page.drawRectangle({ x: MARGIN, y: 300, width: A4_W - MARGIN * 2, height: 180, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.8, 0.84, 0.88), borderWidth: 1 });
        page.drawText("DOCUMENT UNAVAILABLE", { x: MARGIN + 24, y: 405, size: 17, color: rgb(0.15, 0.2, 0.28) });
        page.drawText(fitText(label, 70), { x: MARGIN + 24, y: 375, size: 10, color: rgb(0.4, 0.45, 0.52) });
        page.drawText("The packet was generated without this missing attachment.", { x: MARGIN + 24, y: 345, size: 9, color: rgb(0.4, 0.45, 0.52) });
      };

      for (const p of included) {
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
              const img = isPng ? await pdf.embedPng(buf) : await pdf.embedJpg(buf);
              const maxW = A4_W - MARGIN * 2;
              // WCC scans are preserved as captured; photo pages reserve room
              // for the document type and optional field caption.
              const isPhoto = p.kind === "photo";
              const maxH = A4_H - (isPhoto ? 190 : MARGIN * 2);
              const scale = Math.min(maxW / img.width, maxH / img.height);
              const drawW = img.width * scale;
              const drawH = img.height * scale;
              const page = pdf.addPage([A4_W, A4_H]);
              const [storeName, documentType = p.kind === "photo" ? "Installation Photograph" : "Signed Work Completion Certificate"] = p.label.split(" — ");
              if (isPhoto) {
                page.drawText(fitText(storeName, 52).toUpperCase(), { x: MARGIN, y: A4_H - 72, size: 18, color: rgb(0.08, 0.12, 0.18) });
                page.drawText(documentType, { x: MARGIN, y: A4_H - 98, size: 11, color: rgb(0.85, 0.3, 0.07) });
                if (p.caption) page.drawText(fitText(p.caption, 90), { x: MARGIN, y: 52, size: 9, color: rgb(0.35, 0.39, 0.45) });
              }
              page.drawImage(img, { x: (A4_W - drawW) / 2, y: isPhoto ? 70 + (maxH - drawH) / 2 : (A4_H - drawH) / 2, width: drawW, height: drawH });
            } else {
              throw new Error(`Unsupported packet file type: ${contentType || pathname}`);
            }
          } else {
            const el = document.querySelector(`[data-packet-page="${p.id}"]`) as HTMLElement | null;
            if (!el) continue;
            const canvas = await html2canvas(el, {
              scale: 3,
              useCORS: true,
              backgroundColor: "#ffffff",
              logging: false,
              windowWidth: 794,
              onclone: (doc: Document) => {
                const node = doc.querySelector(`[data-packet-page="${p.id}"]`) as HTMLElement | null;
                if (!node) return;
                node.style.width = "794px";
                node.style.padding = "0";
                node.style.margin = "0";
                node.style.maxWidth = "none";
                node.style.overflow = "visible";
                const sheet = node.querySelector(".a4-sheet") as HTMLElement | null;
                if (sheet) { sheet.style.width = "794px"; sheet.style.minHeight = "1123px"; }
              },
            });
            const pngBytes = canvas.toDataURL("image/png");
            const img = await pdf.embedPng(pngBytes);
            const scale = Math.min(A4_W / img.width, A4_H / img.height);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            const page = pdf.addPage([A4_W, A4_H]);
            page.drawImage(img, { x: (A4_W - drawW) / 2, y: A4_H - drawH, width: drawW, height: drawH });
          }
        } catch (err) {
          console.warn(`[packet-pdf] Failed to add page ${p.label}:`, err);
          addUnavailablePage(p.label);
        }
      }

      if (pdf.getPageCount() === 0) {
        alert("No pages could be assembled into a PDF. Check that documents are loaded.");
        return;
      }

      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const pageCount = pdf.getPageCount();
      pdf.getPages().forEach((page, index) => {
        const pageLabel = `Page ${index + 1} of ${pageCount}`;
        page.drawText(pageLabel, { x: A4_W - MARGIN - regular.widthOfTextAtSize(pageLabel, 7), y: 14, size: 7, font: regular, color: rgb(0.4, 0.44, 0.5) });
      });
      const pdfBytes = await pdf.save();
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice_Packet_${invNum}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Invoice Packet generation failed: " + (err?.message || err));
    } finally {
      setBuilding(false);
    }
  };

  const included = pages.filter(p => p.included);

  // pdfMode: playwright renders this route.
  // "invoice" → render ONLY the Tax Invoice component (InvoiceFrontPage)
  // "estimate" → render ONLY the Estimate component (EstimateSummary)
  // Nothing else — no sidebar, no file previews, no DC summaries.
  if (pdfMode === "invoice" || pdfMode === "estimate") {
    return (
      <div style={{ background: "white", padding: "0", margin: "0" }}>
        {!packet ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>Loading…</div>
        ) : pdfMode === "invoice" ? (
          <InvoiceFrontPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />
        ) : (
          <EstimatePacketPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="print:hidden">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Package className="w-7 h-7 text-orange-600" /> Invoice Packet Builder
        </h1>
        <p className="text-slate-500 text-sm mt-1">Select an invoice → auto-collect PO, estimate, DC, photos → generate one client-ready PDF.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:block">
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
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                <h3 className="font-bold text-sm shrink-0">Packet Pages ({included.length})</h3>
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={doPrint} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">
                    <Printer className="w-3 h-3" /> Print
                  </button>
                  <button
                    onClick={() => generateInvoicePacket()}
                    disabled={building}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-xs font-semibold"
                    title="Generate a single client-ready PDF in submission order"
                  >
                    {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
                    Generate Invoice Packet
                  </button>
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
        <div className={`${fromUrl ? "lg:col-span-9" : "lg:col-span-8"} print:col-span-12`}>
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
                      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => generateInvoicePacket(true)} className="px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">Generate Anyway</button><button onClick={() => window.location.href = packet.estimate?.id ? `/operations?estimateId=${packet.estimate.id}#documents` : "/operations#documents"} className="px-3 py-2 rounded-md border border-amber-300 bg-white text-amber-900 text-xs font-semibold">Go Upload Documents</button></div>
                    </div>
                  </div>
                </div>
              )}
              {included.map((p, idx) => (
                <div key={p.id} className={`packet-page bg-white border border-slate-200 print:border-0 rounded-lg shadow-sm print:shadow-none ${idx < included.length - 1 ? "packet-page-break" : ""}`}>
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between print:hidden">
                    <span>Page {idx + 1}: {p.label}</span>
                  </div>
                  <div className="p-6 print:p-0" data-packet-page={p.id}>
                    {p.kind === "invoice" && <InvoiceFrontPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
                    {p.kind === "estimate" && <EstimatePacketPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
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

      <style>{`
        @media print {
          body { background: white !important; }
          aside, header, nav, .print\\:hidden { display: none !important; }
          .packet-print-root { margin: 0 !important; padding: 0 !important; }
          .packet-page { width: 100% !important; min-height: 279mm !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
          .packet-page-break { break-after: page !important; page-break-after: always !important; }
          .a4-sheet { width: 100% !important; min-height: 270mm !important; }
          .doc-preview-frame {
            height: 270mm !important;
            width: 100% !important;
            border: none !important;
            display: block;
          }
          .document-image { width: 100% !important; height: 270mm !important; object-fit: contain !important; }
        }
        .a4-sheet { width: 210mm; min-height: 297mm; padding: 12mm; box-sizing: border-box; }
        .invoice-lines { border-collapse: collapse; }
        .invoice-lines th, .invoice-lines td { border: 1px solid #cbd5e1; padding: 6px; text-align: center; vertical-align: top; }
        .invoice-lines th { background: #f1f5f9; font-weight: 800; }
        @media print { .invoice-lines thead { display: table-header-group; } .invoice-lines tr { break-inside: avoid; page-break-inside: avoid; } }
        .summary-table > div { display: flex; justify-content: space-between; gap: 16px; padding: 5px 8px; border: 1px solid #cbd5e1; border-bottom: 0; }
        .summary-table > div:last-child { border-bottom: 1px solid #cbd5e1; }
        .summary-table .grand { font-size: 14px; background: #f1f5f9; border-top: 2px solid #0f172a; }
      `}</style>
    </div>
  );
};

const InvoiceFrontPage: React.FC<{ packet: PacketData; sellerProfile: any; assetToken?: string | null }> = ({ packet, sellerProfile, assetToken }) => {
  const inv = packet.invoice;
  const est = packet.estimate;
  // The client invoice deliberately uses the approved Estimate descriptions.
  // Invoice totals/tax remain authoritative; no internal invoice costing fields
  // are rendered or used to construct the visible commercial lines.
  const lines = (packet.estimateItems?.length ? packet.estimateItems : (inv.lineItems || [])).filter((r: any) => !isServiceLineType(r.lineType)) as any[];
  const taxable = Number(inv.amount ?? lines.reduce((sum, row) => sum + Number(row.amount ?? row.totalPrice ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
  const totalTax = Number(inv.taxAmount ?? Math.max(0, Number(inv.totalAmount || 0) - taxable));
  const estIgst = Number(est?.igstAmount || 0);
  const igst = estIgst > 0 ? totalTax : 0;
  const cgst = igst ? 0 : Number(est?.cgstAmount ?? totalTax / 2);
  const sgst = igst ? 0 : Number(est?.sgstAmount ?? totalTax - cgst);
  const beforeRound = taxable + cgst + sgst + igst;
  const roundOff = Number((Number(inv.totalAmount || beforeRound) - beforeRound).toFixed(2));
  const companyName = sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media";
  const logoSrc = companyAssetUrl(sellerProfile?.logoPath, assetToken);
  return (
    <article className="gst-invoice a4-sheet bg-white text-slate-900 mx-auto">
      <header className="flex justify-between gap-6 border-b-2 border-slate-900 pb-4">
        <div className="flex gap-3 items-start">
          <SafeImage src={logoSrc} alt={companyName} className="h-14 w-auto max-w-[180px] object-contain" fallback={companyName} />
          <div><h1 className="text-lg font-black uppercase">{companyName}</h1><p className="text-[10px] whitespace-pre-line">{sellerProfile?.address || sellerProfile?.registeredAddress || ""}</p><p className="text-[10px]">GSTIN: {sellerProfile?.gstin || "—"}</p></div>
        </div>
        <div className="text-right"><h2 className="text-2xl font-black tracking-widest">INVOICE</h2><p className="font-mono font-bold mt-2">{inv.invoiceNumber}</p><p className="text-xs">Date: {inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</p></div>
      </header>
      <section className="grid grid-cols-2 gap-6 py-4 border-b border-slate-300 text-xs">
        <div><p className="text-[10px] uppercase font-bold text-slate-500">Bill To</p><p className="font-bold text-sm">{inv.partyName}</p><p className="whitespace-pre-line">{est?.billingAddressSnapshot || packet.client?.address || ""}</p><p>GSTIN: {est?.billingGstinSnapshot || packet.client?.gstin || "—"}</p></div>
        <div className="grid grid-cols-2 gap-x-3 content-start"><span className="text-slate-500">PO Number</span><b>{inv.poNumber || est?.poNumber || "—"}</b><span className="text-slate-500">Due Date</span><b>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}</b><span className="text-slate-500">Place of Supply</span><b>{est?.billingStateSnapshot || packet.client?.state || "—"}</b></div>
      </section>
      <table className="w-full text-[11px] invoice-lines mt-4">
        <thead><tr><th>Sr.</th><th className="text-left">Product Name</th><th className="text-left">Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>{lines.map((row, index) => {
          const qty = Number(row.quantity || 0); const rate = Number(row.rate || 0); const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
          return <tr key={row.id || index}><td>{index + 1}</td><td className="text-left font-semibold">{row.itemName || row.productName || "Item"}</td><td className="text-left whitespace-pre-wrap">{row.description || "—"}</td><td>{qty}</td><td>{row.unit || "Nos"}</td><td className="text-right">{formatCurrency(rate)}</td><td className="text-right font-semibold">{formatCurrency(amount)}</td></tr>;
        })}</tbody>
      </table>
      <section className="ml-auto mt-4 w-full max-w-sm text-xs summary-table">
        <div><span>Subtotal</span><b>{formatCurrency(taxable)}</b></div>
        {cgst > 0 && <div><span>CGST</span><b>{formatCurrency(cgst)}</b></div>}
        {sgst > 0 && <div><span>SGST</span><b>{formatCurrency(sgst)}</b></div>}
        {igst > 0 && <div><span>IGST</span><b>{formatCurrency(igst)}</b></div>}
        {roundOff !== 0 && <div><span>Round Off</span><b>{formatCurrency(roundOff)}</b></div>}
        <div className="grand"><span>Grand Total</span><b>{formatCurrency(inv.totalAmount || beforeRound + roundOff)}</b></div>
      </section>
      <p className="mt-4 border-t border-slate-300 pt-3 text-xs"><b>Amount in words:</b> {amountInWords(inv.totalAmount || 0)}</p>
      {inv.remarks && <p className="mt-2 text-xs"><b>Remarks:</b> {inv.remarks}</p>}
      <footer className="mt-12 text-right text-xs"><p>For <b>{companyName.toUpperCase()}</b></p><div className="h-12"/><p className="font-bold">Authorised Signatory</p></footer>
    </article>
  );
};

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
