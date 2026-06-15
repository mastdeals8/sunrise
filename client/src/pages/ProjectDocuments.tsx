import React, { useEffect, useMemo, useState } from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { useAuth } from "../contexts/AuthContext";
import { FileUp, Search, Download, ExternalLink, Image as ImageIcon, FileText, File, X, RefreshCw, Trash2, History } from "lucide-react";
import { EmptyState } from "@/components/ui-kit";

interface Upload {
  id: number;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  mimeType: string | null;
  category: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface Estimate { id: number; estimateNumber: string; title: string; poFilePath?: string | null; poNumber?: string | null; status?: string }
interface DC { id: number; dcNumber: string; estimateId: number; signedChallanPath?: string | null; photoPath?: string | null; transportReceiptPath?: string | null; extraDocPath?: string | null; createdAt: string }
interface ExecutionDocument {
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
  uploadedBy: number | null;
  uploadedVia: string | null;
  uploadedAt: string | null;
  createdAt: string;
  metadata: any | null;
}

const formatBytes = (b: number | null) => {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const fileIcon = (mime: string | null, name: string) => {
  if ((mime && mime.startsWith("image/")) || /\.(png|jpe?g|gif|webp)$/i.test(name)) return ImageIcon;
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return FileText;
  return File;
};

interface DocRow {
  id?: number;
  type: string;
  label: string;
  fileName: string;
  filePath: string;
  linkedRef: string;
  linkedKind: string;
  date: string;
  mimeType?: string | null;
  fileSize?: number | null;
  uploadedVia?: string | null;
  storeCode?: string | null;
  version?: number | null;
}

const ProjectDocumentsPage: React.FC = () => {
  const { token } = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [challans, setChallans] = useState<DC[]>([]);
  const [executionDocs, setExecutionDocs] = useState<ExecutionDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [viewingDoc, setViewingDoc] = useState<DocRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [r1, r2, r3, r4] = await Promise.all([
          fetch("/api/uploads", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/operations/estimates", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/operations/delivery-challans", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/operations/execution-documents", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (r1.ok) setUploads(await r1.json());
        if (r2.ok) setEstimates(await r2.json());
        if (r3.ok) setChallans(await r3.json());
        if (r4.ok) setExecutionDocs(await r4.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, reloadKey]);

  const allDocs = useMemo<DocRow[]>(() => {
    const list: DocRow[] = [];

    if (executionDocs.length > 0) {
      executionDocs.forEach((doc) => {
        const est = estimates.find((e) => e.id === doc.estimateId);
        const dc = doc.deliveryChallanId ? challans.find((c) => c.id === doc.deliveryChallanId) : null;
        list.push({
          id: doc.id,
          type: doc.documentType,
          label: labelForDocumentType(doc.documentType),
          fileName: doc.originalFileName || doc.filePath.split("/").pop() || doc.filePath,
          filePath: doc.filePath,
          linkedRef: dc ? `${dc.dcNumber}${est ? ` (Est ${est.estimateNumber})` : ""}` : (est?.estimateNumber || `Estimate #${doc.estimateId}`),
          linkedKind: dc ? "DC/WCC" : "Estimate",
          date: doc.uploadedAt || doc.createdAt,
          mimeType: doc.mimeType,
          fileSize: doc.fileSize,
          uploadedVia: doc.uploadedVia,
          storeCode: doc.storeCode,
          version: doc.version,
        });
      });
      return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }

    // POs from estimates
    estimates.forEach((e) => {
      if (e.poFilePath) {
        list.push({
          type: "PO",
          label: "Purchase Order",
          fileName: e.poFilePath.split("/").pop() || e.poFilePath,
          filePath: e.poFilePath,
          linkedRef: e.estimateNumber,
          linkedKind: "Estimate",
          date: "",
        });
      }
    });

    // Challan documents
    challans.forEach((c) => {
      const linked = estimates.find((e) => e.id === c.estimateId);
      const ref = c.dcNumber + (linked ? ` (Est ${linked.estimateNumber})` : "");
      if (c.signedChallanPath) list.push({ type: "DC", label: "Signed Challan", fileName: c.signedChallanPath.split("/").pop() || c.signedChallanPath, filePath: c.signedChallanPath, linkedRef: ref, linkedKind: "DC/WCC", date: c.createdAt });
      if (c.photoPath) list.push({ type: "Photo", label: "Installation Photo", fileName: c.photoPath.split("/").pop() || c.photoPath, filePath: c.photoPath, linkedRef: ref, linkedKind: "DC/WCC", date: c.createdAt });
      if (c.transportReceiptPath) list.push({ type: "Transport", label: "Transport Receipt", fileName: c.transportReceiptPath.split("/").pop() || c.transportReceiptPath, filePath: c.transportReceiptPath, linkedRef: ref, linkedKind: "DC/WCC", date: c.createdAt });
      if (c.extraDocPath) list.push({ type: "Extra", label: "Extra Document", fileName: c.extraDocPath.split("/").pop() || c.extraDocPath, filePath: c.extraDocPath, linkedRef: ref, linkedKind: "DC/WCC", date: c.createdAt });
    });

    // Direct uploads
    uploads.forEach((u) => {
      list.push({
        type: u.category || "Other",
        label: u.category || "Upload",
        fileName: u.fileName,
        filePath: u.filePath,
        linkedRef: u.uploadedBy ? `User #${u.uploadedBy}` : "—",
        linkedKind: "Direct Upload",
        date: u.createdAt,
      });
    });

    return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [uploads, estimates, challans, executionDocs]);

  const visible = useMemo(() => {
    return allDocs.filter((d) => {
      if (filterType !== "all" && d.type !== filterType) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!d.fileName.toLowerCase().includes(q) && !d.linkedRef.toLowerCase().includes(q) && !d.label.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allDocs, filterType, search]);

  const types = useMemo(() => {
    const s = new Set<string>();
    allDocs.forEach(d => s.add(d.type));
    return Array.from(s).sort();
  }, [allDocs]);

  const { page, setPage, slice: pagedDocs, total: docTotal, pageSize } = usePagedList(visible, 25);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <FileUp className="w-7 h-7 text-orange-600" /> Project Documents
        </h1>
        <p className="text-slate-500 text-sm mt-1">All project files: POs, challans, photos, transport receipts, extra documents.</p>
      </div>

      <div className="glass-panel p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search file / reference" className="bg-transparent border-0 outline-none text-sm flex-1" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white">
          <option value="all">All types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-slate-500">{visible.length} files</span>
      </div>

      {/* Document-type overview chips — quick visual organization before the table.
          Derived from the same list; clicking a chip sets the existing filter. */}
      {!loading && allDocs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(() => {
            const counts = new Map<string, number>();
            for (const d of allDocs) counts.set(d.type, (counts.get(d.type) || 0) + 1);
            const chips = [["all", allDocs.length] as [string, number], ...Array.from(counts.entries())];
            return chips.map(([t, n]) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  filterType === t
                    ? "bg-orange-50 border-orange-200 text-orange-700"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {t === "all" ? "All Documents" : labelForDocumentType(t)}
                <span className={`tabular-nums ${filterType === t ? "text-orange-500" : "text-slate-400"}`}>{n}</span>
              </button>
            ));
          })()}
        </div>
      )}

      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading documents…</div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FileUp className="w-6 h-6" />}
            title={search || filterType !== "all" ? "No matching documents" : "No project documents yet"}
            description={search || filterType !== "all" ? "Try clearing the search or filter." : "POs, challans, photos and receipts will appear here as they're uploaded."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 font-semibold">File</th>
                  <th className="text-left px-4 py-3 font-semibold">Linked To</th>
                  <th className="text-left px-4 py-3 font-semibold">Source</th>
                  <th className="text-left px-4 py-3 font-semibold">Uploaded</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedDocs.map((d, idx) => {
                  const Icon = fileIcon(null, d.fileName);
                  return (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                          {d.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="font-mono text-xs truncate max-w-[280px]" title={d.fileName}>{d.fileName}</span>
                        </div>
                        {d.storeCode && <div className="text-[10px] text-slate-400 mt-1">Store {d.storeCode}</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{d.linkedRef}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {d.linkedKind}
                        {d.uploadedVia && <div className="text-[10px] text-slate-400">via {d.uploadedVia}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{d.date ? new Date(d.date).toLocaleDateString("en-GB") : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setViewingDoc(d)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          View <ExternalLink className="w-3 h-3" />
                        </button>
                        <a href={d.filePath} download className="ml-3 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
                          <Download className="w-3 h-3" /> Download
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={page} pageSize={pageSize} total={docTotal} onPageChange={setPage} className="px-4" />
          </div>
        )}
      </div>
      {viewingDoc && (
        <DocumentViewer
          doc={viewingDoc}
          token={token}
          onClose={() => setViewingDoc(null)}
          onChanged={() => setReloadKey((key) => key + 1)}
          onDocChange={setViewingDoc}
        />
      )}
    </div>
  );
};

const labelForDocumentType = (type: string) => {
  const map: Record<string, string> = {
    po: "Purchase Order",
    photo: "Photo",
    dc: "Delivery Challan",
    wcc: "WCC",
    signed_wcc: "Signed WCC",
    signed_dc: "Signed DC",
    transport_receipt: "Transport Receipt",
    extra: "Extra Document",
    field_upload: "Field Upload",
  };
  return map[type] || type.replace(/_/g, " ");
};

const isImagePath = (doc: DocRow) => {
  return Boolean((doc.mimeType && doc.mimeType.startsWith("image/")) || /\.(png|jpe?g|gif|webp)$/i.test(doc.fileName || doc.filePath));
};

const isPdfPath = (doc: DocRow) => {
  return Boolean(doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.fileName || doc.filePath));
};

const DocumentViewer: React.FC<{
  doc: DocRow;
  token: string | null;
  onClose: () => void;
  onChanged: () => void;
  onDocChange: (doc: DocRow | null) => void;
}> = ({ doc, token, onClose, onChanged, onDocChange }) => {
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/operations/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  };

  const replaceDoc = async (file: File) => {
    if (!doc.id) return;
    setReplacing(true);
    try {
      const uploaded = await uploadFile(file);
      const res = await fetch(`/api/operations/execution-documents/${doc.id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          filePath: uploaded.filePath,
          originalFileName: uploaded.fileName || file.name,
          mimeType: file.type || null,
          fileSize: uploaded.fileSize || file.size || null,
        }),
      });
      if (res.ok) {
        const next = await res.json();
        onDocChange({
          ...doc,
          id: next.id,
          fileName: next.originalFileName || next.filePath?.split("/").pop() || doc.fileName,
          filePath: next.filePath,
          mimeType: next.mimeType,
          fileSize: next.fileSize,
          version: next.version,
          date: next.uploadedAt || next.createdAt,
        });
        onChanged();
      }
    } finally {
      setReplacing(false);
    }
  };

  const deleteDoc = async () => {
    if (!doc.id || !window.confirm(`Delete ${doc.fileName}?`)) return;
    const res = await fetch(`/api/operations/execution-documents/${doc.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      onChanged();
      onClose();
    }
  };

  const loadVersions = async () => {
    if (!doc.id) return;
    const res = await fetch(`/api/operations/execution-documents/${doc.id}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setVersions(await res.json());
      setShowVersions(true);
    }
  };

  return (
    <div data-qa="project-document-viewer-modal" className="fixed inset-0 z-[180] bg-slate-950/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-6xl h-[88vh] rounded-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-orange-600">{doc.label}</p>
            <h2 className="font-bold text-slate-900 truncate">{doc.fileName}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {doc.linkedRef} · {doc.linkedKind}
              {doc.storeCode ? ` · Store ${doc.storeCode}` : ""}
              {doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ""}
              {doc.version ? ` · v${doc.version}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={doc.filePath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded hover:bg-slate-100">
              Open <ExternalLink className="w-3 h-3" />
            </a>
            {doc.id && (
              <>
                <button type="button" onClick={loadVersions} className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded hover:bg-slate-100">
                  <History className="w-3 h-3" /> History
                </button>
                <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold rounded hover:bg-blue-100 cursor-pointer">
                  <RefreshCw className="w-3 h-3" /> {replacing ? "Replacing..." : "Replace"}
                  <input type="file" className="hidden" disabled={replacing} onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) replaceDoc(file);
                  }} />
                </label>
                <button type="button" onClick={deleteDoc} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded hover:bg-red-100">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </>
            )}
            <a href={doc.filePath} download className="inline-flex items-center gap-1 px-3 py-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-bold rounded hover:bg-orange-100">
              <Download className="w-3 h-3" /> Download
            </a>
            <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        {showVersions && (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-black uppercase tracking-wider text-slate-600">Version History</span>
              <button type="button" onClick={() => setShowVersions(false)} className="text-slate-500 hover:text-slate-900">Hide</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  onClick={() => onDocChange({
                    ...doc,
                    id: version.id,
                    fileName: version.originalFileName || version.filePath?.split("/").pop() || doc.fileName,
                    filePath: version.filePath,
                    mimeType: version.mimeType,
                    fileSize: version.fileSize,
                    version: version.version,
                    date: version.uploadedAt || version.createdAt,
                  })}
                  className="px-2 py-1 bg-white border border-slate-200 rounded font-mono hover:border-orange-300"
                >
                  v{version.version || 1} · {version.status}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 bg-slate-100 overflow-auto">
          {isImagePath(doc) ? (
            <div className="min-h-full flex items-center justify-center p-4">
              <img src={doc.filePath} alt={doc.fileName} className="max-w-full max-h-full object-contain bg-white shadow-sm" />
            </div>
          ) : isPdfPath(doc) ? (
            <iframe title={doc.fileName} src={doc.filePath} className="w-full h-full bg-white" />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-8">
              <File className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm font-bold text-slate-700">Preview is not available for this file type.</p>
              <p className="text-xs mt-1">Use Open or Download to inspect the document.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectDocumentsPage;
