import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Settings as SettingsIcon,
  Save,
  Building2,
  FileText,
  CreditCard,
  Image as ImageIcon,
  Upload,
  Sparkles,
  Users,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { INDIA_STATES, getStateCode } from "@/utils/indiaLocations";
import { isBoltMode } from "../lib/supabase";
import {
  fetchCompanySettings,
  uploadToStorage,
  saveAssetSetting,
  upsertAppSettings,
  setTallyInvoiceSequence,
  apiFetch,
  fetchCompanies,
  createCompanyWorkspace,
  fetchCompanyUsers,
  addCompanyUser,
  removeCompanyUser,
} from "../lib/api";

interface SettingsState {
  companyName: string;
  legalName: string;
  tradeName: string;
  displayName: string;
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
  docHeaderText: string;
  docFooterText: string;
}

const empty: SettingsState = {
  companyName: "Sunrise Media",
  legalName: "Sunrise Media",
  tradeName: "Sunrise Media",
  displayName: "Sunrise Media",
  companyAddress: "",
  companyGstin: "",
  companyPan: "",
  companyStateCode: "27",
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
  terms: "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the material.\n3. Transportation charges As per Actual.\n4. Any additional work / rework will be extra.",
  docHeaderText: "",
  docFooterText: "",
};

function getCurrentFyLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const startYear = d.getMonth() < 3 ? y - 1 : y;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

const SettingsPage: React.FC = () => {
  const { token, user, activeCompanyId, availableCompanies, switchCompany, refreshCompanies } = useAuth();
  const [selectedCompanyId, setSelectedCompanyId] = useState<number>(activeCompanyId || 1);
  const [form, setForm] = useState<SettingsState>(empty);
  const [tallyFy, setTallyFy] = useState(getCurrentFyLabel());
  const [tallyStartingNumber, setTallyStartingNumber] = useState<number | string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"branding" | "workspaces">("branding");

  // Multi-Company Management state
  const [companyUsers, setCompanyUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showNewCompanyModal, setShowNewCompanyModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyPrefix, setNewCompanyPrefix] = useState("");
  const [newCompanyCreating, setNewCompanyCreating] = useState(false);

  // Add User to company state
  const [allSystemUsers, setAllSystemUsers] = useState<any[]>([]);
  const [selectedAddUserId, setSelectedAddUserId] = useState<string>("");
  const [selectedAddRole, setSelectedAddRole] = useState<string>("company_user");

  const isAdmin = user?.role === "admin" || user?.isSuperAdmin;
  const isSuperAdmin = user?.isSuperAdmin;

  // Load settings for selectedCompanyId
  const loadSettings = async (cId: number) => {
    setLoading(true);
    try {
      const data = await fetchCompanySettings(token, cId);
      if (data) {
        setForm({
          companyName: String(data.name ?? empty.companyName),
          legalName: String(data.legalName ?? data.name ?? empty.legalName),
          tradeName: String(data.tradeName ?? data.name ?? empty.tradeName),
          displayName: String(data.displayName ?? data.name ?? empty.displayName),
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
          docHeaderText: String(data.documentHeader ?? empty.docHeaderText),
          docFooterText: String(data.documentFooter ?? empty.docFooterText),
        });
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyUsersList = async (cId: number) => {
    setLoadingUsers(true);
    try {
      const list = await fetchCompanyUsers(token, cId);
      setCompanyUsers(list);
    } catch (err) {
      console.error("Failed to load company users:", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadAllSystemUsers = async () => {
    if (!isAdmin) return;
    try {
      const res = await apiFetch("/api/users", token);
      if (res.ok) {
        const uList = await res.json();
        setAllSystemUsers(uList);
      }
    } catch (err) {
      console.error("Failed to load all users:", err);
    }
  };

  useEffect(() => {
    loadSettings(selectedCompanyId);
    if (isAdmin) {
      loadCompanyUsersList(selectedCompanyId);
      loadAllSystemUsers();
    }
  }, [selectedCompanyId, token]);

  const save = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        name: form.companyName,
        legalName: form.legalName,
        tradeName: form.tradeName,
        displayName: form.displayName || form.companyName,
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
        documentHeader: form.docHeaderText,
        documentFooter: form.docFooterText,
      };

      if (isBoltMode) {
        await upsertAppSettings(token, {
          "company.name": form.companyName,
          "company.address": form.companyAddress,
          "company.gstin": form.companyGstin,
          "company.pan": form.companyPan,
          "company.stateCode": form.companyStateCode,
          "company.mobile": form.companyMobile,
          "company.email": form.companyEmail,
          "bank.name": form.bankName,
          "bank.accountNumber": form.bankAccountNumber,
          "bank.ifsc": form.bankIfsc,
          "bank.branch": form.bankBranch,
          "defaults.gstPercent": form.defaultGstPercent,
          "defaults.packingPercent": form.defaultPacking,
          "defaults.implementationPercent": form.defaultImplementation,
          "defaults.localTransport": form.defaultLocalTransport,
          "defaults.outstationTransportRate": form.defaultOutstationTransportRate,
          "defaults.terms": form.terms || null,
          "company.logoPath": form.companyLogoPath || null,
          "company.signatureStampPath": form.signatureStampPath || null,
        });
      } else {
        const res = await apiFetch("/api/company-settings", token, {
          method: "PUT",
          headers: { "X-Company-Id": String(selectedCompanyId) },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.message || "Save failed");
        }
      }

      if (tallyStartingNumber !== "" && selectedCompanyId === 1) {
        const startNum = parseInt(String(tallyStartingNumber), 10);
        if (Number.isFinite(startNum) && startNum >= 0) {
          await setTallyInvoiceSequence(token, tallyFy.trim() || getCurrentFyLabel(), startNum);
        }
      }

      await refreshCompanies();
      setMsg({ kind: "ok", text: "Company settings and document branding saved successfully." });
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
        const { displayUrl } = await uploadToStorage("company-assets", storagePath, file);
        filePath = displayUrl;
        const settingKey = key === "companyLogoPath" ? "company.logoPath" : "company.signatureStampPath";
        await saveAssetSetting(token, settingKey, filePath);
      } else {
        const body = new FormData();
        body.append("file", file);
        const res = await apiFetch("/api/company-assets/upload", token, {
          method: "POST",
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
      setMsg({ kind: "ok", text: "Image uploaded. Click Save Settings to apply changes." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Upload failed" });
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setNewCompanyCreating(true);
    try {
      const created = await createCompanyWorkspace(token, {
        name: newCompanyName.trim(),
        displayName: newCompanyName.trim(),
        estimatePrefix: newCompanyPrefix.trim() || `${newCompanyName.slice(0, 3).toUpperCase()}/E`,
        invoicePrefix: newCompanyPrefix.trim() || `${newCompanyName.slice(0, 3).toUpperCase()}`,
        dcPrefix: `${newCompanyName.slice(0, 3).toUpperCase()}/DC`,
      });
      await refreshCompanies();
      setShowNewCompanyModal(false);
      setNewCompanyName("");
      setNewCompanyPrefix("");
      setSelectedCompanyId(created.id);
      setMsg({ kind: "ok", text: `Company workspace "${created.name}" created successfully!` });
      setTimeout(() => setMsg(null), 4000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Failed to create company" });
    } finally {
      setNewCompanyCreating(false);
    }
  };

  const handleAddUserToCompany = async () => {
    if (!selectedAddUserId) return;
    try {
      await addCompanyUser(token, selectedCompanyId, {
        userId: Number(selectedAddUserId),
        role: selectedAddRole,
      });
      await loadCompanyUsersList(selectedCompanyId);
      setSelectedAddUserId("");
      setMsg({ kind: "ok", text: "User membership added to company." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Failed to add user" });
    }
  };

  const handleRemoveUserFromCompany = async (userId: number) => {
    if (!confirm("Are you sure you want to remove this user from this company workspace?")) return;
    try {
      await removeCompanyUser(token, selectedCompanyId, userId);
      await loadCompanyUsersList(selectedCompanyId);
      setMsg({ kind: "ok", text: "User removed from company." });
      setTimeout(() => setMsg(null), 3000);
    } catch (err: any) {
      setMsg({ kind: "err", text: err.message || "Failed to remove user" });
    }
  };

  const Field: React.FC<{ label: string; k: keyof SettingsState; type?: string; rows?: number; placeholder?: string }> = ({ label, k, type = "text", rows, placeholder }) => (
    <div>
      <label className="text-xs font-bold uppercase text-slate-600">{label}</label>
      {rows ? (
        <textarea
          rows={rows}
          value={form[k]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-hidden"
          disabled={!isAdmin}
        />
      ) : (
        <input
          type={type}
          value={form[k]}
          placeholder={placeholder}
          onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-hidden"
          disabled={!isAdmin}
        />
      )}
    </div>
  );

  const AssetField: React.FC<{ label: string; k: "companyLogoPath" | "signatureStampPath"; hint: string }> = ({ label, k, hint }) => (
    <div className="border border-slate-200 rounded-lg p-3.5 bg-white shadow-2xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="text-xs font-bold uppercase text-slate-700">{label}</label>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
          <div className="mt-2 flex items-center gap-2">
            {form[k] ? (
              <img src={form[k]} alt={label} className="h-10 w-auto max-w-32 object-contain border border-slate-200 rounded bg-slate-50 p-1" />
            ) : (
              <span className="text-[11px] text-slate-400 italic">No image uploaded</span>
            )}
            <p className="text-[10px] text-slate-400 truncate font-mono max-w-xs">{form[k]}</p>
          </div>
        </div>
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold shrink-0 transition-colors ${isAdmin ? "cursor-pointer bg-slate-50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 text-slate-700 border-slate-200 shadow-2xs" : "cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200"}`}>
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
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Building2 className="w-8 h-8 text-orange-600" />
            Company & ERP Settings
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Manage multi-company workspaces, legal details, document branding, bank accounts, and sequences.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Active Company Picker in Settings */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
            <span className="text-xs font-bold uppercase text-slate-400">Target Workspace:</span>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(Number(e.target.value))}
              className="text-xs font-bold text-slate-800 bg-transparent outline-hidden cursor-pointer"
            >
              {availableCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.id} — {c.displayName || c.name} {c.id === activeCompanyId ? "(Active)" : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={save}
            disabled={!isAdmin || saving}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-700 hover:to-amber-600 text-white font-bold rounded-lg text-sm shadow-md transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("branding")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "branding"
              ? "border-orange-600 text-orange-600 bg-orange-50/40"
              : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
          }`}
        >
          <Building2 className="w-4 h-4" />
          Company Branding & Defaults
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("workspaces")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              activeTab === "workspaces"
                ? "border-orange-600 text-orange-600 bg-orange-50/40"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Workspaces Master & Members ({availableCompanies.length})
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="rounded-lg px-4 py-2.5 text-sm border bg-amber-50 text-amber-800 border-amber-200 flex items-center gap-2">
          <span>Only administrators can update company settings. Current values are displayed in read-only mode.</span>
        </div>
      )}

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm font-medium border flex items-center gap-2 shadow-2xs ${
          msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
        }`}>
          {msg.kind === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : null}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="glass-panel p-12 text-center text-sm font-semibold text-slate-500">Loading settings…</div>
      ) : activeTab === "workspaces" ? (
        /* Workspaces Master Tab */
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Registered Company Workspaces</h2>
              <p className="text-xs text-slate-500">Manage independent company entities, legal profiles, and authorized users.</p>
            </div>
            {isSuperAdmin && (
              <button
                onClick={() => setShowNewCompanyModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg text-xs shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Company Workspace
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {availableCompanies.map((c) => (
              <div
                key={c.id}
                className={`p-4 rounded-xl border transition-all ${
                  c.id === selectedCompanyId
                    ? "border-orange-500 bg-orange-50/20 shadow-md ring-2 ring-orange-500/20"
                    : "border-slate-200 bg-white hover:border-slate-300 shadow-2xs"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Company ID #{c.id}</span>
                    <h3 className="font-bold text-slate-900 text-base">{c.displayName || c.name}</h3>
                  </div>
                  {c.id === activeCompanyId && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-orange-100 text-orange-700">
                      Current Active
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-1 text-xs text-slate-600 font-mono">
                  <p>GSTIN: {c.gstin || <span className="text-amber-600 font-sans italic font-normal">Pending Setup</span>}</p>
                  <p>PAN: {c.pan || "—"}</p>
                  <p>Invoice Prefix: <span className="font-bold text-slate-800">{c.invoicePrefix || "SM"}</span></p>
                  <p>Estimate Prefix: <span className="font-bold text-slate-800">{c.estimatePrefix || "SM/E"}</span></p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setSelectedCompanyId(c.id);
                      setActiveTab("branding");
                    }}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    Configure Branding →
                  </button>
                  {c.id !== activeCompanyId && (
                    <button
                      onClick={() => switchCompany(c.id)}
                      className="text-xs font-semibold px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700"
                    >
                      Switch To
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* User Access & Memberships for selected company */}
          <div className="glass-panel p-5 mt-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-orange-600" />
                  Authorized Users for Workspace #{selectedCompanyId} ({form.companyName})
                </h3>
                <p className="text-xs text-slate-500">Only assigned users can query or create business records in this workspace.</p>
              </div>
            </div>

            {/* Add User bar */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg mb-4">
                <span className="text-xs font-bold uppercase text-slate-600">Assign Member:</span>
                <select
                  value={selectedAddUserId}
                  onChange={(e) => setSelectedAddUserId(e.target.value)}
                  className="text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white font-medium min-w-48"
                >
                  <option value="">Select a user…</option>
                  {allSystemUsers
                    .filter((u) => !companyUsers.some((cu) => cu.userId === u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.username} — {u.role})
                      </option>
                    ))}
                </select>

                <select
                  value={selectedAddRole}
                  onChange={(e) => setSelectedAddRole(e.target.value)}
                  className="text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-white font-medium"
                >
                  <option value="company_user">Company User (Scoped Actions)</option>
                  <option value="company_admin">Company Admin (Workspace Settings & Users)</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin (Cross-Company Access)</option>}
                </select>

                <button
                  onClick={handleAddUserToCompany}
                  disabled={!selectedAddUserId}
                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded text-xs disabled:opacity-50"
                >
                  Grant Access
                </button>
              </div>
            )}

            {loadingUsers ? (
              <p className="text-xs text-slate-400 py-3">Loading company members…</p>
            ) : companyUsers.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No specific user memberships found.</p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100/80 font-bold uppercase text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Email</th>
                      <th className="px-4 py-2.5">Workspace Role</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {companyUsers.map((cu) => (
                      <tr key={cu.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-bold text-slate-800">{cu.user?.name || `User #${cu.userId}`}</td>
                        <td className="px-4 py-2.5 text-slate-500 font-mono">{cu.user?.email || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            cu.role === "super_admin"
                              ? "bg-purple-100 text-purple-700"
                              : cu.role === "company_admin"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}>
                            {cu.role.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {!(cu.userId === 1 && selectedCompanyId === 1) && isAdmin && (
                            <button
                              onClick={() => handleRemoveUserFromCompany(cu.userId)}
                              className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50"
                              title="Revoke company access"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Branding & Defaults Tab */
        <div className="space-y-6">
          {/* LIVE DOCUMENT BRANDING PREVIEW */}
          <div className="glass-panel p-5 border-2 border-dashed border-orange-200 bg-gradient-to-br from-white via-orange-50/20 to-amber-50/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 text-base">
                <Sparkles className="w-5 h-5 text-orange-600" />
                Live Document Branding Preview ({form.companyName})
              </h3>
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-800 bg-orange-100 px-2.5 py-1 rounded-full border border-orange-200">
                Official Document Header & Footer Mockup
              </span>
            </div>

            {/* Document Header Preview Card */}
            <div className="bg-white border border-slate-300 rounded-lg p-5 shadow-xs font-sans">
              {form.docHeaderText ? (
                <div className="text-center font-bold text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100 pb-2 mb-3">
                  {form.docHeaderText}
                </div>
              ) : null}

              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3">
                  {form.companyLogoPath ? (
                    <img src={form.companyLogoPath} alt="Logo" className="h-12 w-auto max-w-40 object-contain" />
                  ) : (
                    <div className="h-12 w-32 border border-dashed border-slate-300 rounded flex items-center justify-center text-[10px] text-slate-400 font-bold uppercase">
                      Logo Preview
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-black text-slate-900 leading-tight uppercase tracking-tight">
                      {form.displayName || form.companyName || "COMPANY NAME"}
                    </h2>
                    {form.legalName && form.legalName !== form.companyName && (
                      <p className="text-[11px] text-slate-500 font-medium">({form.legalName})</p>
                    )}
                    <p className="text-xs text-slate-600 max-w-md mt-0.5 leading-snug">
                      {form.companyAddress || <span className="text-slate-400 italic">No address configured</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {form.companyMobile && `Mobile: ${form.companyMobile} `}
                      {form.companyEmail && `| Email: ${form.companyEmail}`}
                    </p>
                  </div>
                </div>

                <div className="text-right text-xs space-y-1 font-mono">
                  <div className="bg-slate-50 border border-slate-200 rounded p-2 text-left">
                    <p className="font-bold text-slate-800">GSTIN: <span className="text-orange-600 font-black">{form.companyGstin || "PENDING"}</span></p>
                    <p className="text-slate-600">PAN: {form.companyPan || "—"}</p>
                    <p className="text-slate-600">State Code: {form.companyStateCode || "—"}</p>
                  </div>
                </div>
              </div>

              {/* Bank Details Strip */}
              <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap justify-between items-center text-[11px] text-slate-600 bg-slate-50/70 p-2.5 rounded">
                <div>
                  <span className="font-bold text-slate-700">Bank:</span> {form.bankName || "—"} | <span className="font-bold text-slate-700">A/C:</span> {form.bankAccountNumber || "—"}
                </div>
                <div>
                  <span className="font-bold text-slate-700">IFSC:</span> {form.bankIfsc || "—"} | <span className="font-bold text-slate-700">Branch:</span> {form.bankBranch || "—"}
                </div>
              </div>

              {form.docFooterText && (
                <div className="mt-3 pt-2 border-t border-slate-100 text-center text-[10px] text-slate-400 font-medium">
                  {form.docFooterText}
                </div>
              )}
            </div>
          </div>

          {/* Company Info Form */}
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
              <Building2 className="w-5 h-5 text-orange-600" />
              Company Entity Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Display / Trading Name" k="displayName" placeholder="e.g. Sunrise Media / Delhi Branch" />
              <Field label="Legal Entity Name" k="legalName" placeholder="e.g. Sunrise Media Private Limited" />
              <Field label="GSTIN" k="companyGstin" placeholder="e.g. 27AAAAA0000A1Z5" />
              <Field label="PAN" k="companyPan" placeholder="e.g. AAAAA0000A" />
              <div className="md:col-span-2">
                <Field label="Registered Office Address" k="companyAddress" rows={2} placeholder="Full legal registered address" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">State / State Code</label>
                <select
                  value={INDIA_STATES.find(s => s.code === form.companyStateCode)?.name || ""}
                  onChange={(e) => {
                    const code = getStateCode(e.target.value);
                    setForm({ ...form, companyStateCode: code });
                  }}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-hidden"
                  disabled={!isAdmin}
                >
                  <option value="">Select state</option>
                  {INDIA_STATES.map(s => (
                    <option key={s.code} value={s.name}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>
              <Field label="Contact Mobile" k="companyMobile" placeholder="+91 9876543210" />
              <Field label="Official Email" k="companyEmail" type="email" placeholder="billing@company.com" />
            </div>
          </div>

          {/* Document Header & Footer (Pasteable Text) */}
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-orange-600" />
              Document Header & Footer (Pasteable Text)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Document Header Text"
                k="docHeaderText"
                rows={3}
                placeholder="Top-of-page document header text or notice (e.g. TAX INVOICE / ESTIMATE OF WORK)"
              />
              <Field
                label="Document Footer Text"
                k="docFooterText"
                rows={3}
                placeholder="Bottom-of-page footer text, registration notes or jurisdiction notice"
              />
            </div>
          </div>

          {/* Document Images */}
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
              <ImageIcon className="w-5 h-5 text-orange-600" />
              Document Logos & Signatures
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AssetField label="Company Logo" k="companyLogoPath" hint="Rendered on estimate, invoice, DC, and packet PDFs." />
              <AssetField label="Signature & Stamp Image" k="signatureStampPath" hint="Transparent PNG with signature and stamp for official invoices." />
            </div>
          </div>

          {/* Bank Details */}
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
              <CreditCard className="w-5 h-5 text-orange-600" />
              Bank Account Details (Printed on Invoices & Estimates)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Bank Name" k="bankName" placeholder="e.g. HDFC Bank" />
              <Field label="Account Number" k="bankAccountNumber" placeholder="e.g. 50200012345678" />
              <Field label="IFSC Code" k="bankIfsc" placeholder="e.g. HDFC0001234" />
              <Field label="Branch Location" k="bankBranch" placeholder="e.g. Andheri East, Mumbai" />
            </div>
          </div>

          {/* Document Defaults & Prefixes */}
          <div className="glass-panel p-5">
            <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-orange-600" />
              Document Numbering & Calculation Defaults
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Default GST %" k="defaultGstPercent" type="number" />
              <Field label="Packing % (ABFRL)" k="defaultPacking" type="number" />
              <Field label="Implementation % (ABFRL)" k="defaultImplementation" type="number" />
              <Field label="Local Transport (₹)" k="defaultLocalTransport" type="number" />
              <Field label="Outstation Rate (₹/KM)" k="defaultOutstationTransportRate" type="number" />
              <Field label="Estimate Prefix" k="defaultEstimatePrefix" placeholder="e.g. SM/E or DEL/E" />
              <Field label="Invoice Prefix" k="defaultInvoicePrefix" placeholder="e.g. SM or DEL" />
              <Field label="Delivery Challan Prefix" k="defaultDcPrefix" placeholder="e.g. SM/DC or DEL/DC" />
              <div className="md:col-span-3">
                <Field label="Default Terms & Conditions" k="terms" rows={4} />
              </div>
            </div>
          </div>

          {/* Tally Alignment */}
          {selectedCompanyId === 1 && (
            <div className="glass-panel p-5">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-1">
                <FileText className="w-5 h-5 text-orange-600" /> Tally / External Invoice Sequence Alignment
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Synchronize Sunrise ERP with your external invoice sequence. Format: <strong>&lt;FY&gt;/SM/&lt;number&gt;</strong> (e.g. 26-27/SM/171).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Financial Year</label>
                  <input
                    type="text"
                    value={tallyFy}
                    onChange={(e) => setTallyFy(e.target.value)}
                    placeholder="e.g. 26-27"
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm font-mono font-bold mt-1"
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Current / Last External Invoice No.</label>
                  <input
                    type="number"
                    value={tallyStartingNumber}
                    onChange={(e) => setTallyStartingNumber(e.target.value)}
                    placeholder="e.g. 170"
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm font-mono font-bold mt-1"
                    disabled={!isAdmin}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Next suggested invoice:{" "}
                    <span className="font-mono font-bold text-orange-600">
                      {tallyStartingNumber ? `${tallyFy}/SM/${Number(tallyStartingNumber) + 1}` : "—"}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Create Company Workspace */}
      {showNewCompanyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-orange-600" />
              Create New Company Workspace
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Add a new isolated business entity to Sunrise ERP with its own data and document sequences.
            </p>

            <form onSubmit={handleCreateCompany} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-700">Company Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delhi Branch / Rika Store"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-hidden font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-slate-700">Document Prefix (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. DEL or RIKA"
                  value={newCompanyPrefix}
                  onChange={(e) => setNewCompanyPrefix(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mt-1 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-hidden font-mono uppercase"
                />
                <p className="text-[11px] text-slate-400 mt-1">Legal details (GSTIN, PAN, address) can be configured by the administrator after creation.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewCompanyModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newCompanyCreating || !newCompanyName.trim()}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50"
                >
                  {newCompanyCreating ? "Creating…" : "Create Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
