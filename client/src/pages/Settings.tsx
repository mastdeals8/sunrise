import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Settings as SettingsIcon, Save, Building2, FileText, CreditCard, Image as ImageIcon, Upload } from "lucide-react";
import { INDIA_STATES, getStateCode } from "@/utils/indiaLocations";
import { isBoltMode } from "../lib/supabase";
import { fetchCompanySettings, uploadToStorage, saveAssetSetting } from "../lib/api";

interface SettingsState {
  companyName: string;
  companyAddress: string;
  companyGstin: string;
  companyPan: string;
  companyStateCode: string;
  companyMobile: string;
  companyEmail: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankBranch: string;
  defaultGstPercent: string;
  defaultInvoicePrefix: string;
  defaultEstimatePrefix: string;
  defaultDcPrefix: string;
  defaultPacking: string;
  defaultImplementation: string;
  defaultLocalTransport: string;
  defaultOutstationTransportRate: string;
  companyLogoPath: string;
  signatureStampPath: string;
  terms: string;
}

const empty: SettingsState = {
  companyName: "Sunrise Media",
  companyAddress: "",
  companyGstin: "",
  companyPan: "",
  companyStateCode: "",
  companyMobile: "",
  companyEmail: "",
  bankName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankBranch: "",
  defaultGstPercent: "18",
  defaultInvoicePrefix: "INV",
  defaultEstimatePrefix: "EST",
  defaultDcPrefix: "DC",
  defaultPacking: "4",
  defaultImplementation: "7",
  defaultLocalTransport: "1000",
  defaultOutstationTransportRate: "18",
  companyLogoPath: "",
  signatureStampPath: "",
  terms: "1. Payment within 30 days.\n2. Interest @ 2% pm on overdue.\n3. Subject to local jurisdiction.",
};

const SettingsPage: React.FC = () => {
  const { token, user } = useAuth();
  const [form, setForm] = useState<SettingsState>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    const load = async () => {
      try {
        let data: any = null;
        if (isBoltMode) {
          data = await fetchCompanySettings(token).catch(() => null);
        } else {
          const res = await fetch("/api/company-settings", { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) data = await res.json();
        }
        if (data) {
          setForm({
            companyName: String(data.name ?? empty.companyName),
            companyAddress: String(data.address ?? empty.companyAddress),
            companyGstin: String(data.gstin ?? empty.companyGstin),
            companyPan: String(data.pan ?? empty.companyPan),
            companyStateCode: String(data.stateCode ?? empty.companyStateCode),
            companyMobile: String(data.mobile ?? empty.companyMobile),
            companyEmail: String(data.email ?? empty.companyEmail),
            bankName: String(data.bankName ?? empty.bankName),
            bankAccountNumber: String(data.bankAccountNumber ?? empty.bankAccountNumber),
            bankIfsc: String(data.bankIfsc ?? empty.bankIfsc),
            bankBranch: String(data.bankBranch ?? empty.bankBranch),
            defaultGstPercent: String(data.defaultGstPercent ?? empty.defaultGstPercent),
            defaultInvoicePrefix: String(data.defaultInvoicePrefix ?? empty.defaultInvoicePrefix),
            defaultEstimatePrefix: String(data.defaultEstimatePrefix ?? empty.defaultEstimatePrefix),
            defaultDcPrefix: String(data.defaultDcPrefix ?? empty.defaultDcPrefix),
            defaultPacking: String(data.defaultPacking ?? empty.defaultPacking),
            defaultImplementation: String(data.defaultImplementation ?? empty.defaultImplementation),
            defaultLocalTransport: String(data.defaultLocalTransport ?? empty.defaultLocalTransport),
            defaultOutstationTransportRate: String(data.defaultOutstationTransportRate ?? empty.defaultOutstationTransportRate),
            companyLogoPath: String(data.logoPath ?? empty.companyLogoPath),
            signatureStampPath: String(data.signatureStampPath ?? empty.signatureStampPath),
            terms: String(data.terms ?? empty.terms),
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const save = async () => {
    if (!isAdmin) return;
    if (isBoltMode) { setMsg({ kind: "err", text: "Settings save migration pending." }); setTimeout(() => setMsg(null), 4000); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/company-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.companyName,
          address: form.companyAddress,
          gstin: form.companyGstin,
          pan: form.companyPan,
          stateCode: form.companyStateCode,
          mobile: form.companyMobile,
          email: form.companyEmail,
          bankName: form.bankName,
          bankAccountNumber: form.bankAccountNumber,
          bankIfsc: form.bankIfsc,
          bankBranch: form.bankBranch,
          defaultGstPercent: form.defaultGstPercent,
          defaultInvoicePrefix: form.defaultInvoicePrefix,
          defaultEstimatePrefix: form.defaultEstimatePrefix,
          defaultDcPrefix: form.defaultDcPrefix,
          defaultPacking: form.defaultPacking,
          defaultImplementation: form.defaultImplementation,
          defaultLocalTransport: form.defaultLocalTransport,
          defaultOutstationTransportRate: form.defaultOutstationTransportRate,
          logoPath: form.companyLogoPath,
          signatureStampPath: form.signatureStampPath,
          terms: form.terms,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = await res.json();
      setForm(prev => ({
        ...prev,
        companyName: String(saved.name ?? prev.companyName),
        companyAddress: String(saved.address ?? prev.companyAddress),
        companyGstin: String(saved.gstin ?? prev.companyGstin),
        companyPan: String(saved.pan ?? prev.companyPan),
        companyStateCode: String(saved.stateCode ?? prev.companyStateCode),
        companyMobile: String(saved.mobile ?? prev.companyMobile),
        companyEmail: String(saved.email ?? prev.companyEmail),
        bankName: String(saved.bankName ?? prev.bankName),
        bankAccountNumber: String(saved.bankAccountNumber ?? prev.bankAccountNumber),
        bankIfsc: String(saved.bankIfsc ?? prev.bankIfsc),
        bankBranch: String(saved.bankBranch ?? prev.bankBranch),
        defaultGstPercent: String(saved.defaultGstPercent ?? prev.defaultGstPercent),
        defaultInvoicePrefix: String(saved.defaultInvoicePrefix ?? prev.defaultInvoicePrefix),
        defaultEstimatePrefix: String(saved.defaultEstimatePrefix ?? prev.defaultEstimatePrefix),
        defaultDcPrefix: String(saved.defaultDcPrefix ?? prev.defaultDcPrefix),
        defaultPacking: String(saved.defaultPacking ?? prev.defaultPacking),
        defaultImplementation: String(saved.defaultImplementation ?? prev.defaultImplementation),
        defaultLocalTransport: String(saved.defaultLocalTransport ?? prev.defaultLocalTransport),
        defaultOutstationTransportRate: String(saved.defaultOutstationTransportRate ?? prev.defaultOutstationTransportRate),
        companyLogoPath: String(saved.logoPath ?? prev.companyLogoPath),
        signatureStampPath: String(saved.signatureStampPath ?? prev.signatureStampPath),
        terms: String(saved.terms ?? prev.terms),
      }));
      setMsg({ kind: "ok", text: "Settings saved." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Save failed" });
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  const uploadAsset = async (e: React.ChangeEvent<HTMLInputElement>, key: "companyLogoPath" | "signatureStampPath") => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    try {
      let filePath: string;
      if (isBoltMode) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${key === "companyLogoPath" ? "logo" : "stamp"}/${Date.now()}-${safeName}`;
        const { storagePath: saved } = await uploadToStorage("company-assets", storagePath, file);
        filePath = saved;
        // Persist to app_settings so it survives refreshes
        const settingKey = key === "companyLogoPath" ? "company.logoPath" : "company.signatureStampPath";
        await saveAssetSetting(token, settingKey, filePath);
      } else {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/company-assets/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Upload failed");
        }
        const data = await res.json();
        filePath = String(data.filePath || "");
      }
      setForm(prev => ({ ...prev, [key]: filePath }));
      setMsg({ kind: "ok", text: "Image uploaded. Save settings to apply it to documents." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Upload failed" });
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const Field: React.FC<{ label: string; k: keyof SettingsState; type?: string; rows?: number }> = ({ label, k, type = "text", rows }) => (
    <div>
      <label className="text-xs font-bold uppercase text-slate-600">{label}</label>
      {rows ? (
        <textarea
          rows={rows}
          value={form[k]}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
          disabled={!isAdmin}
        />
      ) : (
        <input
          type={type}
          value={form[k]}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
          disabled={!isAdmin}
        />
      )}
    </div>
  );

  const AssetField: React.FC<{ label: string; k: "companyLogoPath" | "signatureStampPath"; hint: string }> = ({ label, k, hint }) => (
    <div className="border border-slate-200 rounded-md p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="text-xs font-bold uppercase text-slate-600">{label}</label>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
          <p className="text-[11px] text-slate-400 mt-2 truncate font-mono">{form[k] || "No file selected"}</p>
        </div>
        <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-semibold shrink-0 ${isAdmin ? "cursor-pointer bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200" : "cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200"}`}>
          <Upload className="w-3.5 h-3.5" />
          Upload
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={!isAdmin}
            onChange={(e) => uploadAsset(e, k)}
          />
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <SettingsIcon className="w-7 h-7 text-orange-600" /> Application Settings
          </h1>
          <p className="text-slate-500 text-sm mt-1">Company info, GST defaults, invoice/estimate prefixes, banking, terms.</p>
        </div>
        <button
          onClick={save}
          disabled={!isAdmin || saving}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 text-white font-semibold rounded-lg text-sm shadow-md disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>

      {!isAdmin && (
        <div className="rounded-lg px-4 py-2 text-sm border bg-amber-50 text-amber-800 border-amber-200">
          Only admin users can edit settings. You can view current values.
        </div>
      )}

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm border ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="glass-panel p-8 text-center text-sm text-slate-500">Loading settings…</div>
      ) : (
        <>
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><Building2 className="w-5 h-5 text-orange-600" /> Company Info</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Company name" k="companyName" />
              <Field label="GSTIN" k="companyGstin" />
              <div className="md:col-span-2"><Field label="Registered address" k="companyAddress" rows={2} /></div>
              <Field label="PAN" k="companyPan" />
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">State / State Code</label>
                <select
                  value={INDIA_STATES.find(s => s.code === form.companyStateCode)?.name || ""}
                  onChange={(e) => {
                    const code = getStateCode(e.target.value);
                    setForm({ ...form, companyStateCode: code });
                  }}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  disabled={!isAdmin}
                >
                  <option value="">Select state</option>
                  {INDIA_STATES.map(s => (
                    <option key={s.code} value={s.name}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>
              <Field label="Mobile" k="companyMobile" />
              <Field label="Email" k="companyEmail" type="email" />
            </div>
          </div>

          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><ImageIcon className="w-5 h-5 text-orange-600" /> Document Images</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AssetField label="Company Logo" k="companyLogoPath" hint="Used in estimate, invoice, DC/WCC, and invoice packet print documents." />
              <AssetField label="Signature & Stamp Image" k="signatureStampPath" hint="Upload one transparent PNG containing signature and company stamp." />
            </div>
          </div>

          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><CreditCard className="w-5 h-5 text-orange-600" /> Bank Details (printed on invoices)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Bank name" k="bankName" />
              <Field label="Account number" k="bankAccountNumber" />
              <Field label="IFSC code" k="bankIfsc" />
              <Field label="Branch" k="bankBranch" />
            </div>
          </div>

          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3"><FileText className="w-5 h-5 text-orange-600" /> Document Defaults</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Default GST %" k="defaultGstPercent" type="number" />
              <Field label="Packing % (ABFRL)" k="defaultPacking" type="number" />
              <Field label="Implementation % (ABFRL)" k="defaultImplementation" type="number" />
              <Field label="Local Transport" k="defaultLocalTransport" type="number" />
              <Field label="Outstation / KM" k="defaultOutstationTransportRate" type="number" />
              <Field label="Estimate # prefix" k="defaultEstimatePrefix" />
              <Field label="Invoice # prefix" k="defaultInvoicePrefix" />
              <Field label="DC # prefix" k="defaultDcPrefix" />
              <div className="md:col-span-3"><Field label="Default terms & conditions" k="terms" rows={4} /></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsPage;
