import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { MessageCircle, CheckCircle, XCircle, RefreshCw, Save, AlertTriangle, Terminal, Shield } from "lucide-react";

interface WhatsAppConfig {
  platform: string;
  enabled: boolean;
  botToken: string | null;
  botUsername: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  accessTokenHint: string | null;
  settings: any;
}

interface WebhookLog {
  id: number;
  platform: string;
  event: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

const WhatsAppSettings: React.FC = () => {
  const { token } = useAuth();
  const [config, setConfig] = useState<WhatsAppConfig>({ platform: "whatsapp", enabled: false, botToken: null, botUsername: null, webhookUrl: null, verifyToken: null, phoneNumberId: null, wabaId: null, accessTokenHint: null, settings: {} });
  const [accessTokenInput, setAccessTokenInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const webhookBase = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";

  useEffect(() => { fetchConfig(); fetchLogs(); }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/automation/whatsapp", { headers });
      if (r.ok) setConfig(await r.json());
    } finally { setLoading(false); }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const r = await fetch("/api/automation/logs/whatsapp", { headers });
      if (r.ok) setLogs(await r.json());
    } finally { setLogsLoading(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        enabled: config.enabled,
        verifyToken: config.verifyToken || "",
        phoneNumberId: config.phoneNumberId || "",
        wabaId: config.wabaId || "",
        webhookUrl: config.webhookUrl || "",
      };
      if (accessTokenInput.trim()) payload.botToken = accessTokenInput.trim();
      const r = await fetch("/api/automation/whatsapp", { method: "PUT", headers, body: JSON.stringify(payload) });
      if (r.ok) {
        const updated = await r.json();
        setConfig(updated);
        setAccessTokenInput("");
        setMsg({ text: "Settings saved.", ok: true });
      } else {
        const err = await r.json();
        setMsg({ text: err.message || "Save failed", ok: false });
      }
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2 mb-1">
          <MessageCircle className="w-5 h-5 text-green-500" />
          WhatsApp Business API Settings
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Receive inbound media messages (photos, documents) from WhatsApp via the official Meta Cloud API. Unmatched uploads go to the Bot Upload Inbox.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            WhatsApp Business Cloud API requires a verified Meta Business account, a phone number approved for the API, and a public HTTPS webhook URL. This screen saves your configuration; the actual API call requires real credentials.
          </p>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} />
              <div className="w-11 h-6 bg-slate-200 peer-checked:bg-green-500 rounded-full peer transition-colors"></div>
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform"></div>
            </label>
            <span className="text-sm font-semibold text-slate-700">{config.enabled ? "Integration Enabled" : "Integration Disabled"}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Phone Number ID</label>
              <input
                type="text"
                value={config.phoneNumberId || ""}
                onChange={e => setConfig(c => ({ ...c, phoneNumberId: e.target.value }))}
                placeholder="From Meta Developer Console"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">WABA ID</label>
              <input
                type="text"
                value={config.wabaId || ""}
                onChange={e => setConfig(c => ({ ...c, wabaId: e.target.value }))}
                placeholder="WhatsApp Business Account ID"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Access Token</label>
            {config.accessTokenHint && (
              <p className="text-xs text-slate-400 mb-1">Current: ends in <span className="font-mono">...{config.accessTokenHint}</span></p>
            )}
            <input
              type="password"
              value={accessTokenInput}
              onChange={e => setAccessTokenInput(e.target.value)}
              placeholder={config.accessTokenHint ? "Enter new token to replace" : "Paste your Meta access token"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">Token is stored server-side and never returned to the client. Only the last 4 characters are shown.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Webhook Verify Token</label>
            <input
              type="text"
              value={config.verifyToken || ""}
              onChange={e => setConfig(c => ({ ...c, verifyToken: e.target.value }))}
              placeholder="e.g. sunrise_verify_2026"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Your webhook: <span className="font-mono text-green-700">{webhookBase}/api/webhook/whatsapp</span>
            </p>
          </div>

          {msg && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${msg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {msg.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded-lg transition shadow-sm disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>

      {/* Setup Guide */}
      <div className="bg-green-50/50 border border-green-100 rounded-xl p-5">
        <h3 className="font-bold text-green-800 text-sm mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          WhatsApp Cloud API Setup
        </h3>
        <ol className="text-xs text-green-700 space-y-2 list-decimal pl-4">
          <li>Go to <strong>developers.facebook.com</strong> → Create App → Business</li>
          <li>Add the WhatsApp product to your app</li>
          <li>Get your <strong>Phone Number ID</strong> and <strong>WABA ID</strong> from the WhatsApp dashboard</li>
          <li>Generate an <strong>Access Token</strong> (System User Token for production)</li>
          <li>Set your webhook URL in Meta App Dashboard:<br/>
            <code className="block mt-1 bg-green-100 px-2 py-1 rounded text-[10px] break-all">
              {webhookBase}/api/webhook/whatsapp
            </code>
          </li>
          <li>Enter the same verify token here and in Meta Dashboard</li>
          <li>Subscribe to <strong>messages</strong> webhook field</li>
          <li>Inbound media will appear in <strong>Bot Upload Inbox</strong></li>
        </ol>
      </div>

      {/* Webhook Logs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-700 text-sm">Webhook Logs (last 100)</h3>
          <button onClick={fetchLogs} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {logsLoading ? (
          <div className="p-6 text-center text-slate-400 text-xs">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">No webhook logs yet. Logs appear when WhatsApp sends messages to your webhook.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-sans">
              <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 text-left">Time</th>
                  <th className="px-4 py-2 text-left">Event</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logs.slice(0, 50).map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 text-slate-500 font-mono">{new Date(log.createdAt).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-slate-700">{log.event || "—"}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${log.status === "processed" ? "bg-green-50 text-green-700" : log.status === "error" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>{log.status}</span>
                    </td>
                    <td className="px-4 py-2 text-red-600 text-[10px]">{log.error || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppSettings;
