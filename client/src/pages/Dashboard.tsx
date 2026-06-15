import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import {
  TrendingUp,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  FileText,
  Plus,
  Wallet,
  FileSignature,
  PackageCheck,
  Receipt,
  CreditCard,
  Camera,
  Upload,
  Activity,
  ChevronRight,
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
    case "po": return <FileText className="w-3.5 h-3.5 text-purple-600" />;
    case "wcc": return <FileSignature className="w-3.5 h-3.5 text-amber-600" />;
    case "signed_wcc": return <PackageCheck className="w-3.5 h-3.5 text-emerald-600" />;
    case "invoice": return <Receipt className="w-3.5 h-3.5 text-blue-600" />;
    case "payment": return <CreditCard className="w-3.5 h-3.5 text-emerald-700" />;
    case "estimate": default: return <FileText className="w-3.5 h-3.5 text-slate-600" />;
  }
};

const Dashboard: React.FC = () => {
  const { token } = useAuth();
  const globalDate = useGlobalDate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Derived counts for clickable pipeline + attention cards.
  const counters = stats?.erpCounters;
  const pipelineCounts = useMemo(() => {
    if (!counters) return null;
    const allEstimates =
      (counters.estimatesDraft || 0) +
      (counters.estimatesAwaitingPo || 0) +
      (counters.estimatesApproved || 0) +
      (counters.poReceived || 0);
    return {
      estimates: allEstimates,
      po: counters.poReceived || 0,
      wcc: counters.dcDelivered || 0,
      invoices: counters.invoicesSubmitted || 0,
      payments: counters.invoicePaid || 0,
    };
  }, [counters]);

  const pendingActionsTotal = useMemo(() => {
    if (!counters) return 0;
    return (
      (counters.estimatesAwaitingPo || 0) +
      (counters.dcWccPending || 0) +
      (counters.invoicesReady || 0) +
      (counters.invoicePending || 0) +
      (counters.invoiceOverdue || 0)
    );
  }, [counters]);

  if (loading || !stats) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  const projectHealth = stats.projectHealth || { active: 0, completed: 0, delayed: 0, nearCompletion: 0 };
  const totalProjects =
    projectHealth.active + projectHealth.completed + projectHealth.delayed + projectHealth.nearCompletion;
  const recentActivity = stats.recentActivity || [];

  // Pipeline stages, each with a clickable target.
  const pipeline = [
    { key: "estimates", label: "Estimate", count: pipelineCounts?.estimates ?? 0, href: "/operations#estimates", color: "text-slate-700", bg: "bg-slate-50", ring: "ring-slate-200" },
    { key: "po", label: "PO", count: pipelineCounts?.po ?? 0, href: "/operations#estimates", color: "text-purple-700", bg: "bg-purple-50", ring: "ring-purple-200" },
    { key: "wcc", label: "WCC", count: pipelineCounts?.wcc ?? 0, href: "/operations#challans", color: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200" },
    { key: "invoice", label: "Invoice", count: pipelineCounts?.invoices ?? 0, href: "/submitted-invoices", color: "text-blue-700", bg: "bg-blue-50", ring: "ring-blue-200" },
    { key: "payment", label: "Payment", count: pipelineCounts?.payments ?? 0, href: "/pending-payments", color: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200" },
  ];

  const attention = [
    {
      key: "po", label: "PO Pending Upload", desc: "Approved estimates awaiting client PO",
      count: counters?.estimatesAwaitingPo ?? 0, href: "/operations#estimates",
      Icon: Upload, tone: "border-purple-200 bg-purple-50/40 text-purple-800", chip: "bg-purple-100 text-purple-800",
    },
    {
      key: "wcc", label: "WCC Pending", desc: "Stores without a WCC/DC generated",
      count: counters?.dcWccPending ?? 0, href: "/operations#challans",
      Icon: FileSignature, tone: "border-amber-200 bg-amber-50/40 text-amber-800", chip: "bg-amber-100 text-amber-800",
    },
    {
      key: "invoice", label: "Invoice Pending", desc: "Estimates ready for invoicing",
      count: counters?.invoicesReady ?? 0, href: "/submitted-invoices",
      Icon: Receipt, tone: "border-blue-200 bg-blue-50/40 text-blue-800", chip: "bg-blue-100 text-blue-800",
    },
    {
      key: "payment", label: "Payment Follow-up", desc: "Issued invoices awaiting payment",
      count: counters?.invoicePending ?? 0, href: "/pending-payments",
      Icon: CreditCard, tone: "border-orange-200 bg-orange-50/40 text-orange-800", chip: "bg-orange-100 text-orange-800",
    },
    {
      key: "overdue", label: "Overdue Collections", desc: "Past-due invoices needing escalation",
      count: counters?.invoiceOverdue ?? 0, href: "/pending-payments",
      Icon: AlertTriangle, tone: "border-rose-200 bg-rose-50/40 text-rose-800", chip: "bg-rose-100 text-rose-800",
    },
  ];

  const healthCards = [
    { label: "Active Projects", value: projectHealth.active, color: "bg-blue-500" },
    { label: "Near Completion", value: projectHealth.nearCompletion, color: "bg-emerald-500" },
    { label: "Completed", value: projectHealth.completed, color: "bg-slate-700" },
    { label: "Delayed", value: projectHealth.delayed, color: "bg-rose-500" },
  ];

  return (
    <div className="space-y-5">
      {/* Header — minimal, just the page title + 2 most-used CTAs */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-xs mt-0.5">{globalDate.label} · live business status</p>
        </div>
        <div className="flex gap-2">
          <Link href="/staff" className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 transition rounded-md text-xs text-slate-700 font-semibold">
            <Clock className="w-3.5 h-3.5 text-orange-600" /> Check In/Out
          </Link>
          <Link href="/operations#estimates" className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold transition rounded-md text-xs shadow-md">
            <Plus className="w-3.5 h-3.5" /> New Estimate
          </Link>
        </div>
      </div>

      {/* ── SECTION 1 — Business Snapshot (exactly 4 KPI cards) ───────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Revenue This Month</span>
            <span className="p-1.5 rounded bg-emerald-50 text-emerald-700"><TrendingUp className="w-3.5 h-3.5" /></span>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{formatCurrency(stats.monthlyBilling || 0)}</h2>
            <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1 mt-0.5"><ArrowUpRight className="w-3 h-3" /> Billed in period</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Outstanding Receivables</span>
            <span className="p-1.5 rounded bg-orange-50 text-orange-700"><Wallet className="w-3.5 h-3.5" /></span>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{formatCurrency(stats.totalOutstanding || 0)}</h2>
            <Link href="/pending-payments" className="text-[11px] text-orange-700 font-semibold inline-flex items-center gap-1 mt-0.5 hover:underline">
              View receivables <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pending Actions</span>
            <span className="p-1.5 rounded bg-rose-50 text-rose-700"><AlertTriangle className="w-3.5 h-3.5" /></span>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{pendingActionsTotal}</h2>
            <span className="text-[11px] text-slate-500 font-semibold inline-flex items-center gap-1 mt-0.5">Across PO, WCC, Invoice, Payment</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Collections This Month</span>
            <span className="p-1.5 rounded bg-emerald-50 text-emerald-700"><CreditCard className="w-3.5 h-3.5" /></span>
          </div>
          <div className="mt-3">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{formatCurrency(stats.monthlyCollections || 0)}</h2>
            <span className="text-[11px] text-emerald-700 font-semibold inline-flex items-center gap-1 mt-0.5">Receipts in period</span>
          </div>
        </div>
      </section>

      {/* ── SECTION 2 — Workflow Pipeline (visual + clickable) ────────── */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">Workflow Pipeline</h3>
          <span className="text-[11px] text-slate-400 font-semibold">Click any stage to open it</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-0 items-stretch">
          {pipeline.map((stage, idx) => (
            <React.Fragment key={stage.key}>
              <Link
                href={stage.href}
                className={`group flex flex-col items-center justify-center text-center rounded-lg ${stage.bg} ring-1 ${stage.ring} hover:ring-2 hover:ring-orange-400 hover:shadow-sm transition px-3 py-4`}
              >
                <span className={`text-[10px] font-black uppercase tracking-wider ${stage.color}`}>{stage.label}</span>
                <span className="text-2xl font-black text-slate-900 mt-1">{stage.count}</span>
                <span className="text-[10px] text-slate-500 font-semibold mt-0.5 group-hover:text-orange-700 inline-flex items-center gap-0.5">
                  Open <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
              {idx < pipeline.length - 1 && (
                <div className="hidden sm:flex items-center justify-center text-slate-300">
                  <ChevronRight className="w-6 h-6" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ── SECTION 3 — Attention Required (biggest section) ──────────── */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">Attention Required</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Open items that need action this week</p>
          </div>
          <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded">
            {pendingActionsTotal} open
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {attention.map(card => {
            const Icon = card.Icon;
            const isZero = card.count === 0;
            return (
              <Link
                key={card.key}
                href={card.href}
                className={`flex flex-col gap-3 rounded-xl border p-4 transition hover:shadow-md ${
                  isZero
                    ? "border-slate-200 bg-slate-50/50 text-slate-500 hover:bg-slate-100"
                    : `${card.tone} hover:border-orange-400`
                }`}
              >
                <div className="flex items-center justify-between">
                  <Icon className="w-5 h-5" />
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${isZero ? "bg-white text-slate-500 border border-slate-200" : card.chip}`}>
                    {card.count}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold leading-snug">{card.label}</h4>
                  <p className="text-[11px] mt-1 opacity-80">{card.desc}</p>
                </div>
                <span className="text-[11px] font-bold inline-flex items-center gap-1 mt-auto">
                  Open list <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── SECTION 4 — Project Health (progress bars, no tables) ─────── */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">Project Health</h3>
          <span className="text-[11px] text-slate-400 font-semibold">{totalProjects} total projects</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {healthCards.map(card => {
            const pct = totalProjects > 0 ? Math.round((card.value / totalProjects) * 100) : 0;
            return (
              <div key={card.label} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{card.label}</span>
                  <span className="text-xl font-black text-slate-900">{card.value}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${card.color}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 font-semibold mt-1 inline-block">{pct}% of all projects</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SECTION 5 — Recent Activity (latest 10) ───────────────────── */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-700 inline-flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-500" /> Recent Activity
          </h3>
          <span className="text-[11px] text-slate-400 font-semibold">Latest {Math.min(recentActivity.length, 10)} events</span>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No recent activity yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentActivity.slice(0, 10).map((row, idx) => (
              <li key={`${row.type}-${idx}`}>
                <Link
                  href={row.href}
                  className="flex items-center gap-3 px-2 py-2.5 hover:bg-slate-50 rounded transition"
                >
                  <span className="w-7 h-7 rounded bg-slate-100 inline-flex items-center justify-center flex-shrink-0">
                    {activityIconFor(row.type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-800 truncate">{row.label}</p>
                    {row.meta && <p className="text-[11px] text-slate-500 truncate">{row.meta}</p>}
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono flex-shrink-0">{fmtTime(row.date)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
