import React from "react";
import { createPortal } from "react-dom";
import { Bell, X, Check, CheckCheck, CheckCircle2, RotateCcw, Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "@/lib/api";

type Notif = {
  id: number;
  type: string;
  title: string;
  message?: string;
  severity: "info" | "warning" | "critical";
  read?: boolean;
  estimateId?: number | null;
  invoiceId?: number | null;
  deliveryChallanId?: number | null;
  createdAt: string;
};

const sevDot: Record<string, string> = {
  info: "bg-sky-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

function formatTimestamp(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export const NotificationBell: React.FC = () => {
  const { token } = useAuth();
  const [items, setItems] = React.useState<Notif[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [isMarkingAll, setIsMarkingAll] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({});
  const successTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = React.useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setErrorMessage(null);
      const data = await fetchNotifications(token);
      setItems(Array.isArray(data) ? (data as Notif[]) : []);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load notifications");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    load();
    const t = setInterval(() => load(false), 90_000);
    return () => clearInterval(t);
  }, [load]);

  const unreadCount = items.filter((n) => !n.read).length;

  React.useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(380, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      setPanelStyle({
        position: "fixed",
        top: Math.min(rect.bottom + 8, window.innerHeight - 80),
        left,
        width,
        maxHeight: Math.max(280, Math.min(520, window.innerHeight - rect.bottom - 24)),
        zIndex: 10000,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  // Clean up timer on unmount
  React.useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const toggleRead = async (id: number, shouldRead: boolean) => {
    // Optimistic UI update
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: shouldRead } : n)));
    try {
      const ok = await markNotificationAsRead(id, token, shouldRead);
      if (!ok) {
        // Rollback on network failure
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: !shouldRead } : n)));
        setErrorMessage("Could not update notification status");
      }
    } catch {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: !shouldRead } : n)));
      setErrorMessage("Network error updating notification");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);
    setErrorMessage(null);

    // Optimistically mark all in local state
    const previousItems = [...items];
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));

    try {
      const ok = await markAllNotificationsAsRead(token);
      if (ok) {
        setSuccessMessage("All notifications marked as read");
        if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      } else {
        setItems(previousItems);
        setErrorMessage("Failed to mark all as read. Please try again.");
      }
    } catch (err: any) {
      setItems(previousItems);
      setErrorMessage(err?.message || "Error marking all notifications as read");
    } finally {
      setIsMarkingAll(false);
    }
  };

  const displayedItems = filter === "unread" ? items.filter((n) => !n.read) : items;

  return (
    <div className="relative">
      <button
        type="button"
        ref={buttonRef}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) {
            setErrorMessage(null);
            setSuccessMessage(null);
          }
        }}
        className="relative text-slate-500 hover:text-slate-900 transition p-1.5 rounded-md hover:bg-slate-100"
        aria-label={`Notifications (${unreadCount} unread)`}
        title={`Notifications (${unreadCount} unread)`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9999 }} onClick={() => setOpen(false)} />
          <div
            className="overflow-hidden bg-white border border-slate-200 rounded-lg shadow-2xl flex flex-col"
            style={panelStyle}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">Notifications</span>
                {unreadCount > 0 ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    {unreadCount} new
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 font-medium">All caught up</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    disabled={isMarkingAll}
                    onClick={handleMarkAllAsRead}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50 transition px-2 py-0.5 rounded hover:bg-blue-50"
                    title="Mark all notifications as read"
                  >
                    {isMarkingAll ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Marking...</span>
                      </>
                    ) : (
                      <>
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Mark all as read</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition"
                  aria-label="Close notifications panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-slate-100 bg-slate-50/60 text-xs shrink-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`px-2.5 py-0.5 rounded text-xs font-medium transition ${
                    filter === "all"
                      ? "bg-white text-slate-800 shadow-xs border border-slate-200 font-semibold"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  All ({items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("unread")}
                  className={`px-2.5 py-0.5 rounded text-xs font-medium transition flex items-center gap-1.5 ${
                    filter === "unread"
                      ? "bg-white text-slate-800 shadow-xs border border-slate-200 font-semibold"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span>Unread</span>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
                      {unreadCount}
                    </span>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={loading}
                className="text-[11px] text-slate-400 hover:text-slate-700 transition"
                title="Refresh notifications"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
              </button>
            </div>

            {/* Success indicator banner */}
            {successMessage && (
              <div className="mx-3 mt-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center justify-between shrink-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  {successMessage}
                </span>
                <button
                  type="button"
                  onClick={() => setSuccessMessage(null)}
                  className="text-emerald-500 hover:text-emerald-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Error indicator banner */}
            {errorMessage && (
              <div className="mx-3 mt-2 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-center justify-between shrink-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  {errorMessage}
                </span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  All clear — nothing pending.
                </div>
              ) : displayedItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400">
                  {filter === "unread" ? "No unread notifications." : "No notifications found."}
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {displayedItems.map((n) => {
                    const isRead = Boolean(n.read);
                    return (
                      <li
                        key={n.id}
                        onClick={() => {
                          if (!isRead) toggleRead(n.id, true);
                        }}
                        className={`px-3 py-2.5 cursor-pointer transition flex items-start gap-2.5 group ${
                          isRead
                            ? "bg-slate-50/70 opacity-65 hover:opacity-100 hover:bg-slate-100/70 border-l-2 border-l-transparent"
                            : "bg-white hover:bg-blue-50/30 border-l-2 border-l-blue-600"
                        }`}
                      >
                        {/* Dot indicator */}
                        <div className="pt-1 shrink-0 flex items-center gap-1">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              sevDot[n.severity] || "bg-slate-400"
                            } ${isRead ? "opacity-40" : ""}`}
                            title={`Severity: ${n.severity}`}
                          />
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1.5">
                            <p
                              className={`text-xs leading-snug line-clamp-1 ${
                                isRead ? "font-normal text-slate-600" : "font-semibold text-slate-900"
                              }`}
                            >
                              {n.title}
                            </p>
                            {n.createdAt && (
                              <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                                {formatTimestamp(n.createdAt)}
                              </span>
                            )}
                          </div>
                          {n.message && (
                            <p
                              className={`text-[11px] mt-0.5 line-clamp-2 leading-tight ${
                                isRead ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              {n.message}
                            </p>
                          )}
                        </div>

                        {/* Action: Mark as read / unread toggle button */}
                        <div className="shrink-0 self-center pl-1">
                          {isRead ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRead(n.id, false);
                              }}
                              className="p-1 rounded text-slate-300 hover:text-slate-700 hover:bg-slate-200/60 transition"
                              title="Mark as unread"
                              aria-label="Mark as unread"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRead(n.id, true);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"
                              title="Mark as read"
                              aria-label="Mark as read"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};
