import React, { useEffect, useState, useRef } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import {
  fetchMasterProjects,
  fetchProjectCostingOptions,
  fetchOperatingExpenses,
  createOperatingExpense,
  getActiveCompanyId,
  scanReceiptOCR,
  payPettyCashExpense,
} from "../lib/api";
import {
  Receipt,
  Plus,
  Filter,
  Check,
  X,
  Trash,
  Building2,
  Briefcase,
  MapPin,
  Coins,
  CreditCard,
  UploadCloud,
  Eye,
  CheckCircle2,
  Clock,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface OperatingExpense {
  id: number;
  companyId?: number;
  category: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  expenseDate: string;
  status: string;
  receiptImageUrl: string | null;
  extractedData?: {
    expenseType?: string;
    invoiceNumber?: string;
    gstRate?: number;
    gstAmount?: number;
    baseAmount?: number;
    isRecoverableGst?: boolean;
    paymentMethod?: string;
    paymentReference?: string;
    masterProjectId?: number;
    masterProjectName?: string;
    estimateId?: number;
    estimateNumber?: string;
    storeCode?: string | null;
    [key: string]: any;
  } | null;
}

const CATEGORIES = [
  { value: "rent", label: "Office / Workshop Rent" },
  { value: "salaries", label: "Staff Salaries & Wages" },
  { value: "electricity", label: "Electricity & Power Bills" },
  { value: "utilities", label: "Water & Maintenance Utilities" },
  { value: "internet", label: "Internet & Telecom" },
  { value: "fuel", label: "Vehicle Fuel & Local Transport" },
  { value: "travel", label: "Outstation Travel & Lodging" },
  { value: "office_supplies", label: "Office Supplies & Printing" },
  { value: "marketing", label: "Advertising & Marketing" },
  { value: "maintenance", label: "Machine & Tool Maintenance" },
  { value: "consulting", label: "Legal, CA & Audit Fees" },
  { value: "other", label: "Miscellaneous Operating Expense" },
];

export const ExpensesPage: React.FC = () => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();

  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [masterProjectsList, setMasterProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");
  const [selectedProjectFilter, setSelectedProjectFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [category, setCategory] = useState("rent");
  const [amount, setAmount] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [isRecoverableGst, setIsRecoverableGst] = useState(true);
  const [vendor, setVendor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [paymentReference, setPaymentReference] = useState("");

  // Cascading Project Costing
  const [selectedMasterProjectId, setSelectedMasterProjectId] = useState<number | undefined>(undefined);
  const [availableEstimates, setAvailableEstimates] = useState<any[]>([]);
  const [availableStores, setAvailableStores] = useState<any[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | undefined>(undefined);
  const [selectedStoreCode, setSelectedStoreCode] = useState("");
  const [loadingProjectOptions, setLoadingProjectOptions] = useState(false);

  // Receipt / File Upload
  const [receiptUrl, setReceiptUrl] = useState("");
  const [receiptName, setReceiptName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Document Preview Modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Payment Disbursement Modal
  const [paymentModalExpense, setPaymentModalExpense] = useState<OperatingExpense | null>(null);
  const [disburseMethod, setDisburseMethod] = useState("Bank Transfer");
  const [disburseRef, setDisburseRef] = useState("");
  const [disburseLoading, setDisburseLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [expList, projList] = await Promise.all([
        fetchOperatingExpenses(token, {
          category: selectedCategoryFilter,
          status: selectedStatusFilter,
        }),
        fetchMasterProjects(token).catch(() => []),
      ]);
      setExpenses(expList || []);
      setMasterProjectsList(projList || []);
    } catch (err) {
      console.error("Error loading expenses:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, selectedCategoryFilter, selectedStatusFilter]);

  const handleMasterProjectChange = async (pIdStr: string) => {
    const pId = pIdStr ? Number(pIdStr) : undefined;
    setSelectedMasterProjectId(pId);
    setSelectedEstimateId(undefined);
    setSelectedStoreCode("");
    setAvailableEstimates([]);
    setAvailableStores([]);

    if (!pId) return;

    try {
      setLoadingProjectOptions(true);
      const res = await fetchProjectCostingOptions(token, pId);
      setAvailableEstimates(res.estimates || []);
      setAvailableStores(res.stores || []);
    } catch (err) {
      console.error("Failed to load project options:", err);
    } finally {
      setLoadingProjectOptions(false);
    }
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setReceiptName(file.name);
      const res = await scanReceiptOCR(token, file);
      setReceiptUrl(res.receiptUrl);
      if (res.extracted.totalAmount && !amount) {
        setAmount(String(res.extracted.totalAmount));
      }
      if (res.extracted.vendor && !vendor) {
        setVendor(res.extracted.vendor);
      }
      if (res.extracted.receiptNumber && !invoiceNumber) {
        setInvoiceNumber(res.extracted.receiptNumber);
      }
      if (res.extracted.date) {
        setExpenseDate(res.extracted.date);
      }
    } catch (err: any) {
      alert(err.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  const calculatedGstAmount = React.useMemo(() => {
    const tot = Number(amount) || 0;
    const rate = Number(gstRate) || 0;
    if (rate <= 0 || tot <= 0) return 0;
    // Extract GST from gross: total * (rate / (100 + rate))
    return +(tot * (rate / (100 + rate))).toFixed(2);
  }, [amount, gstRate]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;

    try {
      await createOperatingExpense(token, {
        category,
        amount: Number(amount),
        gstRate: Number(gstRate) || 0,
        gstAmount: calculatedGstAmount,
        isRecoverableGst,
        vendor: vendor || null,
        invoiceNumber: invoiceNumber || null,
        description: description || null,
        expenseDate,
        paymentMethod,
        paymentReference: paymentReference || null,
        masterProjectId: selectedMasterProjectId || null,
        estimateId: selectedEstimateId || null,
        storeCode: selectedStoreCode || null,
        receiptImageUrl: receiptUrl || null,
      });

      setShowModal(false);
      resetForm();
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to log operating expense");
    }
  };

  const resetForm = () => {
    setCategory("rent");
    setAmount("");
    setGstRate("18");
    setIsRecoverableGst(true);
    setVendor("");
    setInvoiceNumber("");
    setDescription("");
    setExpenseDate(new Date().toISOString().split("T")[0]);
    setPaymentMethod("Bank Transfer");
    setPaymentReference("");
    setSelectedMasterProjectId(undefined);
    setSelectedEstimateId(undefined);
    setSelectedStoreCode("");
    setReceiptUrl("");
    setReceiptName("");
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      const res = await fetch(`/api/petty-cash/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleDisbursePayment = async () => {
    if (!paymentModalExpense) return;
    setDisburseLoading(true);

    try {
      await payPettyCashExpense(token, paymentModalExpense.id, {
        paymentMethod: disburseMethod,
        paymentReference: disburseRef || undefined,
      });
      setPaymentModalExpense(null);
      setDisburseRef("");
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to record payment");
    } finally {
      setDisburseLoading(false);
    }
  };

  // Filtered expenses list
  const filteredExpenses = expenses.filter((e) => {
    if (selectedProjectFilter === "general") {
      if (e.extractedData?.masterProjectId) return false;
    } else if (selectedProjectFilter === "project_linked") {
      if (!e.extractedData?.masterProjectId) return false;
    } else if (selectedProjectFilter.startsWith("proj_")) {
      const pId = Number(selectedProjectFilter.replace("proj_", ""));
      if (e.extractedData?.masterProjectId !== pId) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchVendor = (e.vendor || "").toLowerCase().includes(q);
      const matchInv = (e.extractedData?.invoiceNumber || "").toLowerCase().includes(q);
      const matchDesc = (e.description || "").toLowerCase().includes(q);
      const matchProj = (e.extractedData?.masterProjectName || "").toLowerCase().includes(q);
      if (!matchVendor && !matchInv && !matchDesc && !matchProj) return false;
    }
    return true;
  });

  // Aggregate Metrics
  const totalOperatingExpenditure = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalApproved = expenses.filter((e) => e.status === "approved").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalPaid = expenses.filter((e) => e.status === "paid").reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const pendingCount = expenses.filter((e) => e.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Operating Expenses Register</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Audit and record corporate overheads: rent, electricity, salaries, telecom, marketing, and project-attributed expenses.
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); resetForm(); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
        >
          <Plus className="w-4 h-4" />
          Log Operating Expense
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Total Operating Costs</span>
            <Building2 className="w-4 h-4 text-slate-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(totalOperatingExpenditure)}</div>
          <span className="text-[11px] text-slate-400 block mt-0.5">{expenses.length} total entries</span>
        </div>

        <div className="p-4 bg-white border border-amber-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-amber-700 uppercase tracking-wider">
            <span>Pending Approvals</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700">{pendingCount} bills</div>
          <span className="text-[11px] text-amber-600 block mt-0.5">Awaiting management verification</span>
        </div>

        <div className="p-4 bg-white border border-blue-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-blue-700 uppercase tracking-wider">
            <span>Approved (Awaiting Pay)</span>
            <Check className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-blue-700">{formatCurrency(totalApproved)}</div>
          <span className="text-[11px] text-blue-600 block mt-0.5">Ready for bank/RTGS disbursement</span>
        </div>

        <div className="p-4 bg-white border border-emerald-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span>Settled / Paid</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(totalPaid)}</div>
          <span className="text-[11px] text-emerald-600 block mt-0.5">Settled via bank or corporate card</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Filter className="w-3.5 h-3.5 text-orange-600" />
            <span>Category:</span>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <span>Status:</span>
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <span>Project:</span>
            <select
              value={selectedProjectFilter}
              onChange={(e) => setSelectedProjectFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
            >
              <option value="all">All Overheads & Projects</option>
              <option value="general">General Overhead Only</option>
              <option value="project_linked">Project Linked Only</option>
              {masterProjectsList.map((p) => (
                <option key={p.id} value={`proj_${p.id}`}>[{p.projectCode}] {p.name}</option>
              ))}
            </select>
          </div>

          <input
            type="text"
            placeholder="Search vendor, bill #, desc..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 w-48"
          />
        </div>

        <div className="text-xs text-slate-500">
          Showing <span className="font-bold text-slate-800">{filteredExpenses.length}</span> expenses
        </div>
      </div>

      {/* Expenses Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Category</th>
                <th className="px-5 py-3.5">Vendor / Bill #</th>
                <th className="px-5 py-3.5">Project / Store</th>
                <th className="px-5 py-3.5">Payment Details</th>
                <th className="px-5 py-3.5">Description</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Amount</th>
                <th className="px-5 py-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.map((exp) => {
                const ext = exp.extractedData || {};
                const catObj = CATEGORIES.find((c) => c.value === exp.category);
                const hasReceipt = !!exp.receiptImageUrl;

                return (
                  <tr key={exp.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                      {new Date(exp.expenseDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="font-bold text-xs text-slate-900 block">{catObj ? catObj.label : exp.category}</span>
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      <div className="font-semibold text-slate-800">{exp.vendor || "-"}</div>
                      {ext.invoiceNumber && (
                        <div className="text-[11px] text-slate-400 font-mono">Inv: {ext.invoiceNumber}</div>
                      )}
                      {hasReceipt && (
                        <button
                          type="button"
                          onClick={() => setPreviewUrl(exp.receiptImageUrl)}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-bold"
                        >
                          <Receipt className="w-3 h-3" /> View Bill
                        </button>
                      )}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      {ext.masterProjectId ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-orange-700 flex items-center gap-1 truncate max-w-[170px]">
                            <Building2 className="w-3 h-3 shrink-0" />
                            {ext.masterProjectName || `Project #${ext.masterProjectId}`}
                          </span>
                          {ext.storeCode && (
                            <span className="text-[10px] text-slate-600 font-semibold flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-blue-500 shrink-0" />
                              Store: {ext.storeCode}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">General Overhead</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      <div className="text-slate-700 font-medium">{ext.paymentMethod || "Bank Transfer"}</div>
                      {ext.paymentReference && (
                        <div className="text-[10px] text-slate-400 font-mono">Ref: {ext.paymentReference}</div>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-xs text-slate-600 max-w-xs truncate">
                      {exp.description || "-"}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {exp.status === "approved" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-blue-50 text-blue-700 border-blue-200">
                          Approved
                        </span>
                      ) : exp.status === "paid" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Paid
                        </span>
                      ) : exp.status === "rejected" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-red-50 text-red-700 border-red-200">
                          Rejected
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-amber-50 text-amber-700 border-amber-200">
                          Pending
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-right font-black text-slate-900 whitespace-nowrap">
                      {formatCurrency(exp.amount)}
                      {ext.gstAmount ? (
                        <span className="block text-[10px] font-normal text-slate-400">
                          incl. GST: {formatCurrency(ext.gstAmount)}
                        </span>
                      ) : null}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {exp.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(exp.id, "approved")}
                              title="Approve"
                              className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold flex items-center gap-1 transition"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(exp.id, "rejected")}
                              title="Reject"
                              className="p-1 rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {exp.status === "approved" && (
                          <>
                            <button
                              onClick={() => {
                                setPaymentModalExpense(exp);
                                setDisburseMethod(ext.paymentMethod || "Bank Transfer");
                                setDisburseRef(ext.paymentReference || "");
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition"
                            >
                              <Coins className="w-3 h-3" /> Pay / Disburse
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(exp.id, "rejected")}
                              title="Reject / Reverse"
                              className="p-1 rounded bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-700 border border-slate-200 transition"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        )}

                        {exp.status === "paid" && (
                          <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Settled
                          </span>
                        )}

                        {exp.status === "rejected" && (
                          <button
                            onClick={() => handleUpdateStatus(exp.id, "pending")}
                            title="Re-open"
                            className="p-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 transition text-[10px]"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400 text-xs">
                    No operating expenses found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Operating Expense Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateExpense} className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Log Operating Expense</h3>
                <p className="text-xs text-slate-500">Record corporate overhead: rent, power, wages, travel, or project-linked expenses.</p>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Bill Scanner / Uploader */}
            <div className="p-3 border border-dashed border-slate-300 rounded-lg bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-orange-600" />
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Attach Bill / Tax Invoice (Optional)</span>
                  <span className="text-[10px] text-slate-400">PDF, JPG, PNG up to 10MB</span>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleReceiptUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg hover:border-orange-500 transition shadow-sm"
              >
                {uploading ? "Scanning OCR..." : receiptName ? `Uploaded: ${receiptName.slice(0, 15)}...` : "Select File"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Expense Category *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-semibold focus:outline-none focus:border-orange-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Total Bill Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="₹ 15000"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Vendor / Payee Name</label>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="e.g. Landlord, MSEDCL, Airtel, Uber"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Bill / Invoice Reference #</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-2026-8819, Consumer #"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">GST Rate %</label>
                <select
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                >
                  <option value="0">0% (Nil / Exempt)</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18% (Standard Services)</option>
                  <option value="28">28%</option>
                </select>
                {calculatedGstAmount > 0 && (
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Calculated GST: {formatCurrency(calculatedGstAmount)}
                  </span>
                )}
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isRecoverableGst}
                    onChange={(e) => setIsRecoverableGst(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                  />
                  <span className="text-xs font-semibold text-slate-700">
                    Input GST is Recoverable (ITC eligible)
                  </span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Expense Date *</label>
                <input
                  type="date"
                  required
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                >
                  <option value="Bank Transfer">Bank Transfer (NEFT / RTGS)</option>
                  <option value="UPI">UPI / GPay / PhonePe</option>
                  <option value="Card">Corporate Debit/Credit Card</option>
                  <option value="Cheque">Company Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              {/* Project Costing Linkage */}
              <div className="md:col-span-2 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1.5 mb-2">
                  <Briefcase className="w-3.5 h-3.5 text-orange-600" />
                  <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">Project Cost Allocation (Optional)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Master Project</label>
                    <select
                      value={selectedMasterProjectId || ""}
                      onChange={(e) => handleMasterProjectChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                    >
                      <option value="">(None / General Overhead)</option>
                      {masterProjectsList.map((p) => (
                        <option key={p.id} value={p.id}>[{p.projectCode}] {p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Linked Estimate</label>
                    <select
                      disabled={!selectedMasterProjectId || loadingProjectOptions}
                      value={selectedEstimateId || ""}
                      onChange={(e) => setSelectedEstimateId(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                    >
                      <option value="">(Project-wide / No specific estimate)</option>
                      {availableEstimates.map((est) => (
                        <option key={est.id} value={est.id}>{est.estimateNumber} ({est.stores?.length || 0} stores)</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Target Store</label>
                    <select
                      disabled={!selectedMasterProjectId || loadingProjectOptions || availableStores.length === 0}
                      value={selectedStoreCode}
                      onChange={(e) => setSelectedStoreCode(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                    >
                      <option value="">(Project-wide / No store)</option>
                      {availableStores.map((st) => (
                        <option key={`${st.estimateId}-${st.storeCode}`} value={st.storeCode}>
                          {st.storeCode} - {st.storeName || st.storeCity || "Store"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Narration / Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Narration of the expense..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 resize-none"
                ></textarea>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-md"
              >
                Confirm Log Entry
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Disburse Payment Modal */}
      {paymentModalExpense && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200 animate-in fade-in duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Record Operating Expense Payment</h3>
              </div>
              <button onClick={() => setPaymentModalExpense(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Category:</span>
                <span className="font-semibold text-slate-800 capitalize">{paymentModalExpense.category.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payee / Vendor:</span>
                <span className="font-semibold text-slate-800">{paymentModalExpense.vendor || "Direct Expense"}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-black">
                <span className="text-slate-700">Amount to Settle:</span>
                <span className="text-emerald-700">{formatCurrency(paymentModalExpense.amount)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Payment Mode *
                </label>
                <select
                  value={disburseMethod}
                  onChange={(e) => setDisburseMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="Bank Transfer">Bank Transfer (NEFT / RTGS)</option>
                  <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                  <option value="Card">Company Debit / Credit Card</option>
                  <option value="Cheque">Company Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  UTR / Reference / Cheque No. (Optional)
                </label>
                <input
                  type="text"
                  value={disburseRef}
                  onChange={(e) => setDisburseRef(e.target.value)}
                  placeholder="e.g. UTR / IMPS Ref / Cheque #"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setPaymentModalExpense(null)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disburseLoading}
                onClick={handleDisbursePayment}
                className="py-2 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
              >
                {disburseLoading ? "Recording..." : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-4 shadow-2xl space-y-3 max-h-[90vh] flex flex-col border border-slate-200">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-orange-600" /> Bill Preview
              </span>
              <div className="flex items-center gap-2">
                <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-orange-600 hover:text-orange-700 font-bold">
                  Open in New Tab
                </a>
                <button onClick={() => setPreviewUrl(null)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-900/5 rounded-lg flex items-center justify-center p-2 min-h-[300px]">
              {previewUrl.endsWith(".pdf") ? (
                <iframe src={previewUrl} title="Document Preview" className="w-full h-[550px] rounded border border-slate-200" />
              ) : (
                <img src={previewUrl} alt="Bill Preview" className="max-h-[550px] w-auto object-contain rounded shadow-sm" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpensesPage;
