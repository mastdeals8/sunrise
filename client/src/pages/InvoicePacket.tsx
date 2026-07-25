import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { isAblblFormat } from "../../../shared/textFormat";
import { companyAssetUrl } from "../utils/companyAssets";
import { Package, Search, Printer, ChevronUp, ChevronDown, Check, Download } from "lucide-react";
import EstimateDocument from "../components/EstimateDocument";
import type { Client, Brand, Product, Store } from "./operations/types";
import { isBoltMode } from "../lib/supabase";
import { fetchInvoices, fetchCompanySettings, fetchEstimateById, fetchEstimateItems, fetchDeliveryChallansForEstimate, fetchPaymentsForInvoice, fetchClients, fetchStores, fetchProducts, fetchExecutionDocuments, getExecutionDocumentSignedUrl, openExecutionDocument } from "../lib/api";

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
}

interface PacketPage {
  id: string;
  label: string;
  kind: "invoice" | "po" | "estimate" | "dc" | "photo" | "transport" | "extra";
  filePath?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  storeCode?: string | null;
  included: boolean;
}

const docTypeLabel = (type: string) => ({
  photo: "Installation Photo", installation_photo: "Installation Photo", execution_photo: "Execution Photo",
  signed_wcc: "Signed WCC", signed_dc: "Signed Delivery Challan", transport_receipt: "Transport Receipt",
  lr_copy: "LR Copy", courier_receipt: "Courier Receipt", gate_pass: "Gate Pass", eway_bill: "E-Way Bill",
  extra: "Other Project Document", field_upload: "Project Document", client_po: "Purchase Order", po: "Purchase Order",
} as Record<string, string>)[type] || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

const storeCodeFor = (value: any) => String(value?.storeCode || value?.metadata?.storeCode || "").trim();
const isProjectScope = (value: any) => ["", "misc", "project", "all"].includes(storeCodeFor(value).toLowerCase());
const isPhotoType = (type: string) => ["photo", "installation_photo", "execution_photo", "wcc_photo"].includes(type);
const isPoType = (type: string) => ["po", "client_po"].includes(type);
const isSignedType = (type: string) => ["signed_wcc", "signed_dc"].includes(type);

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
          const [estimate, estimateItems, challans, payments, clients, stores, products, executionDocuments] = await Promise.all([
            estimateId ? fetchEstimateById(token, estimateId) : Promise.resolve(null),
            estimateId ? fetchEstimateItems(token, estimateId) : Promise.resolve([]),
            estimateId ? fetchDeliveryChallansForEstimate(token, estimateId) : Promise.resolve([]),
            fetchPaymentsForInvoice(token, selectedId),
            fetchClients(token),
            fetchStores(token),
            fetchProducts(token),
            estimateId ? fetchExecutionDocuments(token, estimateId) : Promise.resolve([]),
          ]);
          const client = clients.find((c: any) => c.id === inv.clientId);
          data = { invoice: inv, estimate, estimateItems, challans, client, payments, stores, clients, products, executionDocuments };
        } else {
          const res = await fetch(`/api/finance/invoice-packet/${selectedId}`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) data = await res.json();
        }
        if (data) {
          setPacket(data);
          const estimateId = Number(data.estimate?.id || 0);
          const docs = (data.executionDocuments || []).filter((d: any) => d.status !== "deleted" && d.status !== "replaced");
          const seen = new Set<string>();
          const list: PacketPage[] = [{ id: "inv", label: "1. Invoice", kind: "invoice", included: true }];
          const addFile = async (page: Omit<PacketPage, "included">) => {
            const raw = String(page.storagePath || page.filePath || "");
            if (!raw || seen.has(raw)) return;
            seen.add(raw);
            const signed = await signPacketDocument({ ...page, included: true }, estimateId);
            if (signed) list.push(signed);
          };

          if (data.estimate?.poFilePath) await addFile({ id: "po", label: `2. Purchase Order (${data.estimate.poNumber || "PO"})`, kind: "po", storagePath: data.estimate.poFilePath });
          if (data.estimate) list.push({ id: "est", label: `3. Estimate ${data.estimate.estimateNumber}`, kind: "estimate", included: true });

          // Project-level documents retain upload order and precede store execution.
          const activeStoreCodes = new Set((data.challans || []).map(storeCodeFor).filter(Boolean));
          const projectDocs = docs.filter((d: any) => !isPoType(d.documentType) && !d.deliveryChallanId && (isProjectScope(d) || !activeStoreCodes.has(storeCodeFor(d))));
          for (const doc of [...projectDocs].sort((a: any, b: any) => new Date(a.uploadedAt || a.createdAt).getTime() - new Date(b.uploadedAt || b.createdAt).getTime())) {
            await addFile({ id: `doc-${doc.id}`, label: docTypeLabel(doc.documentType), kind: "extra", storagePath: doc.storagePath || doc.filePath, mimeType: doc.mimeType });
          }

          const challans = [...(data.challans || [])].sort((a: any, b: any) => storeCodeFor(a).localeCompare(storeCodeFor(b)) || Number(a.id) - Number(b.id));
          for (const dc of challans) {
            const storeCode = storeCodeFor(dc);
            const store = (data.stores || []).find((s: any) => String(s.code || s.storeCode || "") === storeCode);
            const storeLabel = store?.name ? `${store.name}${storeCode ? ` (${storeCode})` : ""}` : (storeCode || "Project");
            list.push({ id: `dc-${dc.id}`, label: `${storeLabel} — DC / WCC ${dc.dcNumber}`, kind: "dc", storeCode, included: true });
            const owned = docs.filter((d: any) => Number(d.deliveryChallanId) === Number(dc.id) || (storeCode && storeCodeFor(d) === storeCode));
            const legacy = [
              dc.signedChallanPath && { id: `legacy-signed-${dc.id}`, documentType: isAblblFormat(dc.clientFormat) ? "signed_wcc" : "signed_dc", storagePath: dc.signedChallanPath },
              dc.photoPath && { id: `legacy-photo-${dc.id}`, documentType: "photo", storagePath: dc.photoPath },
              dc.transportReceiptPath && { id: `legacy-transport-${dc.id}`, documentType: "transport_receipt", storagePath: dc.transportReceiptPath },
              dc.extraDocPath && { id: `legacy-extra-${dc.id}`, documentType: "extra", storagePath: dc.extraDocPath },
            ].filter(Boolean) as any[];
            const ordered = [...owned, ...legacy].sort((a: any, b: any) => {
              const rank = (d: any) => isSignedType(d.documentType) ? 0 : isPhotoType(d.documentType) ? 1 : 2;
              return rank(a) - rank(b) || new Date(a.uploadedAt || a.createdAt).getTime() - new Date(b.uploadedAt || b.createdAt).getTime();
            });
            for (const doc of ordered) await addFile({ id: `exec-${doc.id}`, label: `${storeLabel} — ${docTypeLabel(doc.documentType)}`, kind: isPhotoType(doc.documentType) ? "photo" : "extra", storagePath: doc.storagePath || doc.filePath, mimeType: doc.mimeType, storeCode });
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

  const togglePage = (id: string) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, included: !p.included } : p));
  };
  const movePage = (id: string, dir: -1 | 1) => {
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const doPrint = () => window.print();

  const downloadPage = (page: PacketPage) => {
    if (page.storagePath && packet?.estimate?.id) {
      void openExecutionDocument(page.storagePath, true, packet.estimate.id, page.kind === "po").catch(error => alert(page.kind === "po" ? "Purchase Order not found" : error.message));
    } else if (page.kind === "invoice" || page.kind === "estimate") {
      const url = new URL(window.location.href);
      url.searchParams.set("pdfMode", page.kind);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } else {
      alert("Use Print Packet and select this page to save the generated document as PDF.");
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
          <EstimateSummary packet={packet} sellerProfile={sellerProfile} assetToken={token} />
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
        <p className="text-slate-500 text-sm mt-1">Select an invoice → auto-collect PO, estimate, DC, photos → reorder, include/exclude → print.</p>
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

          {/* Page list with include/reorder */}
          {packet && (
            <div className="glass-panel overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                <h3 className="font-bold text-sm shrink-0">Packet Pages ({included.length})</h3>
                <div className="flex gap-1.5">
                  <button onClick={doPrint} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200">
                    <Printer className="w-3 h-3" /> Print
                  </button>
                  <button
                    onClick={() => document.getElementById("packet-download-list")?.scrollIntoView({ behavior: "smooth" })}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold"
                    title="Download packet documents individually"
                  >
                    <Download className="w-3 h-3" />
                    Download Documents
                  </button>
                </div>
              </div>
              <div className="divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
                {pages.map((p, idx) => (
                  <div key={p.id} className="px-3 py-2 flex items-center gap-2">
                    <button onClick={() => togglePage(p.id)} className={`w-5 h-5 rounded border flex items-center justify-center ${p.included ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300"}`}>
                      {p.included && <Check className="w-3 h-3" />}
                    </button>
                    <div className="flex-1 text-xs truncate" title={p.label}>{idx + 1}. {p.label}</div>
                    <button onClick={() => movePage(p.id, -1)} className="text-slate-400 hover:text-slate-900"><ChevronUp className="w-3 h-3" /></button>
                    <button onClick={() => movePage(p.id, 1)} className="text-slate-400 hover:text-slate-900"><ChevronDown className="w-3 h-3" /></button>
                    <button onClick={() => downloadPage(p)} title={`Download ${p.label}`} className="text-blue-500 hover:text-blue-800"><Download className="w-3 h-3" /></button>
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
              {included.map((p, idx) => (
                <div key={p.id} className={`packet-page bg-white border border-slate-200 print:border-0 rounded-lg shadow-sm print:shadow-none ${idx < included.length - 1 ? "packet-page-break" : ""}`}>
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between print:hidden">
                    <span>Page {idx + 1}: {p.label}</span>
                  </div>
                  <div className="p-6 print:p-0">
                    {p.kind === "invoice" && <InvoiceFrontPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
                    {p.kind === "estimate" && <EstimateSummary packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
                    {p.kind === "dc" && <DcSummary packet={packet} dcId={parseInt(p.id.split("-")[1], 10)} sellerProfile={sellerProfile} assetToken={token} />}
                    {(p.kind === "po" || p.kind === "photo" || p.kind === "transport" || p.kind === "extra") && (
                      <DocumentPreview label={p.label} filePath={p.filePath} mimeType={p.mimeType} isPurchaseOrder={p.kind === "po"} />
                    )}
                  </div>
                </div>
              ))}
              <div id="packet-download-list" className="print:hidden bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="font-bold text-sm">Download Documents</h3>
                <p className="text-xs text-slate-500 mb-3">Original files use verified keys and fresh signed URLs. Generated ERP pages open in the same A4 print pipeline.</p>
                <div className="grid sm:grid-cols-2 gap-2">{included.map(page => <button key={`download-${page.id}`} onClick={() => downloadPage(page)} className="text-left px-3 py-2 border rounded text-xs hover:bg-slate-50 flex items-center gap-2"><Download className="w-3 h-3 text-blue-600"/><span className="truncate">{page.label}</span></button>)}</div>
              </div>
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
  const lines = (inv.lineItems?.length ? inv.lineItems : packet.estimateItems || []) as any[];
  const taxable = Number(inv.amount ?? lines.reduce((sum, row) => sum + Number(row.amount ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
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
          {logoSrc && <img src={logoSrc} alt={companyName} className="h-14 w-auto max-w-[180px] object-contain" />}
          <div><h1 className="text-lg font-black uppercase">{companyName}</h1><p className="text-[10px] whitespace-pre-line">{sellerProfile?.address || sellerProfile?.registeredAddress || ""}</p><p className="text-[10px]">GSTIN: {sellerProfile?.gstin || "—"}</p></div>
        </div>
        <div className="text-right"><h2 className="text-2xl font-black tracking-widest">TAX INVOICE</h2><p className="font-mono font-bold mt-2">{inv.invoiceNumber}</p><p className="text-xs">Date: {inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</p></div>
      </header>
      <section className="grid grid-cols-2 gap-6 py-4 border-b border-slate-300 text-xs">
        <div><p className="text-[10px] uppercase font-bold text-slate-500">Bill To</p><p className="font-bold text-sm">{inv.partyName}</p><p className="whitespace-pre-line">{est?.billingAddressSnapshot || packet.client?.address || ""}</p><p>GSTIN: {est?.billingGstinSnapshot || packet.client?.gstin || "—"}</p></div>
        <div className="grid grid-cols-2 gap-x-3 content-start"><span className="text-slate-500">PO Number</span><b>{inv.poNumber || est?.poNumber || "—"}</b><span className="text-slate-500">Due Date</span><b>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}</b><span className="text-slate-500">Place of Supply</span><b>{est?.billingStateSnapshot || packet.client?.state || "—"}</b></div>
      </section>
      <table className="w-full text-[11px] invoice-lines mt-4">
        <thead><tr><th>#</th><th>Product Code</th><th className="text-left">Product Description</th><th>HSN</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>{lines.map((row, index) => {
          const qty = Number(row.quantity || 0); const rate = Number(row.rate || 0); const amount = Number(row.amount ?? qty * rate);
          return <tr key={row.id || index}><td>{index + 1}</td><td>{row.productCode || row.materialCode || row.itemCode || "—"}</td><td className="text-left"><b>{row.itemName || row.productName || "Item"}</b>{row.description && <div className="font-normal whitespace-pre-wrap mt-0.5">{row.description}</div>}</td><td>{row.hsn || row.hsnCode || "—"}</td><td>{qty}</td><td>{row.unit || "Nos"}</td><td className="text-right">{formatCurrency(rate)}</td><td className="text-right font-semibold">{formatCurrency(amount)}</td></tr>;
        })}</tbody>
      </table>
      <section className="ml-auto mt-4 w-full max-w-sm text-xs summary-table">
        <div><span>Taxable Value</span><b>{formatCurrency(taxable)}</b></div>
        {cgst > 0 && <div><span>CGST</span><b>{formatCurrency(cgst)}</b></div>}
        {sgst > 0 && <div><span>SGST</span><b>{formatCurrency(sgst)}</b></div>}
        {igst > 0 && <div><span>IGST</span><b>{formatCurrency(igst)}</b></div>}
        <div><span>Round Off</span><b>{formatCurrency(roundOff)}</b></div>
        <div className="grand"><span>Grand Total</span><b>{formatCurrency(inv.totalAmount || beforeRound + roundOff)}</b></div>
      </section>
      <p className="mt-4 border-t border-slate-300 pt-3 text-xs"><b>Amount in words:</b> {amountInWords(inv.totalAmount || 0)}</p>
      {inv.remarks && <p className="mt-2 text-xs"><b>Remarks:</b> {inv.remarks}</p>}
      <footer className="mt-12 text-right text-xs"><p>For <b>{companyName.toUpperCase()}</b></p><div className="h-12"/><p className="font-bold">Authorised Signatory</p></footer>
    </article>
  );
};

// Estimate page (inside a packet) — same A4 template, "Estimate" labeling.
const EstimateSummary: React.FC<{ packet: PacketData; sellerProfile: any; assetToken?: string | null }> = ({ packet, sellerProfile, assetToken }) => {
  const est = packet.estimate;
  if (!est) return <div className="text-center text-slate-500 text-sm">No estimate linked.</div>;
  return (
    <EstimateDocument
      estimate={est}
      items={packet.estimateItems || []}
      stores={packet.stores || []}
      clients={packet.clients || (packet.client ? [packet.client] : [])}
      products={packet.products || []}
      docKind="estimate"
      sellerProfile={sellerProfile}
      assetToken={assetToken}
    />
  );
};

const DcSummary: React.FC<{ packet: PacketData; dcId: number; sellerProfile: any; assetToken?: string | null }> = ({ packet, dcId, sellerProfile, assetToken }) => {
  const dc = packet.challans.find(c => c.id === dcId);
  if (!dc) return <div className="text-center text-slate-500">DC not found.</div>;
  const isWcc = isAblblFormat(dc.clientFormat);
  const companyName = sellerProfile?.name || "Sunrise Media";
  const logoSrc = companyAssetUrl(sellerProfile?.logoPath, assetToken);
  const signatureStampSrc = companyAssetUrl(sellerProfile?.signatureStampPath, assetToken);
  return (
    <div className="text-slate-900 text-sm">
      <div className="border-b-2 border-orange-600 pb-2 mb-3 flex items-center justify-between">
        {logoSrc ? (
          <img src={logoSrc} alt={companyName} className="h-7 w-auto max-w-[180px] object-contain" />
        ) : (
          <div className="text-sm font-black uppercase">{companyName}</div>
        )}
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">
          {isWcc ? "Work Completion Certificate" : "Delivery Challan"}
        </h2>
      </div>
      <h2 className="text-lg font-bold mb-2">
        {isWcc ? "WORK COMPLETION CERTIFICATE" : "DELIVERY CHALLAN"}: <span className="font-mono">{dc.dcNumber}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
        <div><span className="text-slate-500">Date:</span> {dc.deliveryDate ? new Date(dc.deliveryDate).toLocaleDateString("en-GB") : "—"}</div>
        <div><span className="text-slate-500">Status:</span> {dc.status}</div>
        <div><span className="text-slate-500">Delivered By:</span> {dc.deliveredBy || "—"}</div>
        <div><span className="text-slate-500">Received By:</span> {dc.receivedBy || "—"}</div>
      </div>
      {dc.remarks && <p className="text-xs text-slate-600 mb-2"><b>Remarks:</b> {dc.remarks}</p>}
      <p className="text-xs text-slate-500 italic">Signed challan, install photos, transport receipts attached as following pages.</p>
      <div className="mt-6 text-right text-xs">
        <div className="font-bold">For {companyName.toUpperCase()}</div>
        <div className="h-14 flex items-center justify-end">
          {signatureStampSrc && <img src={signatureStampSrc} alt="Signature and stamp" className="max-h-12 max-w-[150px] object-contain" />}
        </div>
        <div className="font-bold">Authorised Signatory</div>
      </div>
    </div>
  );
};

const DocumentPreview: React.FC<{ label: string; filePath?: string | null; mimeType?: string | null; isPurchaseOrder?: boolean }> = ({ label, filePath, mimeType, isPurchaseOrder }) => {
  if (!filePath) return <div className="text-center text-slate-500 text-sm p-4 border border-dashed border-slate-200 rounded">{isPurchaseOrder ? "Purchase Order not found" : `${label}: Document not found`}</div>;
  let pathname = filePath;
  try { pathname = decodeURIComponent(new URL(filePath).pathname); } catch { /* storage key */ }
  const isImage = Boolean(mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(pathname));
  const isPdf = Boolean(mimeType === "application/pdf" || /\.pdf$/i.test(pathname));
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase text-slate-500 mb-2 print:hidden">{label}</p>
      {isImage ? (
        <img src={filePath} alt={label} className="document-image max-h-[80vh] max-w-full object-contain mx-auto border border-slate-200 rounded" />
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
