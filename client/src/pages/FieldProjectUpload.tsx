import React from "react";
import { Camera, CheckCircle2, FileText, Lock, Upload, X, AlertTriangle, ChevronLeft } from "lucide-react";

type FieldDoc = {
  id: number;
  documentType: string;
  originalFileName?: string | null;
  uploadedAt?: string | null;
  version?: number | null;
};

type FieldStore = {
  storeCode: string;
  storeName?: string | null;
  storeLocation?: string | null;
  storeCity?: string | null;
  storeState?: string | null;
  status: string;
  stats: {
    photoCount: number;
    signedWccCount: number;
    signedDcCount: number;
    wccCount: number;
    dcCount: number;
  };
  documents: FieldDoc[];
};

type FieldPayload = {
  project: {
    id: number;
    estimateNumber: string;
    title?: string | null;
    status?: string | null;
  };
  channel: string;
  expiresAt: string;
  allowedDocumentTypes: string[];
  stores: FieldStore[];
};

const docLabels: Record<string, string> = {
  photo: "Photos",
  signed_wcc: "Signed WCC",
  signed_dc: "Delivery Challan",
};

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    completed: "Complete",
    signed_wcc_received: "Signed WCC received",
    wcc_generated: "WCC pending signature",
    photos_uploaded: "Photos uploaded",
    pending: "Pending",
    pending_execution: "Pending",
  };
  return labels[status] || String(status || "Pending").replace(/_/g, " ");
};

const fileAccept = (type: string) => type === "photo" ? "image/*" : ".pdf,image/*";

const FieldProjectUpload: React.FC = () => {
  const token = React.useMemo(() => {
    if (typeof window === "undefined") return "";
    return decodeURIComponent(window.location.pathname.replace(/^\/field\/?/, "").split("/")[0] || "");
  }, []);
  const [data, setData] = React.useState<FieldPayload | null>(null);
  const [selectedStore, setSelectedStore] = React.useState<FieldStore | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/field/${token}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Field link unavailable");
      setData(json);
      setSelectedStore(prev => prev ? json.stores.find((s: FieldStore) => s.storeCode === prev.storeCode) || null : null);
    } catch (err: any) {
      setError(err.message || "Unable to open field link");
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => { load(); }, [load]);

  const uploadFile = async (store: FieldStore, documentType: string, file: File) => {
    if (!token) return;
    setUploading(`${store.storeCode}:${documentType}`);
    setMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("storeCode", store.storeCode);
      form.append("documentType", documentType);
      const res = await fetch(`/api/field/${token}/upload`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      setMessage(`${docLabels[documentType] || "Document"} uploaded for ${store.storeCode}.`);
      await load();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm font-bold text-slate-500">Opening project...</div>;
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
        <div className="w-full max-w-sm bg-white border border-red-100 rounded-lg p-5 text-center shadow-sm">
          <Lock className="w-9 h-9 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-black text-slate-900">Link unavailable</h1>
          <p className="text-sm text-slate-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const selected = selectedStore;
  const allowed = data.allowedDocumentTypes || [];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-600">Sunrise Field Upload</p>
            <h1 className="font-black text-lg leading-tight truncate">{data.project.estimateNumber}</h1>
            <p className="text-xs text-slate-500 truncate">{data.project.title || "Execution project"}</p>
          </div>
          <div className="text-right text-[10px] text-slate-400 shrink-0">
            <div className="font-bold text-slate-500 uppercase">Expires</div>
            <div>{new Date(data.expiresAt).toLocaleDateString("en-GB")}</div>
          </div>
        </div>
      </header>

      <main className="p-4 max-w-xl mx-auto space-y-4">
        {message && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-sm font-bold">
            <CheckCircle2 className="w-4 h-4" /> {message}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm font-bold">
            <AlertTriangle className="w-4 h-4" /> {error}
            <button type="button" onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {!selected ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Assigned Stores</h2>
              <span className="text-xs font-bold text-slate-400">{data.stores.length} stores</span>
            </div>
            {data.stores.map(store => {
              const complete = store.status === "completed";
              return (
                <button
                  key={store.storeCode}
                  type="button"
                  onClick={() => setSelectedStore(store)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-4 text-left shadow-sm hover:border-slate-300 hover:shadow active:scale-[0.99] transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-orange-600">{store.storeCode}</div>
                      <div className="text-base font-semibold text-slate-900 truncate mt-0.5">{store.storeName || "Store"}</div>
                      <div className="text-xs text-slate-500 truncate">{[store.storeLocation, store.storeCity, store.storeState].filter(Boolean).join(", ")}</div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset ${complete ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-sky-50 text-sky-700 ring-sky-600/20"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${complete ? "bg-emerald-500" : "bg-sky-500"}`} />
                      {statusLabel(store.status)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3.5 text-center">
                    <div className="bg-slate-50 rounded-lg py-2.5"><div className="text-lg font-semibold text-slate-900 tabular-nums leading-none">{store.stats.photoCount}</div><span className="block text-[11px] text-slate-500 mt-1">Photos</span></div>
                    <div className="bg-slate-50 rounded-lg py-2.5"><div className="text-lg font-semibold text-slate-900 tabular-nums leading-none">{store.stats.signedWccCount}</div><span className="block text-[11px] text-slate-500 mt-1">Signed WCC</span></div>
                    <div className="bg-slate-50 rounded-lg py-2.5"><div className="text-lg font-semibold text-slate-900 tabular-nums leading-none">{store.stats.signedDcCount}</div><span className="block text-[11px] text-slate-500 mt-1">DC</span></div>
                  </div>
                </button>
              );
            })}
          </section>
        ) : (
          <section className="space-y-4">
            <button type="button" onClick={() => setSelectedStore(null)} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600">
              <ChevronLeft className="w-4 h-4" /> Stores
            </button>

            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-semibold text-orange-600">{selected.storeCode}</div>
                  <h2 className="text-xl font-semibold text-slate-900 leading-tight mt-0.5">{selected.storeName || "Store"}</h2>
                  <p className="text-xs text-slate-500 mt-1">{[selected.storeLocation, selected.storeCity, selected.storeState].filter(Boolean).join(", ")}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ring-inset bg-sky-50 text-sky-700 ring-sky-600/20"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />{statusLabel(selected.status)}</span>
              </div>
            </div>

            <div className="grid gap-3">
              {allowed.includes("photo") && (
                <label className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center gap-3 active:scale-[0.99] transition">
                  <div className="w-12 h-12 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center"><Camera className="w-6 h-6" /></div>
                  <div className="flex-1 min-w-0"><div className="font-black">Upload Photos</div><div className="text-xs text-slate-500">JPG, PNG, camera images</div></div>
                  <Upload className="w-5 h-5 text-slate-400" />
                  <input type="file" accept={fileAccept("photo")} multiple className="hidden" disabled={!!uploading} onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = "";
                    files.forEach(file => uploadFile(selected, "photo", file));
                  }} />
                </label>
              )}

              {allowed.includes("signed_wcc") && (
                <label className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center gap-3 active:scale-[0.99] transition">
                  <div className="w-12 h-12 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><FileText className="w-6 h-6" /></div>
                  <div className="flex-1 min-w-0"><div className="font-black">Upload Signed WCC</div><div className="text-xs text-slate-500">PDF or photo of signed WCC</div></div>
                  <Upload className="w-5 h-5 text-slate-400" />
                  <input type="file" accept={fileAccept("signed_wcc")} className="hidden" disabled={!!uploading} onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) uploadFile(selected, "signed_wcc", file);
                  }} />
                </label>
              )}

              {allowed.includes("signed_dc") && (
                <label className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex items-center gap-3 active:scale-[0.99] transition">
                  <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><FileText className="w-6 h-6" /></div>
                  <div className="flex-1 min-w-0"><div className="font-black">Upload Delivery Challan</div><div className="text-xs text-slate-500">PDF or photo of signed challan</div></div>
                  <Upload className="w-5 h-5 text-slate-400" />
                  <input type="file" accept={fileAccept("signed_dc")} className="hidden" disabled={!!uploading} onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) uploadFile(selected, "signed_dc", file);
                  }} />
                </label>
              )}
            </div>

            {uploading && <div className="text-center text-sm font-bold text-orange-600">Uploading...</div>}

            <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-2.5">Uploaded Documents</h3>
              {selected.documents.length ? (
                <div className="space-y-2">
                  {selected.documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between gap-2 text-sm border-b border-slate-100 last:border-b-0 py-2">
                      <span className="font-bold text-slate-700">{docLabels[doc.documentType] || doc.documentType}</span>
                      <span className="text-xs text-slate-400 truncate max-w-[150px]">{doc.originalFileName || `v${doc.version || 1}`}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400">No uploads yet.</p>}
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto mb-2" />
              <div className="font-black text-emerald-800">Done when all required files are uploaded.</div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default FieldProjectUpload;
