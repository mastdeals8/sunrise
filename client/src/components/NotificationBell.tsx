import React from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type Notif = {
  id: number; type: string; title: string; message?: string;
  severity: "info" | "warning" | "critical"; read?: boolean; createdAt: string;
};

const sevDot: Record<string, string> = {
  info: "bg-sky-500", warning: "bg-amber-500", critical: "bg-red-500",
};

/**
 * Phase 3: lightweight notification bell. Polls /api/notifications (which
 * derives state at most every 60s server-side). No dashboard — just the bell,
 * a count, and a dropdown list. Deliberately minimal per scope.
 */
export const NotificationBell: React.FC = () => {
  const { token } = useAuth();
  const [items, setItems] = React.useState<Notif[]>([]);
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({});

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setItems(await res.json());
    } catch { /* offline / not logged in */ }
  }, [token]);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, [load]);

  const unread = items.filter((n) => !n.read).length;

  React.useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      setPanelStyle({
        position: "fixed",
        top: Math.min(rect.bottom + 8, window.innerHeight - 80),
        left,
        width,
        maxHeight: Math.max(260, window.innerHeight - rect.bottom - 24),
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

  const markRead = async (id: number) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch { /* best-effort */ }
  };

  return (
    <div className="relative">
      <button
        type="button"
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className="relative text-slate-500 hover:text-slate-900 transition p-1"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9999 }} onClick={() => setOpen(false)} />
          <div className="overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-2xl" style={panelStyle}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 sticky top-0 bg-white">
              <span className="text-sm font-semibold text-slate-700">
                Notifications {unread > 0 && <span className="text-slate-400 font-normal">({unread} new)</span>}
              </span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">All clear — nothing pending.</div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={`px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${n.read ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sevDot[n.severity] || "bg-slate-400"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{n.title}</p>
                        {n.message && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.message}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
};
