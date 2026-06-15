import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Briefcase, MapPin, CheckCircle, Clock, AlertTriangle, Camera, FileText,
  Search, ExternalLink, Printer, Copy, MessageCircle, Image as ImageIcon,
} from "lucide-react";
import { displayFormatLabel, isAblblFormat, normalizeDisplayName } from "../../../shared/textFormat";

interface Client { id: number; name: string; format?: string }
interface Brand  { id: number; name: string }
interface Store  { id: number; name: string; clientId: number; brandId: number; storeCode?: string | null; city?: string | null; state?: string | null; }
interface Estimate {
  id: number; estimateNumber: string; clientId: number; brandId: number; storeId: number;
  title: string; status: string; clientFormat: string; storeGrouping: any | null;
  poNumber?: string | null; abfrlProjectType?: string | null; totalAmount: number;
}
interface DC {
  id: number; estimateId: number; status: string; dcNumber: string; metadata: any;
  photoPath: string | null; signedChallanPath: string | null; storeCode?: string | null;
}
interface Invoice {
  id: number; estimateId: number | null; invoiceNumber: string; status: string;
  totalAmount: number; balanceAmount?: number; dueDate?: string;
}
interface StoreStatus {
  id: number; estimateId: number; storeCode: string; status: string; remarks: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  pending_execution: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  completed_pending_photos: "bg-amber-50 text-amber-800 border-amber-300",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  proof_received: "bg-emerald-50 text-emerald-700 border-emerald-200",
  blocked: "bg-red-50 text-red-700 border-red-200",
};

export default function JobsPage() {
  const { token } = useAuth();
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [challans, setChallans] = useState<DC[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [statuses, setStatuses] = useState<Record<number, StoreStatus[]>>({});
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterFormat, setFilterFormat] = useState("");
  const [reportEstId, setReportEstId] = useState<number | null>(null);
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const [eRes, cRes, bRes, sRes, dcRes, iRes] = await Promise.all([
        fetch("/api/operations/estimates", auth),
        fetch("/api/operations/clients", auth),
        fetch("/api/operations/brands", auth),
        fetch("/api/operations/stores", auth),
        fetch("/api/operations/delivery-challans", auth),
        fetch("/api/finance/invoices", auth),
      ]);
      setEstimates(eRes.ok ? await eRes.json() : []);
      setClients(cRes.ok ? await cRes.json() : []);
      setBrands(bRes.ok ? await bRes.json() : []);
      setStores(sRes.ok ? await sRes.json() : []);
      setChallans(dcRes.ok ? await dcRes.json() : []);
      setInvoices(iRes.ok ? await iRes.json() : []);
    })();
  }, [token, auth]);

  const loadStatusFor = async (eid: number) => {
    const r = await fetch(`/api/project-store-status/${eid}`, auth);
    if (r.ok) {
      const list = await r.json();
      setStatuses(prev => ({ ...prev, [eid]: list }));
    }
  };

  const updateStoreStatus = async (eid: number, storeCode: string, status: string, remarks?: string) => {
    await fetch(`/api/project-store-status/${eid}/${encodeURIComponent(storeCode)}`, {
      method: "PUT",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status, remarks: remarks ?? null }),
    });
    await loadStatusFor(eid);
  };

  const visible = useMemo(() => {
    return estimates.filter(e => {
      if (filterClient && String(e.clientId) !== filterClient) return false;
      if (filterFormat && e.clientFormat !== filterFormat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const cli = clients.find(c => c.id === e.clientId)?.name?.toLowerCase() ?? "";
        if (!e.estimateNumber.toLowerCase().includes(q) && !e.title?.toLowerCase().includes(q) && !cli.includes(q)) return false;
      }
      return true;
    });
  }, [estimates, filterClient, filterFormat, search, clients]);

  const clientName = (id: number) => normalizeDisplayName(clients.find(c => c.id === id)?.name) || "—";
  const brandName  = (id: number) => normalizeDisplayName(brands.find(b => b.id === id)?.name) || "—";

  // Derive per-store rows for an estimate. For ABFRL multi-store this uses
  // storeGrouping (object keyed by storeId). For normal estimates there is
  // just the single linked store.
  const storeRows = (est: Estimate) => {
    const rows: { storeId: number; storeCode: string; storeName: string; city: string }[] = [];
    const isAbfrl = isAblblFormat(est.clientFormat);
    if (isAbfrl && est.storeGrouping && typeof est.storeGrouping === "object") {
      for (const sid of Object.keys(est.storeGrouping)) {
        const s = stores.find(x => x.id === Number(sid));
        rows.push({
          storeId: Number(sid),
          storeCode: s?.storeCode || String(sid),
          storeName: s?.name || `Store #${sid}`,
          city: s?.city || "",
        });
      }
    } else {
      const s = stores.find(x => x.id === est.storeId);
      rows.push({ storeId: est.storeId, storeCode: s?.storeCode || String(est.storeId), storeName: s?.name || "—", city: s?.city || "" });
    }
    return rows;
  };

  // Auto-derived status from PO / DC / photo. Manual override (from statuses
  // map) wins.
  const deriveStatus = (est: Estimate, storeCode: string): string => {
    const manual = statuses[est.id]?.find(r => r.storeCode === storeCode);
    if (manual) return manual.status;
    const dc = challans.find(d =>
      d.estimateId === est.id &&
      (d.storeCode === storeCode || (d.metadata && (d.metadata as any).storeCode === storeCode))
    );
    if (!est.poNumber) return "pending";
    if (!dc) return "pending_execution";
    if (dc.photoPath) return "completed";
    if (dc.signedChallanPath) return "proof_received";
    return "completed_pending_photos";
  };

  const completionStats = (est: Estimate) => {
    const rows = storeRows(est);
    const total = rows.length;
    const completed = rows.filter(r => ["completed", "proof_received"].includes(deriveStatus(est, r.storeCode))).length;
    return { total, completed, pct: total ? Math.round((completed / total) * 100) : 0 };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-orange-600" /> Job Status Tracker
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-store completion %, signed-challan tracking, and one-click client report.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-2.5 flex flex-wrap items-center gap-2 text-xs">
        <Search className="w-3.5 h-3.5 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search estimate / client" className="bg-transparent border-0 outline-none flex-1 min-w-[160px]" />
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="input-compact w-auto">
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterFormat} onChange={e => setFilterFormat(e.target.value)} className="input-compact w-auto">
          <option value="">All formats</option>
          <option value="normal">Normal</option>
          <option value="ABLBL">ABLBL</option>
          <option value="ablbl_multi_store">ABLBL multi-store</option>
          <option value="ABFRL">ABFRL legacy</option>
          <option value="abfrl_multi_store">ABFRL legacy multi-store</option>
          <option value="letter_signage">Letter Signage</option>
        </select>
        <span className="text-slate-500 ml-auto">{visible.length} jobs</span>
      </div>

      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-md p-6 text-center text-slate-400 text-sm italic">
            No estimates match the current filter.
          </div>
        )}
        {visible.map(est => {
          const rows = storeRows(est);
          const stat = completionStats(est);
          const inv = invoices.find(i => i.estimateId === est.id);
          const cli = clients.find(c => c.id === est.clientId);
          const isExpanded = statuses[est.id] !== undefined;
          return (
            <div key={est.id} className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-xs text-slate-800">{est.estimateNumber}</span>
                  <span className="text-xs text-slate-600">{cli?.name}</span>
                  <span className="text-[10px] text-slate-400">— {brandName(est.brandId)}</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold uppercase rounded">{displayFormatLabel(est.clientFormat)}</span>
                  {est.abfrlProjectType && <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-[10px] font-bold uppercase rounded border border-purple-100">{est.abfrlProjectType}</span>}
                  {est.poNumber && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded border border-blue-100">PO: {est.poNumber}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-700">{stat.completed} / {stat.total}</span>
                    <span className="text-slate-400">stores</span>
                    <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${stat.pct}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700">{stat.pct}%</span>
                  </div>
                  {inv && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${inv.status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                      Inv: {inv.status}
                    </span>
                  )}
                  {!isExpanded ? (
                    <button onClick={() => loadStatusFor(est.id)} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold">
                      Stores
                    </button>
                  ) : (
                    <button onClick={() => setStatuses(prev => { const c = { ...prev }; delete c[est.id]; return c; })} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold">
                      Hide
                    </button>
                  )}
                  <button onClick={() => setReportEstId(est.id)} className="flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-[10px] font-bold">
                    <FileText className="w-3 h-3" /> Client Report
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold text-left">
                        <th className="px-2 py-1.5">Store Code</th>
                        <th className="px-2 py-1.5">Store Name</th>
                        <th className="px-2 py-1.5">City</th>
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5">DC / WCC</th>
                        <th className="px-2 py-1.5">Photo</th>
                        <th className="px-2 py-1.5">Signed Challan</th>
                        <th className="px-2 py-1.5 text-right">Override</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map(r => {
                        const dc = challans.find(d => d.estimateId === est.id && (d.storeCode === r.storeCode || (d.metadata && (d.metadata as any).storeCode === r.storeCode)));
                        const s = deriveStatus(est, r.storeCode);
                        return (
                          <tr key={r.storeId}>
                            <td className="px-2 py-1.5 font-mono text-[11px]">{r.storeCode}</td>
                            <td className="px-2 py-1.5">{r.storeName}</td>
                            <td className="px-2 py-1.5 text-slate-500">{r.city}</td>
                            <td className="px-2 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${STATUS_COLOR[s] || STATUS_COLOR.pending}`}>{s.replace(/_/g, " ")}</span>
                            </td>
                            <td className="px-2 py-1.5">{dc ? <span className="font-mono text-emerald-700 text-[10px]">{dc.dcNumber}</span> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-2 py-1.5">{dc?.photoPath ? <a href={`/${dc.photoPath}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1"><Camera className="w-3 h-3" /> View</a> : <span className="text-slate-300 flex items-center gap-1"><Camera className="w-3 h-3" /> —</span>}</td>
                            <td className="px-2 py-1.5">{dc?.signedChallanPath ? <a href={`/${dc.signedChallanPath}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-right">
                              <select
                                value={statuses[est.id]?.find(x => x.storeCode === r.storeCode)?.status || ""}
                                onChange={e => e.target.value && updateStoreStatus(est.id, r.storeCode, e.target.value)}
                                className="input-compact w-auto text-[10px]"
                              >
                                <option value="">Auto</option>
                                <option value="pending">Pending</option>
                                <option value="in_progress">In progress</option>
                                <option value="completed">Completed</option>
                                <option value="blocked">Blocked</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {reportEstId && (
        <CompletionReport
          estimate={estimates.find(e => e.id === reportEstId)!}
          client={clients.find(c => c.id === estimates.find(e => e.id === reportEstId)?.clientId)}
          brand={brands.find(b => b.id === estimates.find(e => e.id === reportEstId)?.brandId)}
          rows={storeRows(estimates.find(e => e.id === reportEstId)!)}
          challans={challans.filter(d => d.estimateId === reportEstId)}
          deriveStatus={(sc) => deriveStatus(estimates.find(e => e.id === reportEstId)!, sc)}
          onClose={() => setReportEstId(null)}
        />
      )}
    </div>
  );
}

const CompletionReport: React.FC<{
  estimate: Estimate;
  client?: Client;
  brand?: Brand;
  rows: { storeId: number; storeCode: string; storeName: string; city: string }[];
  challans: DC[];
  deriveStatus: (storeCode: string) => string;
  onClose: () => void;
}> = ({ estimate, client, brand, rows, challans, deriveStatus, onClose }) => {
  const [showCompletedOnly, setShowCompletedOnly] = useState(false);
  const today = new Date().toLocaleDateString("en-GB");

  const filteredRows = showCompletedOnly
    ? rows.filter(r => ["completed", "proof_received"].includes(deriveStatus(r.storeCode)))
    : rows;
  const completedCount = rows.filter(r => ["completed", "proof_received"].includes(deriveStatus(r.storeCode))).length;
  const pendingCount = rows.length - completedCount;

  const whatsappSummary = [
    `*Sunrise Media — ${client?.name || ""} ${brand?.name || ""} Job Update*`,
    `Project: ${estimate.title} (${estimate.estimateNumber})`,
    `PO: ${estimate.poNumber || "—"}`,
    `Date: ${today}`,
    ``,
    `✅ Completed: ${completedCount} / ${rows.length} stores`,
    `🕓 Pending:   ${pendingCount} stores`,
    ``,
    ...rows.map(r => {
      const st = deriveStatus(r.storeCode);
      const ok = ["completed", "proof_received"].includes(st);
      return `${ok ? "✅" : "🕓"} ${r.storeCode} — ${r.storeName}${r.city ? ` (${r.city})` : ""} [${st.replace(/_/g, " ")}]`;
    }),
  ].join("\n");

  const copySummary = async () => {
    await navigator.clipboard.writeText(whatsappSummary);
    alert("WhatsApp-ready summary copied to clipboard");
  };

  const printReport = () => window.print();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 print:bg-white print:p-0" onClick={onClose}>
      <div className="bg-white rounded-md shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto print:max-h-none print:rounded-none print:shadow-none print:max-w-full" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10 print:hidden">
          <h3 className="text-sm font-bold text-slate-800">Client Completion Report</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={showCompletedOnly} onChange={e => setShowCompletedOnly(e.target.checked)} /> Completed only
            </label>
            <button onClick={copySummary} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-md" title="Copy WhatsApp-formatted summary">
              <MessageCircle className="w-3.5 h-3.5" /> Copy WhatsApp
            </button>
            <button onClick={printReport} className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md">
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
            <button onClick={onClose} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Close</button>
          </div>
        </div>

        <div className="p-6 print:p-8" id="report-print">
          {/* Cover */}
          <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-orange-600">
            <div>
              <img src="/brand/logo.png" alt="Sunrise Media" className="h-10 mb-3" />
              <h1 className="text-xl font-bold text-slate-900">Installation Completion Report</h1>
              <p className="text-xs text-slate-500">{estimate.title}</p>
            </div>
            <div className="text-right text-xs text-slate-700 space-y-0.5">
              <p><b>Client:</b> {client?.name}</p>
              <p><b>Brand:</b> {brand?.name}</p>
              <p><b>Estimate:</b> {estimate.estimateNumber}</p>
              <p><b>PO:</b> {estimate.poNumber || "—"}</p>
              <p><b>Date:</b> {today}</p>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <SummaryBox label="Total stores" value={String(rows.length)} tone="slate" />
            <SummaryBox label="Completed" value={String(completedCount)} tone="emerald" />
            <SummaryBox label="Pending" value={String(pendingCount)} tone="amber" />
          </div>

          {/* Store pages */}
          <div className="space-y-4">
            {filteredRows.map(r => {
              const dc = challans.find(d => d.storeCode === r.storeCode || (d.metadata && (d.metadata as any).storeCode === r.storeCode));
              const st = deriveStatus(r.storeCode);
              return (
                <div key={r.storeId} className="border border-slate-200 rounded-md p-3 print:break-inside-avoid">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
                    <div>
                      <span className="font-mono font-bold text-sm text-slate-800">{r.storeCode}</span>
                      <span className="ml-2 text-sm text-slate-700">{r.storeName}</span>
                      {r.city && <span className="ml-1 text-xs text-slate-400">— {r.city}</span>}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${STATUS_COLOR[st] || STATUS_COLOR.pending}`}>{st.replace(/_/g, " ")}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase">DC / WCC</p>
                      <p className="font-mono text-slate-700">{dc?.dcNumber || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Installation photo</p>
                      {dc?.photoPath ? (
                        <img src={`/${dc.photoPath}`} alt="install" className="max-h-40 mt-1 border border-slate-200 rounded" />
                      ) : (
                        <p className="text-slate-300 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Pending</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Signed challan</p>
                      {dc?.signedChallanPath
                        ? <a href={`/${dc.signedChallanPath}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View signed proof</a>
                        : <p className="text-slate-300">Pending</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-6 pt-3 border-t border-slate-200 text-[10px] text-slate-400 text-center">
            Generated by Sunrise Media ERP — {today}. For accounting use only.
          </div>
        </div>
      </div>
      <style>{`@media print {
        body * { visibility: hidden; }
        #report-print, #report-print * { visibility: visible; }
        #report-print { position: absolute; left: 0; top: 0; width: 100%; }
      }`}</style>
    </div>
  );
};

const SummaryBox: React.FC<{ label: string; value: string; tone: "slate" | "emerald" | "amber" }> = ({ label, value, tone }) => {
  const cls = tone === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : tone === "amber" ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <div className={`border rounded-md px-3 py-2 ${cls}`}>
      <p className="text-[10px] font-bold uppercase">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
};
