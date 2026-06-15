import React from "react";
import {
  X, Upload, Camera, FileCheck2, Trash2, Image as ImageIcon,
  File, AlertCircle, CheckCircle, Loader,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UploadMode = "photo" | "signed_wcc";

interface ModalStore {
  storeCode: string;
  storeName: string | null;
}

interface PendingFile {
  key: string;
  file: File;
  storeCode: string;
  photoType: string;
  preview: string | null; // object URL for images
}

interface Props {
  mode: UploadMode;
  estimateId: number;
  stores: ModalStore[];
  token: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PHOTO_TYPES = [
  "Installation",
  "Front",
  "Facade",
  "Window",
  "Full Store",
  "Before Work",
  "After Work",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const isImageFile = (f: File) => f.type.startsWith("image/");

const makePreview = (f: File): string | null => {
  if (!isImageFile(f)) return null;
  try { return URL.createObjectURL(f); } catch { return null; }
};

// ── Component ─────────────────────────────────────────────────────────────────

const ProjectUploadModal: React.FC<Props> = ({
  mode, estimateId, stores, token, onClose, onSuccess,
}) => {
  const [pending, setPending] = React.useState<PendingFile[]>([]);
  const [defaultStore, setDefaultStore] = React.useState(stores[0]?.storeCode ?? "");
  const [defaultPhotoType, setDefaultPhotoType] = React.useState("Installation");
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadErrors, setUploadErrors] = React.useState<string[]>([]);
  const [done, setDone] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const authHeader = { Authorization: `Bearer ${token}` };

  // Revoke object URLs on unmount
  React.useEffect(() => {
    return () => {
      pending.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview); });
    };
  }, []);

  const addFiles = React.useCallback((files: File[]) => {
    if (files.length === 0) return;
    setPending(prev => [
      ...prev,
      ...files.map(f => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        storeCode: defaultStore,
        photoType: defaultPhotoType,
        preview: makePreview(f),
      })),
    ]);
  }, [defaultStore, defaultPhotoType]);

  // Paste support
  React.useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter(i => i.kind === "file")
        .map(i => i.getAsFile())
        .filter(Boolean) as File[];
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [addFiles]);

  const removeFile = (key: string) => {
    setPending(prev => {
      const item = prev.find(p => p.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter(p => p.key !== key);
    });
  };

  const updateFile = (key: string, patch: Partial<PendingFile>) => {
    setPending(prev => prev.map(p => p.key === key ? { ...p, ...patch } : p));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const canUpload = pending.length > 0 && pending.every(p => p.storeCode.trim() !== "");

  const uploadAll = async () => {
    if (!canUpload) {
      setUploadErrors(["Please select a store for every file before uploading."]);
      return;
    }
    setUploading(true);
    setUploadErrors([]);
    const errs: string[] = [];

    for (const p of pending) {
      try {
        // Step 1: upload file
        const fd = new FormData();
        fd.append("file", p.file);
        const upRes = await fetch("/api/operations/upload", {
          method: "POST",
          headers: authHeader,
          body: fd,
        });
        if (!upRes.ok) {
          const msg = await upRes.json().catch(() => ({ message: "Upload failed" }));
          throw new Error(msg?.message || "Upload failed");
        }
        const { filePath, fileName, fileSize } = await upRes.json();

        // Step 2: register document
        const body: Record<string, any> = {
          estimateId,
          storeCode: p.storeCode,
          documentType: mode,
          filePath,
          originalFileName: fileName || p.file.name,
          mimeType: p.file.type || null,
          fileSize: fileSize || p.file.size || null,
          uploadedVia: "project_workspace",
        };
        if (mode === "photo") {
          body.metadata = { photoType: p.photoType };
        }
        const docRes = await fetch("/api/operations/execution-documents", {
          method: "POST",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!docRes.ok) {
          const msg = await docRes.json().catch(() => ({ message: "Failed to register" }));
          throw new Error(msg?.message || "Failed to register document");
        }
      } catch (err: any) {
        errs.push(`${p.file.name}: ${err?.message ?? "Failed"}`);
      }
    }

    setUploading(false);
    if (errs.length > 0) {
      setUploadErrors(errs);
    } else {
      setDone(true);
      pending.forEach(p => { if (p.preview) URL.revokeObjectURL(p.preview); });
      onSuccess();
      onClose();
    }
  };

  const title = mode === "photo" ? "Upload Photos" : "Upload Signed WCC";
  const Icon = mode === "photo" ? Camera : FileCheck2;
  const accept = mode === "photo" ? "image/*" : "image/*,.pdf";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-orange-500" />
            <span className="font-black text-slate-900 text-base">{title}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Modal-level defaults */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1">
                Default Store
              </label>
              <select
                value={defaultStore}
                onChange={e => setDefaultStore(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-orange-400 bg-white"
              >
                <option value="">— Select Store —</option>
                {stores.map(s => (
                  <option key={s.storeCode} value={s.storeCode}>
                    {s.storeName ? `${s.storeName} (${s.storeCode})` : s.storeCode}
                  </option>
                ))}
              </select>
            </div>
            {mode === "photo" && (
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1">
                  Default Photo Type
                </label>
                <select
                  value={defaultPhotoType}
                  onChange={e => setDefaultPhotoType(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-orange-400 bg-white"
                >
                  {PHOTO_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver
              ? "border-orange-400 bg-orange-50"
              : "border-slate-200 hover:border-orange-300 hover:bg-slate-50"
            }`}
          >
            <Upload className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-600">
              Drop files here, paste with <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[11px] font-mono">Ctrl+V</kbd>, or{" "}
              <span className="text-orange-600 underline underline-offset-2">browse</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              {mode === "photo" ? "Images only — multiple allowed" : "PDF or image — multiple allowed"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={e => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>

          {/* Pending file list */}
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                {pending.length} file{pending.length !== 1 ? "s" : ""} ready to upload
              </p>
              {pending.map(p => (
                <div
                  key={p.key}
                  className="border border-slate-200 rounded-xl p-3 flex items-start gap-3 bg-white"
                >
                  {/* Thumbnail / icon */}
                  <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-100 bg-slate-50 shrink-0 flex items-center justify-center">
                    {p.preview ? (
                      <img src={p.preview} alt="" className="w-full h-full object-cover" />
                    ) : isImageFile(p.file) ? (
                      <ImageIcon className="w-5 h-5 text-slate-300" />
                    ) : (
                      <File className="w-5 h-5 text-slate-300" />
                    )}
                  </div>

                  {/* File info + per-file overrides */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs font-bold text-slate-800 truncate" title={p.file.name}>
                      {p.file.name}
                    </p>
                    <div className={`grid gap-2 ${mode === "photo" ? "grid-cols-2" : "grid-cols-1"}`}>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Store</label>
                        <select
                          value={p.storeCode}
                          onChange={e => updateFile(p.key, { storeCode: e.target.value })}
                          className={`w-full border rounded-lg px-2 py-1.5 text-xs font-medium focus:outline-none focus:border-orange-400 bg-white ${!p.storeCode ? "border-red-300 text-red-500" : "border-slate-200 text-slate-700"}`}
                        >
                          <option value="">— Select —</option>
                          {stores.map(s => (
                            <option key={s.storeCode} value={s.storeCode}>
                              {s.storeName ? `${s.storeName} (${s.storeCode})` : s.storeCode}
                            </option>
                          ))}
                        </select>
                      </div>
                      {mode === "photo" && (
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-0.5">Photo Type</label>
                          <select
                            value={p.photoType}
                            onChange={e => updateFile(p.key, { photoType: e.target.value })}
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:border-orange-400 bg-white"
                          >
                            {PHOTO_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeFile(p.key)}
                    disabled={uploading}
                    className="p-1.5 text-red-400 hover:text-red-600 rounded hover:bg-red-50 shrink-0 mt-0.5"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Errors */}
          {uploadErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-sm font-bold text-red-700">Upload errors</span>
              </div>
              <ul className="space-y-1">
                {uploadErrors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600">{e}</li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-400">
            {pending.length === 0
              ? "Add files using any method above"
              : pending.some(p => !p.storeCode)
                ? "⚠ Assign a store to all files before uploading"
                : `${pending.length} file${pending.length !== 1 ? "s" : ""} will be uploaded`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={uploadAll}
              disabled={uploading || pending.length === 0 || !canUpload}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg border text-xs font-bold bg-orange-600 border-orange-600 text-white hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <><Loader className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
              ) : done ? (
                <><CheckCircle className="w-3.5 h-3.5" /> Done</>
              ) : (
                <><Upload className="w-3.5 h-3.5" /> Upload {pending.length > 0 ? `${pending.length} file${pending.length !== 1 ? "s" : ""}` : ""}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectUploadModal;
