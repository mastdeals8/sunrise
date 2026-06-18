import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Send, CheckCircle, XCircle, RefreshCw, Save, AlertTriangle, Terminal, Trash2, AlertCircle } from "lucide-react";
import { isBoltMode } from "../lib/supabase";

interface TelegramConfig {
  platform: string;
  enabled: boolean;
  botToken: string | null;
  botUsername: string | null;
  webhookUrl: string | null;
  settings: any;
}

interface WebhookLog {
  id: number;
  platform: string;
  direction: string;
  event: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

const TelegramSettings: React.FC = () => {
  const { token } = useAuth();
  const [config, setConfig] = useState<TelegramConfig>({ platform: "telegram", enabled: false, botToken: null, botUsername: null, webhookUrl: null, settings: {} });
  const [tokenInput, setTokenInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => { if (!isBoltMode) { fetchConfig(); fetchLogs(); } }, []);

  const fetchConfig = async () => {
    if (isBoltMode) return;
    setLoading(true);
    try {
      const r = await fetch("/api/automation/telegram", { headers });
      if (r.ok) setConfig(await r.json());
    } finally { setLoading(false); }
  };

  const fetchLogs = async () => {
    if (isBoltMode) return;
    setLogsLoading(true);
    try {
      const r = await fetch("/api/automation/logs/telegram", { headers });
      if (r.ok) setLogs(await r.json());
    } finally { setLogsLoading(false); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBoltMode) { setMsg({ text: "Not available in Bolt preview mode.", ok: false }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        enabled: config.enabled,
        botUsername: config.botUsername || "",
        webhookUrl: config.webhookUrl || "",
      };
      if (tokenInput.trim()) payload.botToken = tokenInput.trim();
      const r = await fetch("/api/automation/telegram", { method: "PUT", headers, body: JSON.stringify(payload) });
      if (r.ok) {
        const updated = await r.json();
        setConfig(updated);
        setTokenInput("");
        setMsg({ text: "Settings saved.", ok: true });
      } else {
        const err = await r.json();
        setMsg({ text: err.message || "Save failed", ok: false });
      }
    } finally { setSaving(false); }
  };

  const webhookBase = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";

  if (isBoltMode) return (
    <div className="flex flex-col items-center justify-center h-[50vh] gap-4 text-center px-4">
      <AlertCircle className="w-10 h-10 text-amber-500" />
      <h2 className="text-lg font-bold text-slate-800">Telegram Settings require the Express backend</h2>
      <p className="text-sm text-slate-500 max-w-sm">Telegram bot integration is not available in Bolt preview mode.</p>
    </div>
  );

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2 mb-1">
          <Send className="w-5 h-5 text-blue-500" />
          Telegram Bot Settings
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Connect a Telegram bot to receive PO uploads, installation photos, signed challans, and other documents from staff on-site.
        </p>

        <form onSubmit={save} className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} />
              <div className="w-11 h-6 bg-slate-200 peer-checked:bg-blue-500 rounded-full peer transition-colors"></div>
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform"></div>
            </label>
            <span className="text-sm font-semibold text-slate-700">{config.enabled ? "Bot Enabled" : "Bot Disabled"}</span>
          </div>

          {/* Token */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Bot Token</label>
            {config.botToken && (
              <p className="text-xs text-slate-400 mb-1">Current: <span className="font-mono">{config.botToken}</span> (masked)</p>
            )}
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder={config.botToken ? "Enter new token to replace" : "Paste bot token from @BotFather"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">Token is stored encrypted and never shown in full. Get it from @BotFather on Telegram.</p>
          </div>

          {/* Bot Username */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Bot Username</label>
            <input
              type="text"
              value={config.botUsername || ""}
              onChange={e => setConfig(c => ({ ...c, botUsername: e.target.value }))}
              placeholder="@YourBotName"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {/* Webhook URL */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Webhook URL (set in Telegram)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.webhookUrl || ""}
                onChange={e => setConfig(c => ({ ...c, webhookUrl: e.target.value }))}
                placeholder={`${webhookBase}/api/webhook/telegram`}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Your webhook endpoint: <span className="font-mono text-blue-700">{webhookBase}/api/webhook/telegram</span>
            </p>
          </div>

          {msg && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${msg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {msg.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition shadow-sm disabled:opacity-50">
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>

      {/* Setup Guide */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-5">
        <h3 className="font-bold text-blue-800 text-sm mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Quick Setup Guide
        </h3>
        <ol className="text-xs text-blue-700 space-y-2 list-decimal pl-4">
          <li>Open Telegram and search for <strong>@BotFather</strong></li>
          <li>Send <code>/newbot</code> and follow prompts to create your bot</li>
          <li>Copy the token and paste it above</li>
          <li>Deploy this app on a public HTTPS URL (e.g., Render, Railway, Vercel)</li>
          <li>Set the webhook by calling:<br/>
            <code className="block mt-1 bg-blue-100 px-2 py-1 rounded text-[10px] break-all">
              https://api.telegram.org/bot{'<TOKEN>'}/setWebhook?url={webhookBase}/api/webhook/telegram
            </code>
          </li>
          <li>Staff can now send photos and documents to the bot — they appear in <strong>Bot Upload Inbox</strong></li>
        </ol>
        <p className="text-[10px] text-blue-500 mt-3 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Webhook requires a public HTTPS URL. Local development testing requires ngrok or similar tunnel.
        </p>
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
          <div className="p-6 text-center text-slate-400 text-xs">No webhook logs yet. Logs appear when Telegram sends messages to your webhook.</div>
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

export default TelegramSettings;
