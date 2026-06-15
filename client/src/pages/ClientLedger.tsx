import React, { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { Users, Search, ChevronRight, FileText, ArrowRight } from "lucide-react";

interface Client { id: number; name: string }
interface LedgerSummary {
  clientId: number;
  clientName: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  status: string;
}
interface StatementItem {
  date: string;
  ref: string;
  type: string;
  amount: number;
  debitAmount: number;
  creditAmount: number;
  details: string;
  balance: number;
}


const ClientLedgerPage: React.FC = () => {
  const { token } = useAuth();
  const [summary, setSummary] = useState<LedgerSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ client: Client; statement: StatementItem[]; totalBilled: number; totalPaid: number; totalOutstanding: number } | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/finance/ledgers/summary", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setSummary(await res.json());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(`/api/finance/ledgers/client/${selected}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setDetail(await res.json());
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, [selected, token]);

  const filtered = useMemo(() => {
    if (!search.trim()) return summary;
    const q = search.toLowerCase();
    return summary.filter((s) => s.clientName.toLowerCase().includes(q));
  }, [summary, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Users className="w-7 h-7 text-orange-600" /> Client Ledger
        </h1>
        <p className="text-slate-500 text-sm mt-1">Per-client receivables, transactions, and running balance.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: clients list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="glass-panel p-3 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client" className="bg-transparent border-0 outline-none text-sm flex-1" />
          </div>
          <div className="glass-panel overflow-hidden">
            {loading ? (
              <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">No clients</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
                {filtered.map((s) => (
                  <button
                    key={s.clientId}
                    onClick={() => setSelected(s.clientId)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition flex items-center justify-between ${selected === s.clientId ? "bg-orange-50" : ""}`}
                  >
                    <div>
                      <p className="font-semibold text-sm text-slate-900">{s.clientName}</p>
                      <p className="text-xs text-slate-500">
                        Bal: <span className={s.totalOutstanding > 0 ? "text-orange-600 font-bold" : "text-emerald-600"}>{formatCurrency(s.totalOutstanding)}</span>
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: ledger detail */}
        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div className="glass-panel p-12 text-center text-slate-500">
              <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              Select a client from the left to view their ledger.
            </div>
          ) : !detail ? (
            <div className="glass-panel p-8 text-center text-slate-500">Loading ledger…</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-panel p-3">
                  <p className="text-xs font-bold uppercase text-slate-500">Total Billed</p>
                  <p className="text-lg font-bold text-slate-900 mt-1">{formatCurrency(detail.totalBilled)}</p>
                </div>
                <div className="glass-panel p-3">
                  <p className="text-xs font-bold uppercase text-slate-500">Total Paid</p>
                  <p className="text-lg font-bold text-emerald-600 mt-1">{formatCurrency(detail.totalPaid)}</p>
                </div>
                <div className="glass-panel p-3">
                  <p className="text-xs font-bold uppercase text-slate-500">Outstanding</p>
                  <p className="text-lg font-bold text-orange-600 mt-1">{formatCurrency(detail.totalOutstanding)}</p>
                </div>
              </div>

              <div className="glass-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <h3 className="font-bold text-slate-900">
                    {detail.client.name} — Account Statement
                  </h3>
                </div>
                {detail.statement.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">No transactions yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold">Date</th>
                          <th className="text-left px-3 py-2 font-semibold">Type</th>
                          <th className="text-left px-3 py-2 font-semibold">Ref #</th>
                          <th className="text-left px-3 py-2 font-semibold">Details</th>
                          <th className="text-right px-3 py-2 font-semibold">Debit</th>
                          <th className="text-right px-3 py-2 font-semibold">Credit</th>
                          <th className="text-right px-3 py-2 font-semibold">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.statement.map((row, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/60">
                            <td className="px-3 py-2 text-xs">{new Date(row.date).toLocaleDateString("en-GB")}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs font-semibold ${row.type === "Invoice" ? "text-orange-700" : "text-emerald-700"}`}>{row.type}</span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{row.ref}</td>
                            <td className="px-3 py-2 text-xs text-slate-600">{row.details}</td>
                            <td className="px-3 py-2 text-right">{row.debitAmount ? formatCurrency(row.debitAmount) : "—"}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{row.creditAmount ? formatCurrency(row.creditAmount) : "—"}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${row.balance > 0 ? "text-orange-700" : "text-slate-500"}`}>
                              {formatCurrency(row.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientLedgerPage;
