import React, { useEffect, useState, useMemo } from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { Link } from "wouter";
import { Receipt, Search, ExternalLink, FileText, FileCode2, Settings as SettingsIcon } from "lucide-react";

interface Invoice {
  id: number;
  invoiceNumber: string;
  type: string;
  partyName: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount?: number;
  balanceAmount?: number;
  date: string;
  dueDate: string;
  status: string;
  estimateId?: number | null;
  clientId?: number | null;
  remarks?: string | null;
  createdAt?: string;
  tallyExportStatus?: string | null;
  tallyExportedAt?: string | null;
}

const formatCurrency = (val: number) =>
  "₹" + (val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    unpaid: "bg-amber-50 text-amber-700 border-amber-200",
    partial: "bg-blue-50 text-blue-700 border-blue-200",
    overdue: "bg-red-50 text-red-700 border-red-200",
    draft: "bg-slate-50 text-slate-700 border-slate-200",
    submitted: "bg-purple-50 text-purple-700 border-purple-200",
  };
  return map[status] || "bg-slate-50 text-slate-700 border-slate-200";
};

const SubmittedInvoicesPage: React.FC = () => {
  const { token } = useAuth();
  const globalDate = useGlobalDate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("sales");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/finance/invoices", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setInvoices(data.filter((row: Invoice) => globalDate.isInRange(row.date || row.createdAt)));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [globalDate.range.end, globalDate.range.start, token]);

  const visible = useMemo(() => {
    const now = new Date();
    return invoices.filter((inv) => {
      if (filterType !== "all" && inv.type !== filterType) return false;
      if (filterStatus !== "all") {
        if (filterStatus === "overdue") {
          if (inv.status === "paid") return false;
          if (!inv.dueDate || new Date(inv.dueDate) >= now) return false;
        } else if (inv.status !== filterStatus) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !(inv.invoiceNumber || "").toLowerCase().includes(q) &&
          !(inv.partyName || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [invoices, search, filterStatus, filterType]);

  const totals = useMemo(() => {
    const total = visible.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const paid = visible.reduce((s, i) => s + (i.paidAmount || 0), 0);
    const balance = visible.reduce((s, i) => s + ((i.balanceAmount ?? (i.totalAmount - (i.paidAmount || 0))) || 0), 0);
    return { total, paid, balance };
  }, [visible]);

  const { page, setPage, slice: pagedInvoices, total: visibleTotal, pageSize } = usePagedList(visible, 25);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Receipt className="w-7 h-7 text-orange-600" /> Submitted Invoices
          </h1>
          <p className="text-slate-500 text-sm mt-1">All sales invoices issued. Track status, paid amount, and balance.</p>
        </div>
        <Link href="/automation/tally">
          <a className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md">
            <SettingsIcon className="w-3.5 h-3.5" /> Tally Settings
          </a>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Invoiced</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{formatCurrency(totals.total)}</p>
        </div>
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Paid</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(totals.paid)}</p>
        </div>
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Outstanding Balance</p>
          <p className="text-xl font-bold text-orange-600 mt-1">{formatCurrency(totals.balance)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice no. or party name"
            className="bg-transparent border-0 outline-none text-sm flex-1"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="sales">Sales (issued)</option>
          <option value="purchase">Purchase (received)</option>
          <option value="all">All</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <span className="text-xs text-slate-500">{visible.length} invoices</span>
      </div>

      {/* List */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading invoices…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <FileText className="w-8 h-8 text-slate-300" /> No invoices match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
                  <th className="text-left px-4 py-3 font-semibold">Party</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Due</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                  <th className="text-right px-4 py-3 font-semibold">Paid</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-left px-4 py-3 font-semibold">Tally</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedInvoices.map((inv) => {
                  const now = new Date();
                  const overdue = inv.status !== "paid" && inv.dueDate && new Date(inv.dueDate) < now;
                  const displayStatus = overdue && inv.status !== "overdue" ? "overdue" : inv.status;
                  const balance = inv.balanceAmount ?? inv.totalAmount - (inv.paidAmount || 0);
                  return (
                    <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-mono font-semibold">
                        <Link href={`/invoices#inv-${inv.id}`} className="text-blue-700 hover:underline">{inv.invoiceNumber}</Link>
                      </td>
                      <td className="px-4 py-3">{inv.partyName}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(inv.totalAmount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(inv.paidAmount || 0)}</td>
                      <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(balance)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border capitalize ${statusBadge(displayStatus)}`}>
                          {displayStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const s = inv.tallyExportStatus || "not_exported";
                          const cls = s === "pushed_to_tally" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : s === "exported_xml" ? "bg-blue-50 text-blue-700 border-blue-200"
                            : s === "failed" ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-slate-50 text-slate-500 border-slate-200";
                          return <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${cls}`}>{s.replace(/_/g, " ")}</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end items-center gap-2">
                          <a
                            href={`/api/tally/export-xml/${inv.id}`}
                            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                            title="Download Tally XML"
                          >
                            <FileCode2 className="w-3 h-3" /> Tally XML
                          </a>
                          <Link href={`/invoice-packet?id=${inv.id}`}>
                            <a className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              Packet <ExternalLink className="w-3 h-3" />
                            </a>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={page} pageSize={pageSize} total={visibleTotal} onPageChange={setPage} className="px-4" />
          </div>
        )}
      </div>
    </div>
  );
};

export default SubmittedInvoicesPage;
