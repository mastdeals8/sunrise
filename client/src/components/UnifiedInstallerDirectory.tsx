import React, { useState, useEffect, useMemo } from "react";
import {
  Users,
  Search,
  UserPlus,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Phone,
  MessageSquare,
  Bot,
  ExternalLink,
  ShieldCheck,
  Building2,
  Trash2,
  Edit2,
  FolderKanban,
  FileCheck,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Ban,
  CheckSquare,
  Square,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase, isBoltMode } from "../lib/supabase";
import { Pager, usePagedList } from "./Pager";

export interface AssignedProjectSummary {
  linkId: number;
  estimateId: number;
  estimateNumber: string;
  title: string;
  subject?: string;
  clientName?: string;
  storeName?: string;
  allowedStoreCodes?: string[];
  allowedDocumentTypes?: string[];
  expiresAt: string;
}

export interface InstallerContact {
  id: number;
  name: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  telegramChatId: string | null;
  telegramVerified: boolean;
  whatsappPhone: string | null;
  whatsappChatId: string | null;
  whatsappVerified: boolean;
  notes: string | null;
  companyId: number;
  assignedProjects: AssignedProjectSummary[];
}

export interface AccessRequest {
  id: string;
  phone: string;
  name?: string;
  remoteJid?: string;
  chatId?: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  platform: "whatsapp" | "telegram";
}

export function normalizePhoneDisplay(phone?: string | null): string {
  if (!phone) return "—";
  const clean = phone.replace(/[^\d+]/g, "");
  if (clean.length === 10) return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  if (clean.startsWith("+91") && clean.length === 13) {
    return `+91 ${clean.slice(3, 8)} ${clean.slice(8)}`;
  }
  return clean;
}

export const UnifiedInstallerDirectory: React.FC<{ companyId?: number }> = ({ companyId = 1 }) => {
  const { token, user } = useAuth();
  const headers = { Authorization: token ? `Bearer ${token}` : "", "Content-Type": "application/json" };

  const [installers, setInstallers] = useState<InstallerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [sortField, setSortField] = useState<"name" | "role" | "projects" | "status">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);

  // Estimates list for assignment dropdown
  const [estimates, setEstimates] = useState<any[]>([]);

  // Modals & form state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingInstaller, setEditingInstaller] = useState<InstallerContact | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formWhatsappPhone, setFormWhatsappPhone] = useState("");
  const [formRole, setFormRole] = useState("installer");
  const [formNotes, setFormNotes] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Assign Project Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerContact | null>(null);
  const [selectedEstimateIds, setSelectedEstimateIds] = useState<number[]>([]);
  const [assignSearch, setAssignSearch] = useState("");
  const [expandedStoreEstIds, setExpandedStoreEstIds] = useState<number[]>([]);
  const [storeCodesInput, setStoreCodesInput] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<{
    successful: Array<{ estimateId: number; estimateNumber: string }>;
    failed: Array<{ estimateId: number; error: string }>;
  } | null>(null);

  // Expanded projects view per installer
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Pending Access Requests (WhatsApp & Telegram)
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetchInstallers();
    fetchEstimates();
    fetchAccessRequests();
  }, [companyId, token]);

  const showToast = (text: string, ok: boolean = true) => {
    setActionFeedback({ text, ok });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const fetchInstallers = async () => {
    setLoading(true);
    try {
      if (isBoltMode) {
        // Direct Supabase query
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("*")
          .in("role", ["installer", "contractor", "staff", "field"]);

        if (userError || !userData) {
          setInstallers([]);
          return;
        }

        // Fetch active field access links
        const { data: linkData } = await supabase
          .from("field_access_links")
          .select("*")
          .is("revoked_at", null);

        const list: InstallerContact[] = userData.map((u: any) => {
          const uClean = (u.phone || "").replace(/\D/g, "").slice(-10);
          const userLinks = (linkData || []).filter((l: any) => {
            const metaUserId = l.metadata?.userId;
            const linkClean = (l.recipient_contact || "").replace(/\D/g, "").slice(-10);
            return (metaUserId && Number(metaUserId) === u.id) || (uClean && linkClean === uClean);
          });

          return {
            id: u.id,
            name: u.name || u.username,
            phone: u.phone,
            role: u.role || "installer",
            isActive: !!u.is_active,
            telegramChatId: u.telegram_chat_id || null,
            telegramVerified: !!u.telegram_chat_id,
            whatsappPhone: u.whatsapp_phone || u.phone || null,
            whatsappChatId: u.whatsapp_chat_id || null,
            whatsappVerified: !!u.whatsapp_verified,
            notes: u.notes,
            companyId,
            assignedProjects: userLinks.map((l: any) => ({
              linkId: l.id,
              estimateId: l.estimate_id,
              estimateNumber: l.metadata?.estimateNumber || `EST-${l.estimate_id}`,
              title: l.metadata?.title || `Project #${l.estimate_id}`,
              allowedStoreCodes: l.allowed_store_codes || undefined,
              allowedDocumentTypes: l.allowed_document_types || undefined,
              expiresAt: l.expires_at,
            })),
          };
        });

        setInstallers(list);
        return;
      }

      // Express API mode
      const res = await fetch(`/api/automation/installers`, { headers });
      if (res.ok) {
        const data = await res.json();
        setInstallers(data);
      }
    } catch (err: any) {
      console.error("Failed to load installers", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEstimates = async () => {
    try {
      if (!isBoltMode) {
        const res = await fetch("/api/automation/installers/eligible-estimates", { headers });
        if (res.ok) {
          const data = await res.json();
          setEstimates(data);
          return;
        }
      }

      // Bolt mode / fallback direct query
      const { data: estData } = await supabase
        .from("estimates")
        .select("id, estimate_number, title, subject, status, store_id, client_id, stores(name, store_code)")
        .eq("company_id", companyId)
        .not("status", "in", '("rejected","cancelled","completed","archived")')
        .order("id", { ascending: false });

      if (estData) {
        const { data: storeRows } = await supabase
          .from("execution_stores")
          .select("estimate_id, store_name, store_code");

        const byEst = new Map<number, string[]>();
        (storeRows || []).forEach((r: any) => {
          const list = byEst.get(r.estimate_id) || [];
          list.push(r.store_name || r.store_code || "");
          byEst.set(r.estimate_id, list);
        });

        const list = estData.map((d: any) => {
          let storeNames = byEst.get(d.id) || [];
          if (storeNames.length === 0 && d.stores) {
            storeNames = [d.stores.name || d.stores.store_code || "Store"];
          }
          const storeCount = storeNames.length;
          let storeSummary = "Main Project";
          if (storeCount === 1) {
            storeSummary = storeNames[0];
          } else if (storeCount > 1) {
            storeSummary = `${storeNames.slice(0, 3).join(", ")}${storeCount > 3 ? "..." : ""}`;
          }
          const label = `${d.estimate_number} — ${d.subject || d.title} (${storeSummary} — ${storeCount} store${storeCount === 1 ? "" : "s"})`;
          return {
            id: d.id,
            estimateId: d.id,
            estimateNumber: d.estimate_number,
            title: d.title,
            subject: d.subject || "",
            storeNames,
            storeCount,
            storeSummary,
            label,
            status: d.status,
          };
        });
        setEstimates(list);
      }
    } catch (err) {
      console.error("Failed to load eligible estimates", err);
    }
  };

  const fetchAccessRequests = async () => {
    setRequestsLoading(true);
    try {
      const all: AccessRequest[] = [];

      // 1. WhatsApp Access Requests
      if (!isBoltMode) {
        const waRes = await fetch(`/api/automation/whatsapp/requests`, { headers }).catch(() => null);
        if (waRes && waRes.ok) {
          const waRequests = await waRes.json();
          all.push(
            ...waRequests.map((r: any) => ({
              ...r,
              platform: "whatsapp",
            }))
          );
        }

        // 2. Telegram Access Requests
        const tgRes = await fetch(`/api/automation/telegram/requests`, { headers }).catch(() => null);
        if (tgRes && tgRes.ok) {
          const tgRequests = await tgRes.json();
          all.push(
            ...tgRequests.map((r: any) => ({
              id: String(r.chatId || r.id),
              phone: r.phone || r.username || "",
              name: r.name || r.username || `Telegram Chat ${r.chatId}`,
              chatId: String(r.chatId),
              requestedAt: r.requestedAt || new Date().toISOString(),
              status: r.status || "pending",
              platform: "telegram",
            }))
          );
        }
      } else {
        // Bolt mode direct check from bot_settings
        const { data } = await supabase
          .from("bot_settings")
          .select("*")
          .in("platform", ["whatsapp", "telegram"]);

        (data || []).forEach((row: any) => {
          const reqs = row.settings?.accessRequests || [];
          reqs.forEach((r: any) => {
            all.push({
              ...r,
              platform: row.platform,
            });
          });
        });
      }

      setAccessRequests(all);
    } catch {
      // ignore
    } finally {
      setRequestsLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingInstaller(null);
    setFormName("");
    setFormPhone("");
    setFormWhatsappPhone("");
    setFormRole("installer");
    setFormNotes("");
    setFormIsActive(true);
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditModal = (inst: InstallerContact) => {
    setEditingInstaller(inst);
    setFormName(inst.name);
    setFormPhone(inst.phone || "");
    setFormWhatsappPhone(inst.whatsappPhone || "");
    setFormRole(inst.role || "installer");
    setFormNotes(inst.notes || "");
    setFormIsActive(inst.isActive);
    setFormError(null);
    setShowAddModal(true);
  };

  const handleSaveInstaller = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormError(null);

    const cleanPhone = formPhone.replace(/\D/g, "");
    if (!formName.trim()) {
      setFormError("Full Name is required.");
      setFormSaving(false);
      return;
    }
    if (cleanPhone.length < 10) {
      setFormError("A valid 10-digit mobile phone number is required.");
      setFormSaving(false);
      return;
    }

    try {
      const normalizedPhone = formPhone.trim().startsWith("+") ? formPhone.trim() : `+91${cleanPhone.slice(-10)}`;
      const normalizedWhatsapp = formWhatsappPhone.trim()
        ? formWhatsappPhone.trim().startsWith("+")
          ? formWhatsappPhone.trim()
          : `+91${formWhatsappPhone.replace(/\D/g, "").slice(-10)}`
        : normalizedPhone;

      const payload: any = {
        id: editingInstaller ? editingInstaller.id : undefined,
        company_id: companyId,
        name: formName.trim(),
        phone: normalizedPhone,
        whatsapp_phone: normalizedWhatsapp,
        role: formRole,
        notes: formNotes.trim() || undefined,
        is_active: formIsActive,
      };

      let saved = false;

      // 1. Try Express backend endpoint first
      if (!isBoltMode) {
        try {
          const res = await fetch("/api/automation/installers", {
            method: "POST",
            headers,
            body: JSON.stringify({
              id: payload.id,
              name: payload.name,
              phone: payload.phone,
              whatsappPhone: payload.whatsapp_phone,
              role: payload.role,
              notes: payload.notes,
              isActive: payload.is_active,
            }),
          });
          if (res.ok) {
            saved = true;
          } else {
            const err = await res.json().catch(() => ({}));
            if (err?.message && !err.message.includes("Failed to fetch")) {
              throw new Error(err.message || "Failed to save installer");
            }
          }
        } catch (fetchErr: any) {
          if (!isBoltMode && fetchErr.message && !fetchErr.message.includes("Failed to fetch")) {
            throw fetchErr;
          }
        }
      }

      // 2. If not saved via backend, use secure admin_upsert_installer RPC (avoids users table permission denial!)
      if (!saved) {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc("admin_upsert_installer", {
          payload,
        });
        if (rpcErr) {
          throw new Error(rpcErr.message);
        }
        if (rpcRes && !rpcRes.success) {
          throw new Error(rpcRes.error || "Failed to save installer contact");
        }
      }

      setShowAddModal(false);
      showToast(editingInstaller ? "Installer updated successfully" : "New installer registered successfully");
      await fetchInstallers();
    } catch (err: any) {
      setFormError(err.message || "Error saving contact");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeactivate = async (inst: InstallerContact) => {
    if (!confirm(`Are you sure you want to deactivate ${inst.name}? All active Telegram and WhatsApp project links will be revoked.`)) {
      return;
    }

    try {
      if (isBoltMode) {
        await supabase.from("users").update({ is_active: false }).eq("id", inst.id);
        await supabase
          .from("field_access_links")
          .update({ revoked_at: new Date().toISOString() })
          .eq("metadata->>userId", String(inst.id));
        showToast(`Deactivated ${inst.name}`);
        await fetchInstallers();
        return;
      }

      const res = await fetch(`/api/automation/installers/${inst.id}`, { method: "DELETE", headers });
      if (res.ok) {
        showToast(`Deactivated ${inst.name}`);
        await fetchInstallers();
      }
    } catch (err: any) {
      showToast(err.message || "Failed to deactivate", false);
    }
  };

  const openAssignModal = (inst?: InstallerContact) => {
    setSelectedInstaller(inst || (installers[0] || null));
    setSelectedEstimateIds([]);
    setAssignSearch("");
    setExpandedStoreEstIds([]);
    setStoreCodesInput("");
    setAssignError(null);
    setBatchResults(null);
    setShowAssignModal(true);
    fetchEstimates();
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInstaller) {
      setAssignError("Please select an installer.");
      return;
    }
    if (selectedEstimateIds.length === 0) {
      setAssignError("Please select at least one project to assign.");
      return;
    }

    setAssigning(true);
    setAssignError(null);
    setBatchResults(null);

    const storeCodes = storeCodesInput
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      if (isBoltMode) {
        const successful: Array<{ estimateId: number; estimateNumber: string }> = [];
        const failed: Array<{ estimateId: number; error: string }> = [];

        for (const estId of selectedEstimateIds) {
          try {
            const est = estimates.find((e) => e.id === estId);
            const tokenHash = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            const expiresAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();

            const { error } = await supabase.from("field_access_links").insert({
              estimate_id: estId,
              token_hash: tokenHash,
              token_prefix: tokenHash.slice(0, 8),
              channel: "dual",
              recipient_name: selectedInstaller.name,
              recipient_contact: selectedInstaller.phone || selectedInstaller.whatsappPhone || "",
              allowed_store_codes: storeCodes.length > 0 ? storeCodes : null,
              allowed_document_types: ["photo", "signed_challan", "wcc", "signed_wcc", "extra"],
              expires_at: expiresAt,
              metadata: {
                userId: selectedInstaller.id,
                companyId,
                estimateNumber: est?.estimateNumber || `EST-${estId}`,
                title: est?.title || `Project #${estId}`,
                assignedVia: "unified_installer_directory",
              },
            });

            if (error) throw new Error(error.message);
            successful.push({ estimateId: estId, estimateNumber: est?.estimateNumber || `EST-${estId}` });
          } catch (err: any) {
            failed.push({ estimateId: estId, error: err?.message || "Failed to assign" });
          }
        }

        setBatchResults({ successful, failed });
        await fetchInstallers();
        if (failed.length === 0) {
          showToast(`Assigned ${successful.length} project(s) to ${selectedInstaller.name} on both channels!`);
          setTimeout(() => {
            setShowAssignModal(false);
            setBatchResults(null);
          }, 1500);
        } else {
          showToast(`Assigned ${successful.length} project(s), ${failed.length} failed`, false);
        }
        return;
      }

      // Express API (supports batch assignment)
      const res = await fetch("/api/automation/installers/assign", {
        method: "POST",
        headers,
        body: JSON.stringify({
          installerId: selectedInstaller.id,
          estimateIds: selectedEstimateIds,
          allowedStoreCodes: storeCodes.length > 0 ? storeCodes : undefined,
          allowedDocumentTypes: ["photo", "signed_challan", "wcc", "signed_wcc", "extra"],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to assign project(s)");
      }

      if (data.results) {
        const { successful, failed } = data.results;
        setBatchResults({ successful, failed });
        await fetchInstallers();
        if (failed.length === 0) {
          showToast(`Assigned ${successful.length} project(s) to ${selectedInstaller.name} on both channels!`);
          setTimeout(() => {
            setShowAssignModal(false);
            setBatchResults(null);
          }, 1500);
        } else {
          showToast(`Assigned ${successful.length} project(s), ${failed.length} failed`, false);
        }
      } else {
        showToast(`Assigned project to ${selectedInstaller.name} on both Telegram & WhatsApp!`);
        setShowAssignModal(false);
        await fetchInstallers();
      }
    } catch (err: any) {
      setAssignError(err.message || "Failed to save assignment");
    } finally {
      setAssigning(false);
    }
  };

  const handleRevokeAssignment = async (linkId: number, installerName: string) => {
    if (!confirm(`Revoke this project assignment for ${installerName}?`)) return;

    try {
      if (isBoltMode) {
        await supabase
          .from("field_access_links")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", linkId);
        showToast("Assignment revoked");
        await fetchInstallers();
        return;
      }

      const res = await fetch(`/api/automation/installers/revoke-assignment/${linkId}`, {
        method: "POST",
        headers,
      });
      if (res.ok) {
        showToast("Assignment revoked across both channels");
        await fetchInstallers();
      }
    } catch (err: any) {
      showToast(err.message || "Failed to revoke", false);
    }
  };

  const handleApproveRequest = async (req: AccessRequest) => {
    try {
      if (req.platform === "whatsapp") {
        const res = await fetch("/api/automation/whatsapp/requests/approve", {
          method: "POST",
          headers,
          body: JSON.stringify({ phone: req.phone }),
        });
        if (res.ok) {
          showToast(`Approved WhatsApp access for ${req.name || req.phone}`);
        } else {
          const d = await res.json();
          showToast(d.message || "Failed to approve WhatsApp request", false);
        }
      } else {
        const res = await fetch(`/api/automation/telegram/requests/${req.chatId}/approve`, {
          method: "POST",
          headers,
          body: JSON.stringify({ phone: req.phone, name: req.name }),
        });
        if (res.ok) {
          showToast(`Approved Telegram access for ${req.name || req.chatId}`);
        } else {
          const d = await res.json();
          showToast(d.message || "Failed to approve Telegram request", false);
        }
      }
      await fetchAccessRequests();
      await fetchInstallers();
    } catch (err: any) {
      showToast(err.message || "Error approving request", false);
    }
  };

  const handleRejectRequest = async (req: AccessRequest) => {
    if (!confirm(`Reject access request from ${req.name || req.phone}?`)) return;
    try {
      if (req.platform === "whatsapp") {
        await fetch("/api/automation/whatsapp/requests/reject", {
          method: "POST",
          headers,
          body: JSON.stringify({ phone: req.phone }),
        });
      } else {
        await fetch(`/api/automation/telegram/requests/${req.chatId}/reject`, {
          method: "POST",
          headers,
        });
      }
      showToast(`Rejected access request`);
      await fetchAccessRequests();
    } catch (err: any) {
      showToast(err.message || "Error rejecting request", false);
    }
  };

  // Sorting & Filtering logic
  const handleSort = (field: "name" | "role" | "projects" | "status") => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const filteredAndSortedInstallers = useMemo(() => {
    const list = installers.filter((inst) => {
      const matchSearch =
        !searchQuery.trim() ||
        inst.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (inst.phone && inst.phone.includes(searchQuery)) ||
        (inst.whatsappPhone && inst.whatsappPhone.includes(searchQuery));

      const matchRole = roleFilter === "all" || inst.role === roleFilter;
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? inst.isActive : !inst.isActive);

      return matchSearch && matchRole && matchStatus;
    });

    return [...list].sort((a, b) => {
      let comparison = 0;
      if (sortField === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === "role") {
        comparison = a.role.localeCompare(b.role);
      } else if (sortField === "projects") {
        comparison = a.assignedProjects.length - b.assignedProjects.length;
      } else if (sortField === "status") {
        comparison = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [installers, searchQuery, roleFilter, statusFilter, sortField, sortDirection]);

  const { page, setPage, slice: pagedInstallers, total, pageSize } = usePagedList(
    filteredAndSortedInstallers,
    25
  );

  const pendingRequests = useMemo(() => {
    return accessRequests.filter((r) => r.status === "pending");
  }, [accessRequests]);

  const allPageSelected =
    pagedInstallers.length > 0 &&
    pagedInstallers.every((inst) => selectedContactIds.includes(inst.id));

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedContactIds((prev) =>
        prev.filter((id) => !pagedInstallers.some((inst) => inst.id === id))
      );
    } else {
      const pageIds = pagedInstallers.map((inst) => inst.id);
      setSelectedContactIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelectContact = (id: number) => {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const renderSortIndicator = (field: "name" | "role" | "projects" | "status") => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 ml-1 inline opacity-60 group-hover:opacity-100" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3 text-indigo-600 ml-1 inline" />
    ) : (
      <ArrowDown className="w-3 h-3 text-indigo-600 ml-1 inline" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Toast message */}
      {actionFeedback && (
        <div
          className={`p-3 rounded-lg text-sm font-medium flex items-center justify-between border ${
            actionFeedback.ok
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          <span>{actionFeedback.text}</span>
          <button onClick={() => setActionFeedback(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Pending Access Requests Table (if any) */}
      {pendingRequests.length > 0 && (
        <div className="bg-white border border-amber-300 rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
              <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Pending Field Access Requests ({pendingRequests.length})
              </h3>
            </div>
            <span className="text-[11px] text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded font-medium">
              Awaiting Administrator Approval
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-amber-50/40 text-amber-900 border-b border-amber-200/70 text-[11px] font-semibold">
                  <th className="py-2 px-3">Platform</th>
                  <th className="py-2 px-3">Worker Name</th>
                  <th className="py-2 px-3">Phone</th>
                  <th className="py-2 px-3">Requested At</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {pendingRequests.map((req) => (
                  <tr key={`${req.platform}-${req.id}`} className="hover:bg-amber-50/30 transition-colors">
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          req.platform === "whatsapp"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {req.platform === "whatsapp" ? (
                          <MessageSquare className="w-3 h-3" />
                        ) : (
                          <Bot className="w-3 h-3" />
                        )}
                        {req.platform}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-800">
                      {req.name || "Unknown Worker"}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {normalizePhoneDisplay(req.phone)}
                    </td>
                    <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                      {new Date(req.requestedAt).toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
                      {new Date(req.requestedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        onClick={() => handleApproveRequest(req)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold transition shadow-sm"
                      >
                        Approve & Link
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 rounded text-[11px] font-semibold transition"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Directory Top Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              Shared Installer & Contractor Directory
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Register contractors once. Assignments automatically grant access to both Telegram and WhatsApp bots.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openAssignModal()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-semibold transition shadow-sm"
            >
              <FolderKanban className="w-3.5 h-3.5 text-indigo-600" />
              Assign Project
            </button>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition shadow-sm"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add Contact
            </button>
          </div>
        </div>

        {/* Search & Filters Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name (e.g. Rajesh) or mobile number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Roles</option>
              <option value="installer">Installers</option>
              <option value="contractor">Contractors</option>
              <option value="staff">Staff</option>
              <option value="field">Field Ops</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
            <button
              onClick={() => {
                fetchInstallers();
                fetchAccessRequests();
              }}
              title="Refresh Directory"
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Selected contacts action bar */}
        {selectedContactIds.length > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-900">
            <span className="font-semibold">
              {selectedContactIds.length} contact{selectedContactIds.length > 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const firstSelected = installers.find((i) => selectedContactIds.includes(i.id));
                  if (firstSelected) openAssignModal(firstSelected);
                }}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-xs shadow-sm transition"
              >
                Assign Project
              </button>
              <button
                onClick={() => setSelectedContactIds([])}
                className="text-slate-500 hover:text-slate-700 text-xs"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Directory Table (Excel-style compact table) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
            Loading installer directory...
          </div>
        ) : filteredAndSortedInstallers.length === 0 ? (
          <div className="p-8 text-center text-slate-500 space-y-2">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No contacts found</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery
                ? `No installer matching "${searchQuery}". Click 'Add Contact' to register them.`
                : "No installers or contractors registered in this company workspace yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-700 font-semibold text-[11px] select-none">
                    <th className="py-2 px-3 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleSelectAllPage}
                        title="Select / deselect all on this page"
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th
                      onClick={() => handleSort("name")}
                      className="py-2 px-3 cursor-pointer hover:bg-slate-100 transition group"
                    >
                      <span>Contact Name</span>
                      {renderSortIndicator("name")}
                    </th>
                    <th className="py-2 px-3">Mobile Number</th>
                    <th
                      onClick={() => handleSort("role")}
                      className="py-2 px-3 cursor-pointer hover:bg-slate-100 transition group"
                    >
                      <span>Role</span>
                      {renderSortIndicator("role")}
                    </th>
                    <th className="py-2 px-3">WhatsApp Status</th>
                    <th className="py-2 px-3">Telegram Status</th>
                    <th
                      onClick={() => handleSort("projects")}
                      className="py-2 px-3 cursor-pointer hover:bg-slate-100 transition group"
                    >
                      <span>Active Projects</span>
                      {renderSortIndicator("projects")}
                    </th>
                    <th
                      onClick={() => handleSort("status")}
                      className="py-2 px-3 cursor-pointer hover:bg-slate-100 transition group"
                    >
                      <span>Status</span>
                      {renderSortIndicator("status")}
                    </th>
                    <th className="py-2 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedInstallers.map((inst) => {
                    const isExpanded = expandedId === inst.id;
                    const projectCount = inst.assignedProjects.length;
                    const isSelected = selectedContactIds.includes(inst.id);

                    return (
                      <React.Fragment key={inst.id}>
                        <tr
                          className={`hover:bg-slate-50/70 transition-colors ${
                            !inst.isActive ? "bg-slate-50/40 text-slate-400" : ""
                          } ${isSelected ? "bg-indigo-50/30" : ""}`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectContact(inst.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-900 leading-tight">
                              {inst.name}
                            </div>
                            {inst.notes && (
                              <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5" title={inst.notes}>
                                {inst.notes}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span>{normalizePhoneDisplay(inst.phone || inst.whatsappPhone)}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {inst.role}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {inst.whatsappVerified ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Linked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                <XCircle className="w-3 h-3 text-slate-300" />
                                Not Linked
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {inst.telegramVerified ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                                <CheckCircle2 className="w-3 h-3 text-sky-600" />
                                Linked
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                <XCircle className="w-3 h-3 text-slate-300" />
                                Not Linked
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : inst.id)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                                projectCount > 0
                                  ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                              title={isExpanded ? "Collapse projects" : "Expand project details"}
                            >
                              <span>{projectCount} {projectCount === 1 ? "project" : "projects"}</span>
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3 text-indigo-600" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-slate-400" />
                              )}
                            </button>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {inst.isActive ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                Inactive
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openAssignModal(inst)}
                                title="Assign project to this contact"
                                className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition"
                              >
                                <FolderKanban className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openEditModal(inst)}
                                title="Edit contact details"
                                className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {inst.isActive && (
                                <button
                                  onClick={() => handleDeactivate(inst)}
                                  title="Deactivate contact and revoke bot links"
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Inline Expandable Project Assignments Sub-Table */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 border-b border-slate-200">
                            <td colSpan={9} className="p-3 pl-8">
                              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <FolderKanban className="w-3.5 h-3.5 text-indigo-600" />
                                    Active Project Assignments for {inst.name} ({projectCount})
                                  </span>
                                  <button
                                    onClick={() => openAssignModal(inst)}
                                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold"
                                  >
                                    + Assign Another Project
                                  </button>
                                </div>
                                {projectCount === 0 ? (
                                  <p className="text-xs text-slate-400 py-1">
                                    No projects currently assigned to {inst.name}.
                                  </p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left border-collapse">
                                      <thead>
                                        <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 pb-1">
                                          <th className="py-1 px-2">Estimate #</th>
                                          <th className="py-1 px-2">Project Title</th>
                                          <th className="py-1 px-2">Store Scope</th>
                                          <th className="py-1 px-2">Expires At</th>
                                          <th className="py-1 px-2 text-right">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {inst.assignedProjects.map((p) => (
                                          <tr key={p.linkId} className="hover:bg-slate-50/50">
                                            <td className="py-1.5 px-2 font-mono font-semibold text-slate-700">
                                              {p.estimateNumber}
                                            </td>
                                            <td className="py-1.5 px-2 text-slate-900 font-medium">
                                              {p.title}
                                            </td>
                                            <td className="py-1.5 px-2 text-slate-500">
                                              {p.storeName ||
                                                (p.allowedStoreCodes?.length
                                                  ? p.allowedStoreCodes.join(", ")
                                                  : "All permitted stores")}
                                            </td>
                                            <td className="py-1.5 px-2 text-slate-500 whitespace-nowrap">
                                              {new Date(p.expiresAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-1.5 px-2 text-right">
                                              <button
                                                onClick={() => handleRevokeAssignment(p.linkId, inst.name)}
                                                className="px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded border border-rose-200 transition"
                                              >
                                                Revoke
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50/60">
              <Pager
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </div>

      {/* MODAL: Add / Edit Installer Contact */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingInstaller ? "Edit Installer Contact" : "Register New Installer / Contractor"}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveInstaller} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name / Display Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rajesh Kumar"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mobile Phone (Primary) *</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. +91 98236 33833 or 9823633833"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  Normalized to international E.164 (+91...). Used for duplicate prevention.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">WhatsApp Phone (If Different)</label>
                <input
                  type="tel"
                  placeholder="Leave empty if same as primary phone"
                  value={formWhatsappPhone}
                  onChange={(e) => setFormWhatsappPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="installer">Installer</option>
                    <option value="contractor">Contractor</option>
                    <option value="staff">Staff</option>
                    <option value="field">Field Worker</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={formIsActive ? "true" : "false"}
                    onChange={(e) => setFormIsActive(e.target.value === "true")}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes / Regions</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Pune & Mumbai installations, acrylic fabrication"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {formSaving ? "Saving..." : editingInstaller ? "Update Contact" : "Register Contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: One-Click Dual-Channel Multi-Project Assignment */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-4 border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FolderKanban className="w-4 h-4 text-indigo-600" />
                  Assign Ongoing Projects (Dual-Channel)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Browse and assign ongoing company projects to this installer for both Telegram & WhatsApp.
                </p>
              </div>
              <button
                onClick={() => setShowAssignModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {assignError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                <span>{assignError}</span>
              </div>
            )}

            {batchResults && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5 flex-shrink-0">
                {batchResults.successful.length > 0 && (
                  <div className="text-emerald-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Assigned {batchResults.successful.length} project(s): {batchResults.successful.map((s) => s.estimateNumber).join(", ")}</span>
                  </div>
                )}
                {batchResults.failed.length > 0 && (
                  <div className="text-rose-700 font-medium space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>{batchResults.failed.length} project(s) failed:</span>
                    </div>
                    <ul className="list-disc pl-5 text-[11px] text-rose-600">
                      {batchResults.failed.map((f) => (
                        <li key={f.estimateId}>Project #{f.estimateId}: {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSaveAssignment} className="space-y-4 text-xs flex-1 overflow-hidden flex flex-col">
              <div className="flex-shrink-0">
                <label className="block font-semibold text-slate-700 mb-1">Installer / Contractor *</label>
                <select
                  required
                  value={selectedInstaller?.id || ""}
                  onChange={(e) => {
                    const inst = installers.find((i) => i.id === Number(e.target.value));
                    setSelectedInstaller(inst || null);
                    setSelectedEstimateIds([]);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Choose Installer --</option>
                  {installers.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} ({normalizePhoneDisplay(inst.phone)}) — {inst.role}
                    </option>
                  ))}
                </select>
              </div>

              {/* Projects Selector with Search, Select All, and Project Labels */}
              <div className="flex-1 flex flex-col min-h-0 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="font-semibold text-slate-700">
                    Select Ongoing Projects *
                    <span className="ml-2 font-normal text-slate-500">
                      ({selectedEstimateIds.length} selected)
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const alreadyAssigned = new Set((selectedInstaller?.assignedProjects || []).map((p) => p.estimateId));
                        const q = assignSearch.trim().toLowerCase();
                        const matching = estimates.filter((e) => {
                          if (alreadyAssigned.has(e.id)) return false;
                          if (!q) return true;
                          return (
                            (e.estimateNumber || "").toLowerCase().includes(q) ||
                            (e.title || "").toLowerCase().includes(q) ||
                            (e.subject || "").toLowerCase().includes(q) ||
                            (e.label || "").toLowerCase().includes(q) ||
                            (e.storeNames || []).some((sn: string) => sn.toLowerCase().includes(q))
                          );
                        });
                        setSelectedEstimateIds(matching.map((e) => e.id));
                      }}
                      className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition flex items-center gap-1"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEstimateIds([])}
                      className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition flex items-center gap-1"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Search input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by estimate number, subject, title, store name..."
                    value={assignSearch}
                    onChange={(e) => setAssignSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                  />
                </div>

                {/* Scrollable Project Checklist */}
                <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50/50 p-1">
                  {(() => {
                    const alreadyAssigned = new Set((selectedInstaller?.assignedProjects || []).map((p) => p.estimateId));
                    const q = assignSearch.trim().toLowerCase();
                    const filtered = estimates.filter((e) => {
                      if (!q) return true;
                      return (
                        (e.estimateNumber || "").toLowerCase().includes(q) ||
                        (e.title || "").toLowerCase().includes(q) ||
                        (e.subject || "").toLowerCase().includes(q) ||
                        (e.label || "").toLowerCase().includes(q) ||
                        (e.storeNames || []).some((sn: string) => sn.toLowerCase().includes(q))
                      );
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className="p-6 text-center text-slate-400 text-xs">
                          {assignSearch ? "No eligible ongoing projects match your search." : "No eligible ongoing projects found in this company."}
                        </div>
                      );
                    }

                    return filtered.map((est) => {
                      const isAssigned = alreadyAssigned.has(est.id);
                      const isSelected = selectedEstimateIds.includes(est.id);
                      const isStoresExpanded = expandedStoreEstIds.includes(est.id);

                      return (
                        <div
                          key={est.id}
                          className={`p-2.5 rounded-md transition ${
                            isAssigned
                              ? "bg-slate-100/70 opacity-75 cursor-not-allowed"
                              : isSelected
                              ? "bg-indigo-50/70 border border-indigo-200"
                              : "hover:bg-white"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              disabled={isAssigned}
                              checked={isAssigned || isSelected}
                              onChange={(e) => {
                                if (isAssigned) return;
                                if (e.target.checked) {
                                  setSelectedEstimateIds([...selectedEstimateIds, est.id]);
                                } else {
                                  setSelectedEstimateIds(selectedEstimateIds.filter((id) => id !== est.id));
                                }
                              }}
                              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-slate-900">{est.estimateNumber}</span>
                                <span className="text-slate-400">—</span>
                                <span className="font-medium text-slate-700">{est.subject || est.title}</span>
                                {isAssigned ? (
                                  <span className="text-[10px] bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
                                    Already Assigned
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                                    {est.storeCount || 1} {((est.storeCount || 1) === 1 ? "store" : "stores")}
                                  </span>
                                )}
                              </div>

                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                                <span>📍 {est.storeSummary || est.storeName || "Main Project Site"}</span>
                                {est.storeNames && est.storeNames.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isStoresExpanded) {
                                        setExpandedStoreEstIds(expandedStoreEstIds.filter((id) => id !== est.id));
                                      } else {
                                        setExpandedStoreEstIds([...expandedStoreEstIds, est.id]);
                                      }
                                    }}
                                    className="text-indigo-600 hover:text-indigo-800 underline text-[10px] font-medium"
                                  >
                                    {isStoresExpanded ? "Hide store list" : `View all ${est.storeNames.length} stores`}
                                  </button>
                                )}
                              </div>

                              {isStoresExpanded && est.storeNames && est.storeNames.length > 1 && (
                                <div className="mt-1.5 p-2 bg-white rounded border border-slate-200 text-[10px] text-slate-600 space-y-0.5">
                                  <div className="font-semibold text-slate-700">All Stores:</div>
                                  <div className="grid grid-cols-2 gap-1 max-h-24 overflow-y-auto">
                                    {est.storeNames.map((sn: string, idx: number) => (
                                      <div key={idx} className="truncate">• {sn}</div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="flex-shrink-0">
                <label className="block font-semibold text-slate-700 mb-1">Permitted Store Codes Scope (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. ST-001, ST-002 (Leave blank for full project scope)"
                  value={storeCodesInput}
                  onChange={(e) => setStoreCodesInput(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                />
              </div>

              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-indigo-900 space-y-1 flex-shrink-0">
                <div className="font-semibold flex items-center gap-1.5 text-xs">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  Dual-Channel Authorization
                </div>
                <p className="text-[11px] text-indigo-700">
                  Assigning will instantly authorize uploads via both Telegram bot and WhatsApp bot.
                  The installer can upload installation photos, delivery challans, and transportation photos directly.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigning || selectedEstimateIds.length === 0}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {assigning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Assigning...</span>
                    </>
                  ) : (
                    <span>Assign {selectedEstimateIds.length} Selected Project{selectedEstimateIds.length === 1 ? "" : "s"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
