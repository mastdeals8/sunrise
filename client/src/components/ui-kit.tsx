import React from "react";

/**
 * Sunrise ERP — shared UI primitives (Phase 4 modernization).
 *
 * STRICTLY PRESENTATIONAL. No data fetching, no business logic, no routing.
 * Built on the existing CSS token layer in index.css (charcoal/orange brand).
 * These exist so every screen shares one visual language instead of
 * hand-classed one-offs. Drop-in: each accepts className passthrough so
 * existing layouts are unaffected.
 */

// ── cn helper (no new dependency) ───────────────────────────────────────────
export const cn = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 " +
  "disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap";

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-orange-600 text-white shadow-sm hover:bg-orange-700 active:bg-orange-800",
  secondary:
    "bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:bg-slate-950",
  outline:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800",
  subtle:
    "bg-orange-50 text-orange-700 hover:bg-orange-100 active:bg-orange-200",
};

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(BTN_BASE, BTN_VARIANTS[variant], BTN_SIZES[size], className)}
      {...props}
    >
      {loading && (
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
);
Button.displayName = "Button";

// ── StatusBadge ─────────────────────────────────────────────────────────────
// Maps the actual status vocabulary used across the app (counted from source)
// to a consistent tone. Unknown statuses fall back to neutral.
type Tone = { bg: string; text: string; ring: string; dot: string };
const TONES: Record<string, Tone> = {
  green:   { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-600/20", dot: "bg-emerald-500" },
  blue:    { bg: "bg-sky-50",     text: "text-sky-700",     ring: "ring-sky-600/20",     dot: "bg-sky-500" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-700",   ring: "ring-amber-600/20",   dot: "bg-amber-500" },
  orange:  { bg: "bg-orange-50",  text: "text-orange-700",  ring: "ring-orange-600/20",  dot: "bg-orange-500" },
  red:     { bg: "bg-red-50",     text: "text-red-700",     ring: "ring-red-600/20",     dot: "bg-red-500" },
  slate:   { bg: "bg-slate-100",  text: "text-slate-600",   ring: "ring-slate-500/20",   dot: "bg-slate-400" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-700",  ring: "ring-violet-600/20",  dot: "bg-violet-500" },
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  // positive / done
  paid: "green", approved: "green", completed: "green", active: "green",
  present: "green", processed: "green", signed: "green", signed_wcc: "green",
  // in-progress / informational
  in_progress: "blue", po_received: "blue", sent: "blue", partial: "amber",
  half_day: "amber", pending: "amber", unpaid: "amber", draft: "slate",
  // attention / negative
  overdue: "red", rejected: "red", blocked: "red", error: "red", absent: "red",
  cancelled: "slate", leave: "violet",
};

const humanize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const StatusBadge: React.FC<{
  status: string;
  className?: string;
  dot?: boolean;
  label?: string;
}> = ({ status, className, dot = true, label }) => {
  const key = (status || "").toLowerCase();
  const tone = TONES[STATUS_TONE[key] || "slate"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
        tone.bg, tone.text, tone.ring, className
      )}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full", tone.dot)} />}
      {label || humanize(status || "—")}
    </span>
  );
};

// ── Card ────────────────────────────────────────────────────────────────────
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }> = ({
  className, padded = true, children, ...props
}) => (
  <div
    className={cn(
      "bg-white rounded-xl border border-slate-200/80 shadow-sm",
      padded && "p-4 sm:p-5",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

// ── SectionHeader ───────────────────────────────────────────────────────────
export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon, actions, className }) => (
  <div className={cn("flex items-start justify-between gap-3 mb-4", className)}>
    <div className="flex items-start gap-2.5 min-w-0">
      {icon && <div className="mt-0.5 text-orange-600 shrink-0">{icon}</div>}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900 leading-tight truncate">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

// ── KpiCard ─────────────────────────────────────────────────────────────────
export const KpiCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  tone?: keyof typeof TONES;
  className?: string;
}> = ({ label, value, icon, hint, tone = "slate", className }) => {
  const t = TONES[tone];
  return (
    <div className={cn("bg-white rounded-xl border border-slate-200/80 shadow-sm p-4", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {icon && (
          <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center", t.bg, t.text)}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
};

// ── EmptyState ──────────────────────────────────────────────────────────────
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, action, className }) => (
  <div className={cn("flex flex-col items-center justify-center text-center py-12 px-4", className)}>
    {icon && (
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    {description && <p className="text-sm text-slate-400 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ── Skeleton (loading) ──────────────────────────────────────────────────────
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded-md bg-slate-100", className)} />
);
