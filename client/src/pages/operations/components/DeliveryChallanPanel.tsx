import React, { useMemo, useState } from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { Edit3, Eye, Plus, Printer, Search, Trash2 } from "lucide-react";
import type { Client, DeliveryChallan, Estimate, Store } from "../types";
import { displayFormatLabel, isAblblFormat } from "../../../../../shared/textFormat";

interface DeliveryChallanPanelProps {
  challans: DeliveryChallan[];
  estimates: Estimate[];
  clients?: Client[];
  stores?: Store[];
  onEdit?: (dc: DeliveryChallan) => void;
  onPreview?: (dc: DeliveryChallan) => void;
  onPrint?: (dc: DeliveryChallan) => void;
  handleFileUpload?: (e: React.ChangeEvent<HTMLInputElement>, docType: string, customSetCallback: (path: string) => void) => void;
  handleUpdateDcFiles?: (dcId: number, field: string, filePath: string) => void;
  onCreate?: () => void;
  token?: string | null;
  reload?: () => void;
  initialFilter?: Filter;
}

type Filter = "all" | "normal" | "wcc";

const storeCodeForDc = (dc: DeliveryChallan) =>
  String((dc as any).storeCode || dc.metadata?.storeCode || dc.metadata?.storeId || dc.id || "").trim().toLowerCase();

const documentTypeForDc = (dc: DeliveryChallan) => {
  const explicit = String(dc.documentType || "").toLowerCase();
  if (explicit === "wcc") return "wcc";
  return isAblblFormat(dc.clientFormat) ? "wcc" : "dc";
};

const duplicateGroupKey = (dc: DeliveryChallan) =>
  `${dc.estimateId}|${storeCodeForDc(dc)}|${documentTypeForDc(dc)}`;

const createdTime = (dc: DeliveryChallan) => {
  const raw = (dc as any).createdAt || dc.deliveryDate || "";
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const latestWccIdsByGroup = (rows: DeliveryChallan[]) => {
  const map = new Map<string, DeliveryChallan>();
  rows.filter(dc => documentTypeForDc(dc) === "wcc").forEach((dc) => {
    const key = duplicateGroupKey(dc);
    const prev = map.get(key);
    if (!prev || createdTime(dc) > createdTime(prev) || (createdTime(dc) === createdTime(prev) && (dc.id || 0) > (prev.id || 0))) {
      map.set(key, dc);
    }
  });
  return new Set(Array.from(map.values()).map(dc => dc.id));
};

const DeliveryChallanPanel: React.FC<DeliveryChallanPanelProps> = ({
  challans,
  estimates,
  clients = [],
  stores = [],
  onEdit,
  onPreview,
  onPrint,
  handleFileUpload,
  handleUpdateDcFiles,
  onCreate,
  token,
  reload,
  initialFilter = "all",
}) => {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [search, setSearch] = useState("");

  const activeChallans = useMemo(
    () => challans.filter(c => c.status !== "deleted" && !c.metadata?.deleted),
    [challans],
  );

  const latestWccIds = useMemo(() => latestWccIdsByGroup(activeChallans), [activeChallans]);
  const duplicateWccRows = useMemo(
    () => activeChallans.filter(c => documentTypeForDc(c) === "wcc" && !latestWccIds.has(c.id)),
    [activeChallans, latestWccIds],
  );

  const counts = useMemo(() => ({
    all: activeChallans.length,
    normal: activeChallans.filter(c => documentTypeForDc(c) !== "wcc").length,
    wcc: activeChallans.filter(c => documentTypeForDc(c) === "wcc").length,
  }), [activeChallans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = activeChallans;
    if (filter === "normal") list = list.filter(c => documentTypeForDc(c) !== "wcc");
    else if (filter === "wcc") list = list.filter(c => documentTypeForDc(c) === "wcc");
    if (q) {
      list = list.filter(d => {
        const est = estimates.find(e => e.id === d.estimateId);
        const client = est ? clients.find(c => c.id === est.clientId) : null;
        return (d.dcNumber || "").toLowerCase().includes(q)
          || (est?.estimateNumber || "").toLowerCase().includes(q)
          || String(d.metadata?.storeCode || (d as any).storeCode || "").toLowerCase().includes(q)
          || (client?.name || "").toLowerCase().includes(q);
      });
    }
    return [...list].sort((a, b) => {
      const estSort = (a.estimateId || 0) - (b.estimateId || 0);
      if (estSort) return estSort;
      const storeSort = storeCodeForDc(a).localeCompare(storeCodeForDc(b));
      if (storeSort) return storeSort;
      return createdTime(a) - createdTime(b) || (a.id || 0) - (b.id || 0);
    });
  }, [activeChallans, filter, search, estimates, clients]);
  const dcPager = usePagedList(filtered, 25);

  const docLabel = filter === "wcc" ? "WCC No" : (filter === "normal" ? "DC No" : "DC / WCC No");

  const hardDelete = async (d: DeliveryChallan) => {
    if (!token) return;
    if (!confirm("Delete this WCC?")) return;
    const r = await fetch(`/api/operations/delivery-challans/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        status: "deleted",
        metadata: { ...(d.metadata || {}), deleted: true, deletedAt: new Date().toISOString() },
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.message || "Delete failed");
      return;
    }
    reload && reload();
  };

  const deleteDuplicateWccs = async () => {
    if (!token || duplicateWccRows.length === 0) return;
    if (!confirm(`Delete ${duplicateWccRows.length} duplicate WCC record${duplicateWccRows.length === 1 ? "" : "s"}? Latest WCC per estimate/store will remain active.`)) return;
    for (const d of duplicateWccRows) {
      const r = await fetch(`/api/operations/delivery-challans/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status: "deleted",
          metadata: { ...(d.metadata || {}), deleted: true, deletedAt: new Date().toISOString(), deletedReason: "duplicate_wcc_cleanup" },
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.message || `Delete failed for ${d.dcNumber}`);
        break;
      }
    }
    reload && reload();
  };

  return (
    <div className="space-y-3">
      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-600">Audit / History / Reprint</p>
          <h2 className="text-lg font-black text-slate-900">WCC Audit Register</h2>
          <p className="text-xs text-slate-500 mt-1">Search historical WCC/DC records, reprint documents, and review duplicate or deleted history. Daily execution work stays inside Project Workspace.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md border transition ${filter === "all" ? "bg-orange-50 text-orange-600 border-orange-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            All ({counts.all})
          </button>
          <button
            onClick={() => setFilter("normal")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md border transition ${filter === "normal" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            Normal DC ({counts.normal})
          </button>
          <button
            onClick={() => setFilter("wcc")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md border transition ${filter === "wcc" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          >
            ABLBL WCC ({counts.wcc})
          </button>
          <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search DC / estimate / client" className="bg-transparent outline-none text-xs w-56" />
          </div>
        </div>
        {onCreate && (
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-md transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Delivery Challan
          </button>
        )}
        {filter === "wcc" && duplicateWccRows.length > 0 && token && (
          <button
            onClick={deleteDuplicateWccs}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-md transition shadow-sm"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Duplicate WCCs ({duplicateWccRows.length})
          </button>
        )}
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-3 py-2">{docLabel}</th>
                <th className="px-3 py-2">Estimate</th>
                <th className="px-3 py-2">Store Code</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created Date</th>
                <th className="px-3 py-2">Active / Duplicate</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dcPager.slice.map((d) => {
                const est = estimates.find(e => e.id === d.estimateId);
                const store = stores.find(s => s.id === Number(d.metadata?.storeId || 0))
                  || (est ? stores.find(s => s.id === est.storeId) : null);
                const ablbl = documentTypeForDc(d) === "wcc";
                const isDuplicate = ablbl && !latestWccIds.has(d.id);
                return (
                  <tr key={d.id} id={`dc-${d.id}`} className={`hover:bg-slate-50/60 transition ${isDuplicate ? "bg-red-50/40" : ""}`}>
                    <td className="px-3 py-1.5">
                      <span className="font-mono font-bold text-orange-600">{d.dcNumber}</span>
                      <span className={`px-1.5 py-0.5 mt-0.5 inline-block rounded text-[9px] uppercase font-black border ${ablbl ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-blue-50 text-blue-700 border-blue-100"}`}>
                        {displayFormatLabel(d.clientFormat)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-slate-600">
                      {est ? est.estimateNumber : `#${d.estimateId}`}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 font-mono font-bold">
                      {d.metadata?.storeCode || (d as any).storeCode || store?.storeCode || "—"}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {d.metadata?.storeName || store?.name || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-black border bg-emerald-50 text-emerald-700 border-emerald-100">
                        {d.status === "completed" ? "Completed" : "Draft"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 font-mono">{(d as any).createdAt ? new Date((d as any).createdAt).toLocaleDateString("en-GB") : (d.deliveryDate ? new Date(d.deliveryDate).toLocaleDateString("en-GB") : "—")}</td>
                    <td className="px-3 py-1.5">
                      {ablbl ? (
                        <span className={`px-2 py-1 rounded-full border text-[10px] uppercase font-black ${isDuplicate ? "bg-red-100 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                          {isDuplicate ? "Duplicate" : "Active"}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-bold">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-center gap-1">
                        <button
                          onClick={() => onEdit && onEdit(d)}
                          className="inline-flex items-center gap-1 py-1 px-2 bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded hover:bg-slate-100 transition"
                        >
                          <Edit3 className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            onPreview && onPreview(d);
                          }}
                          className="inline-flex items-center gap-1 py-1 px-2 bg-orange-50 border border-orange-200 text-orange-600 font-bold rounded hover:bg-orange-100 transition"
                        >
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                        <button
                          onClick={() => onPrint && onPrint(d)}
                          className="inline-flex items-center gap-1 py-1 px-2 bg-purple-50 border border-purple-200 text-purple-700 font-bold rounded hover:bg-purple-100 transition"
                        >
                          <Printer className="w-3 h-3" />
                          Print
                        </button>
                        {token && (
                          <button title={`Delete ${d.dcNumber}`} onClick={() => hardDelete(d)} className="inline-flex items-center gap-1 py-1 px-2 bg-red-50 border border-red-200 text-red-700 font-bold rounded hover:bg-red-100 transition"><Trash2 className="w-3 h-3" />Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400 text-xs">
                    No {filter === "wcc" ? "WCC certificates" : filter === "normal" ? "delivery challans" : "documents"} yet. Create them from an estimate row.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager page={dcPager.page} pageSize={dcPager.pageSize} total={dcPager.total} onPageChange={dcPager.setPage} />
        </div>
      </div>
    </div>
  );
};

export default DeliveryChallanPanel;
