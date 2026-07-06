import React from "react";
import { isBoltMode, supabase } from "../../../lib/supabase";
import { fetchEstimateItems, fetchDeliveryChallansForEstimate, fetchExecutionStores, fetchExecutionDocuments, fetchInvoiceForEstimate, uploadToStorage, registerExecutionDocument, deleteExecutionDocument } from "../../../lib/api";
import {
  ArrowLeft, Camera, CheckCircle, CheckCircle2, ChevronRight, Clock,
  Download, ExternalLink, Eye, File, FileCheck2, FilePlus, FileText,
  FileUp, Image as ImageIcon, IndianRupee, MapPin, Package, Paperclip,
  Printer, RefreshCw, Trash2, TrendingUp, Truck, Upload, X, AlertCircle,
  Activity as ActivityIcon, Zap,
} from "lucide-react";
import { StatusBadge } from "@/components/ui-kit";
import type { Client, Brand, Store, Estimate, DeliveryChallan } from "../types";
import ProjectUploadModal, { type UploadMode } from "./ProjectUploadModal";

// ── Types ────────────────────────────────────────────────────────────────────

type ProjectTab = "overview" | "photos" | "wcc" | "execution" | "documents" | "invoice" | "activity";

interface ExecDoc {
  id: number;
  estimateId: number;
  deliveryChallanId: number | null;
  storeCode: string | null;
  documentType: string;
  filePath: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  version: number;
  uploadedVia: string | null;
  uploadedAt: string | null;
  createdAt: string;
  metadata: any;
}

interface ExecStoreRow {
  id: number;
  estimateId: number;
  storeId: number | null;
  storeCode: string;
  storeName: string | null;
  storeCity: string | null;
  storeState: string | null;
  status: string;
  billingReady: boolean;
  notes: string | null;
  stats: {
    wccCount: number;
    dcCount: number;
    photoCount: number;
    signedWccCount: number;
    signedDcCount: number;
  };
  wccRecords: DeliveryChallan[];
  dcRecords: DeliveryChallan[];
  signedWccDocuments: ExecDoc[];
  photoDocuments: ExecDoc[];
  documents: ExecDoc[];
}

interface ProjectInvoice {
  id: number;
  invoiceNumber: string;
  date: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  remarks: string | null;
  transportCost: number | null;
  followUpStatus: string | null;
}

interface ProjectData {
  estimate: Estimate;
  items: any[];
  challans: DeliveryChallan[];
  stores: ExecStoreRow[];
  projectDocuments: ExecDoc[];
  invoices: ProjectInvoice[];
}

interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityLabel: string | null;
  userName: string | null;
  estimateId: number | null;
  createdAt: string;
}

interface ProjectWorkspaceProps {
  estimate: Estimate;
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  token: string | null;
  onBack: () => void;
  onOpenWcc: (dc: DeliveryChallan, msg?: string) => void;
  onPreviewWcc: (dc: DeliveryChallan) => void;
  onGenerateWcc: (storeCode: string, storeId?: number | null) => void;
  onOpenInvoice: (args: { estimateId?: number | null; invoiceId?: number | null }) => void;
  onPoUpload: (est: Estimate) => void;
  onRefresh: () => void;
  initialTab?: ProjectTab;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtCur = (n: number | null | undefined) =>
  `₹ ${fmt(n)}`;

const fmtBytes = (b: number | null) => {
  if (!b) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
};

const validDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

const fmtDate = (s: string | null | undefined) => {
  const d = validDate(s);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
};

const fmtDateTime = (s: string | null | undefined) => {
  const d = validDate(s);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const safeDocumentUrl = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw || /[\x00-\x1f\x7f]/.test(raw)) return null;
  if (/^(javascript|data):/i.test(raw)) return null;
  if (/^(https?:|blob:)/i.test(raw)) {
    try {
      new URL(raw);
      return raw;
    } catch {
      return null;
    }
  }
  return raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    let message = `Failed to load project (${res.status})`;
    try {
      const body = text ? JSON.parse(text) : null;
      if (body?.message) message = body.message;
    } catch { /* keep status message */ }
    throw new Error(message);
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`Project API returned ${contentType || "non-JSON"} instead of JSON`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Project API returned invalid JSON");
  }
};

const normalizeExecDoc = (doc: Partial<ExecDoc> | null | undefined): ExecDoc => ({
  id: Number(doc?.id || 0),
  estimateId: Number(doc?.estimateId || 0),
  deliveryChallanId: doc?.deliveryChallanId == null ? null : Number(doc.deliveryChallanId),
  storeCode: doc?.storeCode ?? null,
  documentType: String(doc?.documentType || "extra"),
  filePath: String(doc?.filePath || ""),
  originalFileName: doc?.originalFileName ?? null,
  mimeType: doc?.mimeType ?? null,
  fileSize: doc?.fileSize == null ? null : Number(doc.fileSize),
  status: String(doc?.status || "active"),
  version: Number(doc?.version || 1),
  uploadedVia: doc?.uploadedVia ?? null,
  uploadedAt: doc?.uploadedAt ?? null,
  createdAt: String(doc?.createdAt || ""),
  metadata: doc?.metadata || {},
});

const normalizeStoreRow = (row: Partial<ExecStoreRow> | null | undefined): ExecStoreRow => {
  const stats = (row?.stats || {}) as Partial<ExecStoreRow["stats"]>;
  return {
    id: Number(row?.id || 0),
    estimateId: Number(row?.estimateId || 0),
    storeId: row?.storeId == null ? null : Number(row.storeId),
    storeCode: String(row?.storeCode || ""),
    storeName: row?.storeName ?? null,
    storeCity: row?.storeCity ?? null,
    storeState: row?.storeState ?? null,
    status: String(row?.status || "pending_execution"),
    billingReady: Boolean(row?.billingReady),
    notes: row?.notes ?? null,
    stats: {
      wccCount: Number(stats.wccCount || 0),
      dcCount: Number(stats.dcCount || 0),
      photoCount: Number(stats.photoCount || 0),
      signedWccCount: Number(stats.signedWccCount || 0),
      signedDcCount: Number(stats.signedDcCount || 0),
    },
    wccRecords: Array.isArray(row?.wccRecords) ? row.wccRecords : [],
    dcRecords: Array.isArray(row?.dcRecords) ? row.dcRecords : [],
    signedWccDocuments: Array.isArray(row?.signedWccDocuments) ? row.signedWccDocuments.map(normalizeExecDoc) : [],
    photoDocuments: Array.isArray(row?.photoDocuments) ? row.photoDocuments.map(normalizeExecDoc) : [],
    documents: Array.isArray(row?.documents) ? row.documents.map(normalizeExecDoc) : [],
  };
};

const normalizeProjectData = (payload: any): ProjectData => ({
  estimate: payload?.estimate,
  items: Array.isArray(payload?.items) ? payload.items : [],
  challans: Array.isArray(payload?.challans) ? payload.challans : [],
  stores: Array.isArray(payload?.stores) ? payload.stores.map(normalizeStoreRow) : [],
  projectDocuments: Array.isArray(payload?.projectDocuments) ? payload.projectDocuments.map(normalizeExecDoc) : [],
  invoices: Array.isArray(payload?.invoices) ? payload.invoices.map((inv: any) => ({
    ...inv,
    id: Number(inv?.id || 0),
    invoiceNumber: String(inv?.invoiceNumber || ""),
    totalAmount: Number(inv?.totalAmount || 0),
    paidAmount: Number(inv?.paidAmount || 0),
    balanceAmount: Number(inv?.balanceAmount ?? (Number(inv?.totalAmount || 0) - Number(inv?.paidAmount || 0))),
    transportCost: inv?.transportCost == null ? null : Number(inv.transportCost),
  })) : [],
});

const loadProjectDataFallback = async (estimate: Estimate, authHeader: Record<string, string>, token?: string | null) => {
  const [items, challans, execStores, docs, invoice] = isBoltMode
    ? await Promise.all([
        fetchEstimateItems(token ?? null, estimate.id).catch(() => []),
        fetchDeliveryChallansForEstimate(token ?? null, estimate.id).catch(() => []),
        fetchExecutionStores(token ?? null, estimate.id).catch(() => []),
        fetchExecutionDocuments(token ?? null, estimate.id).catch(() => []),
        fetchInvoiceForEstimate(token ?? null, estimate.id).catch(() => null),
      ])
    : await Promise.all([
        fetchJson(`/api/operations/estimates/${estimate.id}/items`, { headers: authHeader }).catch(() => []),
        fetchJson(`/api/operations/delivery-challans/estimate/${estimate.id}`, { headers: authHeader }).catch(() => []),
        fetchJson(`/api/operations/execution-stores?estimateId=${estimate.id}`, { headers: authHeader }).catch(() => []),
        fetchJson(`/api/operations/execution-documents?estimateId=${estimate.id}`, { headers: authHeader }).catch(() => []),
        fetchJson(`/api/finance/invoices/estimate/${estimate.id}`, { headers: authHeader }).catch(() => null),
      ]);

  // In Bolt mode, execution_stores rows are flat — join docs + challans into each store.
  let stores = execStores;
  if (isBoltMode && Array.isArray(execStores)) {
    const allDocs = Array.isArray(docs) ? docs : [];
    const allChallans = Array.isArray(challans) ? challans : [];
    stores = execStores.map((store: any) => {
      const sc = store.storeCode;
      const storeDocs = allDocs.filter((d: any) => d.storeCode === sc);
      const photoDocs = storeDocs.filter((d: any) => d.documentType === "photo");
      const signedDocs = storeDocs.filter((d: any) => d.documentType === "signed_wcc" || d.documentType === "signed_dc");
      const otherDocs = storeDocs.filter((d: any) => !["photo", "signed_wcc", "signed_dc"].includes(d.documentType));
      const storeChallans = allChallans.filter((c: any) => c.storeCode === sc);
      const wccRecords = storeChallans.filter((c: any) => c.documentType === "wcc");
      const dcRecords = storeChallans.filter((c: any) => c.documentType === "dc");
      return {
        ...store,
        wccRecords,
        dcRecords,
        photoDocuments: photoDocs,
        signedWccDocuments: signedDocs,
        documents: otherDocs,
        stats: {
          photoCount: photoDocs.length,
          wccCount: wccRecords.length,
          dcCount: dcRecords.length,
          signedWccCount: signedDocs.filter((d: any) => d.documentType === "signed_wcc").length,
          signedDcCount: signedDocs.filter((d: any) => d.documentType === "signed_dc").length,
        },
      };
    });
  }

  const projectDocuments = Array.isArray(docs)
    ? docs.filter((doc: any) => !doc?.storeCode || ["po", "transport_receipt", "extra"].includes(doc?.documentType))
    : [];
  return normalizeProjectData({
    estimate,
    items,
    challans,
    stores,
    projectDocuments,
    invoices: invoice ? [invoice] : [],
  });
};

const isImg = (doc: ExecDoc) =>
  Boolean((doc.mimeType && doc.mimeType.startsWith("image/")) ||
    /\.(png|jpe?g|gif|webp)$/i.test(doc.originalFileName || doc.filePath));

const statusBillingLabel = (row: ExecStoreRow) => {
  if (row.billingReady) return { label: "Billing Ready", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  const p = row.stats.photoCount > 0;
  const w = (row.stats.wccCount + row.stats.dcCount) > 0;
  const s = (row.stats.signedWccCount + row.stats.signedDcCount) > 0;
  if (s && w && p) return { label: "Complete", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  if (w || p) return { label: "In Progress", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Pending", cls: "bg-slate-50 text-slate-500 border-slate-200" };
};

const actionLabel = (entry: AuditEntry) => {
  const base = entry.entityLabel || `${entry.entityType} #${entry.estimateId}`;
  const verbs: Record<string, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
    status_change: "Status changed",
    approve: "Approved",
    reject: "Rejected",
  };
  return `${verbs[entry.action] || entry.action}: ${base}`;
};

// ── Small reusable pieces ─────────────────────────────────────────────────────

const Chip: React.FC<{ label: string; cls?: string }> = ({ label, cls = "bg-slate-100 text-slate-600 border-slate-200" }) => (
  <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wide ${cls}`}>{label}</span>
);

const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center justify-between mb-2">
    <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">{children}</h3>
    {action}
  </div>
);

const IconBtn: React.FC<{ icon: React.ReactNode; title: string; onClick: () => void; danger?: boolean }> = ({ icon, title, onClick, danger }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`p-1.5 rounded border transition ${danger
      ? "text-red-500 border-red-100 hover:bg-red-50"
      : "text-slate-500 border-slate-100 hover:bg-slate-100 hover:text-slate-800"}`}
  >
    {icon}
  </button>
);

const DocRow: React.FC<{
  doc: ExecDoc;
  token: string | null;
  onDelete?: (doc: ExecDoc) => void;
}> = ({ doc, token, onDelete }) => {
  const Icon = isImg(doc) ? ImageIcon : doc.mimeType === "application/pdf" ? FileText : File;
  const fileUrl = safeDocumentUrl(doc.filePath);
  const name = doc.originalFileName || String(doc.filePath || "").split("/").pop() || "file";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border border-slate-100 rounded-lg hover:bg-slate-50 group">
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      <span className="text-xs text-slate-700 flex-1 truncate font-medium" title={name}>{name}</span>
      {doc.fileSize ? <span className="text-[10px] text-slate-400 shrink-0">{fmtBytes(doc.fileSize)}</span> : null}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {fileUrl && (
          <>
            <a href={fileUrl} target="_blank" rel="noreferrer" className="p-1 text-slate-500 hover:text-slate-800" title="View">
              <Eye className="w-3.5 h-3.5" />
            </a>
            <a href={fileUrl} download className="p-1 text-slate-500 hover:text-slate-800" title="Download">
              <Download className="w-3.5 h-3.5" />
            </a>
          </>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(doc)} className="p-1 text-red-400 hover:text-red-600" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

// ── Store Detail Drawer ───────────────────────────────────────────────────────

const StoreDrawer: React.FC<{
  row: ExecStoreRow;
  estimate: Estimate;
  token: string | null;
  onClose: () => void;
  onOpenWcc: (dc: DeliveryChallan, msg?: string) => void;
  onPreviewWcc: (dc: DeliveryChallan) => void;
  onGenerateWcc: (storeCode: string, storeId?: number | null) => void;
  onRefresh: () => void;
}> = ({ row, estimate, token, onClose, onOpenWcc, onPreviewWcc, onGenerateWcc, onRefresh }) => {
  const [notes, setNotes] = React.useState(row.notes || "");
  const [savingNotes, setSavingNotes] = React.useState(false);
  const [togglingBilling, setTogglingBilling] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);
  const signedInputRef = React.useRef<HTMLInputElement>(null);

  const authHeader = { Authorization: `Bearer ${token}` };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      if (isBoltMode) {
        const { error } = await supabase
          .from("execution_stores")
          .update({ notes })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
      } else {
        await fetch(`/api/operations/execution-stores/${row.id}`, {
          method: "PATCH",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        });
      }
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Failed to save notes.");
    } finally {
      setSavingNotes(false);
    }
  };

  const toggleBilling = async () => {
    setTogglingBilling(true);
    try {
      if (isBoltMode) {
        const { error } = await supabase
          .from("execution_stores")
          .update({ billing_ready: !row.billingReady })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
      } else {
        await fetch(`/api/operations/execution-stores/${row.id}`, {
          method: "PATCH",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ billingReady: !row.billingReady }),
        });
      }
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Failed to update billing status.");
    } finally {
      setTogglingBilling(false);
    }
  };

  const uploadDoc = async (file: File, docType: "photo" | "signed_wcc") => {
    setUploading(true);
    try {
      let filePath: string;
      let fileName = file.name;

      if (isBoltMode) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `estimate-${estimate.id}/${row.storeCode}/${Date.now()}-${safeName}`;
        const { storagePath: saved } = await uploadToStorage("execution-documents", storagePath, file);
        filePath = saved;
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/operations/upload", { method: "POST", headers: authHeader, body: fd });
        if (!upRes.ok) throw new Error("Upload failed");
        const data = await upRes.json();
        filePath = data.filePath;
        fileName = data.fileName || file.name;
      }

      await registerExecutionDocument(token, {
        estimateId: estimate.id,
        storeCode: row.storeCode,
        documentType: docType,
        filePath,
        originalFileName: fileName,
        mimeType: file.type || null,
        fileSize: file.size || null,
        uploadedVia: "project_workspace",
      });
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (doc: ExecDoc) => {
    if (!confirm(`Delete ${doc.originalFileName || "this file"}?`)) return;
    try {
      await deleteExecutionDocument(token, doc.id);
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Delete failed.");
    }
  };

  const billingStatus = statusBillingLabel(row);
  const primaryWcc = row.wccRecords[0] || null;
  const hasWcc = row.wccRecords.length > 0 || row.dcRecords.length > 0;

  return (
    <div className="fixed inset-0 z-[200] flex items-stretch justify-end" onClick={onClose}>
      <div
        className="w-full max-w-[520px] bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 sticky top-0 bg-white z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <MapPin className="w-4 h-4 text-orange-500 shrink-0" />
              <span className="font-black text-slate-900">{row.storeName || row.storeCode}</span>
              <Chip label={row.storeCode} cls="bg-slate-100 text-slate-600 border-slate-200" />
              <Chip label={billingStatus.label} cls={billingStatus.cls} />
            </div>
            {(row.storeCity || row.storeState) && (
              <p className="text-xs text-slate-500 mt-0.5 ml-6">{[row.storeCity, row.storeState].filter(Boolean).join(", ")}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-5 space-y-6">
          {/* Photos */}
          <div>
            <SectionTitle action={
              <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold cursor-pointer transition ${uploading ? "opacity-60 pointer-events-none" : "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"}`}>
                <Camera className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : "Upload Photo"}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  multiple
                  disabled={uploading}
                  onChange={async e => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    for (const f of files) await uploadDoc(f, "photo");
                  }}
                />
              </label>
            }>
              Photos ({row.stats.photoCount})
            </SectionTitle>
            {row.photoDocuments.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {row.photoDocuments.map(doc => {
                  const fileUrl = safeDocumentUrl(doc.filePath);
                  return (
                    <div key={doc.id} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                      {isImg(doc) && fileUrl ? (
                        <img src={fileUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><File className="w-8 h-8 text-slate-300" /></div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        {fileUrl && (
                          <a href={fileUrl} target="_blank" rel="noreferrer" className="p-1 bg-white/90 rounded text-slate-700 hover:bg-white" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button type="button" onClick={() => deleteDoc(doc)} className="p-1 bg-white/90 rounded text-red-500 hover:bg-white" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-2">No photos yet.</p>
            )}
          </div>

          {/* WCC */}
          <div>
            <SectionTitle action={
              <div className="flex items-center gap-1.5">
                {!hasWcc ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onGenerateWcc(row.storeCode, row.storeId ?? null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                  >
                    <FilePlus className="w-3.5 h-3.5" /> Generate WCC
                  </button>
                ) : primaryWcc && (
                  <button
                    type="button"
                    onClick={() => onOpenWcc(primaryWcc)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  >
                    <Eye className="w-3.5 h-3.5" /> Edit WCC
                  </button>
                )}
              </div>
            }>
              WCC ({row.stats.wccCount + row.stats.dcCount})
            </SectionTitle>
            {[...row.wccRecords, ...row.dcRecords].length > 0 ? (
              <div className="space-y-1.5">
                {[...row.wccRecords, ...row.dcRecords].map(dc => (
                  <div key={dc.id} className="flex items-center gap-2 px-3 py-2 border border-slate-100 rounded-lg hover:bg-slate-50">
                    <FileCheck2 className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="text-xs font-mono font-bold text-slate-700 flex-1">{dc.dcNumber}</span>
                    <button type="button" onClick={() => onPreviewWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="View">
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => onOpenWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="Edit">
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                    {isBoltMode ? (
                      <button type="button" onClick={() => onPreviewWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="Print">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <a
                        href={`/api/operations/wcc-preview/${dc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 text-slate-400 hover:text-slate-700"
                        title="Print/Download"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-2">No WCC generated yet.</p>
            )}
          </div>

          {/* Signed WCC */}
          <div>
            <SectionTitle action={
              <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold cursor-pointer transition ${uploading ? "opacity-60 pointer-events-none" : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"}`}>
                <FileCheck2 className="w-3.5 h-3.5" />
                Upload Signed WCC
                <input
                  ref={signedInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) await uploadDoc(file, "signed_wcc");
                  }}
                />
              </label>
            }>
              Signed WCC ({row.stats.signedWccCount + row.stats.signedDcCount})
            </SectionTitle>
            {row.signedWccDocuments.length > 0 ? (
              <div className="space-y-1.5">
                {row.signedWccDocuments.map(doc => (
                  <DocRow key={doc.id} doc={doc} token={token} onDelete={deleteDoc} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-2">No signed WCC uploaded yet.</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <SectionTitle>Notes</SectionTitle>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Add store-level notes here…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 resize-none focus:outline-none focus:border-orange-300"
            />
            {notes !== (row.notes || "") && (
              <button
                type="button"
                onClick={saveNotes}
                disabled={savingNotes}
                className="mt-1.5 px-3 py-1.5 rounded border text-xs font-bold bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {savingNotes ? "Saving…" : "Save Notes"}
              </button>
            )}
          </div>

          {/* Billing toggle */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={toggleBilling}
              disabled={togglingBilling}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border font-bold text-sm transition ${row.billingReady
                ? "bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <CheckCircle className={`w-4 h-4 ${row.billingReady ? "text-emerald-600" : "text-slate-300"}`} />
              {togglingBilling ? "Updating…" : row.billingReady ? "Billing Ready ✓ (Click to unmark)" : "Mark as Billing Ready"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Overview ─────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  data: ProjectData;
  clients: Client[];
  brands: Brand[];
  onGoToTab: (t: ProjectTab) => void;
  onPoUpload: (est: Estimate) => void;
  onOpenInvoice: () => void;
}> = ({ data, clients, brands, onGoToTab, onPoUpload, onOpenInvoice }) => {
  const { estimate, stores, invoices } = data;
  const client = clients.find(c => c.id === estimate.clientId);
  const brand = brands.find(b => b.id === estimate.brandId);
  const inv = invoices[0] || null;

  const total = stores.length;
  const completed = stores.filter(s => (s.stats.signedWccCount + s.stats.signedDcCount) > 0).length;
  const billing = stores.filter(s => s.billingReady).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Project Info */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Client</p>
          <p className="text-sm font-bold text-slate-800 mt-0.5">{client?.name || "—"}</p>
        </div>
        {brand && <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Brand</p>
          <p className="text-sm font-bold text-slate-800 mt-0.5">{brand.name}</p>
        </div>}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Estimate</p>
          <p className="text-sm font-mono font-bold text-orange-700 mt-0.5">{estimate.estimateNumber}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">PO Number</p>
          <p className="text-sm font-mono font-bold text-slate-800 mt-0.5">{estimate.poNumber || <span className="text-slate-400 font-normal">Not received</span>}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Total Value</p>
          <p className="text-sm font-mono font-bold text-slate-800 mt-0.5">{fmtCur(estimate.totalAmount)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Invoice Status</p>
          <p className="text-sm font-bold mt-0.5">
            {inv ? <StatusBadge status={inv.status} /> : <span className="text-slate-400 text-xs">Not raised</span>}
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Execution Progress</h3>
          <span className="text-xs font-bold text-slate-700">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
          <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Stores", val: total, icon: <MapPin className="w-3.5 h-3.5" /> },
            { label: "Photos Done", val: stores.filter(s => s.stats.photoCount > 0).length, icon: <Camera className="w-3.5 h-3.5" /> },
            { label: "WCC Generated", val: stores.filter(s => (s.stats.wccCount + s.stats.dcCount) > 0).length, icon: <FileCheck2 className="w-3.5 h-3.5" /> },
            { label: "Billing Ready", val: billing, icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> },
          ].map(k => (
            <div key={k.label} className="bg-slate-50 rounded-lg px-3 py-2.5 flex items-center gap-2">
              <span className="text-slate-400">{k.icon}</span>
              <div>
                <div className="text-lg font-black text-slate-900">{k.val}</div>
                <div className="text-[10px] text-slate-500 font-semibold">{k.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onGoToTab("execution")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100">
            <TrendingUp className="w-3.5 h-3.5" /> View Execution
          </button>
          <button type="button" onClick={() => onPoUpload(estimate)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
            <Package className="w-3.5 h-3.5" /> {estimate.poNumber ? "View PO" : "Upload PO"}
          </button>
          <button type="button" onClick={() => onGoToTab("documents")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
            <Paperclip className="w-3.5 h-3.5" /> Documents
          </button>
          <button type="button" onClick={onOpenInvoice} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
            <IndianRupee className="w-3.5 h-3.5" /> {inv ? "View Invoice" : "Create Invoice"}
          </button>
          <button type="button" onClick={() => onGoToTab("activity")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
            <Clock className="w-3.5 h-3.5" /> Activity
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Installation Photos ──────────────────────────────────────────────────

const PHOTO_TYPE_LABELS: Record<string, string> = {
  Installation: "Installation",
  Front: "Front",
  Facade: "Facade",
  Window: "Window",
  "Full Store": "Full Store",
  "Before Work": "Before Work",
  "After Work": "After Work",
  Other: "Other",
};

const PhotoTypeChip: React.FC<{ type: string }> = ({ type }) => {
  const colors: Record<string, string> = {
    Installation: "bg-orange-50 text-orange-700 border-orange-200",
    Front: "bg-blue-50 text-blue-700 border-blue-200",
    Facade: "bg-violet-50 text-violet-700 border-violet-200",
    Window: "bg-cyan-50 text-cyan-700 border-cyan-200",
    "Full Store": "bg-teal-50 text-teal-700 border-teal-200",
    "Before Work": "bg-amber-50 text-amber-700 border-amber-200",
    "After Work": "bg-emerald-50 text-emerald-700 border-emerald-200",
    Other: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${colors[type] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {PHOTO_TYPE_LABELS[type] || type}
    </span>
  );
};

const PhotosTab: React.FC<{
  data: ProjectData;
  token: string | null;
  onOpenUpload: () => void;
  onRefresh: () => void;
}> = ({ data, token, onOpenUpload, onRefresh }) => {
  const { stores } = data;
  const totalPhotos = stores.reduce((s, r) => s + r.stats.photoCount, 0);
  const authHeader = { Authorization: `Bearer ${token}` };

  const deleteDoc = async (doc: ExecDoc) => {
    if (!confirm(`Delete ${doc.originalFileName || "this photo"}?`)) return;
    try {
      await deleteExecutionDocument(token, doc.id);
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Delete failed.");
    }
  };

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-orange-500" />
          <span className="font-black text-slate-800">Installation Photos</span>
          <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700 text-[11px] font-black">{totalPhotos}</span>
        </div>
        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-orange-600 border-orange-600 text-white hover:bg-orange-500"
        >
          <Camera className="w-3.5 h-3.5" /> Upload Photos
        </button>
      </div>

      {/* Per-store photo grid */}
      {stores.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-semibold">No stores found</p>
        </div>
      ) : (
        stores.map(store => {
          const photos = store.photoDocuments;
          // Group by photoType
          const grouped = photos.reduce<Record<string, ExecDoc[]>>((acc, doc) => {
            const t = doc.metadata?.photoType || "Other";
            if (!acc[t]) acc[t] = [];
            acc[t].push(doc);
            return acc;
          }, {});

          return (
            <div key={store.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Store header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span className="font-bold text-sm text-slate-800">{store.storeName || store.storeCode}</span>
                  <Chip label={store.storeCode} />
                </div>
                <span className={`text-[11px] font-black px-2 py-0.5 rounded ${photos.length > 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                  {photos.length} photo{photos.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="p-4">
                {photos.length === 0 ? (
                  <div className="flex items-center gap-2 py-3">
                    <AlertCircle className="w-4 h-4 text-slate-300" />
                    <span className="text-xs text-slate-400 font-semibold">Pending Photos</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(grouped).map(([photoType, docs]) => (
                      <div key={photoType}>
                        <div className="flex items-center gap-2 mb-2">
                          <PhotoTypeChip type={photoType} />
                          <span className="text-[10px] text-slate-400">{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                          {docs.map(doc => {
                            const fileUrl = safeDocumentUrl(doc.filePath);
                            return (
                              <div key={doc.id} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                {isImg(doc) && fileUrl ? (
                                  <img src={fileUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-2">
                                    <File className="w-6 h-6 text-slate-300" />
                                    <span className="text-[9px] text-slate-400 text-center truncate w-full">{doc.originalFileName || "file"}</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                                  {fileUrl && (
                                    <a href={fileUrl} target="_blank" rel="noreferrer" className="p-1 bg-white/90 rounded text-slate-700 hover:bg-white" title="View">
                                      <Eye className="w-3 h-3" />
                                    </a>
                                  )}
                                  <button type="button" onClick={() => deleteDoc(doc)} className="p-1 bg-white/90 rounded text-red-500 hover:bg-white" title="Delete">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

// ── Tab: WCC ──────────────────────────────────────────────────────────────────

const WccTab: React.FC<{
  data: ProjectData;
  token: string | null;
  onOpenUpload: () => void;
  onOpenWcc: (dc: DeliveryChallan, msg?: string) => void;
  onPreviewWcc: (dc: DeliveryChallan) => void;
  onGenerateWcc: (storeCode: string, storeId?: number | null) => void;
  onRefresh: () => void;
}> = ({ data, token, onOpenUpload, onOpenWcc, onPreviewWcc, onGenerateWcc, onRefresh }) => {
  const { stores } = data;
  const [wccPickerOpen, setWccPickerOpen] = React.useState(false);
  const authHeader = { Authorization: `Bearer ${token}` };

  const totalWcc = stores.reduce((s, r) => s + r.stats.wccCount + r.stats.dcCount, 0);
  const totalSigned = stores.reduce((s, r) => s + r.stats.signedWccCount + r.stats.signedDcCount, 0);

  const deleteDoc = async (doc: ExecDoc) => {
    if (!confirm(`Delete ${doc.originalFileName || "this file"}?`)) return;
    try {
      await deleteExecutionDocument(token, doc.id);
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Delete failed.");
    }
  };

  const handleCreateWcc = () => {
    if (stores.length === 0) return;
    if (stores.length === 1) {
      const existing = stores[0].wccRecords[0] || stores[0].dcRecords[0];
      if (existing) onOpenWcc(existing);
      else onGenerateWcc(stores[0].storeCode, stores[0].storeId ?? null);
      return;
    }
    setWccPickerOpen(v => !v);
  };

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-blue-500" />
          <span className="font-black text-slate-800">WCC Status</span>
          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[11px] font-black">{totalWcc} WCC</span>
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[11px] font-black">{totalSigned} Signed</span>
        </div>
        <div className="flex items-center gap-2 relative">
          <div className="relative">
            <button
              type="button"
              onClick={handleCreateWcc}
              disabled={stores.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-blue-600 border-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            >
              <FilePlus className="w-3.5 h-3.5" /> Create WCC
            </button>
            {wccPickerOpen && stores.length > 1 && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl min-w-[200px] py-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-3 pt-2 pb-1">Select Store</p>
                {stores.map(s => (
                  <button
                    key={s.storeCode}
                    type="button"
                  onClick={() => {
                    setWccPickerOpen(false);
                    const existing = s.wccRecords[0] || s.dcRecords[0];
                    if (existing) onOpenWcc(existing);
                    else onGenerateWcc(s.storeCode, s.storeId ?? null);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <MapPin className="w-3 h-3 text-orange-400 shrink-0" />
                  <span>{s.storeName || s.storeCode}</span>
                  <Chip label={s.storeCode} />
                  {(s.wccRecords.length > 0 || s.dcRecords.length > 0) && <span className="ml-auto text-[10px] text-blue-600 font-black">Edit</span>}
                </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenUpload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Signed WCC
          </button>
        </div>
      </div>

      {/* Per-store WCC status */}
      {stores.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          <FileCheck2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-semibold">No stores found</p>
        </div>
      ) : (
        stores.map(store => {
          const allDcs = [...store.wccRecords, ...store.dcRecords];
          const hasDcs = allDcs.length > 0;
          const hasSigned = store.signedWccDocuments.length > 0;

          return (
            <div key={store.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Store header */}
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span className="font-bold text-sm text-slate-800">{store.storeName || store.storeCode}</span>
                  <Chip label={store.storeCode} />
                </div>
                <div className="flex items-center gap-1.5">
                  {hasDcs ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded bg-blue-100 text-blue-700">Generated</span>
                  ) : (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-500">Pending WCC</span>
                  )}
                  {hasSigned ? (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Signed Uploaded</span>
                  ) : (
                    <span className="text-[11px] font-black px-2 py-0.5 rounded bg-amber-100 text-amber-700">Pending Signed WCC</span>
                  )}
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* WCC list */}
                {hasDcs ? (
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">WCC / DC Records</p>
                    <div className="space-y-1.5">
                      {allDcs.map(dc => (
                        <div key={dc.id} className="flex items-center gap-2 px-3 py-2 border border-slate-100 rounded-lg hover:bg-slate-50">
                          <FileCheck2 className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="text-xs font-mono font-bold text-slate-700 flex-1">{dc.dcNumber}</span>
                          <button type="button" onClick={() => onPreviewWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => onOpenWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="Edit">
                            <Upload className="w-3.5 h-3.5" />
                          </button>
                          {isBoltMode ? (
                            <button type="button" onClick={() => onPreviewWcc(dc)} className="p-1 text-slate-400 hover:text-slate-700" title="Print">
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <a
                              href={`/api/operations/wcc-preview/${dc.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-slate-400 hover:text-slate-700"
                              title="Print/Download"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-1">
                    <AlertCircle className="w-3.5 h-3.5 text-slate-300" />
                    <span className="text-xs text-slate-400">No WCC generated yet</span>
                    <button
                      type="button"
                      onClick={() => onGenerateWcc(store.storeCode, store.storeId ?? null)}
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-bold bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    >
                      <FilePlus className="w-3 h-3" /> Generate
                    </button>
                  </div>
                )}

                {/* Signed WCC */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Signed WCC</p>
                  {hasSigned ? (
                    <div className="space-y-1.5">
                      {store.signedWccDocuments.map(doc => (
                        <DocRow key={doc.id} doc={doc} token={token} onDelete={deleteDoc} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-1">
                      <AlertCircle className="w-3.5 h-3.5 text-slate-300" />
                      <span className="text-xs text-slate-400">Pending Signed WCC</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

// ── Tab: Execution ────────────────────────────────────────────────────────────

const ExecutionTab: React.FC<{
  data: ProjectData;
  estimate: Estimate;
  token: string | null;
  onOpenWcc: (dc: DeliveryChallan, msg?: string) => void;
  onPreviewWcc: (dc: DeliveryChallan) => void;
  onGenerateWcc: (storeCode: string, storeId?: number | null) => void;
  onRefresh: () => void;
}> = ({ data, estimate, token, onOpenWcc, onPreviewWcc, onGenerateWcc, onRefresh }) => {
  const [selectedStore, setSelectedStore] = React.useState<ExecStoreRow | null>(null);
  const stores = data.stores;

  const totalPhotos = stores.reduce((s, r) => s + r.stats.photoCount, 0);
  const totalWcc = stores.reduce((s, r) => s + r.stats.wccCount + r.stats.dcCount, 0);
  const totalSigned = stores.reduce((s, r) => s + r.stats.signedWccCount + r.stats.signedDcCount, 0);
  const totalBilling = stores.filter(s => s.billingReady).length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Stores", val: stores.length, cls: "text-slate-700" },
          { label: "Photos", val: totalPhotos, cls: "text-blue-700" },
          { label: "WCC Generated", val: totalWcc, cls: "text-amber-700" },
          { label: "Billing Ready", val: totalBilling, cls: "text-emerald-700" },
        ].map(k => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className={`text-xl font-black ${k.cls}`}>{k.val}</div>
            <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Stores table */}
      {stores.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
          <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-semibold">No execution stores found</p>
          <p className="text-xs mt-1">Stores are created from the estimate's store grouping when execution begins.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Store</th>
                  <th className="text-center px-3 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Photos</th>
                  <th className="text-center px-3 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">WCC</th>
                  <th className="text-center px-3 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Signed WCC</th>
                  <th className="text-center px-3 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Status</th>
                  <th className="text-right px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stores.map(row => {
                  const bs = statusBillingLabel(row);
                  const hasPhotos = row.stats.photoCount > 0;
                  const hasWcc = (row.stats.wccCount + row.stats.dcCount) > 0;
                  const hasSigned = (row.stats.signedWccCount + row.stats.signedDcCount) > 0;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                          <div>
                            <div className="font-bold text-slate-800 text-xs">{row.storeName || row.storeCode}</div>
                            {row.storeCity && <div className="text-[10px] text-slate-400">{row.storeCity}{row.storeState ? `, ${row.storeState}` : ""}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-black ${hasPhotos ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
                          {row.stats.photoCount}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-black ${hasWcc ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>
                          {row.stats.wccCount + row.stats.dcCount}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-black ${hasSigned ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                          {row.stats.signedWccCount + row.stats.signedDcCount}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Chip label={bs.label} cls={bs.cls} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedStore(row)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        >
                          View <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedStore && (
        <StoreDrawer
          row={selectedStore}
          estimate={estimate}
          token={token}
          onClose={() => setSelectedStore(null)}
          onOpenWcc={onOpenWcc}
          onPreviewWcc={onPreviewWcc}
          onGenerateWcc={onGenerateWcc}
          onRefresh={() => {
            setSelectedStore(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};

// ── Tab: Documents ────────────────────────────────────────────────────────────

const DocumentsTab: React.FC<{
  data: ProjectData;
  token: string | null;
  onPoUpload: (est: Estimate) => void;
  onRefresh: () => void;
}> = ({ data, token, onPoUpload, onRefresh }) => {
  const { estimate, projectDocuments } = data;
  const [uploading, setUploading] = React.useState(false);
  const authHeader = { Authorization: `Bearer ${token}` };

  const byType = (type: string) => projectDocuments.filter(d => d.documentType === type);
  const transportDocs = byType("transport_receipt");
  const extraDocs = byType("extra");

  const deleteDoc = async (doc: ExecDoc) => {
    if (!confirm(`Delete ${doc.originalFileName || "this file"}?`)) return;
    try {
      await deleteExecutionDocument(token, doc.id);
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Delete failed.");
    }
  };

  const uploadTransport = async (file: File) => {
    setUploading(true);
    try {
      if (isBoltMode) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `estimate-${estimate.id}/transport/${Date.now()}-${safeName}`;
        const { storagePath: saved } = await uploadToStorage("execution-documents", storagePath, file);
        await registerExecutionDocument(token, {
          estimateId: estimate.id,
          storeCode: "",
          documentType: "transport_receipt",
          filePath: saved,
          originalFileName: file.name,
          mimeType: file.type || null,
          fileSize: file.size || null,
          uploadedVia: "project_workspace",
        });
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/projects/${estimate.id}/transport-receipt`, {
          method: "POST",
          headers: authHeader,
          body: fd,
        });
        if (!res.ok) throw new Error("Upload failed");
      }
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const uploadExtra = async (file: File) => {
    setUploading(true);
    try {
      let filePath: string;
      let fileName = file.name;

      if (isBoltMode) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `estimate-${estimate.id}/extra/${Date.now()}-${safeName}`;
        const { storagePath: saved } = await uploadToStorage("execution-documents", storagePath, file);
        filePath = saved;
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/operations/upload", { method: "POST", headers: authHeader, body: fd });
        if (!upRes.ok) throw new Error("Upload failed");
        const data = await upRes.json();
        filePath = data.filePath;
        fileName = data.fileName || file.name;
      }

      await registerExecutionDocument(token, {
        estimateId: estimate.id,
        storeCode: "",
        documentType: "extra",
        filePath,
        originalFileName: fileName,
        mimeType: file.type || null,
        fileSize: file.size || null,
        uploadedVia: "project_workspace",
      });
      onRefresh();
    } catch (e: any) {
      alert(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Estimate */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle>Estimate</SectionTitle>
        <div className="flex items-center gap-3 py-2">
          <FileText className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-700">{estimate.estimateNumber} — {estimate.title}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {isBoltMode ? (
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100">
                <Eye className="w-3.5 h-3.5" /> Print / PDF
              </button>
            ) : (
              <a href={`/api/operations/estimates/export/pdf/${estimate.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100">
                <Eye className="w-3.5 h-3.5" /> View PDF
              </a>
            )}
            <button
              type="button"
              onClick={async () => {
                if (isBoltMode) {
                  const { fetchEstimateItems: fetchItems } = await import("../../../lib/api");
                  const { exportEstimateToExcel } = await import("../utils/exportHelpers");
                  const items = await fetchItems(token, estimate.id);
                  await exportEstimateToExcel(estimate, items);
                } else {
                  window.open(`/api/operations/estimates/export/xlsx/${estimate.id}`, "_blank");
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
        </div>
      </div>

      {/* Purchase Order */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle action={
          <button type="button" onClick={() => onPoUpload(estimate)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100">
            <Upload className="w-3.5 h-3.5" /> {estimate.poFilePath ? "Replace PO" : "Upload PO"}
          </button>
        }>
          Purchase Order
        </SectionTitle>
        {estimate.poFilePath ? (
          <div className="flex items-center gap-3 py-2">
            <FileText className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-bold text-slate-700">PO {estimate.poNumber || "—"}</span>
            <a href={estimate.poFilePath} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100">
              <Eye className="w-3.5 h-3.5" /> View PO
            </a>
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-2">
            {estimate.poNumber
              ? `PO number: ${estimate.poNumber} — file not uploaded yet.`
              : "No PO received yet. PO is optional — execution can proceed without it."
            }
          </p>
        )}
      </div>

      {/* Transport Receipts */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle action={
          <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold cursor-pointer transition ${uploading ? "opacity-60 pointer-events-none" : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"}`}>
            <Truck className="w-3.5 h-3.5" />
            {uploading ? "Uploading…" : "Upload Receipt"}
            <input
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) uploadTransport(file);
              }}
            />
          </label>
        }>
          Transport Receipts ({transportDocs.length})
        </SectionTitle>
        {transportDocs.length > 0 ? (
          <div className="space-y-1.5">
            {transportDocs.map(doc => <DocRow key={doc.id} doc={doc} token={token} onDelete={deleteDoc} />)}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-2">No transport receipts uploaded. Upload courier receipts, LR copies, or dispatch proofs here.</p>
        )}
      </div>

      {/* Other Documents */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle action={
          <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold cursor-pointer transition ${uploading ? "opacity-60 pointer-events-none" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"}`}>
            <FileUp className="w-3.5 h-3.5" />
            Add Document
            <input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
              className="hidden"
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) uploadExtra(file);
              }}
            />
          </label>
        }>
          Other Documents ({extraDocs.length})
        </SectionTitle>
        {extraDocs.length > 0 ? (
          <div className="space-y-1.5">
            {extraDocs.map(doc => <DocRow key={doc.id} doc={doc} token={token} onDelete={deleteDoc} />)}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-2">Attach any other client documents here.</p>
        )}
      </div>
    </div>
  );
};

// ── Tab: Invoice ──────────────────────────────────────────────────────────────

const InvoiceTab: React.FC<{
  data: ProjectData;
  token: string | null;
  onOpenInvoice: () => void;
  onRefresh: () => void;
}> = ({ data, token, onOpenInvoice, onRefresh }) => {
  const inv = data.invoices[0] || null;
  const [recording, setRecording] = React.useState(false);
  const authHeader = { Authorization: `Bearer ${token}` };

  const recordPayment = async () => {
    if (!inv) return;
    const amount = prompt(`Record payment for ${inv.invoiceNumber}.\n\nEnter amount received (₹):`);
    if (amount === null) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { alert("Invalid amount."); return; }
    setRecording(true);
    try {
      const payload = {
        type: "receipt",
        invoiceId: inv.id,
        amount: amt,
        date: new Date().toISOString(),
        method: "bank_transfer",
        allocatedInvoices: [{ invoiceId: inv.id, amount: amt }],
      };
      if (isBoltMode) {
        const { createPayment } = await import("../../../lib/api");
        await createPayment(token, payload);
      } else {
        const res = await fetch("/api/finance/payments", {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.message || "Failed to record payment"); return; }
      }
      onRefresh();
    } finally {
      setRecording(false);
    }
  };

  if (!inv) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <IndianRupee className="w-10 h-10 mx-auto text-slate-300 mb-3" />
        <h3 className="font-bold text-slate-700 mb-1">No Invoice Raised</h3>
        <p className="text-xs text-slate-500 mb-4">Create an invoice when the project is ready for billing.</p>
        <button
          type="button"
          onClick={onOpenInvoice}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100"
        >
          <FilePlus className="w-4 h-4" /> Create Invoice
        </button>
      </div>
    );
  }

  const outstanding = Number(inv.balanceAmount ?? (inv.totalAmount - (inv.paidAmount || 0)));
  const isPaid = inv.status === "paid";
  const dueDate = validDate(inv.dueDate);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono font-black text-slate-900">{inv.invoiceNumber}</span>
            <StatusBadge status={inv.status} />
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/invoice-packet?id=${inv.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <Eye className="w-3.5 h-3.5" /> View
            </a>
            <button type="button" onClick={onOpenInvoice} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-100">
              Edit
            </button>
          </div>
        </div>
        <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Invoice Date</p>
            <p className="text-sm font-bold text-slate-800 mt-0.5">{fmtDate(inv.date)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Due Date</p>
            <p className={`text-sm font-bold mt-0.5 ${!isPaid && dueDate && dueDate < new Date() ? "text-red-600" : "text-slate-800"}`}>
              {fmtDate(inv.dueDate)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Invoice Amount</p>
            <p className="text-sm font-mono font-bold text-slate-900 mt-0.5">{fmtCur(inv.totalAmount)}</p>
          </div>
          {(inv.transportCost && inv.transportCost > 0) ? <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Transport Cost</p>
            <p className="text-sm font-mono font-bold text-slate-800 mt-0.5">{fmtCur(inv.transportCost)}</p>
          </div> : null}
          <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Amount Received</p>
            <p className="text-sm font-mono font-bold text-emerald-700 mt-0.5">{fmtCur(inv.paidAmount)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Outstanding</p>
            <p className={`text-sm font-mono font-bold mt-0.5 ${outstanding > 0 ? "text-red-600" : "text-emerald-700"}`}>{fmtCur(outstanding)}</p>
          </div>
          {inv.remarks && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-[10px] uppercase tracking-wider font-black text-slate-400">Remarks</p>
              <p className="text-xs text-slate-700 mt-0.5">{inv.remarks}</p>
            </div>
          )}
        </div>
        {!isPaid && (
          <div className="px-5 pb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={recordPayment}
              disabled={recording}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-bold bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {recording ? "Recording…" : "Record Payment"}
            </button>
            <a href={`/invoice-packet?id=${inv.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50">
              <Printer className="w-4 h-4" /> Print Invoice
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tab: Activity ─────────────────────────────────────────────────────────────

const ActivityTab: React.FC<{
  estimateId: number;
  token: string | null;
}> = ({ estimateId, token }) => {
  const [entries, setEntries] = React.useState<AuditEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/projects/${estimateId}/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : [])
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [estimateId, token]);

  const entityIcon = (type: string) => {
    if (type === "invoice") return <IndianRupee className="w-3.5 h-3.5" />;
    if (type === "delivery_challan") return <FileCheck2 className="w-3.5 h-3.5" />;
    if (type === "execution_document") return <FileUp className="w-3.5 h-3.5" />;
    if (type === "estimate") return <FileText className="w-3.5 h-3.5" />;
    return <ActivityIcon className="w-3.5 h-3.5" />;
  };

  if (loading) return <div className="text-center py-12 text-slate-400 text-sm">Loading activity…</div>;

  if (entries.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
        <ActivityIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-semibold">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="divide-y divide-slate-100">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50/60">
            <div className="mt-0.5 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
              {entityIcon(entry.entityType)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800">{actionLabel(entry)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{entry.userName || "system"} · {fmtDateTime(entry.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Quick Action Bar ──────────────────────────────────────────────────────────

const QuickActionBar: React.FC<{
  estimate: Estimate;
  data: ProjectData | null;
  onOpenUpload: (mode: UploadMode) => void;
  onGenerateWcc: (storeCode: string, storeId?: number | null) => void;
  onOpenWcc: (dc: DeliveryChallan, msg?: string) => void;
  onOpenInvoice: () => void;
}> = ({ estimate, data, onOpenUpload, onGenerateWcc, onOpenWcc, onOpenInvoice }) => {
  const [wccPickerOpen, setWccPickerOpen] = React.useState(false);
  const stores = data?.stores ?? [];

  const handleCreateWcc = () => {
    if (stores.length === 0) return;
    if (stores.length === 1) {
      const existing = stores[0].wccRecords[0] || stores[0].dcRecords[0];
      if (existing) onOpenWcc(existing);
      else onGenerateWcc(stores[0].storeCode, stores[0].storeId ?? null);
      return;
    }
    setWccPickerOpen(v => !v);
  };

  // Close picker on outside click
  React.useEffect(() => {
    if (!wccPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-wcc-picker]")) setWccPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [wccPickerOpen]);

  return (
    <div className="mb-4 bg-white border border-slate-200/80 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
        <Zap className="w-3 h-3 text-orange-400" /> Actions
      </div>
      <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

      {/* Primary: upload actions */}
      <button
        type="button"
        onClick={() => onOpenUpload("photo")}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-orange-600 border-orange-600 text-white hover:bg-orange-500 transition"
      >
        <Camera className="w-3.5 h-3.5" /> Upload Photos
      </button>

      <button
        type="button"
        onClick={() => onOpenUpload("signed_wcc")}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition"
      >
        <FileCheck2 className="w-3.5 h-3.5" /> Upload Signed WCC
      </button>

      {/* Divider between primary and secondary */}
      <div className="h-4 w-px bg-slate-200 mx-0.5 shrink-0" />

      {/* Secondary: management actions */}
      <div className="relative" data-wcc-picker>
        <button
          type="button"
          onClick={handleCreateWcc}
          disabled={stores.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
        >
          <FilePlus className="w-3.5 h-3.5 text-blue-500" /> Create WCC
        </button>
        {wccPickerOpen && stores.length > 1 && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl min-w-[200px] py-1">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-3 pt-2 pb-1">Select Store</p>
            {stores.map(s => (
              <button
                key={s.storeCode}
                type="button"
                onClick={() => {
                  setWccPickerOpen(false);
                  const existing = s.wccRecords[0] || s.dcRecords[0];
                  if (existing) onOpenWcc(existing);
                  else onGenerateWcc(s.storeCode, s.storeId ?? null);
                }}
                className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <MapPin className="w-3 h-3 text-orange-400 shrink-0" />
                <span className="flex-1 truncate">{s.storeName || s.storeCode}</span>
                <Chip label={s.storeCode} />
                {(s.wccRecords.length > 0 || s.dcRecords.length > 0) && <span className="ml-auto text-[10px] text-blue-600 font-black">Edit</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {isBoltMode ? (
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 transition">
          <FileText className="w-3.5 h-3.5 text-slate-400" /> Print / PDF
        </button>
      ) : (
        <a href={`/api/operations/estimates/export/pdf/${estimate.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 transition">
          <FileText className="w-3.5 h-3.5 text-slate-400" /> View Estimate
        </a>
      )}

      <button
        type="button"
        onClick={onOpenInvoice}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 transition"
      >
        <IndianRupee className="w-3.5 h-3.5 text-slate-400" />
        {data?.invoices[0] ? "View Invoice" : "Create Invoice"}
      </button>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({
  estimate,
  clients,
  brands,
  stores: masterStores,
  token,
  onBack,
  onOpenWcc,
  onPreviewWcc,
  onGenerateWcc,
  onOpenInvoice,
  onPoUpload,
  onRefresh,
  initialTab = "overview",
}) => {
  const [activeTab, setActiveTab] = React.useState<ProjectTab>(initialTab);
  const [data, setData] = React.useState<ProjectData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [uploadModal, setUploadModal] = React.useState<UploadMode | null>(null);

  const authHeader = { Authorization: `Bearer ${token}` };

  const load = React.useCallback(async () => {
    if (!estimate?.id) return;
    setLoading(true);
    setError(null);
    try {
      if (isBoltMode) {
        // In Bolt mode the /api/projects/:id route doesn't exist — go straight to fallback.
        setData(await loadProjectDataFallback(estimate, authHeader, token));
      } else {
        try {
          const payload = await fetchJson(`/api/projects/${estimate.id}`, { headers: authHeader });
          setData(normalizeProjectData(payload));
        } catch (err: any) {
          if (!String(err?.message || "").includes("instead of JSON")) throw err;
          setData(await loadProjectDataFallback(estimate, authHeader, token));
        }
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [estimate?.id, token, refreshKey]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [estimate?.id, initialTab]);

  const refresh = () => {
    setRefreshKey(k => k + 1);
    onRefresh();
  };

  const client = clients.find(c => c.id === estimate.clientId);
  const brand = brands.find(b => b.id === estimate.brandId);

  const totalPhotos = data?.stores.reduce((s, r) => s + r.stats.photoCount, 0) ?? 0;
  const totalWcc = data?.stores.reduce((s, r) => s + r.stats.wccCount + r.stats.dcCount, 0) ?? 0;

  const tabs: { key: ProjectTab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "photos", label: "Installation Photos", count: totalPhotos },
    { key: "wcc", label: "WCC", count: totalWcc },
    { key: "execution", label: "Execution", count: data?.stores.length },
    { key: "documents", label: "Documents", count: data ? data.projectDocuments.length : undefined },
    { key: "invoice", label: "Invoice", count: data?.invoices.length },
    { key: "activity", label: "Activity" },
  ];

  // Stores for the upload modal (simplified shape)
  const modalStores = (data?.stores ?? []).map(s => ({
    storeCode: s.storeCode,
    storeName: s.storeName,
  }));

  return (
    <div className="space-y-0">
      {/* Back + Header */}
      <div className="mb-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 mb-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Projects
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-black text-orange-700 text-lg">{estimate.estimateNumber}</span>
              <StatusBadge status={estimate.status} />
              {estimate.poNumber && (
                <span className="font-mono text-[11px] px-2 py-0.5 rounded border bg-purple-50 border-purple-200 text-purple-700">
                  PO {estimate.poNumber}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-0.5">
              {client?.name}{brand ? ` · ${brand.name}` : ""}{estimate.title ? ` · ${estimate.title}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={refresh} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold bg-white border-slate-200 text-slate-600 hover:bg-slate-50">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Quick Action Bar */}
      <QuickActionBar
        estimate={estimate}
        data={data}
        onOpenUpload={mode => setUploadModal(mode)}
        onGenerateWcc={onGenerateWcc}
        onOpenWcc={onOpenWcc}
        onOpenInvoice={() => onOpenInvoice({ estimateId: estimate.id, invoiceId: data?.invoices[0]?.id ?? null })}
      />

      {/* Tab Strip */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 transition flex items-center gap-1.5 ${activeTab === tab.key
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${activeTab === tab.key ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-12 text-center text-slate-400">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin opacity-50" />
          <p className="text-sm">Loading project…</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 mx-auto text-red-400 mb-2" />
          <p className="text-sm font-bold text-red-700">{error}</p>
          <button type="button" onClick={refresh} className="mt-3 px-3 py-1.5 rounded border text-xs font-bold bg-white border-red-200 text-red-700 hover:bg-red-50">Retry</button>
        </div>
      ) : data ? (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              data={data}
              clients={clients}
              brands={brands}
              onGoToTab={setActiveTab}
              onPoUpload={onPoUpload}
              onOpenInvoice={() => onOpenInvoice({ estimateId: estimate.id, invoiceId: data.invoices[0]?.id || null })}
            />
          )}
          {activeTab === "photos" && (
            <PhotosTab
              data={data}
              token={token}
              onOpenUpload={() => setUploadModal("photo")}
              onRefresh={refresh}
            />
          )}
          {activeTab === "wcc" && (
            <WccTab
              data={data}
              token={token}
              onOpenUpload={() => setUploadModal("signed_wcc")}
              onOpenWcc={onOpenWcc}
              onPreviewWcc={onPreviewWcc}
              onGenerateWcc={onGenerateWcc}
              onRefresh={refresh}
            />
          )}
          {activeTab === "execution" && (
            <ExecutionTab
              data={data}
              estimate={estimate}
              token={token}
              onOpenWcc={onOpenWcc}
              onPreviewWcc={onPreviewWcc}
              onGenerateWcc={onGenerateWcc}
              onRefresh={refresh}
            />
          )}
          {activeTab === "documents" && (
            <DocumentsTab
              data={data}
              token={token}
              onPoUpload={onPoUpload}
              onRefresh={refresh}
            />
          )}
          {activeTab === "invoice" && (
            <InvoiceTab
              data={data}
              token={token}
              onOpenInvoice={() => onOpenInvoice({ estimateId: estimate.id, invoiceId: data.invoices[0]?.id || null })}
              onRefresh={refresh}
            />
          )}
          {activeTab === "activity" && (
            <ActivityTab estimateId={estimate.id} token={token} />
          )}
        </>
      ) : null}

      {/* Upload Modal */}
      {uploadModal && (
        <ProjectUploadModal
          mode={uploadModal}
          estimateId={estimate.id}
          stores={modalStores}
          token={token}
          onClose={() => setUploadModal(null)}
          onSuccess={refresh}
        />
      )}
    </div>
  );
};

export default ProjectWorkspace;
