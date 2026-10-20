import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Inbox,
  RefreshCw,
  CheckCircle,
  X,
  Link as LinkIcon,
  Image as ImageIcon,
  FileText,
  File,
  Search,
  Eye,
  MessageCircle,
  Send,
  Store,
  UserCheck,
} from "lucide-react";

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

interface Estimate {
  id: number;
  estimateNumber: string;
  subject: string | null;
  title: string;
}
interface Client {
  id: number;
  name: string;
}

const UPLOAD_TYPES = ["po", "photo", "signed_challan", "transport", "wcc", "extra"] as const;

const mediaIcon = (type: string | null) => {
  if (type === "photo") return <ImageIcon className="w-4 h-4 text-emerald-500" />;
  if (type === "document") return <FileText className="w-4 h-4 text-blue-500" />;
  if (type === "text") return <MessageCircle className="w-4 h-4 text-emerald-600" />;
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

  // Quick WhatsApp Reply state
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState<{ id: number; ok: boolean; msg: string } | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    fetchItems();
    fetchMaster();
  }, [filterStatus]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const url = filterStatus ? `/api/bot-inbox?status=${filterStatus}` : "/api/bot-inbox";
      const r = await fetch(url, { headers });
      if (r.ok) setItems(await r.json());
    } finally {
      setLoading(false);
    }
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
    } finally {
      setSaving(false);
    }
  };

  const ignoreItem = async (id: number) => {
    await fetch(`/api/bot-inbox/${id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "ignored" }) });
    fetchItems();
  };

  const handleSendReply = async (item: InboxItem) => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    setReplyFeedback(null);
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: item.senderId,
          text: replyText.trim(),
        }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setReplyFeedback({ id: item.id, ok: true, msg: "Reply sent via WhatsApp!" });
        setReplyText("");
        setTimeout(() => {
          setReplyingTo(null);
          setReplyFeedback(null);
        }, 2500);
      } else {
        setReplyFeedback({ id: item.id, ok: false, msg: data.message || "Failed to send reply." });
      }
    } catch (e: any) {
      setReplyFeedback({ id: item.id, ok: false, msg: e.message || "Network error" });
    } finally {
      setSendingReply(false);
    }
  };

  const filtered = items.filter((it) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (it.senderName || "").toLowerCase().includes(q) ||
      it.senderId.toLowerCase().includes(q) ||
      (it.messageText || "").toLowerCase().includes(q) ||
      it.source.toLowerCase().includes(q) ||
      (it.remarks || "").toLowerCase().includes(q)
    );
  });

  const counts = {
    unlinked: items.filter((i) => i.status === "unlinked").length,
    mapped: items.filter((i) => i.status === "mapped").length,
    ignored: items.filter((i) => i.status === "ignored").length,
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-slate-800 text-xl flex items-center gap-2 mb-1">
            <Inbox className="w-6 h-6 text-emerald-600" />
            WhatsApp & Bot Inbox
          </h2>
          <p className="text-xs text-slate-500">
            Incoming WhatsApp messages, store photos, and documents received by Sunrise Media ERP. Map them to clients,
            estimates, or delivery challans.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Unlinked", count: counts.unlinked, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
          { label: "Mapped", count: counts.mapped, color: "text-green-700", bg: "bg-green-50 border-green-200" },
          { label: "Ignored", count: counts.ignored, color: "text-slate-600", bg: "bg-slate-50 border-slate-200" },
        ].map((s) => (
          <button
            key={s.label}
            onClick={() => setFilterStatus(s.label.toLowerCase())}
            className={`rounded-2xl border p-4 text-left transition hover:shadow-sm ${
              filterStatus === s.label.toLowerCase() ? s.bg : "bg-white border-slate-200"
            }`}
          >
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
            placeholder="Search sender, message, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white"
        >
          <option value="">All Statuses</option>
          <option value="unlinked">Unlinked</option>
          <option value="mapped">Mapped</option>
          <option value="ignored">Ignored</option>
        </select>
        <button
          onClick={fetchItems}
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl px-3.5 py-2 transition bg-white font-bold"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 text-xs">
          Loading messages...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Inbox className="w-12 h-12 mx-auto mb-3 text-slate-200" />
          <p className="text-sm font-bold text-slate-500">No messages in this view</p>
          <p className="text-xs text-slate-400 mt-1">
            Incoming WhatsApp messages and media will appear here automatically when received.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition overflow-hidden"
            >
              <div className="px-5 py-4 flex items-start gap-4">
                <div className="mt-1 p-2 bg-slate-50 rounded-xl border border-slate-100">{mediaIcon(item.mediaType)}</div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border flex items-center gap-1 ${
                        item.source === "whatsapp"
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-blue-50 text-blue-700 border-blue-200"
                      }`}
                    >
                      {item.source === "whatsapp" && <MessageCircle className="w-3 h-3" />}
                      {item.source}
                    </span>

                    <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${statusBadge(item.status)}`}>
                      {item.status}
                    </span>

                    {item.uploadType && (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
                        {item.uploadType.replace("_", " ")}
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400 font-mono ml-auto">
                      {new Date(item.createdAt).toLocaleString("en-IN")}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{item.senderName || item.senderId}</p>
                    {item.senderId && (
                      <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        +{item.senderId.replace(/^\+/, "")}
                      </span>
                    )}
                  </div>

                  {item.messageText && (
                    <p className="text-xs text-slate-700 mt-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      {item.messageText}
                    </p>
                  )}

                  {item.mediaUrl && (
                    <div className="mt-2">
                      <a
                        href={item.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:text-emerald-800 font-bold bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Attached Media
                      </a>
                    </div>
                  )}

                  {/* Auto-matching or linked notes */}
                  {item.remarks && (
                    <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1.5 font-medium">
                      <UserCheck className="w-3.5 h-3.5" /> {item.remarks}
                    </p>
                  )}

                  {item.mappedEstimateId && (
                    <p className="text-xs text-slate-600 mt-1 flex items-center gap-1 font-mono">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Mapped to Estimate #{item.mappedEstimateId}
                    </p>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  {item.source === "whatsapp" && (
                    <button
                      onClick={() => {
                        setReplyingTo(replyingTo === item.id ? null : item.id);
                        setReplyText("");
                        setReplyFeedback(null);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl transition"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {replyingTo === item.id ? "Cancel" : "Reply"}
                    </button>
                  )}

                  {item.status !== "mapped" && (
                    <button
                      onClick={() => startEdit(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> Map
                    </button>
                  )}

                  {item.status === "unlinked" && (
                    <button
                      onClick={() => ignoreItem(item.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-600 text-xs font-bold rounded-xl transition"
                    >
                      <X className="w-3.5 h-3.5" /> Ignore
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Reply Form */}
              {replyingTo === item.id && (
                <div className="border-t border-emerald-100 bg-emerald-50/40 p-4 space-y-2">
                  <p className="text-xs font-bold text-emerald-900">
                    Reply to {item.senderName || item.senderId} via WhatsApp:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type WhatsApp reply..."
                      className="flex-1 border border-emerald-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply(item);
                        }
                      }}
                    />
                    <button
                      onClick={() => handleSendReply(item)}
                      disabled={sendingReply || !replyText.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingReply ? "Sending..." : "Send"}
                    </button>
                  </div>
                  {replyFeedback && replyFeedback.id === item.id && (
                    <p
                      className={`text-xs font-bold ${
                        replyFeedback.ok ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {replyFeedback.msg}
                    </p>
                  )}
                </div>
              )}

              {/* Mapping form */}
              {editing === item.id && (
                <div className="border-t border-slate-100 bg-slate-50/70 p-4 space-y-3">
                  <p className="text-xs font-bold text-slate-700">Map this upload to ERP record:</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Upload Type</label>
                      <select
                        value={editData.uploadType}
                        onChange={(e) => setEditData((d: any) => ({ ...d, uploadType: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none"
                      >
                        {UPLOAD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Client</label>
                      <select
                        value={editData.mappedClientId}
                        onChange={(e) => setEditData((d: any) => ({ ...d, mappedClientId: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none"
                      >
                        <option value="">— Select client —</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Estimate</label>
                      <select
                        value={editData.mappedEstimateId}
                        onChange={(e) => setEditData((d: any) => ({ ...d, mappedEstimateId: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none"
                      >
                        <option value="">— Select estimate —</option>
                        {estimates.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.estimateNumber} — {e.subject || e.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Remarks</label>
                    <input
                      type="text"
                      value={editData.remarks}
                      onChange={(e) => setEditData((d: any) => ({ ...d, remarks: e.target.value }))}
                      placeholder="Optional notes..."
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none bg-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveMapping(item.id)}
                      disabled={saving}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save Mapping"}
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition"
                    >
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
