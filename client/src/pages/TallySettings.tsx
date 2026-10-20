import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Database, Save, CheckCircle, XCircle, FileCode2, Layers } from "lucide-react";
import { isBoltMode } from "../lib/supabase";
import {
  TallySettings,
  DEFAULT_TALLY_SETTINGS,
  fetchTallySettings,
  saveTallySettings,
} from "../lib/tally";

export default function TallySettingsPage() {
  const { token } = useAuth();
  const [s, setS] = useState<TallySettings>(DEFAULT_TALLY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<"" | "ok" | "err">("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"" | "ok" | "fail">("");

  useEffect(() => {
    fetchTallySettings(token)
      .then((d) => setS(d))
      .catch((err) => console.warn("[tally] Error loading settings:", err))
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaved("");
    const success = await saveTallySettings(token, s);
    setSaved(success ? "ok" : "err");
    setTimeout(() => setSaved(""), 3000);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const targetUrl = s.tallyUrl || "http://localhost:9000";
      // Best-effort ping: Tally XML/ODBC responds on HTTP port 9000
      const r = await fetch(targetUrl, {
        method: "GET",
        mode: "no-cors",
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      setTestResult(r ? "ok" : "fail");
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(""), 4000);
    }
  };

  const upd = (k: keyof TallySettings, v: any) => setS({ ...s, [k]: v });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[40vh] text-slate-400 text-sm">
        Loading Tally settings...
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-600" /> Tally Integration & XML Export
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Export sales invoices as Tally XML or push directly to a running Tally ERP / Prime instance. ERP remains the source of truth; Tally handles accounting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <Layers className="w-3 h-3 text-slate-500" />
            {isBoltMode ? "Storage: Supabase" : "Storage: Express API"}
          </span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <Toggle label="Enable Tally export" checked={s.enabled} onChange={(v) => upd("enabled", v)} />
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
            {s.enabled ? "Active" : "Disabled"}
          </span>
        </div>

        <Row>
          <Field label="Export mode">
            <select
              value={s.mode || "xml"}
              onChange={(e) => upd("mode", e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            >
              <option value="xml">XML download (Standard import)</option>
              <option value="push">Direct push to Tally (Local server)</option>
              <option value="both">Both (Download + Direct Push)</option>
            </select>
          </Field>
          <Field label="Tally HTTP/ODBC Server URL">
            <input
              value={s.tallyUrl}
              onChange={(e) => upd("tallyUrl", e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              placeholder="http://localhost:9000"
            />
          </Field>
          <Field label="Company name (in Tally)">
            <input
              value={s.companyName}
              onChange={(e) => upd("companyName", e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              placeholder="Sunrise Media Pvt Ltd"
            />
          </Field>
          <Field label="Voucher type">
            <input
              value={s.voucherType}
              onChange={(e) => upd("voucherType", e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              placeholder="Sales"
            />
          </Field>
        </Row>

        <div className="pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">
            Tally Ledger Name Mappings
          </p>
          <Row>
            <Field label="Sales ledger">
              <input
                value={s.salesLedger}
                onChange={(e) => upd("salesLedger", e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </Field>
            <Field label="CGST ledger">
              <input
                value={s.cgstLedger}
                onChange={(e) => upd("cgstLedger", e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </Field>
            <Field label="SGST ledger">
              <input
                value={s.sgstLedger}
                onChange={(e) => upd("sgstLedger", e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </Field>
            <Field label="IGST ledger">
              <input
                value={s.igstLedger}
                onChange={(e) => upd("igstLedger", e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </Field>
            <Field label="Round-off ledger">
              <input
                value={s.roundOffLedger || ""}
                onChange={(e) => upd("roundOffLedger", e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </Field>
          </Row>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100">
          <button
            onClick={save}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg shadow-sm transition"
          >
            <Save className="w-3.5 h-3.5" /> Save Settings
          </button>
          <button
            onClick={testConnection}
            disabled={testing}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition disabled:opacity-40"
          >
            <FileCode2 className="w-3.5 h-3.5 text-slate-600" />
            {testing ? "Testing..." : "Test Tally Connection"}
          </button>
          {saved === "ok" && (
            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <CheckCircle className="w-3.5 h-3.5" /> Settings saved successfully!
            </span>
          )}
          {saved === "err" && (
            <span className="text-xs text-red-700 font-semibold flex items-center gap-1 bg-red-50 px-2.5 py-1 rounded-md border border-red-200">
              <XCircle className="w-3.5 h-3.5" /> Save failed. Please try again.
            </span>
          )}
          {testResult === "ok" && (
            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <CheckCircle className="w-3.5 h-3.5" /> Tally HTTP/XML server is reachable!
            </span>
          )}
          {testResult === "fail" && (
            <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
              Tally not reachable at {s.tallyUrl || "http://localhost:9000"}. Ensure Tally is open with XML/ODBC import enabled. XML download mode works without direct connection.
            </span>
          )}
        </div>
      </div>

      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 text-xs text-amber-900 space-y-2">
        <p className="font-bold text-amber-950 flex items-center gap-1.5">
          <FileCode2 className="w-4 h-4 text-amber-700" /> How to Import Invoices into Tally ERP 9 / TallyPrime
        </p>
        <ol className="list-decimal pl-4 space-y-1 text-slate-700 leading-relaxed">
          <li>
            In Sunrise ERP, navigate to <b>Finance → Submitted Invoices</b>.
          </li>
          <li>
            Click <b>XML</b> on any submitted invoice to download the generated <code>tally_INV-####.xml</code>.
          </li>
          <li>
            Open Tally on your computer, load your company, and select <i>Gateway of Tally → Import Data → Vouchers</i>.
          </li>
          <li>
            Specify the path to the downloaded XML file. Tally will automatically create the sales voucher with all customer, taxable, CGST, SGST, and IGST ledger allocations.
          </li>
          <li>
            If you enable <b>Direct Push</b>, ensure Tally's XML server is running on port 9000 (F12 → Advanced Configuration → Enable ODBC/XML Server).
          </li>
        </ol>
      </div>
    </div>
  );
}

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">{children}</div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">{label}</label>
    {children}
  </div>
);

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
    />
    <span className="font-bold text-slate-800">{label}</span>
  </label>
);
