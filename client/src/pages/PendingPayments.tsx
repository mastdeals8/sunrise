import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { Link } from "wouter";
import { AlertCircle, Search, Plus, X, CheckCircle } from "lucide-react";

interface Invoice {
  id: number;
  invoiceNumber: string;
  partyName: string;
  type: string;
  totalAmount: number;
  paidAmount?: number;
  balanceAmount?: number;
  date: string;
  dueDate: string;
  status: string;
  clientId?: number | null;
}


const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

const PendingPaymentsPage: React.FC = () => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPayFor, setShowPayFor] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    method: "bank_transfer",
    reference: "",
    notes: "",
  });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const canAddPayment = ["admin", "manager", "accounts"].includes((user?.role || "").toLowerCase());

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/finance/invoices", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const rows = await res.json();
        setInvoices(rows.filter((row: Invoice) => globalDate.isInRange(row.date || row.dueDate)));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [globalDate.range.start, globalDate.range.end, token]);

  const showMsg = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const pending = useMemo(() => {
    const now = new Date();
    return invoices
      .filter(i => i.type === "sales" && i.status !== "paid")
      .map((inv) => {
        const balance = inv.balanceAmount ?? inv.totalAmount - (inv.paidAmount || 0);
        const due = inv.dueDate ? new Date(inv.dueDate) : null;
        const overdue = due ? daysBetween(now, due) : 0;
        return { ...inv, balance, overdueDays: overdue > 0 ? overdue : 0 };
      })
      .filter((inv) => {
        if (search.trim()) {
          const q = search.toLowerCase();
          if (!inv.invoiceNumber.toLowerCase().includes(q) && !inv.partyName.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.overdueDays - a.overdueDays);
  }, [invoices, search]);

  const totals = useMemo(() => {
    const totalOutstanding = pending.reduce((s, i) => s + i.balance, 0);
    const overdue = pending.filter(i => i.overdueDays > 0).reduce((s, i) => s + i.balance, 0);
    return { totalOutstanding, overdue, count: pending.length };
  }, [pending]);

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPayFor) return;
    const amount = parseFloat(payForm.amount);
    if (isNaN(amount) || amount <= 0) {
      showMsg("err", "Enter a valid amount");
      return;
    }
    try {
      const voucherNumber = `RV/${new Date().getFullYear()}/${Date.now().toString().slice(-6)}`;
      const res = await fetch("/api/finance/payments/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          payment: {
            voucherNumber,
            type: "receipt",
            partyName: showPayFor.partyName,
            amount,
            date: payForm.date,
            method: payForm.method,
            description: payForm.notes || payForm.reference || null,
            clientId: showPayFor.clientId ?? null,
            invoiceId: showPayFor.id,
          },
          allocations: [{ invoiceId: showPayFor.id, amount }],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Payment failed" }));
        showMsg("err", err.message || "Payment failed");
        return;
      }
      showMsg("ok", "Payment recorded");
      setShowPayFor(null);
      setPayForm({ amount: "", date: new Date().toISOString().slice(0, 10), method: "bank_transfer", reference: "", notes: "" });
      load();
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <AlertCircle className="w-7 h-7 text-red-600" /> Pending Payments
        </h1>
        <p className="text-slate-500 text-sm mt-1">Unpaid sales invoices, sorted by overdue days.</p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm border ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Pending Invoices</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{totals.count}</p>
        </div>
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Total Outstanding</p>
          <p className="text-xl font-bold text-orange-600 mt-1">{formatCurrency(totals.totalOutstanding)}</p>
        </div>
        <div className="glass-panel p-4">
          <p className="text-xs font-bold uppercase text-slate-500">Overdue Amount</p>
          <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totals.overdue)}</p>
        </div>
      </div>

      <div className="glass-panel p-4 flex items-center gap-2">
        <Search className="w-4 h-4 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / party" className="bg-transparent border-0 outline-none text-sm flex-1" />
      </div>

      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
            <span className="font-semibold">All caught up!</span>
            No pending sales payments.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
                  <th className="text-left px-4 py-3 font-semibold">Party</th>
                  <th className="text-left px-4 py-3 font-semibold">Due</th>
                  <th className="text-right px-4 py-3 font-semibold">Overdue</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                  <th className="text-right px-4 py-3 font-semibold">Paid</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((inv) => (
                  <tr key={inv.id} className={`border-b border-slate-100 hover:bg-slate-50/60 ${inv.overdueDays > 0 ? "bg-red-50/30" : ""}`}>
                    <td className="px-4 py-3 font-mono font-semibold">
                      <Link href={`/invoices#inv-${inv.id}`} className="text-blue-700 hover:underline">{inv.invoiceNumber}</Link>
                    </td>
                    <td className="px-4 py-3">{inv.partyName}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${inv.overdueDays > 30 ? "text-red-700" : inv.overdueDays > 0 ? "text-orange-600" : "text-slate-400"}`}>
                      {inv.overdueDays > 0 ? `${inv.overdueDays}d` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">{formatCurrency(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(inv.paidAmount || 0)}</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-700">{formatCurrency(inv.balance)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setShowPayFor(inv);
                          setPayForm({ ...payForm, amount: String(inv.balance.toFixed(2)) });
                        }}
                        disabled={!canAddPayment}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40"
                      >
                        <Plus className="w-3 h-3" /> Pay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPayFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold">Record Payment</h2>
              <button onClick={() => setShowPayFor(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitPayment} className="p-6 space-y-3">
              <div className="bg-slate-50 rounded-md p-3 text-xs">
                <div><span className="text-slate-500">Invoice:</span> <b className="font-mono">{showPayFor.invoiceNumber}</b></div>
                <div><span className="text-slate-500">Party:</span> {showPayFor.partyName}</div>
                <div><span className="text-slate-500">Balance:</span> {formatCurrency(showPayFor.balanceAmount ?? showPayFor.totalAmount - (showPayFor.paidAmount || 0))}</div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Amount *</label>
                <input required type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Date</label>
                  <input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-600">Mode</label>
                  <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="upi">UPI</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Reference (UTR / Cheque / Txn)</label>
                <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Notes</label>
                <textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="pt-3 border-t flex justify-end gap-2">
                <button type="button" onClick={() => setShowPayFor(null)} className="px-4 py-2 rounded-md border text-sm">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow">
                  Save Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingPaymentsPage;
