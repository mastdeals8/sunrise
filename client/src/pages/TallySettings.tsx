import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Database, Save, CheckCircle, XCircle, FileCode2, AlertCircle } from "lucide-react";
import { isBoltMode } from "../lib/supabase";

interface TallySettings {
  enabled: boolean;
  mode?: string;       // "xml" | "push" | "both"
  tallyUrl: string;
  companyName: string;
  salesLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  roundOffLedger?: string;
  voucherType: string;
}

const DEFAULT: TallySettings = {
  enabled: false,
  mode: "xml",
  tallyUrl: "http://localhost:9000",
  companyName: "",
  salesLedger: "Sales",
  cgstLedger: "CGST",
  sgstLedger: "SGST",
  igstLedger: "IGST",
  roundOffLedger: "Round Off",
  voucherType: "Sales",
};

export default function TallySettingsPage() {
  const { token } = useAuth();
  const [s, setS] = useState<TallySettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<"" | "ok" | "err">("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"" | "ok" | "fail">("");

  useEffect(() => {
    if (!token || isBoltMode) return;
    fetch("/api/tally/settings", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : DEFAULT)
      .then(d => setS({ ...DEFAULT, ...d }))
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    if (isBoltMode) return;
    setSaved("");
    const r = await fetch("/api/tally/settings", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setSaved(r.ok ? "ok" : "err");
    setTimeout(() => setSaved(""), 2500);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult("");
    try {
      // Best-effort ping: Tally HTTP/XML responds on /. Local-only — browsers
      // cannot reach localhost:9000 over CORS so this is more of a hint.
      const r = await fetch(s.tallyUrl, { method: "GET", mode: "no-cors" }).catch(() => null);
      setTestResult(r ? "ok" : "fail");
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(""), 3000);
    }
  };

  if (isBoltMode) return (
    <div className="flex flex-col items-center justify-center h-[50vh] gap-4 text-center px-4">
      <AlertCircle className="w-10 h-10 text-amber-500" />
      <h2 className="text-lg font-bold text-slate-800">Tally Settings require the Express backend</h2>
      <p className="text-sm text-slate-500 max-w-sm">Tally integration is not available in Bolt preview mode.</p>
    </div>
  );

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  const upd = (k: keyof TallySettings, v: any) => setS({ ...s, [k]: v });

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-600" /> Tally Integration
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Export sales invoices as Tally XML or push directly to a running Tally instance. ERP remains the source of truth; Tally handles accounting.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
        <Toggle label="Enable Tally export" checked={s.enabled} onChange={v => upd("enabled", v)} />
        <Row>
          <Field label="Export mode">
            <select value={s.mode || "xml"} onChange={e => upd("mode", e.target.value)} className="input-compact">
              <option value="xml">XML download only</option>
              <option value="push">Direct push to Tally</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Tally URL">
            <input value={s.tallyUrl} onChange={e => upd("tallyUrl", e.target.value)} className="input-compact" placeholder="http://localhost:9000" />
          </Field>
          <Field label="Company name (in Tally)">
            <input value={s.companyName} onChange={e => upd("companyName", e.target.value)} className="input-compact" placeholder="Sunrise Media Pvt Ltd" />
          </Field>
          <Field label="Voucher type">
            <input value={s.voucherType} onChange={e => upd("voucherType", e.target.value)} className="input-compact" placeholder="Sales" />
          </Field>
        </Row>

        <div className="pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Ledger names</p>
          <Row>
            <Field label="Sales ledger"><input value={s.salesLedger} onChange={e => upd("salesLedger", e.target.value)} className="input-compact" /></Field>
            <Field label="CGST ledger"><input value={s.cgstLedger} onChange={e => upd("cgstLedger", e.target.value)} className="input-compact" /></Field>
            <Field label="SGST ledger"><input value={s.sgstLedger} onChange={e => upd("sgstLedger", e.target.value)} className="input-compact" /></Field>
            <Field label="IGST ledger"><input value={s.igstLedger} onChange={e => upd("igstLedger", e.target.value)} className="input-compact" /></Field>
            <Field label="Round-off ledger"><input value={s.roundOffLedger || ""} onChange={e => upd("roundOffLedger", e.target.value)} className="input-compact" /></Field>
          </Row>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md">
            <Save className="w-3.5 h-3.5" /> Save Settings
          </button>
          <button onClick={testConnection} disabled={testing} className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md disabled:opacity-30">
            <FileCode2 className="w-3.5 h-3.5" /> Test Connection
          </button>
          {saved === "ok" && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Saved</span>}
          {saved === "err" && <span className="text-xs text-red-700 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Save failed</span>}
          {testResult === "ok" && <span className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Tally reachable</span>}
          {testResult === "fail" && <span className="text-xs text-amber-700">Tally not reachable in browser. Use XML download mode.</span>}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
        <p className="font-bold mb-1">How to use</p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>Per invoice: open Submitted Invoices, click <b>Tally XML</b>. Browser downloads <code>tally_INV-####.xml</code>.</li>
          <li>In Tally: <i>Gateway of Tally → Import → Vouchers</i> → pick the XML file.</li>
          <li>Once imported, the invoice's Tally status moves to <b>exported_xml</b>. Mark <b>pushed_to_tally</b> manually once accountant confirms.</li>
          <li>Direct push is only available when Tally is running on the same machine with the HTTP/ODBC server enabled.</li>
        </ol>
      </div>
    </div>
  );
}

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
    {children}
  </div>
);
const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span className="font-semibold text-slate-700">{label}</span>
  </label>
);
