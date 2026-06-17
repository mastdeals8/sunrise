import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { isBoltMode } from "../lib/supabase";
import { fetchAccounts, fetchInvoices, fetchPayments, createInvoice, createPayment } from "../lib/api";
import { 
  Wallet, 
  FileText, 
  Coins, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Search, 
  AlertCircle,
  CheckCircle,
  Printer
} from "lucide-react";

interface ChartOfAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
}

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
}

interface Payment {
  id: number;
  voucherNumber: string;
  type: string;
  partyName: string;
  date: string;
  amount: number;
  method: string;
  description: string | null;
  invoiceId: number | null;
}

interface LedgerLine {
  id: number;
  debit: number;
  credit: number;
  description: string;
  lineNumber: number;
  entryDate: string;
  entryNumber: string;
  sourceModule: string;
  referenceNumber: string;
}

const FinancePage: React.FC = () => {
  const { token } = useAuth();
  const globalDate = useGlobalDate();
  const [activeSubTab, setActiveSubTab] = useState<"invoices" | "ledger" | "payments">("invoices");
  
  // Data lists
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [invoicesList, setInvoicesList] = useState<Invoice[]>([]);
  const [paymentsList, setPaymentsList] = useState<Payment[]>([]);
  
  // Selected ledger states
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(undefined);
  const [ledgerLines, setLedgerLines] = useState<LedgerLine[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Invoice Form states
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invNumber, setInvNumber] = useState("");
  const [invType, setInvType] = useState("sales");
  const [invParty, setInvParty] = useState("");
  const [invAmount, setInvAmount] = useState("");
  const [invTax, setInvTax] = useState("");
  const [invDueDate, setInvDueDate] = useState("");

  // Voucher Form states
  const [showVoucherForm, setShowVoucherForm] = useState(false);
  const [vouchNumber, setVouchNumber] = useState("");
  const [vouchType, setVouchType] = useState("receipt");
  const [vouchParty, setVouchParty] = useState("");
  const [vouchAmount, setVouchAmount] = useState("");
  const [vouchMethod, setVouchMethod] = useState("bank_transfer");
  const [vouchDesc, setVouchDesc] = useState("");
  const [vouchLinkedInvoice, setVouchLinkedInvoice] = useState<number | undefined>(undefined);

  const fetchFinanceData = async () => {
    try {
      setLoading(true);

      if (isBoltMode) {
        const [accs, invs, pays] = await Promise.all([
          fetchAccounts(token),
          fetchInvoices(token),
          fetchPayments(token),
        ]);
        setAccounts(accs as any[]);
        if ((accs as any[]).length > 0 && !selectedAccountId) {
          setSelectedAccountId((accs as any[])[0].id);
        }
        setInvoicesList((invs as any[]).filter((r: any) => globalDate.isInRange(r.date)));
        setPaymentsList((pays as any[]).filter((r: any) => globalDate.isInRange(r.date)));
        return;
      }

      const resAcc = await fetch("/api/finance/accounts", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resAcc.ok) {
        const data = await resAcc.json();
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(data[0].id);
        }
      }

      const resInv = await fetch("/api/finance/invoices", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resInv.ok) {
        const rows = await resInv.json();
        setInvoicesList(rows.filter((row: Invoice) => globalDate.isInRange(row.date)));
      }

      const resPay = await fetch("/api/finance/payments", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resPay.ok) {
        const rows = await resPay.json();
        setPaymentsList(rows.filter((row: Payment) => globalDate.isInRange(row.date)));
      }
    } catch (err) {
      console.error("Error loading finance details:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceData();
  }, [globalDate.range.end, globalDate.range.start, token]);

  // Load ledger details when selected account changes
  useEffect(() => {
    const fetchLedger = async () => {
      if (!selectedAccountId) return;
      try {
        const res = await fetch(`/api/finance/ledger/${selectedAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const rows = await res.json();
          setLedgerLines(rows.filter((row: LedgerLine) => globalDate.isInRange(row.entryDate)));
        }
      } catch (err) {
        console.error("Error loading ledger:", err);
      }
    };

    fetchLedger();
  }, [globalDate.range.end, globalDate.range.start, selectedAccountId, token]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invNumber || !invParty || !invAmount) return;

    try {
      const amountNum = Number(invAmount);
      const taxNum = Number(invTax) || 0;
      const totalNum = amountNum + taxNum;

      const invoicePayload = {
        invoiceNumber: invNumber,
        type: invType,
        partyName: invParty,
        amount: amountNum,
        taxAmount: taxNum,
        totalAmount: totalNum,
        date: new Date().toISOString(),
        dueDate: invDueDate ? new Date(invDueDate).toISOString() : new Date().toISOString(),
        status: "unpaid"
      };

      let res: Response;
      if (isBoltMode) {
        try {
          const data = await createInvoice(token, invoicePayload);
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        res = await fetch("/api/finance/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(invoicePayload),
        });
      }

      if (res.ok) {
        setMessage("Invoice successfully registered & journalized!");
        setShowInvoiceForm(false);
        setInvNumber("");
        setInvParty("");
        setInvAmount("");
        setInvTax("");
        setInvDueDate("");
        fetchFinanceData();
      }
    } catch (err) {
      console.error("Invoice creation failure:", err);
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vouchNumber || !vouchParty || !vouchAmount) return;

    try {
      const paymentPayload = {
        voucherNumber: vouchNumber,
        type: vouchType,
        partyName: vouchParty,
        amount: Number(vouchAmount),
        method: vouchMethod,
        description: vouchDesc || null,
        invoiceId: vouchLinkedInvoice || null,
        date: new Date().toISOString()
      };

      let res: Response;
      if (isBoltMode) {
        try {
          const data = await createPayment(token, paymentPayload);
          res = new Response(JSON.stringify(data), { status: 200 });
        } catch (err: any) {
          res = new Response(JSON.stringify({ message: err.message }), { status: 500 });
        }
      } else {
        res = await fetch("/api/finance/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(paymentPayload),
        });
      }

      if (res.ok) {
        setMessage("Payment registered & invoice balances updated!");
        setShowVoucherForm(false);
        setVouchNumber("");
        setVouchParty("");
        setVouchAmount("");
        setVouchDesc("");
        setVouchLinkedInvoice(undefined);
        fetchFinanceData();
      }
    } catch (err) {
      console.error("Voucher creation failure:", err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }


  // Selected account for running ledger balance
  const activeAccount = accounts.find(a => a.id === selectedAccountId);
  const isDebitNormal = activeAccount?.normalBalance === "debit";

  // Calculate running balance
  let runningBalance = 0;
  const ledgerLinesWithBalance = ledgerLines.map(line => {
    if (isDebitNormal) {
      runningBalance += (line.debit - line.credit);
    } else {
      runningBalance += (line.credit - line.debit);
    }
    return { ...line, balance: runningBalance };
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Financial Ledgers</h1>
          <p className="text-slate-500 text-sm mt-1">Full bookkeeping ledger, invoice matching, and voucher reconciliations.</p>
        </div>
      </div>

      {message && (
        <div className="p-3 bg-orange-50 border border-orange-200 text-orange-850 text-xs rounded-lg font-medium flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />
          {message}
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto pb-1 whitespace-nowrap bg-white p-2 rounded-xl shadow-sm">
        <button
          onClick={() => { setActiveSubTab("invoices"); setMessage(""); }}
          className={`pb-2 px-6 text-sm font-bold border-b-2 transition ${activeSubTab === "invoices" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          Invoice Tracker
        </button>
        <button
          onClick={() => { setActiveSubTab("ledger"); setMessage(""); }}
          className={`pb-2 px-6 text-sm font-bold border-b-2 transition ${activeSubTab === "ledger" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          General Ledger Accounts
        </button>
        <button
          onClick={() => { setActiveSubTab("payments"); setMessage(""); }}
          className={`pb-2 px-6 text-sm font-bold border-b-2 transition ${activeSubTab === "payments" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          Vouchers & Receipts
        </button>
      </div>

      {/* 1. INVOICES TAB */}
      {activeSubTab === "invoices" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800 text-lg">Invoice Registers</h3>
            <button
              onClick={() => setShowInvoiceForm(!showInvoiceForm)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
            >
              <Plus className="w-4 h-4" />
              Register Invoice
            </button>
          </div>

          {showInvoiceForm && (
            <form onSubmit={handleCreateInvoice} className="glass-panel p-6 max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Invoice Number</label>
                <input
                  type="text"
                  required
                  value={invNumber}
                  onChange={(e) => setInvNumber(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="e.g. INV-2026-001"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Invoice Category</label>
                <select
                  value={invType}
                  onChange={(e) => setInvType(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="sales">Sales Invoice (Customer)</option>
                  <option value="purchase">Purchase Invoice (Supplier)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Party / Corporate Client Name</label>
                <input
                  type="text"
                  required
                  value={invParty}
                  onChange={(e) => setInvParty(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="e.g. Reliance Group"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Due Date</label>
                <input
                  type="date"
                  required
                  value={invDueDate}
                  onChange={(e) => setInvDueDate(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subtotal Amount (₹)</label>
                <input
                  type="number"
                  required
                  value={invAmount}
                  onChange={(e) => setInvAmount(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="₹ 1,00,000"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tax Amount / GST (₹)</label>
                <input
                  type="number"
                  value={invTax}
                  onChange={(e) => setInvTax(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="₹ 18,000"
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowInvoiceForm(false)}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-slate-700 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition"
                >
                  Save & Post Ledger
                </button>
              </div>
            </form>
          )}

          <div className="glass-panel overflow-hidden border border-slate-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4">Invoice Number</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Party Name</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Due Date</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Tax</th>
                    <th className="px-6 py-4 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {invoicesList.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-6 py-4 font-mono text-orange-600 font-bold text-xs">{inv.invoiceNumber}</td>
                      <td className="px-6 py-4 font-medium capitalize text-slate-700">
                        {inv.type === "sales" ? "Sales (Cr)" : "Purchase (Dr)"}
                      </td>
                      <td className="px-6 py-4 text-slate-900 font-semibold">{inv.partyName}</td>
                      <td className="px-6 py-4 text-slate-500 text-xs">
                        {new Date(inv.date).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-xs">
                        {new Date(inv.dueDate).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide border ${inv.status === "paid" ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-700 border-red-100"}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-500">{formatCurrency(inv.taxAmount)}</td>
                      <td className="px-6 py-4 text-right text-slate-900 font-black">{formatCurrency(inv.totalAmount)}</td>
                    </tr>
                  ))}

                  {invoicesList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-400 text-xs">
                        No corporate invoices tracked
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. GENERAL LEDGER TAB */}
      {activeSubTab === "ledger" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400" />
              <select
                value={selectedAccountId || ""}
                onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none min-w-[280px]"
              >
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.code} - {acc.name} ({acc.accountType})
                  </option>
                ))}
              </select>
            </div>
            {selectedAccountId && (
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                <Printer className="w-4 h-4 text-orange-600" />
                Print Statement
              </button>
            )}
          </div>

          <div className="glass-panel p-5 print:border-0 print:bg-white print:text-black">
            <div className="text-center mb-6">
              <h2 className="text-xl font-extrabold text-slate-900 print:text-black uppercase tracking-wider">Account Ledger Statement</h2>
              {activeAccount && (
                <h3 className="text-lg font-bold text-orange-600 mt-1">
                  {activeAccount.code} — {activeAccount.name}
                </h3>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700 print:text-black">
                <thead className="bg-slate-50 text-slate-550 text-xs uppercase tracking-wider border-b border-slate-200 print:border-black">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Journal Ref</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Narration</th>
                    <th className="px-4 py-3 text-right">Debit (Dr)</th>
                    <th className="px-4 py-3 text-right">Credit (Cr)</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white print:divide-slate-200">
                  {ledgerLinesWithBalance.map((line) => (
                    <tr key={line.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                        {new Date(line.entryDate).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-orange-600">{line.entryNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500 capitalize">{line.sourceModule || "Manual"}</td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate text-slate-600">{line.description}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-blue-600 font-semibold">
                        {line.debit > 0 ? formatCurrency(line.debit) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-green-600 font-semibold">
                        {line.credit > 0 ? formatCurrency(line.credit) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-slate-900 font-bold">
                        {formatCurrency(line.balance)}
                      </td>
                    </tr>
                  ))}

                  {ledgerLines.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                        No ledger entries recorded for this account
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. VOUCHERS & RECEIPTS TAB */}
      {activeSubTab === "payments" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800 text-lg">Corporate Reconciled Vouchers</h3>
            <button
              onClick={() => setShowVoucherForm(!showVoucherForm)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
            >
              <Plus className="w-4 h-4" />
              Issue Voucher / Receipt
            </button>
          </div>

          {showVoucherForm && (
            <form onSubmit={handleCreateVoucher} className="glass-panel p-6 max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Voucher Number</label>
                <input
                  type="text"
                  required
                  value={vouchNumber}
                  onChange={(e) => setVouchNumber(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="e.g. PV-2026-001"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Voucher Type</label>
                <select
                  value={vouchType}
                  onChange={(e) => setVouchType(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="receipt">Receipt (Received from Client)</option>
                  <option value="payment">Payment (Paid to Vendor/Bill)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Party Name</label>
                <input
                  type="text"
                  required
                  value={vouchParty}
                  onChange={(e) => setVouchParty(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="e.g. HDFC Bank"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Method</label>
                <select
                  value={vouchMethod}
                  onChange={(e) => setVouchMethod(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="bank_transfer">Bank Transfer / NEFT</option>
                  <option value="cash">Cash Register</option>
                  <option value="cheque">Cheque Deposit</option>
                  <option value="upi">UPI / GPay</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Amount Transferred (₹)</label>
                <input
                  type="number"
                  required
                  value={vouchAmount}
                  onChange={(e) => setVouchAmount(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="₹ 50,000"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reconcile Linked Invoice</label>
                <select
                  value={vouchLinkedInvoice || ""}
                  onChange={(e) => setVouchLinkedInvoice(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="">Unlinked Payment</option>
                  {invoicesList.filter(inv => inv.status !== "paid").map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} — {inv.partyName} ({formatCurrency(inv.totalAmount)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Transact description</label>
                <textarea
                  rows={2}
                  value={vouchDesc}
                  onChange={(e) => setVouchDesc(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500 resize-none"
                  placeholder="Narration of the payment transaction..."
                ></textarea>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowVoucherForm(false)}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-slate-700 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition"
                >
                  Post Payment & Reconcile
                </button>
              </div>
            </form>
          )}

          <div className="glass-panel overflow-hidden border border-slate-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-550 text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4">Voucher No</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Party Name</th>
                    <th className="px-6 py-4">Method</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {paymentsList.map((pay) => (
                    <tr key={pay.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-6 py-4 font-mono text-orange-600 font-bold text-xs">{pay.voucherNumber}</td>
                      <td className="px-6 py-4 font-medium capitalize text-slate-700">
                        {pay.type === "receipt" ? "Receipt (Client)" : "Payment (Supplier)"}
                      </td>
                      <td className="px-6 py-4 text-slate-550 text-xs">
                        {new Date(pay.date).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-6 py-4 text-slate-900 font-semibold">{pay.partyName}</td>
                      <td className="px-6 py-4 text-slate-600 capitalize">{pay.method.replace("_", " ")}</td>
                      <td className="px-6 py-4 text-slate-550 text-xs max-w-xs truncate">{pay.description || "-"}</td>
                      <td className="px-6 py-4 text-right text-slate-900 font-black">{formatCurrency(pay.amount)}</td>
                    </tr>
                  ))}

                  {paymentsList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                        No financial vouchers logged
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancePage;
