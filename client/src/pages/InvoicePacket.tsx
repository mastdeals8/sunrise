import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { isAblblFormat } from "../../../shared/textFormat";
import { companyAssetUrl } from "../utils/companyAssets";
import { Package, Search, Printer, FileDown, ChevronUp, ChevronDown, Check, Loader2 } from "lucide-react";
import EstimateDocument from "../components/EstimateDocument";
import type { Client, Brand, Product, Store } from "./operations/types";
import { isBoltMode } from "../lib/supabase";
import { fetchInvoices, fetchCompanySettings, fetchEstimateById, fetchEstimateItems, fetchDeliveryChallansForEstimate, fetchPaymentsForInvoice, fetchClients, fetchStores, fetchProducts } from "../lib/api";

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
}

interface PacketPage {
  id: string;
  label: string;
  kind: "invoice" | "po" | "estimate" | "dc" | "photo" | "transport" | "extra";
  filePath?: string | null;
  included: boolean;
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
  const [generatingPdf, setGeneratingPdf] = useState(false);

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
          const [estimate, estimateItems, challans, payments, clients, stores, products] = await Promise.all([
            estimateId ? fetchEstimateById(token, estimateId) : Promise.resolve(null),
            estimateId ? fetchEstimateItems(token, estimateId) : Promise.resolve([]),
            estimateId ? fetchDeliveryChallansForEstimate(token, estimateId) : Promise.resolve([]),
            fetchPaymentsForInvoice(token, selectedId),
            fetchClients(token),
            fetchStores(token),
            fetchProducts(token),
          ]);
          const client = clients.find((c: any) => c.id === inv.clientId);
          data = { invoice: inv, estimate, estimateItems, challans, client, payments, stores, clients, products };
        } else {
          const res = await fetch(`/api/finance/invoice-packet/${selectedId}`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) data = await res.json();
        }
        if (data) {
          setPacket(data);
          const list: PacketPage[] = [];
          list.push({ id: "inv", label: "Invoice Front Page", kind: "invoice", included: true });
          if (data.estimate?.poFilePath) list.push({ id: "po", label: `Purchase Order (${data.estimate.poNumber || "PO"})`, kind: "po", filePath: data.estimate.poFilePath, included: true });
          if (data.estimate) list.push({ id: "est", label: `Estimate ${data.estimate.estimateNumber}`, kind: "estimate", included: true });
          (data.challans || []).forEach((c: any) => {
            list.push({ id: `dc-${c.id}`, label: `DC / WCC ${c.dcNumber}`, kind: "dc", included: true });
            if (c.signedChallanPath) list.push({ id: `dc-${c.id}-signed`, label: `Signed Challan (${c.dcNumber})`, kind: "extra", filePath: c.signedChallanPath, included: true });
            if (c.photoPath) list.push({ id: `dc-${c.id}-photo`, label: `Installation Photo (${c.dcNumber})`, kind: "photo", filePath: c.photoPath, included: true });
            if (c.transportReceiptPath) list.push({ id: `dc-${c.id}-trn`, label: `Transport Receipt (${c.dcNumber})`, kind: "transport", filePath: c.transportReceiptPath, included: true });
            if (c.extraDocPath) list.push({ id: `dc-${c.id}-extra`, label: `Extra Doc (${c.dcNumber})`, kind: "extra", filePath: c.extraDocPath, included: true });
          });
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

  const downloadPdf = async () => {
    if (!selectedId) return;
    if (isBoltMode) {
      window.print();
      return;
    }
    setGeneratingPdf(true);
    try {
      const res = await fetch(`/api/finance/invoice-packet/${selectedId}/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "PDF generation failed" }));
        alert(err.message || "PDF generation failed");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-packet-${selectedId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "PDF generation failed");
    } finally {
      setGeneratingPdf(false);
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
                    onClick={downloadPdf}
                    disabled={generatingPdf}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-xs font-semibold"
                    title={isBoltMode ? "Print / Save as PDF" : "Download full packet as a single PDF (includes all pages and attachments)"}
                  >
                    {generatingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
                    {generatingPdf ? "Building…" : isBoltMode ? "Print / PDF" : "Download PDF"}
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
            <div className="space-y-6" data-print-document="true">
              {included.map((p, idx) => (
                <div key={p.id} className="bg-white border border-slate-200 print:border-0 rounded-lg shadow-sm print:shadow-none print:break-after-page">
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between print:hidden">
                    <span>Page {idx + 1}: {p.label}</span>
                  </div>
                  <div className="p-6 print:p-8">
                    {p.kind === "invoice" && <InvoiceFrontPage packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
                    {p.kind === "estimate" && <EstimateSummary packet={packet} sellerProfile={sellerProfile} assetToken={token} />}
                    {p.kind === "dc" && <DcSummary packet={packet} dcId={parseInt(p.id.split("-")[1], 10)} sellerProfile={sellerProfile} assetToken={token} />}
                    {(p.kind === "po" || p.kind === "photo" || p.kind === "transport" || p.kind === "extra") && (
                      <DocumentPreview label={p.label} filePath={p.filePath} />
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
          .doc-preview-frame {
            height: 100vh !important;
            width: 100% !important;
            border: none !important;
            display: block;
          }
        }
      `}</style>
    </div>
  );
};

// Invoice front page — renders the shared A4 template with the linked
// estimate's items, but stamped with the invoice number/date and a TAX
// INVOICE banner. Falls back to a placeholder if no estimate is linked.
const InvoiceFrontPage: React.FC<{ packet: PacketData; sellerProfile: any; assetToken?: string | null }> = ({ packet, sellerProfile, assetToken }) => {
  const inv = packet.invoice;
  const est = packet.estimate;
  if (!est) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        <p className="font-semibold mb-2">Invoice {inv.invoiceNumber} has no linked estimate.</p>
        <p className="text-xs">Total: {formatCurrency(inv.totalAmount)} · Date: {inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</p>
        <p className="text-xs mt-2 italic">Link this invoice to an estimate to render the full TAX INVOICE document.</p>
      </div>
    );
  }
  return (
    <EstimateDocument
      estimate={est}
      items={packet.estimateItems || []}
      stores={packet.stores || []}
      clients={packet.clients || (packet.client ? [packet.client] : [])}
      products={packet.products || []}
      docKind="invoice"
      docNumber={inv.invoiceNumber}
      docDate={inv.date}
      subjectOverride={est.subject || est.title || inv.remarks || undefined}
      sellerProfile={sellerProfile}
      assetToken={assetToken}
    />
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

const DocumentPreview: React.FC<{ label: string; filePath?: string | null }> = ({ label, filePath }) => {
  if (!filePath) return <div className="text-center text-slate-500 text-sm p-4 border border-dashed border-slate-200 rounded">{label}: no file attached.</div>;
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(filePath);
  const isPdf = /\.pdf$/i.test(filePath);
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase text-slate-500 mb-2 print:hidden">{label}</p>
      {isImage ? (
        <img src={filePath} alt={label} className="max-h-[80vh] mx-auto border border-slate-200 rounded print:max-h-none print:w-full" />
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
