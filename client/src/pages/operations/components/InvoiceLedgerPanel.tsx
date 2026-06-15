import React, { useMemo, useState } from "react";
import { Pager, usePagedList } from "@/components/Pager";
import { Link } from "wouter";
import { FileText, Plus, Eye, X, Search, Pencil, Trash2, Ban, Printer, Receipt, Download } from "lucide-react";
import type { Client, DeliveryChallan, Estimate } from "../types";

interface Invoice {
  id: number;
  invoiceNumber: string;
  type: string;
  partyName: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  date: string;
  dueDate: string;
  status: string;
  estimateId: number | null;
  clientId: number | null;
  paidAmount: number;
  balanceAmount: number;
  deliveryChallanId?: number | null;
  packetSettings: any | null;
  remarks: string | null;
  createdAt: string;
  poNumber?: string | null;
  poReference?: string | null;
}

interface LedgerSummary {
  clientId: number;
  clientName: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  status: string;
}

interface ClientStatementItem {
  date: string;
  ref: string;
  type: string;
  amount: number;
  debitAmount: number;
  creditAmount: number;
  balance: number;
  remarks: string | null;
}

interface InvoiceLedgerPanelProps {
  invoices: Invoice[];
  estimates: Estimate[];
  challans: DeliveryChallan[];
  clients: Client[];
  ledgerSummary: LedgerSummary[];
  clientStatement: ClientStatementItem[];
  activeLedgerClientId: number | null;
  setActiveLedgerClientId: (v: number | null) => void;
  setClientStatement: (v: ClientStatementItem[]) => void;
  statementLoading: boolean;
  invoiceSubTab: "packets" | "ledger" | "clients";
  setInvoiceSubTab: (v: "packets" | "ledger" | "clients") => void;
  setShowRecordPayment: (v: boolean) => void;
  openInvoiceEditor: (args: { invoiceId?: number; estimateId?: number; deliveryChallanId?: number }) => void;
  cancelInvoice: (inv: Invoice) => void;
  deleteInvoice: (inv: Invoice) => void;
  fetchClientStatement: (clientId: number) => void;
  formatCurrency: (n: number) => string;
  token?: string | null;
}

const InvoiceLedgerPanel: React.FC<InvoiceLedgerPanelProps> = ({
  invoices,
  estimates,
  challans,
  clients,
  ledgerSummary,
  clientStatement,
  activeLedgerClientId,
  setActiveLedgerClientId,
  setClientStatement,
  statementLoading,
  invoiceSubTab,
  setInvoiceSubTab,
  setShowRecordPayment,
  openInvoiceEditor,
  cancelInvoice,
  deleteInvoice,
  fetchClientStatement,
  formatCurrency,
  token,
}) => {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // ----- BUILDER TAB: pick a DC/WCC (PO already received), then create invoice -----
  const dcRows = useMemo(() => {
    return challans.map(d => {
      const est = estimates.find(e => e.id === d.estimateId);
      const client = est ? clients.find(c => c.id === est.clientId) : null;
      const existingInv = invoices.find(i => (i.deliveryChallanId === d.id) || (!i.deliveryChallanId && i.estimateId === d.estimateId));
      return { dc: d, est, client, existingInv };
    });
  }, [challans, estimates, invoices, clients]);

  // ----- LEDGER TAB filters -----
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter(inv => {
      if (filterStatus !== "all") {
        if (filterStatus === "overdue") {
          if (inv.status === "paid" || inv.status === "cancelled") return false;
          if (!inv.dueDate || new Date(inv.dueDate) >= new Date()) return false;
        } else if (inv.status !== filterStatus) return false;
      }
      if (q) {
        return (inv.invoiceNumber || "").toLowerCase().includes(q)
          || (inv.partyName || "").toLowerCase().includes(q)
          || (inv.poNumber || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [invoices, search, filterStatus]);
  const invLedgerPager = usePagedList(filteredInvoices, 25);

  const exportCsv = () => {
    const rows = [
      ["Invoice No","Date","Due","Party","Estimate","DC/WCC","PO","Status","Total","Paid","Balance"].join(","),
      ...filteredInvoices.map(inv => {
        const est = estimates.find(e => e.id === inv.estimateId);
        const dc = challans.find(d => d.id === inv.deliveryChallanId);
        const balance = inv.balanceAmount ?? inv.totalAmount - (inv.paidAmount || 0);
        return [
          inv.invoiceNumber, inv.date?.slice(0, 10) || "", inv.dueDate?.slice(0, 10) || "",
          inv.partyName, est?.estimateNumber || "", dc?.dcNumber || "", inv.poNumber || "",
          inv.status, inv.totalAmount, inv.paidAmount || 0, balance,
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
      })
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "invoices.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-500" />
            Invoices &amp; Payment Ledger
          </h3>
          <p className="text-xs text-slate-500 mt-1">Estimate → DC/WCC → Invoice → Payment. Invoices must originate from a delivery challan.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRecordPayment(true)} className="inline-flex items-center gap-1.5 py-2 px-4 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Record Payment
          </button>
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-0 overflow-x-auto">
        {(["packets", "ledger", "clients"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setInvoiceSubTab(tab)}
            className={`pb-2 px-5 py-2 text-xs font-bold border-b-2 transition capitalize ${
              invoiceSubTab === tab ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab === "packets" ? "Invoice Builder (from DC/WCC)" : tab === "ledger" ? "Invoice Register" : "Client-Wise Outstanding"}
          </button>
        ))}
      </div>

      {/* ===================== Invoice Builder (from DC/WCC) ===================== */}
      {invoiceSubTab === "packets" && (
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-bold text-slate-600">How to bill:</p>
            <ol className="text-xs text-slate-500 list-decimal pl-4 space-y-0.5">
              <li>Pick a delivery challan or WCC certificate that's been issued.</li>
              <li>Click <strong className="text-orange-600">Create Invoice</strong> — the full invoice editor opens with the linked DC, line items, PO ref pre-filled.</li>
              <li>Save as Draft, then Approve when ready. Use the <strong>Invoice Register</strong> tab to track payment.</li>
            </ol>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left">DC / WCC No.</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Estimate</th>
                  <th className="px-3 py-2 text-left">PO No.</th>
                  <th className="px-3 py-2 text-center">DC Date</th>
                  <th className="px-3 py-2 text-center">Invoice</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dcRows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400 text-sm">No delivery challans / WCCs exist yet. Create one from an estimate after PO upload.</td></tr>
                )}
                {dcRows.map(({ dc, est, client, existingInv }) => (
                  <tr key={dc.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono font-bold text-amber-700">{dc.dcNumber}</td>
                    <td className="px-3 py-2 text-slate-700">{client?.name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-700">{est?.estimateNumber || "—"}</td>
                    <td className="px-3 py-2 font-mono text-purple-700">{est?.poNumber || "—"}</td>
                    <td className="px-3 py-2 text-center text-slate-500">{dc.deliveryDate ? new Date(dc.deliveryDate).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {existingInv ? (
                        <button
                          onClick={() => openInvoiceEditor({ invoiceId: existingInv.id })}
                          className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-black hover:underline"
                        >{existingInv.invoiceNumber}</button>
                      ) : <span className="text-slate-300 text-[10px]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!existingInv ? (
                        <button
                          onClick={() => openInvoiceEditor({ estimateId: dc.estimateId, deliveryChallanId: dc.id })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 border border-orange-200 text-orange-700 text-[10px] font-black rounded hover:bg-orange-100 transition"
                        >
                          <Plus className="w-3 h-3" /> Create Invoice
                        </button>
                      ) : (
                        <button
                          onClick={() => openInvoiceEditor({ invoiceId: existingInv.id })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-black rounded hover:bg-blue-100 transition"
                        >
                          <Pencil className="w-3 h-3" /> Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== Invoice Register ===================== */}
      {invoiceSubTab === "ledger" && (
        <div className="space-y-3">
          <div className="bg-white rounded-md p-3 border border-slate-200 flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded bg-white">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice / party / PO" className="bg-transparent outline-none text-xs w-56" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-2 py-1 border border-slate-200 rounded bg-white text-xs">
              <option value="all">All status</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="hold">Hold</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button onClick={exportCsv} className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <span className="text-xs text-slate-500">{filteredInvoices.length} invoices</span>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-semibold">No invoices match the filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Invoice No.</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Estimate</th>
                    <th className="px-3 py-2 text-left">DC/WCC</th>
                    <th className="px-3 py-2 text-left">PO</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invLedgerPager.slice.map(inv => {
                    const est = estimates.find(e => e.id === inv.estimateId);
                    const dc = challans.find(d => d.id === inv.deliveryChallanId);
                    const balance = inv.balanceAmount ?? inv.totalAmount - (inv.paidAmount || 0);
                    const isOverdue = !["paid", "cancelled"].includes(inv.status) && inv.dueDate && new Date(inv.dueDate) < new Date();
                    const displayStatus = isOverdue && !["partial", "draft"].includes(inv.status) ? "overdue" : inv.status;
                    return (
                      <tr key={inv.id} className={`hover:bg-slate-50/60 cursor-pointer ${isOverdue ? "bg-red-50/20" : ""} ${inv.status === "cancelled" ? "opacity-50" : ""}`}
                          onClick={() => openInvoiceEditor({ invoiceId: inv.id })}>
                        <td className="px-3 py-2 font-mono font-bold text-blue-700">
                          <button onClick={(e) => { e.stopPropagation(); openInvoiceEditor({ invoiceId: inv.id }); }} className="hover:underline text-left">{inv.invoiceNumber}</button>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</td>
                        <td className="px-3 py-2 text-slate-700">{inv.partyName}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {est ? <button onClick={(e) => { e.stopPropagation(); window.location.href = `/estimates#est-${est.id}`; }} className="text-orange-600 hover:underline">{est.estimateNumber}</button> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {dc ? <button onClick={(e) => { e.stopPropagation(); window.location.href = `/delivery-challans#dc-${dc.id}`; }} className="text-amber-600 hover:underline">{dc.dcNumber}</button> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-purple-700">{inv.poNumber || "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${statusClass(displayStatus)}`}>{displayStatus}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(inv.totalAmount)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-700">{formatCurrency(inv.paidAmount || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-orange-700">{formatCurrency(balance)}</td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1">
                            <button title="Edit" onClick={() => openInvoiceEditor({ invoiceId: inv.id })} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                            <a title="Print / Packet" href={`/invoice-packet?id=${inv.id}`} target="_blank" rel="noreferrer" className="btn-action"><Printer className="w-3.5 h-3.5 text-slate-600" /></a>
                            {inv.status !== "cancelled" && (
                              <button title="Cancel" onClick={() => cancelInvoice(inv)} className="btn-action"><Ban className="w-3.5 h-3.5 text-amber-600" /></button>
                            )}
                            <button title="Delete (admin)" onClick={() => deleteInvoice(inv)} className="btn-action"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager page={invLedgerPager.page} pageSize={invLedgerPager.pageSize} total={invLedgerPager.total} onPageChange={invLedgerPager.setPage} />
            </div>
          )}
        </div>
      )}

      {/* ===================== Client-wise Outstanding ===================== */}
      {invoiceSubTab === "clients" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
            {[
              { label: "Total Billed", value: ledgerSummary.reduce((s, l) => s + l.totalBilled, 0), color: "text-slate-800" },
              { label: "Total Collected", value: ledgerSummary.reduce((s, l) => s + l.totalPaid, 0), color: "text-green-700" },
              { label: "Total Outstanding", value: ledgerSummary.reduce((s, l) => s + l.totalOutstanding, 0), color: "text-orange-700" },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{card.label}</p>
                <p className={`text-2xl font-black mt-1 font-mono ${card.color}`}>{formatCurrency(card.value)}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-right">Total Billed</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Statement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerSummary.filter(l => l.totalBilled > 0).map(row => (
                  <tr key={row.clientId} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.clientName}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{formatCurrency(row.totalBilled)}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-700">{formatCurrency(row.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-orange-700">{formatCurrency(row.totalOutstanding)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${row.status === "clean" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {row.status === "clean" ? "clear" : "outstanding"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => fetchClientStatement(row.clientId)} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold rounded">
                        <Eye className="w-3 h-3" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activeLedgerClientId && (
            <div className="border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                <h4 className="font-bold text-slate-800 text-sm">
                  Account Statement — {clients.find(c => c.id === activeLedgerClientId)?.name || "Client"}
                </h4>
                <button onClick={() => { setActiveLedgerClientId(null); setClientStatement([]); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </div>
              {statementLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs">Loading statement…</div>
              ) : (
                <table className="w-full text-xs font-mono">
                  <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Ref</th>
                      <th className="px-4 py-2 text-left">Type</th>
                      <th className="px-4 py-2 text-right">Debit</th>
                      <th className="px-4 py-2 text-right">Credit</th>
                      <th className="px-4 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clientStatement.map((row, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 text-slate-500">{new Date(row.date).toLocaleDateString("en-IN")}</td>
                        <td className="px-4 py-2 font-bold text-slate-700">{row.ref}</td>
                        <td className="px-4 py-2 text-slate-500 font-sans">{row.type}</td>
                        <td className="px-4 py-2 text-right text-red-600 font-semibold">{row.debitAmount > 0 ? formatCurrency(row.debitAmount) : ""}</td>
                        <td className="px-4 py-2 text-right text-green-700 font-semibold">{row.creditAmount > 0 ? formatCurrency(row.creditAmount) : ""}</td>
                        <td className={`px-4 py-2 text-right font-black ${row.balance > 0 ? "text-orange-700" : "text-green-700"}`}>
                          {formatCurrency(Math.abs(row.balance))}{row.balance > 0 ? " Dr" : " Cr"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function statusClass(s: string): string {
  return ({
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    unpaid: "bg-amber-50 text-amber-700 border-amber-200",
    partial: "bg-blue-50 text-blue-700 border-blue-200",
    overdue: "bg-red-50 text-red-700 border-red-200",
    draft: "bg-slate-50 text-slate-700 border-slate-200",
    approved: "bg-blue-50 text-blue-700 border-blue-200",
    hold: "bg-amber-50 text-amber-700 border-amber-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
  } as Record<string, string>)[s] || "bg-slate-50 text-slate-700 border-slate-200";
}

export default InvoiceLedgerPanel;
