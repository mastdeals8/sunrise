import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Inbox, RefreshCw, CheckCircle, X, Link as LinkIcon, Image as ImageIcon, FileText, File, Search, Eye } from "lucide-react";

interface InboxItem {
  id: number;
  source: string;
  senderId: string;
  senderName: string | null;
  messageText: string | null;
  mediaUrl: string | null;
  mediaLocalPath: string | null;
  mediaType: string | null;
  uploadType: string | null;
  mappedClientId: number | null;
  mappedBrandId: number | null;
  mappedEstimateId: number | null;
  mappedDcId: number | null;
  mappedStoreId: number | null;
  status: string;
  remarks: string | null;
  createdAt: string;
}

interface Estimate { id: number; estimateNumber: string; subject: string | null; title: string }
interface Client { id: number; name: string }

const UPLOAD_TYPES = ["po", "photo", "signed_challan", "transport", "wcc", "extra"] as const;

const mediaIcon = (type: string | null) => {
  if (type === "photo") return <ImageIcon className="w-4 h-4 text-blue-500" />;
  if (type === "document") return <FileText className="w-4 h-4 text-orange-500" />;
  return <File className="w-4 h-4 text-slate-400" />;
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    unlinked: "bg-amber-50 text-amber-700 border-amber-200",
    mapped: "bg-green-50 text-green-700 border-green-200",
    ignored: "bg-slate-50 text-slate-500 border-slate-200",
  };
  return map[status] || "bg-slate-50 text-slate-600 border-slate-200";
};

const BotInbox: React.FC = () => {
  const { token } = useAuth();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("unlinked");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => { fetchItems(); fetchMaster(); }, [filterStatus]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const url = filterStatus ? `/api/bot-inbox?status=${filterStatus}` : "/api/bot-inbox";
      const r = await fetch(url, { headers });
      if (r.ok) setItems(await r.json());
    } finally { setLoading(false); }
  };

  const fetchMaster = async () => {
    const [er, cr] = await Promise.all([
      fetch("/api/operations/estimates", { headers }),
      fetch("/api/operations/clients", { headers }),
    ]);
    if (er.ok) setEstimates(await er.json());
    if (cr.ok) setClients(await cr.json());
  };

  const startEdit = (item: InboxItem) => {
    setEditing(item.id);
    setEditData({
      uploadType: item.uploadType || "extra",
      mappedClientId: item.mappedClientId || "",
      mappedEstimateId: item.mappedEstimateId || "",
      remarks: item.remarks || "",
      status: "mapped",
    });
  };

  const saveMapping = async (id: number) => {
    setSaving(true);
    try {
      const payload = {
        ...editData,
        mappedClientId: editData.mappedClientId ? Number(editData.mappedClientId) : null,
        mappedEstimateId: editData.mappedEstimateId ? Number(editData.mappedEstimateId) : null,
      };
      const r = await fetch(`/api/bot-inbox/${id}`, { method: "PATCH", headers, body: JSON.stringify(payload) });
      if (r.ok) {
        setEditing(null);
        fetchItems();
      }
    } finally { setSaving(false); }
  };

  const ignoreItem = async (id: number) => {
    await fetch(`/api/bot-inbox/${id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "ignored" }) });
    fetchItems();
  };

  const filtered = items.filter(it => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (it.senderName || "").toLowerCase().includes(q) ||
      it.senderId.toLowerCase().includes(q) ||
      (it.messageText || "").toLowerCase().includes(q) ||
      it.source.toLowerCase().includes(q)
    );
  });

  const counts = { unlinked: items.filter(i => i.status === "unlinked").length, mapped: items.filter(i => i.status === "mapped").length, ignored: items.filter(i => i.status === "ignored").length };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2 mb-1">
          <Inbox className="w-5 h-5 text-orange-500" />
          Bot Upload Inbox
        </h2>
        <p className="text-xs text-slate-500">
          Photos and documents received via Telegram or WhatsApp that haven't been linked to a project yet. Review and map each upload to the correct estimate or DC.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Unlinked", count: counts.unlinked, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
          { label: "Mapped", count: counts.mapped, color: "text-green-700", bg: "bg-green-50 border-green-200" },
          { label: "Ignored", count: counts.ignored, color: "text-slate-600", bg: "bg-slate-50 border-slate-200" },
        ].map(s => (
          <button key={s.label} onClick={() => setFilterStatus(s.label.toLowerCase())} className={`rounded-xl border p-4 text-left transition hover:shadow-sm ${filterStatus === s.label.toLowerCase() ? s.bg : "bg-white border-slate-200"}`}>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{s.label}</p>
            <p className={`text-2xl font-black ${s.color} font-mono mt-1`}>{s.count}</p>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search sender, message..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-orange-400"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 bg-white">
          <option value="">All</option>
          <option value="unlinked">Unlinked</option>
          <option value="mapped">Mapped</option>
          <option value="ignored">Ignored</option>
        </select>
        <button onClick={fetchItems} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-2 transition bg-white">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-semibold text-slate-400">No uploads in this category</p>
          <p className="text-xs text-slate-400 mt-1">Uploads from Telegram/WhatsApp bots appear here when received.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5">{mediaIcon(item.mediaType)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase border ${item.source === "telegram" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-green-50 text-green-700 border-green-200"}`}>{item.source}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase border ${statusBadge(item.status)}`}>{item.status}</span>
                    {item.uploadType && <span className="text-[10px] px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 font-bold">{item.uploadType}</span>}
                    <span className="text-[10px] text-slate-400 ml-auto">{new Date(item.createdAt).toLocaleString("en-IN")}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{item.senderName || item.senderId}</p>
                  {item.messageText && <p className="text-xs text-slate-500 mt-0.5 truncate">{item.messageText}</p>}
                  {item.mediaUrl && (
                    <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline mt-1">
                      <Eye className="w-3 h-3" /> View media
                    </a>
                  )}
                  {item.mappedEstimateId && (
                    <p className="text-xs text-green-700 mt-1 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Mapped to estimate #{item.mappedEstimateId}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {item.status !== "mapped" && (
                    <button onClick={() => startEdit(item)} className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 border border-orange-200 text-orange-700 text-[10px] font-black rounded hover:bg-orange-100 transition">
                      <LinkIcon className="w-3 h-3" /> Map
                    </button>
                  )}
                  {item.status === "unlinked" && (
                    <button onClick={() => ignoreItem(item.id)} className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-500 text-[10px] font-black rounded hover:bg-slate-100 transition">
                      <X className="w-3 h-3" /> Ignore
                    </button>
                  )}
                </div>
              </div>

              {/* Mapping form */}
              {editing === item.id && (
                <div className="border-t border-slate-100 bg-orange-50/30 px-4 py-4 space-y-3">
                  <p className="text-xs font-bold text-slate-700">Map this upload:</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Upload Type</label>
                      <select value={editData.uploadType} onChange={e => setEditData((d: any) => ({ ...d, uploadType: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                        {UPLOAD_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Client</label>
                      <select value={editData.mappedClientId} onChange={e => setEditData((d: any) => ({ ...d, mappedClientId: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                        <option value="">— Select client —</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Estimate</label>
                      <select value={editData.mappedEstimateId} onChange={e => setEditData((d: any) => ({ ...d, mappedEstimateId: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
                        <option value="">— Select estimate —</option>
                        {estimates.map(e => <option key={e.id} value={e.id}>{e.estimateNumber} — {e.subject || e.title}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Remarks</label>
                    <input type="text" value={editData.remarks} onChange={e => setEditData((d: any) => ({ ...d, remarks: e.target.value }))} placeholder="Optional notes..." className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveMapping(item.id)} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition disabled:opacity-50">
                      <CheckCircle className="w-3.5 h-3.5" /> {saving ? "Saving..." : "Save Mapping"}
                    </button>
                    <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-50 transition">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BotInbox;
