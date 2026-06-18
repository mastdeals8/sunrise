import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { isBoltMode } from "../lib/supabase";
import { 
  Coins, 
  Plus, 
  UploadCloud, 
  Check, 
  X, 
  Trash, 
  Sparkles, 
  AlertCircle 
} from "lucide-react";

interface PettyCashExpense {
  id: number;
  category: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  paidBy: number | null;
  receiptImageUrl: string | null;
  expenseDate: string;
  status: string;
}

interface Staff {
  id: number;
  name: string;
}

const PettyCashPage: React.FC = () => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("office_supplies");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [paidBy, setPaidBy] = useState<number | undefined>(undefined);
  
  // OCR states
  const [scanning, setScanning] = useState(false);
  const [ocrSuccess, setOcrSuccess] = useState(false);
  const [receiptName, setReceiptName] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const resE = await fetch("/api/petty-cash", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resE.ok) {
        const dataE = await resE.json();
        setExpenses(dataE.filter((row: PettyCashExpense) => globalDate.isInRange(row.expenseDate)));
      }

      const resS = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resS.ok) {
        const dataS = await resS.json();
        setStaffList(dataS);
      }
    } catch (err) {
      console.error("Error loading petty cash data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [globalDate.range.end, globalDate.range.start, token]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;

    try {
      const res = await fetch("/api/petty-cash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          category,
          amount: Number(amount),
          vendor: vendor || null,
          description: description || null,
          paidBy: paidBy || null,
          expenseDate: expenseDate || new Date().toISOString(),
          status: "pending",
          receiptImageUrl: receiptName ? `/uploads/receipts/${receiptName}` : null
        })
      });

      if (res.ok) {
        setShowForm(false);
        setCategory("office_supplies");
        setAmount("");
        setVendor("");
        setDescription("");
        setExpenseDate("");
        setPaidBy(undefined);
        setOcrSuccess(false);
        setReceiptName("");
        fetchData();
      }
    } catch (err) {
      console.error("Error logging cash expense:", err);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    try {
      const res = await fetch(`/api/petty-cash/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Error updating petty cash status:", err);
    }
  };

  const handleDeleteExpense = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this expense record?")) return;
    try {
      const res = await fetch(`/api/petty-cash/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Error deleting expense:", err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setReceiptName(file.name);

    // Mock OCR scanning simulation
    setTimeout(async () => {
      setScanning(false);
      setOcrSuccess(true);
      
      const randomAmounts = [850, 1200, 2400, 320, 650];
      const randomVendors = ["Blue Dart Courier", "Starbucks Coffee", "Amazon Business", "Modern Book Depot", "Reliance Digital"];
      const randomCategory = ["transport", "food", "office_supplies", "office_supplies", "utilities"];

      const idx = Math.floor(Math.random() * randomAmounts.length);
      setAmount(randomAmounts[idx].toString());
      setVendor(randomVendors[idx]);
      setCategory(randomCategory[idx]);
      setDescription(`OCR Extracted: Purchase at ${randomVendors[idx]} for Sunrise Media production.`);
    }, 2000);
  };

  if (isBoltMode) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4 text-center px-4">
        <AlertCircle className="w-10 h-10 text-amber-500" />
        <h2 className="text-lg font-bold text-slate-800">Petty Cash requires the Express backend</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          This module is not yet available in Bolt preview mode. Run the full stack (<code>npm run dev:full</code>) to access Petty Cash.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }


  const totalApproved = expenses
    .filter(e => e.status === "approved")
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Petty Cash Registry</h1>
          <p className="text-slate-500 text-sm mt-1">Audit daily cash spending, minor costs, and scan receipt OCRs.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
        >
          <Plus className="w-4 h-4" />
          Log Minor Expense
        </button>
      </div>

      {/* Top dashboard summary banner */}
      <div className="p-6 glass-panel flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-orange-50 text-orange-600 rounded-full">
            <Coins className="w-8 h-8" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Total Cash Outflow</h3>
            <p className="text-xs text-slate-500 mt-0.5">Sum of all approved office and transport expenditures.</p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-3xl font-black text-slate-900">{formatCurrency(totalApproved)}</span>
          <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider mt-1">APPROVED OUTFLOW</span>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreateExpense} className="glass-panel p-6 max-w-3xl mx-auto space-y-6">
          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
            <h3 className="font-bold text-slate-900 text-lg">Log Petty Cash Expense</h3>
            <span className="text-[10px] uppercase font-bold text-orange-600 tracking-wider">MOCK OCR ACTIVE</span>
          </div>

          {/* OCR Dropper Block */}
          <div className="p-5 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 text-center relative hover:border-orange-500/30 transition-all group">
            <input 
              type="file" 
              accept="image/*,application/pdf"
              onChange={handleFileUpload} 
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {scanning ? (
              <div className="space-y-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent mx-auto"></div>
                <p className="text-xs font-semibold text-orange-600">OCR Wizard Scanning Receipt...</p>
              </div>
            ) : ocrSuccess ? (
              <div className="space-y-1">
                <Sparkles className="w-6 h-6 text-green-700 mx-auto" />
                <p className="text-xs font-bold text-green-700">OCR Scan Completed Successfully!</p>
                <p className="text-[10px] text-slate-500">Values have been prefilled. Please review below.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-orange-600 transition mx-auto" />
                <p className="text-xs font-bold text-slate-700">Drag Receipt Image here or Click to upload</p>
                <p className="text-[10px] text-slate-400">Supports JPG, PNG, PDF receipts up to 10MB</p>
              </div>
            )}
          </div>

          {/* Form details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Expense Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
              >
                <option value="office_supplies">Office Supplies</option>
                <option value="transport">Local Transport / Courier</option>
                <option value="food">Catering & Food</option>
                <option value="utilities">Electricity & Subscriptions</option>
                <option value="other">Other Expenses</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Amount (₹)</label>
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="₹ 500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Vendor / Store Name</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g. Modern Stationers"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Paid By (Talent)</label>
              <select
                value={paidBy || ""}
                onChange={(e) => setPaidBy(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
              >
                <option value="">Select Personnel...</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>{staff.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Expense Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500 resize-none"
                placeholder="Narration of the expense..."
              ></textarea>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => { setShowForm(false); setOcrSuccess(false); }}
              className="py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-slate-700 text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-all shadow-md"
            >
              Confirm Log Entry
            </button>
          </div>
        </form>
      )}

      {/* Expenses Table */}
      <div className="glass-panel overflow-hidden border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Expense Date</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Vendor</th>
                <th className="px-6 py-4">Paid By</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Amount</th>
                {user?.role === "admin" && <th className="px-6 py-4 text-center">Approvals</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {expenses.map((expense) => {
                const payer = staffList.find(s => s.id === expense.paidBy);
                return (
                  <tr key={expense.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                      {new Date(expense.expenseDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900 capitalize whitespace-nowrap">{expense.category.replace("_", " ")}</td>
                    <td className="px-6 py-4 text-slate-700 font-medium whitespace-nowrap">{expense.vendor || "-"}</td>
                    <td className="px-6 py-4 text-slate-600 whitespace-nowrap">{payer ? payer.name : "System"}</td>
                    <td className="px-6 py-4 text-slate-500 text-xs max-w-xs truncate">{expense.description || "-"}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border ${expense.status === "approved" ? "bg-green-50 text-green-700 border-green-100" : expense.status === "rejected" ? "bg-red-50 text-red-700 border-red-100" : "bg-orange-50 text-orange-700 border-orange-100"}`}>
                        {expense.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-900 font-black whitespace-nowrap">{formatCurrency(expense.amount)}</td>
                    {user?.role === "admin" && (
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {expense.status === "pending" ? (
                          <div className="flex gap-1.5 justify-center">
                            <button
                              onClick={() => handleUpdateStatus(expense.id, "approved")}
                              title="Approve Cash Outflow"
                              className="p-1 rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-100 transition"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(expense.id, "rejected")}
                              title="Reject"
                              className="p-1 rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleDeleteExpense(expense.id)}
                            className="p-1 rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-100 transition mx-auto"
                          >
                            <Trash className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {expenses.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-xs">
                    No petty cash transactions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PettyCashPage;
