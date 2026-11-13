import React, { useEffect, useState, useRef } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { supabase, isBoltMode } from "../lib/supabase";
import { 
  fetchUsers, 
  fetchMasterProjects, 
  getActiveCompanyId,
  scanReceiptOCR,
  fetchProjectCostingOptions,
  payPettyCashExpense
} from "../lib/api";
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
  Filter,
  Eye,
  Camera,
  Receipt,
  FileText,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Building2,
  MapPin,
  RefreshCw
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
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidAt?: string | null;
  disbursedBy?: number | null;
  extractedData?: {
    masterProjectId?: number;
    masterProjectName?: string;
    estimateId?: number;
    estimateNumber?: string;
    projectName?: string;
    storeCode?: string | null;
    storeName?: string | null;
    gstAmount?: number;
    isRecoverableGst?: boolean;
    ocrMetadata?: any;
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

interface ProjectOptionEstimate {
  id: number;
  estimateNumber: string;
  title?: string;
  clientName?: string;
  stores: Array<{
    storeCode: string;
    storeName: string;
    storeCity?: string;
  }>;
}

interface ProjectOptionStore {
  storeCode: string;
  storeName: string;
  storeCity: string;
  estimateId: number;
}

const PettyCashPage: React.FC = () => {
  const { token, user } = useAuth();
  const globalDate = useGlobalDate();
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [masterProjectsList, setMasterProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Form states
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("office_supplies");
  const [amount, setAmount] = useState("");
  const [gstAmount, setGstAmount] = useState("");
  const [isRecoverableGst, setIsRecoverableGst] = useState(false);
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidBy, setPaidBy] = useState<number | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [paymentReference, setPaymentReference] = useState<string>("");

  // Cascading Project Costing states
  const [selectedMasterProjectId, setSelectedMasterProjectId] = useState<number | undefined>(undefined);
  const [availableEstimates, setAvailableEstimates] = useState<ProjectOptionEstimate[]>([]);
  const [availableStores, setAvailableStores] = useState<ProjectOptionStore[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | undefined>(undefined);
  const [selectedStoreCode, setSelectedStoreCode] = useState<string>("");
  const [loadingProjectOptions, setLoadingProjectOptions] = useState(false);

  // OCR and Receipt states
  const [scanning, setScanning] = useState(false);
  const [ocrSuccess, setOcrSuccess] = useState(false);
  const [ocrResultData, setOcrResultData] = useState<any>(null);
  const [receiptUrl, setReceiptUrl] = useState<string>("");
  const [receiptName, setReceiptName] = useState<string>("");
  const [showOcrRawText, setShowOcrRawText] = useState(false);

  // Receipt Preview Modal
  const [previewReceiptUrl, setPreviewReceiptUrl] = useState<string | null>(null);

  // Payment Disbursement Modal
  const [paymentModalExpense, setPaymentModalExpense] = useState<PettyCashExpense | null>(null);
  const [disburseMethod, setDisburseMethod] = useState<string>("Cash");
  const [disburseRef, setDisburseRef] = useState<string>("");
  const [disburseLoading, setDisburseLoading] = useState(false);

  // File input refs for camera vs file upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const activeCompanyId = getActiveCompanyId();

      const [allProjects, staff] = await Promise.all([
        fetchMasterProjects(token).catch(() => []),
        fetchUsers(token).catch(() => []),
      ]);
      setMasterProjectsList(allProjects || []);
      setStaffList(staff || []);

      if (isBoltMode) {
        const { data: rows, error: errRows } = await supabase
          .from("petty_cash_expenses")
          .select("*")
          .eq("company_id", activeCompanyId)
          .order("expense_date", { ascending: false });
        if (errRows) {
          console.warn("Error loading petty cash from supabase:", errRows.message);
        }
        const dataE = (rows || []).map((r: any) => {
          const ext = r.extracted_data || {};
          return {
            id: r.id,
            companyId: r.company_id,
            category: r.category,
            amount: Number(r.amount),
            vendor: r.vendor,
            description: r.description,
            paidBy: r.paid_by,
            paymentMethod: r.payment_method || ext.paymentMethod || null,
            paymentReference: r.payment_reference || ext.paymentReference || null,
            paidAt: r.paid_at || ext.paidAt || null,
            disbursedBy: r.disbursed_by || ext.disbursedBy || null,
            expenseDate: r.expense_date,
            status: r.status,
            receiptImageUrl: r.receipt_image_url,
            extractedData: ext,
            createdAt: r.created_at,
          };
        });
        setExpenses(dataE.filter((row: PettyCashExpense) => globalDate.isInRange(row.expenseDate)));
        return;
      }

      const resE = await fetch(`/api/petty-cash?companyId=${activeCompanyId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resE.ok) {
        const dataE = await resE.json();
        const mapped = (dataE || []).map((r: any) => {
          const ext = r.extractedData || r.extracted_data || {};
          return {
            ...r,
            paymentMethod: r.paymentMethod || ext.paymentMethod || null,
            paymentReference: r.paymentReference || ext.paymentReference || null,
            paidAt: r.paidAt || ext.paidAt || null,
            disbursedBy: r.disbursedBy || ext.disbursedBy || null,
            extractedData: ext,
          };
        });
        setExpenses(mapped.filter((row: PettyCashExpense) => globalDate.isInRange(row.expenseDate)));
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

  // Handle cascading project selection
  const handleMasterProjectChange = async (projectIdStr: string) => {
    const pId = projectIdStr ? Number(projectIdStr) : undefined;
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
      console.error("Failed to load project costing options:", err);
    } finally {
      setLoadingProjectOptions(false);
    }
  };

  // Filter stores when estimate changes
  const handleEstimateChange = (estimateIdStr: string) => {
    const eId = estimateIdStr ? Number(estimateIdStr) : undefined;
    setSelectedEstimateId(eId);
    setSelectedStoreCode("");
  };

  // Compute stores to display based on whether estimate is selected
  const visibleStores = React.useMemo(() => {
    if (!selectedEstimateId) {
      // All stores belonging to any linked estimate in this project
      return availableStores;
    }
    return availableStores.filter(s => s.estimateId === selectedEstimateId);
  }, [availableStores, selectedEstimateId]);

  // Real OCR File Upload and Scanning
  const processReceiptFile = async (file: File) => {
    if (!file) return;

    setScanning(true);
    setOcrSuccess(false);
    setReceiptName(file.name);
    setOcrResultData(null);

    try {
      const response = await scanReceiptOCR(token, file);
      setScanning(false);
      setOcrSuccess(true);
      setReceiptUrl(response.receiptUrl);

      const ocr = response.extracted;
      setOcrResultData(ocr);

      // Autofill fields honestly if extracted
      if (ocr.totalAmount != null) {
        setAmount(String(ocr.totalAmount));
      }
      if (ocr.gstAmount != null) {
        setGstAmount(String(ocr.gstAmount));
      }
      if (ocr.vendor) {
        setVendor(ocr.vendor);
      }
      if (ocr.date) {
        setExpenseDate(ocr.date);
      }
      if (ocr.category && ["office_supplies", "transport", "food", "utilities", "hardware", "other"].includes(ocr.category)) {
        setCategory(ocr.category);
      }
      if (ocr.receiptNumber && !description) {
        setDescription(`Receipt / Inv #${ocr.receiptNumber}`);
      }
    } catch (err: any) {
      setScanning(false);
      alert(err.message || "Failed to scan receipt image.");
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;

    const activeCompanyId = getActiveCompanyId();
    const proj = masterProjectsList.find(p => p.id === selectedMasterProjectId);
    const est = availableEstimates.find(item => item.id === selectedEstimateId);
    const selectedStore = visibleStores.find(s => s.storeCode === selectedStoreCode);

    const jobData = selectedMasterProjectId ? {
      masterProjectId: proj?.id,
      masterProjectName: proj?.name,
      estimateId: est?.id || null,
      estimateNumber: est?.estimateNumber || null,
      projectName: est?.title || null,
      storeCode: selectedStoreCode ? selectedStoreCode.trim().toUpperCase() : null,
      storeName: selectedStore?.storeName || null,
      gstAmount: gstAmount ? Number(gstAmount) : 0,
      isRecoverableGst: isRecoverableGst,
      ocrMetadata: ocrResultData ? {
        receiptNumber: ocrResultData.receiptNumber,
        gstin: ocrResultData.gstin,
        vendor: ocrResultData.vendor,
        taxableAmount: ocrResultData.taxableAmount,
      } : null,
    } : null;

    const payload = {
      category,
      amount: Number(amount),
      vendor: vendor || null,
      description: description || null,
      paidBy: paidBy || null,
      paymentMethod: paymentMethod || "Cash",
      paymentReference: paymentReference || null,
      expenseDate: expenseDate || new Date().toISOString().split("T")[0],
      status: "pending",
      receiptImageUrl: receiptUrl || null,
      extractedData: jobData,
      companyId: activeCompanyId,
    };

    if (isBoltMode) {
      const { error: insErr } = await supabase.from("petty_cash_expenses").insert({
        category: payload.category,
        amount: payload.amount,
        vendor: payload.vendor,
        description: payload.description,
        paid_by: payload.paidBy,
        payment_method: payload.paymentMethod,
        payment_reference: payload.paymentReference,
        expense_date: payload.expenseDate,
        status: payload.status,
        receipt_image_url: payload.receiptImageUrl,
        extracted_data: payload.extractedData,
        company_id: activeCompanyId,
      });
      if (!insErr) {
        resetForm();
        fetchData();
      } else {
        alert("Failed to save expense: " + insErr.message);
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
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        resetForm();
        fetchData();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.message || "Failed to record petty cash expense");
      }
    } catch (err) {
      console.error("Error logging cash expense:", err);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setCategory("office_supplies");
    setAmount("");
    setGstAmount("");
    setIsRecoverableGst(false);
    setVendor("");
    setDescription("");
    setExpenseDate(new Date().toISOString().split("T")[0]);
    setPaidBy(undefined);
    setPaymentMethod("Cash");
    setPaymentReference("");
    setSelectedMasterProjectId(undefined);
    setSelectedEstimateId(undefined);
    setSelectedStoreCode("");
    setAvailableEstimates([]);
    setAvailableStores([]);
    setOcrSuccess(false);
    setOcrResultData(null);
    setReceiptUrl("");
    setReceiptName("");
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
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || "Failed to update expense status");
      }
    } catch (err) {
      console.error("Error updating petty cash status:", err);
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
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to record payment disbursement");
    } finally {
      setDisburseLoading(false);
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

  // Filtered expenses list
  const filteredExpenses = expenses.filter((e) => {
    // Project filter
    if (selectedProjectFilter === "general") {
      if (e.extractedData?.masterProjectId || e.extractedData?.estimateId) return false;
    } else if (selectedProjectFilter === "project_linked") {
      if (!e.extractedData?.masterProjectId && !e.extractedData?.estimateId) return false;
    } else if (selectedProjectFilter.startsWith("proj_")) {
      const pId = Number(selectedProjectFilter.replace("proj_", ""));
      if (e.extractedData?.masterProjectId !== pId) return false;
    }

    // Status filter
    if (selectedStatusFilter !== "all" && e.status !== selectedStatusFilter) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchVendor = (e.vendor || "").toLowerCase().includes(q);
      const matchDesc = (e.description || "").toLowerCase().includes(q);
      const matchProj = (e.extractedData?.masterProjectName || "").toLowerCase().includes(q);
      const matchStore = (e.extractedData?.storeCode || "").toLowerCase().includes(q);
      const matchRef = (e.paymentReference || "").toLowerCase().includes(q);
      if (!matchVendor && !matchDesc && !matchProj && !matchStore && !matchRef) return false;
    }

    return true;
  });

  // Calculate Header Metrics
  const totalApproved = expenses
    .filter(e => e.status === "approved")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalPaid = expenses
    .filter(e => e.status === "paid")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalOutflow = totalApproved + totalPaid;

  const pendingExpenses = expenses.filter(e => e.status === "pending");
  const pendingTotal = pendingExpenses.reduce((sum, e) => sum + e.amount, 0);

  const projectAllocatedTotal = expenses
    .filter(e => (e.status === "approved" || e.status === "paid") && (e.extractedData?.masterProjectId || e.extractedData?.estimateId))
    .reduce((sum, e) => sum + e.amount, 0);

  const generalOverheadTotal = totalOutflow - projectAllocatedTotal;

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Petty Cash & Expense Registry</h1>
          <p className="text-slate-500 text-sm mt-1">Audit daily cash spending, scan receipts with genuine OCR, and track project allocations.</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancel Entry" : "Log Minor Expense"}
        </button>
      </div>

      {/* Top Dashboard Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="glass-panel p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Outflow</span>
            <div className="p-2 bg-slate-100 text-slate-700 rounded-lg">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-slate-900">{formatCurrency(totalOutflow)}</span>
            <span className="text-[11px] text-slate-400 block mt-0.5">Approved + Disbursed</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-white border border-amber-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Pending Approval</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-amber-700">{formatCurrency(pendingTotal)}</span>
            <span className="text-[11px] text-amber-600 font-medium block mt-0.5">{pendingExpenses.length} awaiting review</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-white border border-blue-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Approved (Awaiting Pay)</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Check className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-blue-700">{formatCurrency(totalApproved)}</span>
            <span className="text-[11px] text-blue-600 block mt-0.5">Ready for cash disbursement</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-white border border-emerald-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Paid Disbursements</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-emerald-700">{formatCurrency(totalPaid)}</span>
            <span className="text-[11px] text-emerald-600 block mt-0.5">Cash / UPI settled</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-white border border-orange-200 rounded-xl shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">Project Cost Split</span>
            <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
              <Briefcase className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-lg font-black text-orange-700">{formatCurrency(projectAllocatedTotal)}</span>
            <div className="text-[10px] text-slate-500 flex justify-between mt-1 pt-1 border-t border-slate-100">
              <span>Projects: {formatCurrency(projectAllocatedTotal)}</span>
              <span>General: {formatCurrency(generalOverheadTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expense Form Modal / Panel */}
      {showForm && (
        <form onSubmit={handleCreateExpense} className="glass-panel p-6 max-w-4xl mx-auto space-y-6 bg-white border border-slate-200 rounded-xl shadow-lg">
          <div className="flex justify-between items-center pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Log Petty Cash Expense</h3>
              <p className="text-xs text-slate-500">Scan physical receipts with genuine OCR or enter minor cash voucher details.</p>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold tracking-wide">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              GENUINE OCR ENGINE ACTIVE
            </div>
          </div>

          {/* OCR Dropper & Camera Action Card */}
          <div className="p-5 border-2 border-dashed border-slate-300 hover:border-orange-500 rounded-xl bg-slate-50 text-center transition-all">
            {/* Hidden native inputs for file and mobile camera */}
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processReceiptFile(file);
              }} 
              className="hidden"
            />
            <input 
              ref={cameraInputRef}
              type="file" 
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) processReceiptFile(file);
              }} 
              className="hidden"
            />

            {scanning ? (
              <div className="py-6 space-y-3">
                <div className="h-8 w-8 animate-spin rounded-full border-3 border-orange-500 border-t-transparent mx-auto"></div>
                <div>
                  <p className="text-sm font-bold text-orange-600">Analyzing Document via Tesseract OCR Engine...</p>
                  <p className="text-xs text-slate-500 mt-1">Extracting vendor, GSTIN, receipt number, date, and monetary figures.</p>
                </div>
              </div>
            ) : ocrSuccess && ocrResultData ? (
              <div className="space-y-3 py-2">
                <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Receipt Scanned Successfully ({receiptName})
                </div>

                {/* Structured Extracted Data Display Card */}
                <div className="bg-white p-4 rounded-lg border border-emerald-200 text-left grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs shadow-sm">
                  <div>
                    <span className="text-slate-400 block font-medium">Detected Vendor</span>
                    <span className="font-bold text-slate-800">{ocrResultData.vendor || "Not detected (manual entry)"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Receipt / Inv #</span>
                    <span className="font-bold text-slate-800">{ocrResultData.receiptNumber || "Not detected"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Invoice Date</span>
                    <span className="font-bold text-slate-800">{ocrResultData.date || "Not detected"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Total Amount</span>
                    <span className="font-bold text-emerald-700 text-sm">
                      {ocrResultData.totalAmount ? formatCurrency(ocrResultData.totalAmount) : "Not detected"}
                    </span>
                  </div>
                  {ocrResultData.gstin && (
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-medium">Vendor GSTIN</span>
                      <span className="font-mono font-bold text-blue-700">{ocrResultData.gstin}</span>
                    </div>
                  )}
                  {ocrResultData.gstAmount && (
                    <div>
                      <span className="text-slate-400 block font-medium">GST Amount</span>
                      <span className="font-bold text-slate-700">{formatCurrency(ocrResultData.gstAmount)}</span>
                    </div>
                  )}
                  {receiptUrl && (
                    <div className="col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => setPreviewReceiptUrl(receiptUrl)}
                        className="text-xs text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Receipt
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center px-1">
                  <button
                    type="button"
                    onClick={() => setShowOcrRawText(!showOcrRawText)}
                    className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1 font-medium"
                  >
                    {showOcrRawText ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showOcrRawText ? "Hide raw text" : "Show extracted raw text"}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] text-orange-600 hover:text-orange-700 font-bold"
                  >
                    Scan another receipt
                  </button>
                </div>

                {showOcrRawText && ocrResultData.rawText && (
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded text-[11px] text-left max-h-36 overflow-y-auto whitespace-pre-wrap font-mono">
                    {ocrResultData.rawText}
                  </pre>
                )}
              </div>
            ) : (
              <div className="py-4 space-y-3">
                <UploadCloud className="w-10 h-10 text-slate-400 mx-auto" />
                <div>
                  <p className="text-xs font-bold text-slate-700">Scan Bill / Receipt using Genuine OCR</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Accepts JPG, PNG, PDF receipts. Values will be extracted into the form automatically.</p>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:border-orange-500 text-slate-700 text-xs font-bold rounded-lg shadow-sm transition"
                  >
                    <Camera className="w-3.5 h-3.5 text-orange-600" />
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-bold rounded-lg transition"
                  >
                    <UploadCloud className="w-3.5 h-3.5 text-orange-600" />
                    Upload Image / PDF
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Form details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Expense Category *</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="office_supplies">Office Supplies & Stationery</option>
                <option value="transport">Local Transport / Porter / Courier</option>
                <option value="food">Catering, Meals & Staff Tea</option>
                <option value="site_expense">Site Installation Minor Expense</option>
                <option value="hardware">Hardware / Minor Tools</option>
                <option value="utilities">Electricity, Internet & Utilities</option>
                <option value="other">Other Miscellaneous</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Total Bill / Gross Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-orange-500"
                placeholder="₹ 500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">GST Amount included (₹)</label>
              <input
                type="number"
                step="0.01"
                value={gstAmount}
                onChange={(e) => setGstAmount(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="₹ 0 (Optional)"
              />
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
                  Input GST is Recoverable (Eligible for ITC)
                </span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Vendor / Store Name</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g. Modern Stationers, Uber, Chai Point"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Expense Date *</label>
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Claimed By (Staff Personnel)</label>
              <select
                value={paidBy || ""}
                onChange={(e) => setPaidBy(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">Select Employee...</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>{staff.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Payment Method</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI / GPay / PhonePe</option>
                  <option value="Bank Transfer">Bank Transfer (NEFT/IMPS)</option>
                  <option value="Card">Company Debit/Credit Card</option>
                </select>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="UTR / Ref / Voucher #"
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* CASCADING PROJECT COSTING SECTION */}
            <div className="md:col-span-2 pt-3 pb-1 border-t border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-4 h-4 text-orange-600" />
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Project Cost Allocation (Optional)</h4>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">
                Link this expense to a Master Project to charge it against the job budget. If unassigned, it will be treated as General Overhead.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Master Project Selector */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    1. Master Project
                  </label>
                  <select
                    value={selectedMasterProjectId || ""}
                    onChange={(e) => handleMasterProjectChange(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-semibold focus:outline-none focus:border-orange-500"
                  >
                    <option value="">(None / General Overhead)</option>
                    {masterProjectsList.map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.projectCode ? `[${proj.projectCode}] ` : ""}{proj.name} — {proj.clientName || "Client"}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Project Estimate Selector (Scoped strictly to selected project) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    2. Linked Estimate
                  </label>
                  <select
                    disabled={!selectedMasterProjectId || loadingProjectOptions}
                    value={selectedEstimateId || ""}
                    onChange={(e) => handleEstimateChange(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">(Project-wide / No specific estimate)</option>
                    {availableEstimates.map((est) => (
                      <option key={est.id} value={est.id}>
                        {est.estimateNumber} {est.title ? `— ${est.title}` : ""} ({est.stores?.length || 0} stores)
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Target Store Selector (Strictly scoped to selected project/estimate) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    3. Target Store (Optional)
                  </label>
                  <select
                    disabled={!selectedMasterProjectId || loadingProjectOptions || visibleStores.length === 0}
                    value={selectedStoreCode}
                    onChange={(e) => setSelectedStoreCode(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">(Project-wide Overhead / No store)</option>
                    {visibleStores.map((st) => (
                      <option key={`${st.estimateId}-${st.storeCode}`} value={st.storeCode}>
                        {st.storeCode} — {st.storeName || st.storeCity || "Store"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Expense Narration / Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500 resize-none"
                placeholder="Narration of the expense..."
              ></textarea>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={resetForm}
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

      {/* Project Job & Status Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Filter className="w-3.5 h-3.5 text-orange-600" />
            <span>Master Project:</span>
            <select
              value={selectedProjectFilter}
              onChange={(e) => setSelectedProjectFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
            >
              <option value="all">All Expenses</option>
              <option value="general">General Overhead Only</option>
              <option value="project_linked">All Project-Linked</option>
              {masterProjectsList.map((p) => (
                <option key={p.id} value={`proj_${p.id}`}>
                  {p.projectCode ? `[${p.projectCode}] ` : ""}{p.name}
                </option>
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
              <option value="approved">Approved (Awaiting Pay)</option>
              <option value="paid">Paid (Disbursed)</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <input
            type="text"
            placeholder="Search vendor, desc, ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 w-44"
          />
        </div>

        <div className="text-xs text-slate-500">
          Showing <span className="font-bold text-slate-800">{filteredExpenses.length}</span> of <span className="font-bold text-slate-800">{expenses.length}</span> transactions
        </div>
      </div>

      {/* Expenses Table */}
      <div className="glass-panel overflow-hidden border border-slate-200 rounded-xl shadow-sm bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Date</th>
                <th className="px-5 py-3.5">Category</th>
                <th className="px-5 py-3.5">Project / Store</th>
                <th className="px-5 py-3.5">Vendor / Receipt</th>
                <th className="px-5 py-3.5">Paid By / Method</th>
                <th className="px-5 py-3.5">Description</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Amount</th>
                <th className="px-5 py-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredExpenses.map((expense) => {
                const payer = staffList.find(s => s.id === expense.paidBy);
                const hasReceipt = !!expense.receiptImageUrl;

                return (
                  <tr key={expense.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                      {new Date(expense.expenseDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>

                    <td className="px-5 py-3.5 font-semibold text-slate-900 capitalize whitespace-nowrap text-xs">
                      {expense.category.replace(/_/g, " ")}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      {expense.extractedData?.masterProjectName || expense.extractedData?.estimateNumber ? (
                        <div className="flex flex-col gap-0.5">
                          {expense.extractedData.masterProjectName && (
                            <span className="font-bold text-orange-700 truncate max-w-[170px] flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-orange-600 inline shrink-0" />
                              {expense.extractedData.masterProjectName}
                            </span>
                          )}
                          {expense.extractedData.estimateNumber && (
                            <span className="text-slate-600 flex items-center gap-1">
                              <Briefcase className="w-3 h-3 text-slate-400 inline shrink-0" />
                              <span className="truncate max-w-[150px]">{expense.extractedData.estimateNumber}</span>
                            </span>
                          )}
                          {expense.extractedData.storeCode && (
                            <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-blue-500 inline shrink-0" />
                              Store: {expense.extractedData.storeCode} {expense.extractedData.storeName ? `(${expense.extractedData.storeName})` : ""}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs italic">General Overhead</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      <div className="font-medium text-slate-800">{expense.vendor || "-"}</div>
                      {hasReceipt && (
                        <button
                          type="button"
                          onClick={() => setPreviewReceiptUrl(expense.receiptImageUrl)}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-bold"
                        >
                          <Receipt className="w-3 h-3 text-orange-600" />
                          View Receipt
                        </button>
                      )}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      <div className="text-slate-700 font-medium">{payer ? payer.name : "System"}</div>
                      {expense.paymentMethod && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <CreditCard className="w-2.5 h-2.5" />
                          {expense.paymentMethod}
                          {expense.paymentReference ? ` (${expense.paymentReference})` : ""}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-slate-600 text-xs max-w-xs truncate">
                      {expense.description || "-"}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {expense.status === "approved" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-blue-50 text-blue-700 border-blue-200">
                          Approved
                        </span>
                      ) : expense.status === "paid" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Paid
                        </span>
                      ) : expense.status === "rejected" ? (
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
                      {formatCurrency(expense.amount)}
                      {expense.extractedData?.gstAmount ? (
                        <span className="block text-[10px] font-normal text-slate-400">
                          incl. GST: {formatCurrency(expense.extractedData.gstAmount)}
                        </span>
                      ) : null}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {expense.status === "pending" && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(expense.id, "approved")}
                              title="Approve Cash Outflow"
                              className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold flex items-center gap-1 transition"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(expense.id, "rejected")}
                              title="Reject"
                              className="p-1 rounded bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 transition"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {expense.status === "approved" && (
                          <>
                            <button
                              onClick={() => {
                                setPaymentModalExpense(expense);
                                setDisburseMethod(expense.paymentMethod || "Cash");
                                setDisburseRef(expense.paymentReference || "");
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition"
                            >
                              <Coins className="w-3 h-3" /> Disburse / Pay
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(expense.id, "rejected")}
                              title="Reverse / Reject"
                              className="p-1 rounded bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-700 border border-slate-200 transition text-[10px]"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        )}

                        {expense.status === "paid" && (
                          <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Settled
                          </span>
                        )}

                        {expense.status === "rejected" && (
                          <button
                            onClick={() => handleUpdateStatus(expense.id, "pending")}
                            title="Re-open"
                            className="p-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 transition text-[10px]"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}

                        {user?.role === "admin" && (
                          <button
                            onClick={() => handleDeleteExpense(expense.id)}
                            title="Delete Record"
                            className="p-1 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 transition"
                          >
                            <Trash className="w-3.5 h-3.5" />
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
                    No petty cash transactions found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Disbursement Modal */}
      {paymentModalExpense && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200 animate-in fade-in duration-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Record Cash Disbursement</h3>
              </div>
              <button 
                onClick={() => setPaymentModalExpense(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Expense Category:</span>
                <span className="font-semibold text-slate-800 capitalize">{paymentModalExpense.category.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payee / Vendor:</span>
                <span className="font-semibold text-slate-800">{paymentModalExpense.vendor || "Direct Staff Expense"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Project Allocation:</span>
                <span className="font-bold text-orange-700">
                  {paymentModalExpense.extractedData?.masterProjectName || "General Overhead"}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-black">
                <span className="text-slate-700">Amount to Disburse:</span>
                <span className="text-emerald-700">{formatCurrency(paymentModalExpense.amount)}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Payment Disbursement Mode *
                </label>
                <select
                  value={disburseMethod}
                  onChange={(e) => setDisburseMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="Cash">Physical Cash</option>
                  <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                  <option value="Bank Transfer">Bank Transfer (NEFT / IMPS)</option>
                  <option value="Card">Company Debit / Credit Card</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Reference / Transaction No. (Optional)
                </label>
                <input
                  type="text"
                  value={disburseRef}
                  onChange={(e) => setDisburseRef(e.target.value)}
                  placeholder="e.g. UPI Ref, Cash Voucher #, UTR"
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
                {disburseLoading ? "Recording..." : "Confirm Disbursement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Preview Dialog */}
      {previewReceiptUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-4 shadow-2xl space-y-3 max-h-[90vh] flex flex-col border border-slate-200">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-orange-600" />
                <h3 className="font-bold text-slate-900 text-sm">Receipt Document Preview</h3>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewReceiptUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-orange-600 hover:text-orange-700 font-bold"
                >
                  Open in New Tab
                </a>
                <button 
                  onClick={() => setPreviewReceiptUrl(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-slate-900/5 rounded-lg flex items-center justify-center p-2 min-h-[300px]">
              {previewReceiptUrl.endsWith(".pdf") ? (
                <iframe 
                  src={previewReceiptUrl} 
                  title="Receipt Document" 
                  className="w-full h-[550px] rounded border border-slate-200"
                />
              ) : (
                <img 
                  src={previewReceiptUrl} 
                  alt="Receipt Preview" 
                  className="max-h-[550px] w-auto object-contain rounded shadow-sm"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PettyCashPage;
