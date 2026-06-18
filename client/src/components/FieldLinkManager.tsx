import React from "react";
import {
  Link2, Copy, Check, Ban, Clock, Send, RefreshCw, Activity, RotateCw, AlertCircle,
} from "lucide-react";
import { Button, StatusBadge, Card, SectionHeader, EmptyState, cn } from "@/components/ui-kit";
import { useAuth } from "@/contexts/AuthContext";
import { isBoltMode } from "@/lib/supabase";

type Recipient = { id: number; name: string; role: string; telegramChatId?: string | null };
type Delivery = {
  id: number; recipientName: string; status: string; error?: string | null;
  retryCount: number; sentAt?: string | null; createdAt: string;
};

/**
 * Phase 4 (Part B): Field-link management UI.
 *
 * STRICTLY a UI surface over EXISTING endpoints — no new APIs:
 *   GET    /api/operations/field-access-links?estimateId=
 *   POST   /api/operations/field-access-links          (create)
 *   POST   /api/operations/field-access-links/:id/revoke
 * The list endpoint already returns useCount, lastUsedAt, revokedAt,
 * expiresAt, channel and a computed `active` flag — everything below is
 * derived from that. No schema/contract change.
 */

type FieldLink = {
  id: number;
  estimateId: number;
  channel: string;
  recipientName?: string | null;
  tokenPrefix?: string | null;
  allowedStoreCodes?: string[];
  allowedDocumentTypes?: string[];
  expiresAt: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  useCount: number;
  createdAt: string;
  active: boolean;
  url?: string;
};

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const linkState = (l: FieldLink): "active" | "revoked" | "expired" => {
  if (l.revokedAt) return "revoked";
  if (new Date(l.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
};

const STATE_LABEL: Record<string, string> = { active: "active", revoked: "cancelled", expired: "overdue" };

export const FieldLinkManager: React.FC<{ estimateId: number; estimateNumber?: string }> = ({
  estimateId, estimateNumber,
}) => {
  const { token } = useAuth();
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  if (isBoltMode) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
        <AlertCircle className="w-8 h-8 text-amber-500" />
        <p className="text-sm font-semibold text-slate-700">Field Links require the Express backend</p>
        <p className="text-xs text-slate-500">This feature is not available in Bolt preview mode.</p>
      </div>
    );
  }
  const [links, setLinks] = React.useState<FieldLink[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "active" | "expired" | "revoked">("all");
  const [recipients, setRecipients] = React.useState<Recipient[]>([]);
  const [deliveries, setDeliveries] = React.useState<Delivery[]>([]);
  const [sendingFor, setSendingFor] = React.useState<number | null>(null);
  const [pickerFor, setPickerFor] = React.useState<FieldLink | null>(null);
  const [retrying, setRetrying] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [linkRes, recRes, delRes] = await Promise.all([
        fetch(`/api/operations/field-access-links?estimateId=${estimateId}`, { headers: auth }),
        fetch(`/api/users`, { headers: auth }),
        fetch(`/api/operations/telegram/deliveries?estimateId=${estimateId}`, { headers: auth }),
      ]);
      if (linkRes.ok) setLinks(await linkRes.json());
      if (recRes.ok) {
        const all: Recipient[] = await recRes.json();
        // Only users who have a Telegram chat id can receive a bot message.
        setRecipients(all.filter((u) => u.telegramChatId));
      }
      if (delRes.ok) setDeliveries(await delRes.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [estimateId, token]);

  React.useEffect(() => { load(); }, [load]);

  // Real ERP→Telegram bot send (replaces the old share intent).
  const sendBot = async (link: FieldLink, recipientUserId: number) => {
    setSendingFor(link.id);
    try {
      const res = await fetch("/api/operations/telegram/send", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          estimateId,
          fieldLinkId: link.id,
          recipientUserId,
          url: link.url || `${window.location.origin}/field/${link.tokenPrefix || ""}`,
        }),
      });
      await res.json().catch(() => ({}));
    } catch { /* ignore */ }
    setSendingFor(null);
    setPickerFor(null);
    await load();
  };

  const retryDelivery = async (id: number) => {
    setRetrying(id);
    try {
      await fetch(`/api/operations/telegram/deliveries/${id}/retry`, { method: "POST", headers: auth });
    } catch { /* ignore */ }
    setRetrying(null);
    await load();
  };

  const createLink = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/operations/field-access-links", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ estimateId, channel: "telegram" }),
      });
      if (res.ok) await load();
    } catch { /* ignore */ }
    setCreating(false);
  };

  const revoke = async (id: number) => {
    try {
      const res = await fetch(`/api/operations/field-access-links/${id}/revoke`, { method: "POST", headers: auth });
      if (res.ok) await load();
    } catch { /* ignore */ }
  };

  const copy = (l: FieldLink) => {
    const url = l.url || `${window.location.origin}/field/${l.tokenPrefix || ""}…`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(l.id);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // Delivery status for a given link (latest delivery row, if any).
  const latestDeliveryFor = (linkId: number) =>
    deliveries.find((d) => (d as any).fieldLinkId === linkId);

  const counts = {
    active: links.filter((l) => linkState(l) === "active").length,
    expired: links.filter((l) => linkState(l) === "expired").length,
    revoked: links.filter((l) => linkState(l) === "revoked").length,
  };
  const shown = filter === "all" ? links : links.filter((l) => linkState(l) === filter);

  return (
    <Card padded>
      <SectionHeader
        icon={<Link2 className="w-5 h-5" />}
        title="Field Upload Links"
        subtitle="Generate, share and revoke secure field-upload links."
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>
            <Button variant="primary" size="sm" onClick={createLink} loading={creating}>
              <Link2 className="w-4 h-4" /> Generate Link
            </Button>
          </>
        }
      />

      {/* Filter chips with live counts */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(["all", "active", "expired", "revoked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-medium border transition-all capitalize",
              filter === f
                ? "bg-orange-50 border-orange-200 text-orange-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            {f}
            {f !== "all" && <span className="ml-1.5 text-slate-400 tabular-nums">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">Loading links…</div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Link2 className="w-6 h-6" />}
          title={filter === "all" ? "No field links yet" : `No ${filter} links`}
          description="Generate a secure link to let field staff upload photos and signed WCCs for this project."
          action={filter === "all" ? <Button size="sm" onClick={createLink} loading={creating}><Link2 className="w-4 h-4" /> Generate Link</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((l) => {
            const state = linkState(l);
            return (
              <li key={l.id} className="border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-slate-500">…{l.tokenPrefix || l.id}</span>
                      <StatusBadge status={STATE_LABEL[state]} label={state} />
                      <span className="text-xs text-slate-400 capitalize">{l.channel}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> {l.useCount} use{l.useCount === 1 ? "" : "s"}</span>
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> last {fmt(l.lastUsedAt)}</span>
                      <span className="hidden sm:inline">expires {fmt(l.expiresAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {state === "active" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => copy(l)} aria-label="Copy link">
                          {copied === l.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="subtle" size="sm"
                          onClick={() => setPickerFor(pickerFor?.id === l.id ? null : l)}
                          loading={sendingFor === l.id}
                        >
                          <Send className="w-3.5 h-3.5" /> Send
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => revoke(l.id)} aria-label="Revoke">
                          <Ban className="w-4 h-4 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Recipient picker (bot send) */}
                {pickerFor?.id === l.id && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    {recipients.length === 0 ? (
                      <p className="text-xs text-slate-400 py-1">
                        No users have a Telegram chat ID yet. Add one in User Management → user profile.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-slate-500 self-center mr-1">Send to:</span>
                        {recipients.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => sendBot(l, r.id)}
                            disabled={sendingFor === l.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border border-slate-200 bg-white hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 transition-all disabled:opacity-50"
                          >
                            <Send className="w-3 h-3" /> {r.name}
                            <span className="text-slate-400 capitalize">· {r.role}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Per-link delivery status */}
                {(() => {
                  const d = latestDeliveryFor(l.id);
                  if (!d) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 text-slate-500">
                        <Send className="w-3 h-3" /> Sent to {d.recipientName}
                        <StatusBadge status={d.status === "sent" ? "approved" : d.status === "failed" ? "error" : "pending"} label={d.status} />
                        {d.error && <span className="text-red-500 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {d.error}</span>}
                      </span>
                      {d.status === "failed" && (
                        <Button variant="ghost" size="sm" onClick={() => retryDelivery(d.id)} loading={retrying === d.id}>
                          <RotateCw className="w-3 h-3" /> Retry
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      )}

      {/* Message history (per project) */}
      {deliveries.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Message History</h4>
          <ul className="space-y-1.5">
            {deliveries.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs py-1">
                <span className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={d.status === "sent" ? "approved" : d.status === "failed" ? "error" : "pending"} label={d.status} dot />
                  <span className="text-slate-600 truncate">{d.recipientName}</span>
                  <span className="text-slate-400">{new Date(d.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {d.retryCount > 0 && <span className="text-slate-400">· {d.retryCount} retr{d.retryCount === 1 ? "y" : "ies"}</span>}
                </span>
                {d.status === "failed" && (
                  <Button variant="ghost" size="sm" onClick={() => retryDelivery(d.id)} loading={retrying === d.id}>
                    <RotateCw className="w-3 h-3" /> Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};
