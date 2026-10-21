import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Send,
  CheckCircle,
  XCircle,
  RefreshCw,
  Save,
  AlertTriangle,
  Terminal,
  Shield,
  ShieldCheck,
  UserCheck,
  UserX,
  Clock,
  FolderPlus,
  Trash2,
  Users,
  Copy,
  Check,
} from "lucide-react";
import { supabase, isBoltMode } from "../lib/supabase";
import { UnifiedInstallerDirectory } from "../components/UnifiedInstallerDirectory";

interface TelegramConfig {
  platform: string;
  enabled: boolean;
  botToken: string | null;
  botUsername: string | null;
  webhookUrl: string | null;
  adminChatId?: string | null;
  adminChatVerified?: boolean;
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

interface DiscoveredChat {
  chatId: string;
  name: string;
  username?: string;
  lastText?: string;
}

interface AccessRequest {
  id: string;
  chatId: string;
  name: string;
  phone: string;
  username?: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
}

interface StaffAssignment {
  id: number;
  name: string;
  phone: string | null;
  role: string;
  telegramChatId: string | null;
  isActive: boolean;
  assignedProjects: Array<{
    linkId: number;
    estimateId: number;
    estimateNumber: string;
    title: string;
    clientName: string;
  }>;
}

interface EstimateSummary {
  id: number;
  estimateNumber: string;
  title: string;
}

const TelegramSettings: React.FC = () => {
  const { token } = useAuth();
  const [config, setConfig] = useState<TelegramConfig>({
    platform: "telegram",
    enabled: false,
    botToken: null,
    botUsername: null,
    webhookUrl: null,
    adminChatId: "",
    adminChatVerified: false,
    settings: {},
  });
  const [tokenInput, setTokenInput] = useState("");
  const [adminChatIdInput, setAdminChatIdInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Discovery & Test
  const [discoveredChats, setDiscoveredChats] = useState<DiscoveredChat[]>([]);
  const [testChatId, setTestChatId] = useState("");
  const [testMessage, setTestMessage] = useState("Hello from Sunrise Media ERP! Telegram bot is operational.");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [verifyingAdmin, setVerifyingAdmin] = useState(false);
  const [adminVerifyResult, setAdminVerifyResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Access Requests & Staff Assignments
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [availableEstimates, setAvailableEstimates] = useState<EstimateSummary[]>([]);
  const [assignModalUser, setAssignModalUser] = useState<StaffAssignment | null>(null);
  const [selectedEstimateToAssign, setSelectedEstimateToAssign] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    fetchConfig();
    fetchLogs();
    fetchDiscoveredChats();
    fetchRequests();
    fetchAssignments();
    fetchEstimates();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      if (isBoltMode) {
        const { data, error } = await supabase.from("bot_settings").select("*").eq("platform", "telegram").limit(1).maybeSingle();
        if (data && !error) {
          const s = data.settings || {};
          setConfig({
            platform: data.platform,
            enabled: !!data.enabled,
            botToken: data.bot_token ? "••••" + data.bot_token.slice(-4) : null,
            botUsername: data.bot_username,
            webhookUrl: data.webhook_url,
            adminChatId: s.adminChatId || "",
            adminChatVerified: !!s.adminChatVerified,
            settings: s,
          });
          setAdminChatIdInput(s.adminChatId || "");
        }
        return;
      }
      const r = await fetch("/api/automation/telegram", { headers });
      if (r.ok) {
        const data = await r.json();
        const s = data.settings || {};
        setConfig({
          ...data,
          adminChatId: s.adminChatId || "",
          adminChatVerified: !!s.adminChatVerified,
        });
        setAdminChatIdInput(s.adminChatId || "");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      if (isBoltMode) {
        const { data } = await supabase.from("webhook_logs").select("*").eq("platform", "telegram").order("created_at", { ascending: false }).limit(50);
        if (data) {
          setLogs(
            data.map((d: any) => ({
              id: d.id,
              platform: d.platform,
              direction: d.direction,
              event: d.event,
              status: d.status,
              error: d.error,
              createdAt: d.created_at,
            }))
          );
        }
        return;
      }
      const r = await fetch("/api/automation/logs/telegram", { headers });
      if (r.ok) setLogs(await r.json());
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchDiscoveredChats = async () => {
    try {
      const r = await fetch("/api/automation/telegram/discover-chats", { headers });
      if (r.ok) {
        const data = await r.json();
        setDiscoveredChats(Array.isArray(data) ? data : []);
      }
    } catch {
      // silently handle
    }
  };

  const fetchRequests = async () => {
    setRequestsLoading(true);
    try {
      if (isBoltMode) {
        const { data } = await supabase.from("bot_settings").select("settings").eq("platform", "telegram").limit(1).maybeSingle();
        const s = data?.settings || {};
        setRequests(Array.isArray(s.accessRequests) ? s.accessRequests : []);
        return;
      }
      const r = await fetch("/api/automation/telegram/requests", { headers });
      if (r.ok) setRequests(await r.json());
    } finally {
      setRequestsLoading(false);
    }
  };

  const fetchAssignments = async () => {
    setAssignmentsLoading(true);
    try {
      if (isBoltMode) {
        const { data: usersData } = await supabase.from("users").select("id, name, phone, role, telegram_chat_id, is_active").not("telegram_chat_id", "is", null);
        if (usersData) {
          setAssignments(
            usersData.map((u: any) => ({
              id: u.id,
              name: u.name,
              phone: u.phone,
              role: u.role,
              telegramChatId: u.telegram_chat_id,
              isActive: !!u.is_active,
              assignedProjects: [],
            }))
          );
        }
        return;
      }
      const r = await fetch("/api/automation/telegram/assignments", { headers });
      if (r.ok) setAssignments(await r.json());
    } finally {
      setAssignmentsLoading(false);
    }
  };

  const fetchEstimates = async () => {
    try {
      if (isBoltMode) {
        const { data } = await supabase.from("estimates").select("id, estimate_number, title").order("id", { ascending: false }).limit(50);
        if (data) {
          setAvailableEstimates(data.map((d: any) => ({ id: d.id, estimateNumber: d.estimate_number, title: d.title })));
        }
        return;
      }
      const r = await fetch("/api/operations/estimates", { headers });
      if (r.ok) {
        const data = await r.json();
        setAvailableEstimates(
          data.map((d: any) => ({
            id: d.id,
            estimateNumber: d.estimateNumber,
            title: d.title,
          }))
        );
      }
    } catch {
      // ignore
    }
  };

  const handleVerifyAdmin = async () => {
    if (!adminChatIdInput.trim()) return;
    setVerifyingAdmin(true);
    setAdminVerifyResult(null);
    try {
      const r = await fetch("/api/automation/telegram/verify-admin", {
        method: "POST",
        headers,
        body: JSON.stringify({ adminChatId: adminChatIdInput.trim() }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setAdminVerifyResult({
          ok: true,
          msg: "Verification message sent to your Telegram. Tap 'Verify Admin Connection' in Telegram to complete.",
        });
      } else {
        setAdminVerifyResult({ ok: false, msg: data.message || "Failed to send admin verification." });
      }
    } catch (err: any) {
      setAdminVerifyResult({ ok: false, msg: err.message || "Network error" });
    } finally {
      setVerifyingAdmin(false);
    }
  };

  const handleApproveRequest = async (chatId: string) => {
    try {
      const r = await fetch(`/api/automation/telegram/requests/${chatId}/approve`, {
        method: "POST",
        headers,
      });
      if (r.ok) {
        fetchRequests();
        fetchAssignments();
      }
    } catch {
      // ignore
    }
  };

  const handleRejectRequest = async (chatId: string) => {
    try {
      const r = await fetch(`/api/automation/telegram/requests/${chatId}/reject`, {
        method: "POST",
        headers,
      });
      if (r.ok) {
        fetchRequests();
      }
    } catch {
      // ignore
    }
  };

  const handleAssignProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalUser || !selectedEstimateToAssign) return;
    setAssigning(true);
    try {
      const r = await fetch("/api/automation/telegram/assign", {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId: assignModalUser.id,
          estimateId: Number(selectedEstimateToAssign),
        }),
      });
      if (r.ok) {
        setAssignModalUser(null);
        setSelectedEstimateToAssign("");
        fetchAssignments();
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleRevokeProject = async (linkId: number) => {
    try {
      const r = await fetch("/api/automation/telegram/revoke", {
        method: "POST",
        headers,
        body: JSON.stringify({ linkId }),
      });
      if (r.ok) {
        fetchAssignments();
      }
    } catch {
      // ignore
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testChatId.trim()) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/automation/telegram/test", {
        method: "POST",
        headers,
        body: JSON.stringify({ chatId: testChatId.trim(), message: testMessage }),
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setTestResult({ ok: true, msg: "Test message delivered successfully to Telegram!" });
      } else {
        setTestResult({ ok: false, msg: data.message || "Failed to send test message" });
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.message || "Network error" });
    } finally {
      setSendingTest(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload: any = {
        enabled: config.enabled,
        botUsername: config.botUsername || "",
        webhookUrl: config.webhookUrl || "",
        settings: {
          ...config.settings,
          adminChatId: adminChatIdInput.trim() || null,
        },
      };
      if (tokenInput.trim()) payload.botToken = tokenInput.trim();

      if (isBoltMode) {
        const updateData: any = {
          platform: "telegram",
          enabled: config.enabled,
          bot_username: config.botUsername,
          webhook_url: config.webhookUrl,
          settings: payload.settings,
          updated_at: new Date().toISOString(),
        };
        if (tokenInput.trim()) updateData.bot_token = tokenInput.trim();
        const { error } = await supabase.from("bot_settings").upsert(updateData, { onConflict: "platform" });
        if (!error) {
          setTokenInput("");
          setMsg({ text: "Settings saved to Supabase successfully.", ok: true });
          fetchConfig();
        } else {
          setMsg({ text: error.message || "Save failed", ok: false });
        }
        return;
      }

      const r = await fetch("/api/automation/telegram", { method: "PUT", headers, body: JSON.stringify(payload) });
      if (r.ok) {
        const updated = await r.json();
        setConfig(updated);
        setTokenInput("");
        setMsg({ text: "Settings saved successfully.", ok: true });
      } else {
        const err = await r.json();
        setMsg({ text: err.message || "Save failed", ok: false });
      }
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const webhookBase = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "";

  if (loading) return <div className="p-8 text-slate-400 text-sm">Loading Telegram configuration...</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* 1. Bot Core Configuration */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2 mb-1">
          <Send className="w-5 h-5 text-blue-500" />
          Telegram Bot Settings
        </h2>
        <p className="text-xs text-slate-500 mb-5">
          Connect your Telegram Bot for field photo uploads, delivery challan proof, and automated administrator access control.
        </p>

        <form onSubmit={save} className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={config.enabled}
                onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
              />
              <div className="w-11 h-6 bg-slate-200 peer-checked:bg-blue-500 rounded-full peer transition-colors"></div>
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform"></div>
            </label>
            <span className="text-sm font-semibold text-slate-700">{config.enabled ? "Bot Enabled" : "Bot Disabled"}</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Bot Token</label>
            {config.botToken && (
              <p className="text-xs text-slate-400 mb-1">
                Current: <span className="font-mono">{config.botToken}</span> (masked)
              </p>
            )}
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={config.botToken ? "Enter new token to replace" : "Paste bot token from @BotFather"}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">Get the token from @BotFather on Telegram. Stored encrypted.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Bot Username</label>
            <input
              type="text"
              value={config.botUsername || ""}
              onChange={(e) => setConfig((c) => ({ ...c, botUsername: e.target.value }))}
              placeholder="@SunriseMediaBot"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {/* Admin Telegram Chat ID Configuration */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-600" />
                Administrator Telegram Chat ID (for private approvals)
              </label>
              {config.adminChatVerified ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verified
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  Unverified
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={adminChatIdInput}
                onChange={(e) => setAdminChatIdInput(e.target.value)}
                placeholder="e.g. 123456789"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400 bg-white"
              />
              <button
                type="button"
                onClick={handleVerifyAdmin}
                disabled={verifyingAdmin || !adminChatIdInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
              >
                {verifyingAdmin ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Verify Connection
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              The administrator must start the bot (send /start to @{config.botUsername?.replace("@", "") || "your_bot"}) before the bot can message them.
            </p>
            {adminVerifyResult && (
              <p className={`text-xs font-bold mt-1 ${adminVerifyResult.ok ? "text-emerald-700" : "text-red-600"}`}>
                {adminVerifyResult.msg}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Webhook URL</label>
            <input
              type="text"
              value={config.webhookUrl || ""}
              onChange={(e) => setConfig((c) => ({ ...c, webhookUrl: e.target.value }))}
              placeholder={`${webhookBase}/api/webhook/telegram`}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Your server endpoint: <span className="font-mono text-blue-700">{webhookBase}/api/webhook/telegram</span>
            </p>
          </div>

          {msg && (
            <div
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl ${
                msg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {msg.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {msg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>

      {/* 2. Pending Access Requests */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              Telegram Field Access Requests
            </h3>
            <p className="text-xs text-slate-400">
              Users who shared their contact via Telegram /start awaiting administrator approval.
            </p>
          </div>
          <button
            onClick={fetchRequests}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {requestsLoading ? (
          <div className="p-6 text-center text-slate-400 text-xs">Loading requests...</div>
        ) : requests.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">No pending access requests.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-sans">
              <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2.5 text-left">Contact Name</th>
                  <th className="px-4 py-2.5 text-left">Phone</th>
                  <th className="px-4 py-2.5 text-left">Telegram Chat ID</th>
                  <th className="px-4 py-2.5 text-left">Requested At</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-bold text-slate-800">{req.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{req.phone}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">{req.chatId}</td>
                    <td className="px-4 py-3 text-slate-400">{new Date(req.requestedAt).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          req.status === "approved"
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : req.status === "rejected"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.status === "pending" && (
                        <div className="inline-flex gap-2">
                          <button
                            onClick={() => handleApproveRequest(req.chatId)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[11px] shadow-sm transition"
                          >
                            <UserCheck className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => handleRejectRequest(req.chatId)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[11px] shadow-sm transition"
                          >
                            <UserX className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unified Installer Directory (Dual Channel: Telegram + WhatsApp) */}
      <UnifiedInstallerDirectory companyId={1} />

      {/* 3. Telegram Field Project Assignments */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-emerald-600" />
              Field Staff Project Assignments
            </h3>
            <p className="text-xs text-slate-400">
              Approved staff and contractors linked to Telegram. Field users can only view and upload to their assigned projects.
            </p>
          </div>
          <button
            onClick={fetchAssignments}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {assignmentsLoading ? (
          <div className="p-6 text-center text-slate-400 text-xs">Loading staff assignments...</div>
        ) : assignments.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No staff with Telegram Chat IDs found. Approve an access request above or link a Telegram Chat ID in Staff Master.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {assignments.map((staff) => (
              <div key={staff.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{staff.name}</span>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {staff.role}
                    </span>
                    <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      Chat ID: {staff.telegramChatId}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-400">Assigned Projects:</span>
                    {staff.assignedProjects.length === 0 ? (
                      <span className="text-xs text-amber-600 italic">No projects assigned</span>
                    ) : (
                      staff.assignedProjects.map((p) => (
                        <span
                          key={p.linkId}
                          className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1 rounded-lg font-medium"
                        >
                          <strong>{p.estimateNumber}</strong>
                          {p.clientName ? `— ${p.clientName}` : ""}
                          <button
                            onClick={() => handleRevokeProject(p.linkId)}
                            title="Revoke access"
                            className="text-red-500 hover:text-red-700 ml-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => {
                      setAssignModalUser(staff);
                      setSelectedEstimateToAssign("");
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold rounded-xl transition shadow-sm"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    Assign Project
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Assign Project */}
      {assignModalUser && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-100 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              Assign Project to {assignModalUser.name}
            </h3>
            <p className="text-xs text-slate-500">
              Select an active estimate/project. The user will immediately be able to select this project in Telegram and upload photos.
            </p>

            <form onSubmit={handleAssignProject} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Estimate</label>
                <select
                  value={selectedEstimateToAssign}
                  onChange={(e) => setSelectedEstimateToAssign(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white"
                  required
                >
                  <option value="">-- Choose Estimate / Project --</option>
                  {availableEstimates.map((est) => (
                    <option key={est.id} value={est.id}>
                      {est.estimateNumber} — {est.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignModalUser(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigning || !selectedEstimateToAssign}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
                >
                  {assigning ? "Assigning..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Test Message Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
        <h3 className="font-bold text-slate-800 text-sm">Send Test Telegram Message</h3>
        <form onSubmit={handleSendTest} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Recipient Chat ID</label>
              <input
                type="text"
                value={testChatId}
                onChange={(e) => setTestChatId(e.target.value)}
                placeholder="e.g. 111222333"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Message</label>
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={sendingTest || !testChatId.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition shadow-sm disabled:opacity-50"
          >
            {sendingTest ? "Sending..." : "Send Test Message"}
          </button>
          {testResult && (
            <p className={`text-xs font-bold ${testResult.ok ? "text-green-700" : "text-red-600"}`}>
              {testResult.msg}
            </p>
          )}
        </form>
      </div>

      {/* 5. Webhook Logs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-700 text-sm">Telegram Webhook Logs</h3>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {logsLoading ? (
          <div className="p-6 text-center text-slate-400 text-xs">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No webhook logs yet. Logs appear when Telegram sends messages to your webhook.
          </div>
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
                {logs.slice(0, 30).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 text-slate-500 font-mono">
                      {new Date(log.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{log.event || "—"}</td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          log.status === "processed"
                            ? "bg-green-50 text-green-700"
                            : log.status === "error"
                            ? "bg-red-50 text-red-700"
                            : "bg-slate-50 text-slate-600"
                        }`}
                      >
                        {log.status}
                      </span>
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
