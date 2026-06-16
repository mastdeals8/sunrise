import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate, toYmd } from "../contexts/GlobalDateContext";
import {
  TrendingUp,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  FileText,
  Wallet,
  FileSignature,
  PackageCheck,
  Receipt,
  CreditCard,
  Upload,
  Activity,
  ChevronRight,
  CalendarDays,
  RotateCcw,
} from "lucide-react";
import { Link } from "wouter";

interface ErpCounters {
  estimatesAwaitingPo: number;
  poReceived: number;
  estimatesDraft: number;
  estimatesApproved: number;
  dcPending: number;
  dcDelivered: number;
  invoicePending: number;
  invoicePaid: number;
  invoiceOverdue: number;
  staffPresentToday: number;
  pettyCashPending: number;
  jobsInProgress?: number;
  storesCompleted?: number;
  storesPending?: number;
  invoicesReady?: number;
  invoicesSubmitted?: number;
  tallyPending?: number;
  dcWccPending?: number;
}

interface ActivityRow {
  type: string;
  label: string;
  meta: string;
  date: string | null;
  href: string;
}

interface ProjectHealth {
  active: number;
  completed: number;
  delayed: number;
  nearCompletion: number;
}

interface DashboardStats {
  totalRevenue: number;
  totalReceivables: number;
  totalOutstanding?: number;
  monthlyBilling?: number;
  monthlyCollections?: number;
  erpCounters?: ErpCounters;
  projectHealth?: ProjectHealth;
  recentActivity?: ActivityRow[];
}

const fmtTime = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

const activityIconFor = (type: string) => {
  switch (type) {
    case "po": return <FileText className="w-3 h-3 text-purple-600" />;
    case "wcc": return <FileSignature className="w-3 h-3 text-amber-600" />;
    case "signed_wcc": return <PackageCheck className="w-3 h-3 text-emerald-600" />;
    case "invoice": return <Receipt className="w-3 h-3 text-blue-600" />;
    case "payment": return <CreditCard className="w-3 h-3 text-emerald-700" />;
    case "estimate": default: return <FileText className="w-3 h-3 text-slate-500" />;
  }
};

// Compact inline date filter for the dashboard header.
// Replaces the orange-pill GlobalDateFilter with clean Pharma-style date inputs.
const DashboardDateBar: React.FC = () => {
  const { range, setCustomRange, reset } = useGlobalDate();
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);

  useEffect(() => { setStart(range.start); setEnd(range.end); }, [range.start, range.end]);

  const apply = (s: string, e: string) => {
    if (s && e) setCustomRange({ start: s, end: e });
  };

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
        <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="date"
          value={start}
          aria-label="From date"
          onChange={e => { setStart(e.target.value); apply(e.target.value, end); }}
          className="border-0 outline-none text-xs text-slate-700 font-semibold bg-transparent w-[108px]"
        />
        <span className="text-slate-300 font-bold">→</span>
        <input
          type="date"
          value={end}
          aria-label="To date"
          onChange={e => { setEnd(e.target.value); apply(start, e.target.value); }}
          className="border-0 outline-none text-xs text-slate-700 font-semibold bg-transparent w-[108px]"
        />
      </div>
      <button
        type="button"
        onClick={reset}
        title="Reset to This Month"
        className="inline-flex items-center gap-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
      >
        <RotateCcw className="w-3 h-3" /> Reset
      </button>
      <span className="text-[11px] text-slate-400 font-semibold hidden sm:block">{today}</span>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityExpanded, setActivityExpanded] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const params = new URLSearchParams({ startDate: globalDate.range.start, endDate: globalDate.range.end });
        const res = await fetch(`/api/finance/dashboard?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setStats(await res.json());
      } catch (err) {
        console.error("Error fetching dashboard statistics:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [globalDate.range.end, globalDate.range.start, token]);

  const counters = stats?.erpCounters;
  const pipelineCounts = useMemo(() => {
    if (!counters) return null;
    return {
      estimates: (counters.estimatesDraft || 0) + (counters.estimatesAwaitingPo || 0) + (counters.estimatesApproved || 0) + (counters.poReceived || 0),
      po: counters.poReceived || 0,
      wcc: counters.dcDelivered || 0,
      invoices: counters.invoicesSubmitted || 0,
      payments: counters.invoicePaid || 0,
    };
  }, [counters]);

  const pendingActionsTotal = useMemo(() => {
    if (!counters) return 0;
    return (counters.estimatesAwaitingPo || 0) + (counters.dcWccPending || 0) + (counters.invoicesReady || 0) + (counters.invoicePending || 0) + (counters.invoiceOverdue || 0);
  }, [counters]);

  if (loading || !stats) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  const projectHealth = stats.projectHealth || { active: 0, completed: 0, delayed: 0, nearCompletion: 0 };
  const totalProjects = projectHealth.active + projectHealth.completed + projectHealth.delayed + projectHealth.nearCompletion;
  const recentActivity = stats.recentActivity || [];

  const pipeline = [
    { key: "estimates", label: "Estimate", count: pipelineCounts?.estimates ?? 0, href: "/estimates", color: "text-slate-700", bg: "bg-slate-50", ring: "ring-slate-200" },
    { key: "po",        label: "PO",       count: pipelineCounts?.po ?? 0,        href: "/estimates",         color: "text-purple-700", bg: "bg-purple-50", ring: "ring-purple-200" },
    { key: "wcc",       label: "WCC",      count: pipelineCounts?.wcc ?? 0,       href: "/delivery-challans", color: "text-amber-700",  bg: "bg-amber-50",  ring: "ring-amber-200" },
    { key: "invoice",   label: "Invoice",  count: pipelineCounts?.invoices ?? 0,  href: "/submitted-invoices",color: "text-blue-700",   bg: "bg-blue-50",   ring: "ring-blue-200" },
    { key: "payment",   label: "Payment",  count: pipelineCounts?.payments ?? 0,  href: "/pending-payments",  color: "text-emerald-700",bg: "bg-emerald-50",ring: "ring-emerald-200" },
  ];

  const attention = [
    { key: "po",       label: "PO Pending",      desc: "Approved, awaiting PO",     count: counters?.estimatesAwaitingPo ?? 0, href: "/estimates",          Icon: Upload,        tone: "border-purple-200 bg-purple-50/50 text-purple-800", chip: "bg-purple-100 text-purple-700" },
    { key: "wcc",      label: "WCC Pending",      desc: "Stores without WCC/DC",     count: counters?.dcWccPending ?? 0,        href: "/delivery-challans",  Icon: FileSignature,  tone: "border-amber-200 bg-amber-50/50 text-amber-800",   chip: "bg-amber-100 text-amber-700"   },
    { key: "invoice",  label: "Invoice Pending",  desc: "Ready for invoicing",       count: counters?.invoicesReady ?? 0,       href: "/submitted-invoices", Icon: Receipt,        tone: "border-blue-200 bg-blue-50/50 text-blue-800",      chip: "bg-blue-100 text-blue-700"     },
    { key: "payment",  label: "Payment Due",      desc: "Invoices awaiting payment", count: counters?.invoicePending ?? 0,      href: "/pending-payments",   Icon: CreditCard,     tone: "border-orange-200 bg-orange-50/50 text-orange-800", chip: "bg-orange-100 text-orange-700" },
    { key: "overdue",  label: "Overdue",          desc: "Past-due collections",      count: counters?.invoiceOverdue ?? 0,      href: "/pending-payments",   Icon: AlertTriangle,  tone: "border-rose-200 bg-rose-50/50 text-rose-800",      chip: "bg-rose-100 text-rose-700"     },
  ];

  const healthCards = [
    { label: "Active",          value: projectHealth.active,          color: "bg-blue-500"  },
    { label: "Near Completion", value: projectHealth.nearCompletion,  color: "bg-emerald-500" },
    { label: "Completed",       value: projectHealth.completed,        color: "bg-slate-600"  },
    { label: "Delayed",         value: projectHealth.delayed,          color: "bg-rose-500"  },
  ];

  return (
    <div className="space-y-3">

      {/* ── Header: compact single row ───────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[15px] font-black text-slate-900 leading-tight">
            Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">Live business status</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DashboardDateBar />
          <Link
            href="/staff"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 transition rounded-lg text-xs text-slate-600 font-semibold whitespace-nowrap"
          >
            <Clock className="w-3.5 h-3.5 text-orange-500" /> Check In/Out
          </Link>
        </div>
      </div>

      {/* ── SECTION 1 — KPI Cards ────────────────────────────────────────── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Revenue This Month",
            value: formatCurrency(stats.monthlyBilling || 0),
            sub: <span className="inline-flex items-center gap-1 text-emerald-600"><ArrowUpRight className="w-3 h-3" />Billed in period</span>,
            icon: <TrendingUp className="w-3.5 h-3.5" />, iconCls: "bg-emerald-50 text-emerald-600",
          },
          {
            label: "Outstanding",
            value: formatCurrency(stats.totalOutstanding || 0),
            sub: <Link href="/pending-payments" className="inline-flex items-center gap-1 text-orange-600 hover:underline">View <ChevronRight className="w-3 h-3" /></Link>,
            icon: <Wallet className="w-3.5 h-3.5" />, iconCls: "bg-orange-50 text-orange-600",
          },
          {
            label: "Pending Actions",
            value: String(pendingActionsTotal),
            sub: <span className="text-slate-400">PO · WCC · Invoice · Payment</span>,
            icon: <AlertTriangle className="w-3.5 h-3.5" />, iconCls: "bg-rose-50 text-rose-600",
          },
          {
            label: "Collections",
            value: formatCurrency(stats.monthlyCollections || 0),
            sub: <span className="text-emerald-600">Receipts in period</span>,
            icon: <CreditCard className="w-3.5 h-3.5" />, iconCls: "bg-emerald-50 text-emerald-600",
          },
        ].map(card => (
          <div key={card.label} className="bg-white border border-slate-200/80 rounded-xl px-4 py-3 flex flex-col gap-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-tight">{card.label}</span>
              <span className={`p-1.5 rounded-lg shrink-0 ${card.iconCls}`}>{card.icon}</span>
            </div>
            <div>
              <div className="text-xl font-black text-slate-900 tracking-tight leading-tight">{card.value}</div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">{card.sub}</div>
            </div>
          </div>
        ))}
      </section>

      {/* ── SECTION 2 — Workflow Pipeline ────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-600">Workflow Pipeline</h3>
          <span className="text-[10px] text-slate-400">Click a stage to open</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-0 items-stretch">
          {pipeline.map((stage, idx) => (
            <React.Fragment key={stage.key}>
              <Link
                href={stage.href}
                className={`group flex flex-col items-center justify-center text-center rounded-lg ${stage.bg} ring-1 ${stage.ring} hover:ring-2 hover:ring-orange-400 hover:shadow-sm transition px-2 py-2.5`}
              >
                <span className={`text-[10px] font-black uppercase tracking-wider ${stage.color}`}>{stage.label}</span>
                <span className="text-xl font-black text-slate-900 mt-0.5 leading-tight">{stage.count}</span>
                <span className="text-[10px] text-slate-500 font-semibold mt-0.5 group-hover:text-orange-700 inline-flex items-center gap-0.5">
                  Open <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
              {idx < pipeline.length - 1 && (
                <div className="hidden sm:flex items-center justify-center text-slate-200">
                  <ChevronRight className="w-5 h-5" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ── SECTIONS 3 & 4 side-by-side on large screens ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Attention Required — spans 2 cols */}
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-600">Attention Required</h3>
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">{pendingActionsTotal} open</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {attention.map(card => {
              const Icon = card.Icon;
              const isZero = card.count === 0;
              return (
                <Link
                  key={card.key}
                  href={card.href}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition hover:shadow-sm ${isZero ? "border-slate-200 bg-slate-50/50 text-slate-500" : `${card.tone} hover:border-orange-400`}`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-bold leading-tight truncate">{card.label}</p>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded shrink-0 ${isZero ? "bg-white text-slate-400 border border-slate-200" : card.chip}`}>{card.count}</span>
                    </div>
                    <p className="text-[10px] mt-0.5 opacity-75 truncate">{card.desc}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Project Health — 1 col */}
        <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-600">Project Health</h3>
            <span className="text-[10px] text-slate-400">{totalProjects} total</span>
          </div>
          <div className="space-y-2">
            {healthCards.map(card => {
              const pct = totalProjects > 0 ? Math.round((card.value / totalProjects) * 100) : 0;
              return (
                <div key={card.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-slate-600">{card.label}</span>
                    <span className="text-[11px] font-black text-slate-900">{card.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${card.color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── SECTION 5 — Recent Activity ──────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-600 inline-flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-slate-400" /> Recent Activity
          </h3>
          <span className="text-[10px] text-slate-400">
            {activityExpanded ? recentActivity.length : Math.min(recentActivity.length, 4)} of {recentActivity.length}
          </span>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-slate-400 py-3 text-center">No recent activity yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {recentActivity.slice(0, activityExpanded ? recentActivity.length : 4).map((row, idx) => (
                <li key={`${row.type}-${idx}`}>
                  <Link
                    href={row.href}
                    className="flex items-center gap-2.5 px-1 py-2 hover:bg-slate-50 rounded transition"
                  >
                    <span className="w-6 h-6 rounded bg-slate-100 inline-flex items-center justify-center flex-shrink-0">
                      {activityIconFor(row.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-bold text-slate-800 truncate">{row.label}</p>
                      {row.meta && <p className="text-[10px] text-slate-500 truncate">{row.meta}</p>}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">{fmtTime(row.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {recentActivity.length > 4 && (
              <button
                onClick={() => setActivityExpanded(v => !v)}
                className="mt-1.5 w-full text-center text-[11px] font-semibold text-orange-600 hover:text-orange-700 py-1.5 hover:bg-orange-50 rounded transition"
              >
                {activityExpanded ? "Show less" : `See ${recentActivity.length - 4} more`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
