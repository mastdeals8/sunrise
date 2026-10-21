import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Save,
  AlertTriangle,
  QrCode,
  LogOut,
  Send,
  ExternalLink,
  ShieldCheck,
  Server,
  Phone,
  Clock,
  Copy,
  Check,
  Smartphone,
  Info,
  Users,
  Settings,
  Activity,
} from "lucide-react";
import { supabase, isBoltMode } from "../lib/supabase";
import { UnifiedInstallerDirectory } from "../components/UnifiedInstallerDirectory";

interface WhatsAppStatus {
  serverOnline: boolean;
  sessionState: "open" | "close" | "connecting" | "qrcode" | "disconnected";
  instanceName: string;
  phone?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  latencyMs?: number;
  version?: string;
  qrCode?: string | null;
  pairingCode?: string | null;
  error?: string | null;
}

interface WebhookLog {
  id: number;
  platform: string;
  direction?: string;
  event: string | null;
  status: string;
  error: string | null;
  payload: any;
  createdAt: string;
}

const WhatsAppSettings: React.FC = () => {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Configuration state
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("sunrise_company_1");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [companyId, setCompanyId] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<"directory" | "connection" | "logs">("directory");

  // Test messaging state
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState("Hello from Sunrise Media ERP! WhatsApp service is connected.");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // QR Code pairing state
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<number>(45);

  // Webhook Logs
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const webhookBase = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";
  const fullWebhookUrl = `${webhookBase}/api/webhook/whatsapp`;

  const pollIntervalRef = useRef<any>(null);

  useEffect(() => {
    fetchInitialData();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [companyId]);

  // Polling when QR code is active to detect successful scan
  useEffect(() => {
    if (status?.sessionState === "qrcode" || qrBase64) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          await fetchStatus(false);
        }, 3000);
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [status?.sessionState, qrBase64]);

  // Countdown for QR expiry
  useEffect(() => {
    if (!qrBase64) return;
    const timer = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          handleConnect(); // refresh QR
          return 45;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [qrBase64]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchConfig(), fetchStatus(true), fetchLogs()]);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/automation/whatsapp", { headers });
      if (res.ok) {
        const data = await res.json();
        const settings = data.settings || {};
        setServerUrl(settings.serverUrl || "https://sunrise-production-76df.up.railway.app");
        setInstanceName(settings.instanceName || `sunrise_company_${companyId}`);
        setWebhookSecret(settings.webhookSecret || "");
        if (data.botToken) setApiKey(data.botToken);
        return;
      }
      // Bolt direct fallback if backend fetch fails
      if (isBoltMode) {
        const { data, error } = await supabase.from("bot_settings").select("*").eq("platform", "whatsapp").limit(1).maybeSingle();
        if (data && !error) {
          const settings = data.settings || {};
          setServerUrl(settings.serverUrl || "https://sunrise-production-76df.up.railway.app");
          setInstanceName(settings.instanceName || `sunrise_company_${companyId}`);
          setWebhookSecret(settings.webhookSecret || "");
          if (data.bot_token) setApiKey("••••" + String(data.bot_token).slice(-4));
        } else {
          setServerUrl("https://sunrise-production-76df.up.railway.app");
        }
      }
    } catch (e) {
      console.error("Failed to fetch WhatsApp config", e);
      if (isBoltMode) {
        setServerUrl("https://sunrise-production-76df.up.railway.app");
      }
    }
  };

  const fetchStatus = async (showToast: boolean = false) => {
    try {
      const res = await fetch("/api/whatsapp/status", { headers });
      if (res.ok) {
        const data: WhatsAppStatus = await res.json();
        setStatus(data);

        // If session is open, clear QR code
        if (data.sessionState === "open") {
          setQrBase64(null);
          setPairingCode(null);
          if (showToast) {
            setMsg({ text: "WhatsApp session is active and verified.", ok: true });
          }
        } else if (data.qrCode && !qrBase64) {
          setQrBase64(data.qrCode);
          setPairingCode(data.pairingCode || null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setStatus({
          serverOnline: false,
          sessionState: "disconnected",
          instanceName: instanceName || `sunrise_company_${companyId}`,
          error: errData.message || `HTTP ${res.status}: Backend unreachable`,
        });
      }
    } catch (e: any) {
      console.error("Failed to fetch status", e);
      setStatus({
        serverOnline: false,
        sessionState: "disconnected",
        instanceName: instanceName || `sunrise_company_${companyId}`,
        error: "Express backend or Evolution API is unreachable.",
      });
    }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/automation/logs/whatsapp", { headers });
      if (res.ok) {
        setLogs(await res.json());
        return;
      }
      if (isBoltMode) {
        const { data } = await supabase
          .from("webhook_logs")
          .select("*")
          .eq("platform", "whatsapp")
          .order("created_at", { ascending: false })
          .limit(50);
        if (data) {
          setLogs(
            data.map((d: any) => ({
              id: d.id,
              platform: d.platform,
              direction: d.direction || "inbound",
              event: d.event,
              status: d.status,
              error: d.error,
              createdAt: d.created_at,
              payload: d.payload,
            }))
          );
        }
      }
    } catch {
      // ignore
    } finally {
      setLogsLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setMsg(null);
    try {
      const payload: any = {
        enabled: true,
        apiKey: apiKey.trim(),
        settings: {
          serverUrl: serverUrl.trim(),
          instanceName: instanceName.trim(),
          webhookSecret: webhookSecret.trim(),
        },
      };

      const res = await fetch("/api/automation/whatsapp", {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMsg({ text: "Configuration saved successfully. Verifying service...", ok: true });
        await fetchStatus(true);
        return;
      }

      if (isBoltMode) {
        const updateData: any = {
          platform: "whatsapp",
          enabled: true,
          updated_at: new Date().toISOString(),
          settings: {
            serverUrl: serverUrl.trim() || "https://sunrise-production-76df.up.railway.app",
            instanceName: instanceName.trim(),
            webhookSecret: webhookSecret.trim(),
          },
        };
        if (apiKey.trim() && !apiKey.trim().startsWith("••••")) {
          updateData.bot_token = apiKey.trim();
        }
        await supabase.from("bot_settings").upsert(updateData, { onConflict: "platform" });
        setMsg({ text: "Configuration saved successfully.", ok: true });
        await fetchStatus(true);
        return;
      }

      const err = await res.json().catch(() => ({}));
      setMsg({ text: err.message || "Failed to save configuration", ok: false });
    } catch (e: any) {
      if (isBoltMode) {
        try {
          const updateData: any = {
            platform: "whatsapp",
            enabled: true,
            updated_at: new Date().toISOString(),
            settings: {
              serverUrl: serverUrl.trim() || "https://sunrise-production-76df.up.railway.app",
              instanceName: instanceName.trim(),
              webhookSecret: webhookSecret.trim(),
            },
          };
          if (apiKey.trim() && !apiKey.trim().startsWith("••••")) {
            updateData.bot_token = apiKey.trim();
          }
          await supabase.from("bot_settings").upsert(updateData, { onConflict: "platform" });
          setMsg({ text: "Configuration saved successfully.", ok: true });
          await fetchStatus(true);
          return;
        } catch (dbErr: any) {
          setMsg({ text: dbErr.message || "Failed to save configuration", ok: false });
          return;
        }
      }
      setMsg({ text: e.message || "Failed to save configuration", ok: false });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.qrCode) {
          setQrBase64(data.qrCode);
          setPairingCode(data.pairingCode || null);
          setQrCountdown(45);
          setMsg({ text: "QR code generated. Scan with WhatsApp on your phone.", ok: true });
        } else if (data.state === "open") {
          setMsg({ text: "WhatsApp is already connected!", ok: true });
          setQrBase64(null);
          await fetchStatus(true);
        }
      } else {
        setMsg({ text: data.message || "Failed to initiate WhatsApp connection.", ok: false });
      }
    } catch (e: any) {
      setMsg({ text: e.message || "Connection error", ok: false });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Are you sure you want to disconnect this WhatsApp account? Incoming messages will stop until you scan the QR code again.")) {
      return;
    }
    setDisconnecting(true);
    try {
      const res = await fetch("/api/whatsapp/disconnect", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMsg({ text: "WhatsApp disconnected successfully.", ok: true });
        setQrBase64(null);
        setPairingCode(null);
        await fetchStatus(false);
      } else {
        setMsg({ text: data.message || "Failed to disconnect", ok: false });
      }
    } catch (e: any) {
      setMsg({ text: e.message || "Disconnect error", ok: false });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSendTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim() || !testText.trim()) return;

    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: testPhone.trim(),
          text: testText.trim(),
          companyId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          ok: true,
          text: `Message dispatched successfully! ID: ${data.messageId || "Sent"}`,
        });
        fetchLogs();
      } else {
        setTestResult({
          ok: false,
          text: data.message || "Failed to send message.",
        });
      }
    } catch (e: any) {
      setTestResult({ ok: false, text: e.message || "Network error" });
    } finally {
      setSendingTest(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(fullWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };


  const isConnected = status?.serverOnline && status?.sessionState === "open";

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-xl flex items-center gap-2">
                WhatsApp Integration
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Evolution API v2
                </span>
              </h1>
              <p className="text-xs text-slate-500">
                Connect your business WhatsApp account via QR pairing. Hosted on Railway with 24/7 session persistence.
              </p>
            </div>
          </div>
        </div>

        {/* Company Isolation Selector */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-1.5 self-start md:self-auto">
          <span className="text-[11px] font-semibold text-slate-500 px-2">Account:</span>
          {[
            { id: 1, label: "Sunrise Media (Pune)" },
            { id: 2, label: "Delhi Company" },
            { id: 3, label: "Rika Store" },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setCompanyId(c.id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                companyId === c.id
                  ? "bg-white text-emerald-700 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`p-5 rounded-2xl border transition-all ${
          isConnected
            ? "bg-emerald-50/70 border-emerald-200"
            : status?.serverOnline
            ? "bg-amber-50/70 border-amber-200"
            : "bg-slate-50 border-slate-200"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                isConnected
                  ? "bg-emerald-500 text-white shadow-md shadow-emerald-200"
                  : status?.serverOnline
                  ? "bg-amber-500 text-white shadow-md shadow-amber-200"
                  : "bg-slate-300 text-slate-600"
              }`}
            >
              {isConnected ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : status?.serverOnline ? (
                <QrCode className="w-6 h-6" />
              ) : (
                <Server className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  {isConnected
                    ? "WhatsApp Session Connected & Verified"
                    : status?.serverOnline
                    ? "Service Online — QR Pairing Required"
                    : "WhatsApp Service Offline"}
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    isConnected
                      ? "bg-emerald-100 text-emerald-800"
                      : status?.serverOnline
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? "bg-emerald-500 animate-pulse" : status?.serverOnline ? "bg-amber-500" : "bg-red-500"
                    }`}
                  />
                  {isConnected ? "CONNECTED" : status?.serverOnline ? "SCAN QR" : "DISCONNECTED"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-1">
                {status?.phone && (
                  <span className="flex items-center gap-1 font-mono font-bold text-emerald-800">
                    <Phone className="w-3.5 h-3.5" /> +{status.phone}
                  </span>
                )}
                {status?.profileName && <span className="font-semibold text-slate-700">{status.profileName}</span>}
                <span className="flex items-center gap-1 text-slate-500 font-mono">
                  <Server className="w-3.5 h-3.5" /> Instance: {status?.instanceName || instanceName}
                </span>
                {status?.latencyMs !== undefined && status.latencyMs > 0 && (
                  <span className="text-slate-400 font-mono text-[11px]">{status.latencyMs}ms latency</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchStatus(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl transition shadow-xs"
              title="Refresh connection status"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>

            {isConnected ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-bold rounded-xl transition shadow-xs disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                {disconnecting ? "Disconnecting..." : "Disconnect WhatsApp"}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
              >
                <QrCode className="w-3.5 h-3.5" />
                {connecting ? "Generating QR..." : "Connect / Scan QR"}
              </button>
            )}
          </div>
        </div>

        {status?.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{status.error}</span>
          </div>
        )}
      </div>

      {/* Global Alerts / Messages */}
      {msg && (
        <div
          className={`flex items-center gap-2 text-xs px-4 py-3 rounded-xl border ${
            msg.ok ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === "directory"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Installer Directory & Dual-Channel Assignments</span>
        </button>

        <button
          onClick={() => setActiveTab("connection")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === "connection"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Evolution API & QR Pairing</span>
        </button>

        <button
          onClick={() => setActiveTab("logs")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === "logs"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Webhook Event Logs ({logs.length})</span>
        </button>
      </div>

      {/* TAB 1: Unified Installer Directory */}
      {activeTab === "directory" && (
        <UnifiedInstallerDirectory companyId={companyId} />
      )}

      {/* TAB 2: Connection & Evolution API Configuration */}
      {activeTab === "connection" && (
        <>
      {/* QR Code Scan Section (Shown when QR is available and not connected) */}
      {!isConnected && qrBase64 && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex flex-col md:flex-row gap-8 items-center">
            {/* QR Card */}
            <div className="flex flex-col items-center bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-inner">
              <div className="bg-white p-3 rounded-xl shadow-md border border-slate-100 relative">
                <img src={qrBase64} alt="WhatsApp QR Code" className="w-64 h-64 object-contain rounded-lg" />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-3 font-mono">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>Refreshes in {qrCountdown}s</span>
                <button onClick={handleConnect} className="text-emerald-600 font-bold hover:underline ml-2">
                  Regenerate Now
                </button>
              </div>
            </div>

            {/* Step by step guide */}
            <div className="space-y-4 max-w-lg">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">How to link your WhatsApp Account</h3>
              </div>

              <ol className="space-y-3 text-xs text-slate-600 list-decimal pl-4">
                <li>
                  Open <strong>WhatsApp</strong> on your mobile phone.
                </li>
                <li>
                  Tap <strong>Settings</strong> (iOS) or <strong>⋮ Menu</strong> (Android) &gt;{" "}
                  <strong>Linked Devices</strong>.
                </li>
                <li>
                  Tap <strong>Link a Device</strong>.
                </li>
                <li>Point your phone camera at the QR code on the left to scan.</li>
                <li>
                  Once paired, this screen will instantly confirm connection. You can now send and receive messages
                  directly from Sunrise Media ERP!
                </li>
              </ol>

              {pairingCode && (
                <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                  <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wide">
                    Or Pair using Phone Code:
                  </p>
                  <p className="font-mono text-base font-black text-emerald-700 tracking-widest mt-1">
                    {pairingCode}
                  </p>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-[11px] text-slate-500 flex items-start gap-2">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  The session runs continuously on the hosted Railway server. Once paired, your phone does not need to stay
                  awake and your Mac can be switched off without disconnecting.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid: Test Message + Railway Configuration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Test Messaging Card */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-1">
              <Send className="w-4 h-4 text-emerald-600" />
              Test WhatsApp Messaging
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Send a test message to any WhatsApp number to verify outbound delivery.
            </p>

            <form onSubmit={handleSendTestMessage} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Recipient Phone Number</label>
                <input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="e.g. 9823633833 or 919823633833"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Test Message</label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {testResult && (
                <div
                  className={`text-xs p-3 rounded-xl border flex items-start gap-2 ${
                    testResult.ok
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResult.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={sendingTest || !testPhone.trim() || !isConnected}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingTest ? "Sending Test Message..." : "Send Test Message"}
              </button>
            </form>
          </div>

          {!isConnected && (
            <p className="text-[11px] text-amber-600 mt-3 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Connect WhatsApp above before testing message delivery.
            </p>
          )}
        </div>

        {/* Railway / Evolution API Connection Details */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 mb-1">
            <Server className="w-4 h-4 text-slate-700" />
            Hosted Service & Credentials
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Evolution API hosted on Railway with persistent PostgreSQL session storage.
          </p>

          <form onSubmit={handleSaveConfig} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Service URL (Railway / Server)</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://evolution-api-production.up.railway.app"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Global API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Secret Evolution API key"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">Kept securely on the backend; never exposed to clients.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Instance Identifier</label>
              <input
                type="text"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="sunrise_company_1"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">ERP Webhook Endpoint</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={fullWebhookUrl}
                  className="w-full border border-slate-200 bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-mono text-slate-600"
                />
                <button
                  type="button"
                  onClick={copyWebhookUrl}
                  className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition"
                  title="Copy Webhook URL"
                >
                  {copiedWebhook ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingConfig}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50 mt-2"
            >
              <Save className="w-3.5 h-3.5" />
              {savingConfig ? "Saving..." : "Save Configuration"}
            </button>
          </form>
        </div>
      </div>

      {/* Security & Anti-Ban Best Practices Card */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm text-white">WhatsApp Safety & Policy Guidelines</h3>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Sunrise Media ERP uses direct QR-pairing with Baileys via Evolution API. This gives you full control over your
          own number without per-template Meta fees. To keep your WhatsApp account safe from restrictions:
        </p>
        <ul className="text-xs text-slate-300 space-y-1.5 list-disc pl-5">
          <li>
            <strong>Use for genuine transactional communication:</strong> Send invoices, estimates, job proofs, and
            replies to client inquiries.
          </li>
          <li>
            <strong>Avoid unsolicited bulk broadcasts:</strong> WhatsApp enforces automatic spam filtering if many
            recipients flag or block messages.
          </li>
          <li>
            <strong>Continuous 24/7 Server:</strong> The Baileys session is maintained continuously in PostgreSQL on
            Railway. Normal restarts preserve credentials without re-scanning.
          </li>
        </ul>
      </div>
        </>
      )}

      {/* TAB 3: Webhook & Inbound Activity Logs */}
      {activeTab === "logs" && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Recent WhatsApp Activity & Webhook Logs</h3>
              <p className="text-xs text-slate-400">Live incoming and outgoing message events logged by the ERP</p>
            </div>
            <button
              onClick={fetchLogs}
              className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 font-bold px-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-xl transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Logs
            </button>
          </div>

          {logsLoading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No activity logged yet. Webhooks and message deliveries will appear here in real-time.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-sans">
                <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-3 text-left">Time</th>
                    <th className="px-5 py-3 text-left">Direction</th>
                    <th className="px-5 py-3 text-left">Event</th>
                    <th className="px-5 py-3 text-center">Status</th>
                    <th className="px-5 py-3 text-left">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.slice(0, 30).map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50">
                      <td className="px-5 py-3 text-slate-500 font-mono text-[11px]">
                        {new Date(log.createdAt).toLocaleString("en-IN")}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            log.direction === "outbound"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-purple-50 text-purple-700 border border-purple-200"
                          }`}
                        >
                          {log.direction || "inbound"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-800 font-mono font-medium">{log.event || "message"}</td>
                      <td className="px-5 py-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            log.status === "processed"
                              ? "bg-emerald-50 text-emerald-700"
                              : log.status === "error"
                              ? "bg-red-50 text-red-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-[11px] max-w-xs truncate">
                        {log.error ? (
                          <span className="text-red-600 font-medium">{log.error}</span>
                        ) : (
                          <span>{JSON.stringify(log.payload || {}).slice(0, 80)}...</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WhatsAppSettings;
