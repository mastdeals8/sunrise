import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { supabase, isBoltMode } from "../lib/supabase";
import { fetchUsers, fetchEstimates, fetchDeliveryChallans, getActiveCompanyId } from "../lib/api";
import { 
  Coins, 
  Plus, 
  UploadCloud, 
  Check, 
  X, 
  Trash, 
  Sparkles, 
  AlertCircle,
  Briefcase,
  Truck,
  Filter
} from "lucide-react";

interface PettyCashExpense {
  id: number;
  companyId?: number;
  category: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  paidBy: number | null;
  receiptImageUrl: string | null;
  extractedData?: {
    estimateId?: number;
    estimateNumber?: string;
    projectName?: string;
    dcId?: number;
    dcNumber?: string;
    [key: string]: any;
  } | null;
  expenseDate: string;
  status: string;
  createdAt?: string;
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
  const [estimatesList, setEstimatesList] = useState<any[]>([]);
  const [dcList, setDcList] = useState<any[]>([]);
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("office_supplies");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [paidBy, setPaidBy] = useState<number | undefined>(undefined);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | undefined>(undefined);
  const [selectedDcId, setSelectedDcId] = useState<number | undefined>(undefined);
  
  // OCR states
  const [scanning, setScanning] = useState(false);
  const [ocrSuccess, setOcrSuccess] = useState(false);
  const [receiptName, setReceiptName] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const activeCompanyId = getActiveCompanyId();

      // Load estimates and DCs for job-cost linking
      const [allEsts, allDCs] = await Promise.all([
        fetchEstimates(token).catch(() => []),
        fetchDeliveryChallans(token).catch(() => []),
      ]);
      setEstimatesList(allEsts || []);
      setDcList(allDCs || []);

      if (isBoltMode) {
        const { data: rows, error: errRows } = await supabase
          .from("petty_cash_expenses")
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("expense_date", { ascending: false });
        if (errRows) {
          console.warn("Error loading petty cash from supabase:", errRows.message);
        }
        const dataE = (rows || []).map((r: any) => ({
          id: r.id,
          companyId: r.company_id,
          category: r.category,
          amount: Number(r.amount),
          vendor: r.vendor,
          description: r.description,
          paidBy: r.paid_by,
          expenseDate: r.expense_date,
          status: r.status,
          receiptImageUrl: r.receipt_image_url,
          extractedData: r.extracted_data || null,
          createdAt: r.created_at,
        }));
        setExpenses(dataE.filter((row: PettyCashExpense) => globalDate.isInRange(row.expenseDate)));
        const staff = await fetchUsers(token);
        setStaffList(staff);
        return;
      }

      const resE = await fetch(`/api/petty-cash?companyId=${activeCompanyId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resE.ok) {
        const dataE = await resE.json();
        const mapped = (dataE || []).map((r: any) => ({
          ...r,
          extractedData: r.extractedData || r.extracted_data || null,
        }));
        setExpenses(mapped.filter((row: PettyCashExpense) => globalDate.isInRange(row.expenseDate)));
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

    const activeCompanyId = getActiveCompanyId();
    const est = estimatesList.find(item => item.id === selectedEstimateId);
    const dc = dcList.find(item => item.id === selectedDcId);

    const jobData = (selectedEstimateId || selectedDcId) ? {
      estimateId: est?.id,
      estimateNumber: est?.estimateNumber || est?.estimate_number,
      projectName: est?.projectName || est?.project_name,
      dcId: dc?.id,
      dcNumber: dc?.dcNumber || dc?.dc_number,
    } : null;

    if (isBoltMode) {
      const { error: insErr } = await supabase.from("petty_cash_expenses").insert({
        category,
        amount: Number(amount),
        vendor: vendor || null,
        description: description || null,
        paid_by: paidBy || null,
        expense_date: expenseDate || new Date().toISOString(),
        status: "pending",
        receipt_image_url: receiptName ? `/uploads/receipts/${receiptName}` : null,
        extracted_data: jobData,
        company_id: activeCompanyId,
      });
      if (!insErr) {
        setShowForm(false);
        setCategory("office_supplies");
        setAmount("");
        setVendor("");
        setDescription("");
        setExpenseDate("");
        setPaidBy(undefined);
        setSelectedEstimateId(undefined);
        setSelectedDcId(undefined);
        setOcrSuccess(false);
        setReceiptName("");
        fetchData();
      }
      return;
    }

    try {
      const res = await fetch("/api/petty-cash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Company-Id": String(activeCompanyId),
        },
        body: JSON.stringify({
          category,
          amount: Number(amount),
          vendor: vendor || null,
          description: description || null,
          paidBy: paidBy || null,
          expenseDate: expenseDate || new Date().toISOString(),
          status: "pending",
          receiptImageUrl: receiptName ? `/uploads/receipts/${receiptName}` : null,
          extractedData: jobData,
          companyId: activeCompanyId,
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
        setSelectedEstimateId(undefined);
        setSelectedDcId(undefined);
        setOcrSuccess(false);
        setReceiptName("");
        fetchData();
      }
    } catch (err) {
      console.error("Error logging cash expense:", err);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    if (isBoltMode) {
      await supabase.from("petty_cash_expenses").update({ status: newStatus }).eq("id", id);
      fetchData();
      return;
    }

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

    if (isBoltMode) {
      await supabase.from("petty_cash_expenses").delete().eq("id", id);
      fetchData();
      return;
    }

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
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Link to Project / Estimate (Job Costing)
              </label>
              <select
                value={selectedEstimateId || ""}
                onChange={(e) => setSelectedEstimateId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">General Overhead (Not project specific)</option>
                {estimatesList.map((est) => (
                  <option key={est.id} value={est.id}>
                    {est.estimateNumber || est.estimate_number || `Est #${est.id}`} - {est.projectName || est.project_name || "Project"} ({est.clientName || est.client_name || ""})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Link to Delivery Challan (DC)
              </label>
              <select
                value={selectedDcId || ""}
                onChange={(e) => setSelectedDcId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">No DC Attached</option>
                {dcList
                  .filter((dc) => !selectedEstimateId || (dc.estimateId || dc.estimate_id) === selectedEstimateId)
                  .map((dc) => (
                    <option key={dc.id} value={dc.id}>
                      {dc.dcNumber || dc.dc_number || `DC #${dc.id}`} {dc.storeName || dc.store_name ? `(${dc.storeName || dc.store_name})` : ""}
                    </option>
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

      {/* Project Job Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Filter className="w-4 h-4 text-orange-600" />
          <span>Job Cost Filter:</span>
          <select
            value={selectedProjectFilter}
            onChange={(e) => setSelectedProjectFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Expenses (General + All Projects)</option>
            <option value="general">General Overhead Only</option>
            <option value="project_linked">Project Linked Only</option>
            {estimatesList.map((est) => (
              <option key={est.id} value={`est_${est.id}`}>
                {est.estimateNumber || est.estimate_number || `Est #${est.id}`} - {est.projectName || est.project_name || "Project"}
              </option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-500">
          Showing <span className="font-bold text-slate-800">{
            expenses.filter((e) => {
              if (selectedProjectFilter === "general") return !e.extractedData?.estimateId && !e.extractedData?.estimateNumber;
              if (selectedProjectFilter === "project_linked") return !!(e.extractedData?.estimateId || e.extractedData?.estimateNumber);
              if (selectedProjectFilter.startsWith("est_")) {
                const eid = Number(selectedProjectFilter.replace("est_", ""));
                return e.extractedData?.estimateId === eid;
              }
              return true;
            }).length
          }</span> of <span className="font-bold text-slate-800">{expenses.length}</span> expenses
        </div>
      </div>

      {/* Expenses Table */}
      <div className="glass-panel overflow-hidden border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Expense Date</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Job / Project</th>
                <th className="px-6 py-4">Vendor</th>
                <th className="px-6 py-4">Paid By</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Amount</th>
                {user?.role === "admin" && <th className="px-6 py-4 text-center">Approvals</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {expenses
                .filter((expense) => {
                  if (selectedProjectFilter === "general") return !expense.extractedData?.estimateId && !expense.extractedData?.estimateNumber;
                  if (selectedProjectFilter === "project_linked") return !!(expense.extractedData?.estimateId || expense.extractedData?.estimateNumber);
                  if (selectedProjectFilter.startsWith("est_")) {
                    const eid = Number(selectedProjectFilter.replace("est_", ""));
                    return expense.extractedData?.estimateId === eid;
                  }
                  return true;
                })
                .map((expense) => {
                const payer = staffList.find(s => s.id === expense.paidBy);
                return (
                  <tr key={expense.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                      {new Date(expense.expenseDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900 capitalize whitespace-nowrap">{expense.category.replace("_", " ")}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      {expense.extractedData?.estimateNumber || expense.extractedData?.projectName ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-amber-800 flex items-center gap-1">
                            <Briefcase className="w-3 h-3 text-amber-600 inline shrink-0" />
                            <span className="truncate max-w-[150px]">{expense.extractedData.estimateNumber || "Est"} · {expense.extractedData.projectName || "Job"}</span>
                          </span>
                          {expense.extractedData.dcNumber && (
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Truck className="w-2.5 h-2.5 text-slate-400 inline shrink-0" />
                              <span className="truncate max-w-[120px]">{expense.extractedData.dcNumber}</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">General</span>
                      )}
                    </td>
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
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-xs">
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
