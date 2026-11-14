import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Layers,
  IndianRupee,
  TrendingUp,
  Package,
  CheckCircle,
  AlertTriangle,
  Split,
  Plus,
  Trash2,
  FileText,
  RotateCcw,
  Check,
  Store,
  ShieldCheck,
  Percent,
} from "lucide-react";
import { formatCurrency } from "../utils/formatters";
import {
  fetchMasterProjectById,
  fetchProjectProfitability,
  fetchProjectCostAllocations,
  reverseProjectCostAllocation,
  fetchContractorWorkOrders,
  createContractorWorkOrder,
  updateContractorWorkOrder,
  updateMasterProject,
} from "../../../lib/api";
import { PurchaseAllocationModal } from "./PurchaseAllocationModal";
import { EstimateSelectorModal } from "./EstimateSelectorModal";

interface MasterProjectWorkspaceProps {
  projectId: number;
  onBack: () => void;
  clients: Array<{ id: number; name: string }>;
  brands: Array<{ id: number; name: string; clientId?: number | null }>;
  users?: Array<{ id: number; name: string }>;
}

export const MasterProjectWorkspace: React.FC<MasterProjectWorkspaceProps> = ({
  projectId,
  onBack,
  clients,
  brands,
}) => {
  const [project, setProject] = useState<any | null>(null);
  const [profitability, setProfitability] = useState<any | null>(null);
  const [costAllocations, setCostAllocations] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<
    "overview" | "estimates" | "costs" | "contractors" | "matrix"
  >("overview");
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const syncHash = () => {
      const h = (window.location.hash || "").toLowerCase();
      if (h === "#stores" || h === "#matrix") {
        setActiveTab("matrix");
      } else if (h === "#estimates") {
        setActiveTab("estimates");
      } else if (h === "#costs") {
        setActiveTab("costs");
      } else if (h === "#contractors") {
        setActiveTab("contractors");
      } else if (h === "#profitability" || h === "#overview") {
        setActiveTab("overview");
      }
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  // Modals
  const [isAllocationModalOpen, setIsAllocationModalOpen] = useState(false);
  const [isEstimateSelectorOpen, setIsEstimateSelectorOpen] = useState(false);

  // New contractor WO form state
  const [showWoForm, setShowWoForm] = useState(false);
  const [woNumber, setWoNumber] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [woScope, setWoScope] = useState("");
  const [committedAmount, setCommittedAmount] = useState("");
  const [woStatus, setWoStatus] = useState("issued");

  const loadAllData = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const token = localStorage.getItem("token");

      const [projData, profitData, allocData, woData] = await Promise.all([
        fetchMasterProjectById(token, projectId),
        fetchProjectProfitability(token, projectId),
        fetchProjectCostAllocations(token, { projectId }),
        fetchContractorWorkOrders(token, { projectId }),
      ]);

      setProject(projData);
      setProfitability(profitData);
      setCostAllocations(allocData || []);
      setWorkOrders(woData || []);
    } catch (err: any) {
      console.error("Failed to load project workspace:", err);
      setErrorMessage(err.message || "Failed to load project data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [projectId]);

  const handleReverseAllocation = async (allocationId: number) => {
    const reason = window.prompt("Please enter reason for reversing this cost allocation:");
    if (!reason || !reason.trim()) return;

    try {
      const token = localStorage.getItem("token");
      await reverseProjectCostAllocation(token, allocationId, reason.trim());
      setActionMessage("Allocation reversed successfully");
      setTimeout(() => setActionMessage(null), 4000);
      loadAllData();
    } catch (err: any) {
      console.error("Failed to reverse allocation:", err);
      alert(err.message || "Failed to reverse allocation");
    }
  };

  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!woNumber.trim() || !contractorName.trim() || !committedAmount) return;

    try {
      const token = localStorage.getItem("token");
      await createContractorWorkOrder(token, {
        projectId,
        workOrderNumber: woNumber.trim(),
        contractorName: contractorName.trim(),
        scopeOfWork: woScope.trim() || null,
        committedAmount: Number(committedAmount),
        status: woStatus,
      });

      setShowWoForm(false);
      setWoNumber("");
      setContractorName("");
      setWoScope("");
      setCommittedAmount("");
      setWoStatus("issued");
      setActionMessage("Work order recorded");
      setTimeout(() => setActionMessage(null), 4000);
      loadAllData();
    } catch (err: any) {
      console.error("Failed to create work order:", err);
      alert(err.message || "Failed to create work order");
    }
  };

  const handleUpdateEstimates = async (newEstimateIds: number[]) => {
    try {
      const token = localStorage.getItem("token");
      await updateMasterProject(token, projectId, {
        estimateIds: newEstimateIds,
      });
      setIsEstimateSelectorOpen(false);
      setActionMessage("Linked estimates updated");
      setTimeout(() => setActionMessage(null), 4000);
      loadAllData();
    } catch (err: any) {
      console.error("Failed to update estimates:", err);
      alert(err.message || "Failed to update project estimates");
    }
  };

  const handleUnlinkEstimate = async (estimateId: number) => {
    if (!window.confirm("Are you sure you want to unlink this estimate from the Master Project?")) return;
    const currentIds = (project?.linkedEstimates || [])
      .map((e: any) => e.estimateId || e.id)
      .filter((id: number) => id !== estimateId);
    handleUpdateEstimates(currentIds);
  };

  if (loading && !project) {
    return (
      <div className="py-24 text-center text-xs text-slate-500">
        Loading Master Project workspace...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-red-600">Master Project not found</p>
        <button
          onClick={onBack}
          className="mt-4 px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  const client = clients.find((c) => c.id === (project.clientId || project.client_id));
  const brand = brands.find((b) => b.id === (project.brandId || project.brand_id));
  const summary = profitability?.summary || {};
  const storeBreakdown = profitability?.storeBreakdown || [];
  const projectOverhead = profitability?.projectWideOverhead || { totalOverhead: 0, items: [] };

  // Prepare store options for allocation modal
  const projectStores = storeBreakdown.map((s: any) => ({
    storeCode: s.storeCode,
    storeName: s.storeName,
    estimateId: s.estimateId,
  }));

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                {project.projectCode && (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-orange-100 text-orange-700">
                    {project.projectCode}
                  </span>
                )}
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    project.status === "active"
                      ? "bg-emerald-100 text-emerald-800"
                      : project.status === "completed"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {project.status}
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                {client && (
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    {client.name}
                  </span>
                )}
                {brand && (
                  <span className="flex items-center gap-1">
                    • Brand: <span className="font-semibold text-slate-700">{brand.name}</span>
                  </span>
                )}
                {project.startDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {String(project.startDate).split("T")[0]}
                  </span>
                )}
                {project.targetBudget > 0 && (
                  <span className="flex items-center gap-1 text-slate-700 font-medium">
                    Budget: {formatCurrency(Number(project.targetBudget))}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAllocationModalOpen(true)}
              className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Split className="w-3.5 h-3.5" />
              Allocate Cost / Split
            </button>
            <button
              type="button"
              onClick={() => setIsEstimateSelectorOpen(true)}
              className="px-3.5 py-2 text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Manage Estimates ({project.linkedEstimates?.length || 0})
            </button>
          </div>
        </div>

        {actionMessage && (
          <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium flex items-center gap-2 animate-pulse">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            {actionMessage}
          </div>
        )}
      </div>

      {/* Tabs navigation */}
      <div className="flex border-b border-slate-200 bg-white px-3 py-1.5 rounded-xl shadow-xs gap-2 overflow-x-auto">
        <button
          onClick={() => {
            setActiveTab("overview");
            if (window.location.hash !== "#profitability") window.location.hash = "#profitability";
          }}
          className={`px-4 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "overview"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Financial KPIs & Overview
        </button>
        <button
          onClick={() => {
            setActiveTab("estimates");
            if (window.location.hash !== "#estimates") window.location.hash = "#estimates";
          }}
          className={`px-4 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "estimates"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Layers className="w-4 h-4" />
          Estimates & Stores ({project.linkedEstimates?.length || 0})
        </button>
        <button
          onClick={() => {
            setActiveTab("costs");
            if (window.location.hash !== "#costs") window.location.hash = "#costs";
          }}
          className={`px-4 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "costs"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <IndianRupee className="w-4 h-4" />
          Cost Allocations ({costAllocations.length})
        </button>
        <button
          onClick={() => {
            setActiveTab("contractors");
            if (window.location.hash !== "#contractors") window.location.hash = "#contractors";
          }}
          className={`px-4 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "contractors"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Contractor Commitments ({workOrders.length})
        </button>
        <button
          onClick={() => {
            setActiveTab("matrix");
            if (window.location.hash !== "#stores") window.location.hash = "#stores";
          }}
          className={`px-4 py-2 text-xs font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "matrix"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Percent className="w-4 h-4" />
          Store Profitability Matrix ({storeBreakdown.length})
        </button>
      </div>

      {/* TAB 1: OVERVIEW & FINANCIAL KPIS */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Quoted Turnover */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Quoted Rollout Value
              </span>
              <span className="text-lg font-bold text-slate-900 mt-1 block">
                {formatCurrency(summary.quotedRevenue || 0)}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Subtotal: {formatCurrency(summary.quotedSubtotal || 0)}
              </span>
            </div>

            {/* Invoiced Sales */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Invoiced Turnover (Net)
              </span>
              <span className="text-lg font-bold text-blue-600 mt-1 block">
                {formatCurrency(summary.invoicedSales || 0)}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Collections: {formatCurrency(summary.collections || 0)}
              </span>
            </div>

            {/* Recognised Cost */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Recognised Cost (Base)
              </span>
              <span className="text-lg font-bold text-slate-900 mt-1 block">
                {formatCurrency(summary.actualRecognisedCost || 0)}
              </span>
              <span className="text-[10px] text-emerald-600 font-medium mt-1 block">
                ITC Recoverable: {formatCurrency(summary.recoverableGst || 0)}
              </span>
            </div>

            {/* Actual Profit & Margin */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Actual Profit & Margin
              </span>
              <span
                className={`text-lg font-bold mt-1 block ${
                  (summary.actualProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {formatCurrency(summary.actualProfit || 0)}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 mt-1 block">
                Margin: {summary.actualMarginPercent || 0}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Open Commitments & Forecast */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Contractor Commitments & Forecast
              </h3>
              <div className="flex justify-between items-center text-xs py-1 border-b border-slate-100">
                <span className="text-slate-500">Open Work Orders:</span>
                <span className="font-bold text-slate-900">
                  {formatCurrency(summary.openCommitments || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs py-1 border-b border-slate-100">
                <span className="text-slate-500">Forecast Profit:</span>
                <span
                  className={`font-bold ${
                    (summary.forecastProfit || 0) >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {formatCurrency(summary.forecastProfit || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs py-1">
                <span className="text-slate-500">Forecast Margin:</span>
                <span className="font-bold text-slate-900">{summary.forecastMarginPercent || 0}%</span>
              </div>
            </div>

            {/* GST Tax Credit Tracking */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                GST Tax Classification
              </h3>
              <div className="flex justify-between items-center text-xs py-1 border-b border-slate-100">
                <span className="text-slate-500">Recoverable ITC (Input Credit):</span>
                <span className="font-bold text-emerald-600">
                  {formatCurrency(summary.recoverableGst || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs py-1 border-b border-slate-100">
                <span className="text-slate-500">Ineligible / Blocked GST:</span>
                <span className="font-bold text-slate-700">
                  {formatCurrency(summary.ineligibleGst || 0)}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Recoverable ITC is excluded from project cost and claimed on GST returns. Ineligible GST is
                expensed as project cost.
              </p>
            </div>

            {/* Scope / Notes */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Project Scope & Notes
              </h3>
              <p className="text-xs text-slate-600 whitespace-pre-wrap">
                {project.notes || "No scope notes recorded for this Master Project."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ESTIMATES & STORES */}
      {activeTab === "estimates" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Grouped Estimates & Stores</h2>
              <p className="text-xs text-slate-500">
                Estimates grouped into this Master Project. Original estimate identity, POs, and line items remain intact.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsEstimateSelectorOpen(true)}
              className="px-3 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Attach Estimates
            </button>
          </div>

          {(!project.linkedEstimates || project.linkedEstimates.length === 0) ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No estimates currently linked. Click "Attach Estimates" to group existing quotes.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
              {project.linkedEstimates.map((e: any) => (
                <div key={e.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition">
                  <div className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {e.estimateNumber || `Estimate #${e.id}`}
                        </span>
                        {e.projectName && (
                          <span className="text-xs text-slate-600">• {e.projectName}</span>
                        )}
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {e.status || "draft"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        {e.purchaseOrderNumber || e.poNumber ? (
                          <span className="text-emerald-700 font-medium">
                            PO: {e.purchaseOrderNumber || e.poNumber}
                          </span>
                        ) : (
                          <span>No PO</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-900">
                        {formatCurrency(Number(e.totalAmount || e.subtotal || 0))}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Subtotal: {formatCurrency(Number(e.subtotal || 0))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnlinkEstimate(e.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Unlink from project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: COSTS & ALLOCATIONS */}
      {activeTab === "costs" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Cost Allocations Register</h2>
              <p className="text-xs text-slate-500">
                Direct store expenses and project-wide overhead allocations.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAllocationModalOpen(true)}
              className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs flex items-center gap-1"
            >
              <Split className="w-3.5 h-3.5" />
              + New Allocation
            </button>
          </div>

          {costAllocations.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No cost allocations recorded. Click "+ New Allocation" to allocate supplier bills or expenses.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-200 uppercase">
                  <tr>
                    <th className="p-3">Target</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Category</th>
                    <th className="p-3 text-right">Base Amount</th>
                    <th className="p-3 text-right">GST</th>
                    <th className="p-3 text-center">ITC</th>
                    <th className="p-3 text-right">Recognised Cost</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {costAllocations.map((alloc) => (
                    <tr
                      key={alloc.id}
                      className={`hover:bg-slate-50/50 ${alloc.status === "reversed" ? "opacity-50 line-through" : ""}`}
                    >
                      <td className="p-3 font-semibold text-slate-900">
                        {alloc.storeCode ? (
                          <span>Store: {alloc.storeCode}</span>
                        ) : (
                          <span className="text-orange-700 bg-orange-50 px-2 py-0.5 rounded text-[11px]">
                            Project Overhead
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600 capitalize">
                        {alloc.sourceType.replace("_", " ")}
                        {alloc.sourceReference && ` (${alloc.sourceReference})`}
                      </td>
                      <td className="p-3 capitalize">{alloc.costCategory}</td>
                      <td className="p-3 text-right font-medium text-slate-800">
                        {formatCurrency(Number(alloc.baseAmount))}
                      </td>
                      <td className="p-3 text-right text-slate-500">
                        {formatCurrency(Number(alloc.gstAmount || 0))}
                      </td>
                      <td className="p-3 text-center">
                        {alloc.isRecoverableGst ? (
                          <span className="text-emerald-700 font-bold text-[11px]">Recoverable</span>
                        ) : (
                          <span className="text-amber-700 font-bold text-[11px]">Ineligible</span>
                        )}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900">
                        {formatCurrency(Number(alloc.recognisedCost))}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            alloc.status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {alloc.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {alloc.status === "active" && (
                          <button
                            type="button"
                            onClick={() => handleReverseAllocation(alloc.id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium hover:underline"
                          >
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CONTRACTOR COMMITMENTS */}
      {activeTab === "contractors" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Contractor Work Orders & Commitments</h2>
              <p className="text-xs text-slate-500">
                Track committed installer and fabrication contracts against actual billed amounts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowWoForm((v) => !v)}
              className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {showWoForm ? "Cancel" : "+ New Work Order"}
            </button>
          </div>

          {showWoForm && (
            <form onSubmit={handleCreateWorkOrder} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">WO Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. WO-2026-001"
                    value={woNumber}
                    onChange={(e) => setWoNumber(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Contractor Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Metro Signage Team"
                    value={contractorName}
                    onChange={(e) => setContractorName(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Committed Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={committedAmount}
                    onChange={(e) => setCommittedAmount(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-orange-500 text-right font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={woStatus}
                    onChange={(e) => setWoStatus(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-orange-500 capitalize"
                  >
                    <option value="issued">Issued</option>
                    <option value="in_progress">In Progress</option>
                    <option value="billed">Billed</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Scope of Work</label>
                <input
                  type="text"
                  placeholder="Scope details e.g. Store fabrication & night installation at 5 stores"
                  value={woScope}
                  onChange={(e) => setWoScope(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-orange-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowWoForm(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded shadow-xs"
                >
                  Save Work Order
                </button>
              </div>
            </form>
          )}

          {workOrders.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No contractor work orders registered.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-200 uppercase">
                  <tr>
                    <th className="p-3">WO #</th>
                    <th className="p-3">Contractor</th>
                    <th className="p-3">Scope</th>
                    <th className="p-3 text-right">Committed (₹)</th>
                    <th className="p-3 text-right">Billed (₹)</th>
                    <th className="p-3 text-right">Outstanding (₹)</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {workOrders.map((wo) => {
                    const committed = Number(wo.committedAmount || 0);
                    const billed = Number(wo.billedAmount || 0);
                    const outstanding = Math.max(0, committed - billed);

                    return (
                      <tr key={wo.id} className="hover:bg-slate-50/50">
                        <td className="p-3 font-bold text-slate-900">{wo.workOrderNumber}</td>
                        <td className="p-3 font-medium text-slate-800">{wo.contractorName}</td>
                        <td className="p-3 text-slate-500">{wo.scopeOfWork || "-"}</td>
                        <td className="p-3 text-right font-medium text-slate-900">
                          {formatCurrency(committed)}
                        </td>
                        <td className="p-3 text-right text-emerald-600 font-medium">
                          {formatCurrency(billed)}
                        </td>
                        <td className="p-3 text-right font-bold text-amber-700">
                          {formatCurrency(outstanding)}
                        </td>
                        <td className="p-3 text-center">
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                            {wo.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: STORE PROFITABILITY MATRIX */}
      {activeTab === "matrix" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Store-wise Profitability Matrix</h2>
              <p className="text-xs text-slate-500">
                Itemized direct costs vs net invoiced revenue per store in this rollout.
              </p>
            </div>
            <div className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
              Total Rollout Stores: {storeBreakdown.length}
            </div>
          </div>

          {storeBreakdown.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No store records found in linked estimates.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-200 uppercase whitespace-nowrap">
                  <tr>
                    <th className="p-2.5">Store Code</th>
                    <th className="p-2.5">Store / Location</th>
                    <th className="p-2.5 text-right">Invoiced Rev</th>
                    <th className="p-2.5 text-right">Materials</th>
                    <th className="p-2.5 text-right">Printing</th>
                    <th className="p-2.5 text-right">Fabrication</th>
                    <th className="p-2.5 text-right">Installation</th>
                    <th className="p-2.5 text-right">Transport</th>
                    <th className="p-2.5 text-right">Petty Cash</th>
                    <th className="p-2.5 text-right">Total Direct</th>
                    <th className="p-2.5 text-right">Store Profit</th>
                    <th className="p-2.5 text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                  {storeBreakdown.map((st: any) => {
                    const invoiced = Number(st.invoicedRevenue || 0);
                    const totalCost = Number(st.totalCost || 0);
                    const profit = Number(st.profit || 0);
                    const margin = Number(st.marginPercent || 0);

                    return (
                      <tr key={st.storeCode} className="hover:bg-slate-50/50">
                        <td className="p-2.5 font-bold text-slate-900">{st.storeCode}</td>
                        <td className="p-2.5 text-slate-700">
                          {st.storeName}
                          {st.city && <span className="text-slate-400 text-[10px] ml-1">({st.city})</span>}
                        </td>
                        <td className="p-2.5 text-right font-medium text-slate-900">
                          {formatCurrency(invoiced)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.materials || 0)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.printing || 0)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.fabrication || 0)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.installation || 0)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.transport || 0)}
                        </td>
                        <td className="p-2.5 text-right text-slate-600">
                          {formatCurrency(st.directCosts?.pettyCash || 0)}
                        </td>
                        <td className="p-2.5 text-right font-semibold text-slate-900">
                          {formatCurrency(totalCost)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-bold ${
                            profit >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {formatCurrency(profit)}
                        </td>
                        <td
                          className={`p-2.5 text-right font-bold ${
                            margin >= 20 ? "text-emerald-600" : margin >= 0 ? "text-amber-600" : "text-red-600"
                          }`}
                        >
                          {margin}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Project-wide Overhead Notice */}
          {projectOverhead.totalOverhead > 0 && (
            <div className="p-4 bg-orange-50/50 border border-orange-200 rounded-lg flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-orange-900">Project-wide Shared Overhead: </span>
                <span className="text-slate-600">
                  {projectOverhead.items.length} unassigned cost item{projectOverhead.items.length === 1 ? "" : "s"} not tied to a single store.
                </span>
              </div>
              <span className="font-bold text-slate-900 text-sm">
                {formatCurrency(projectOverhead.totalOverhead)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* MODALS */}
      {isAllocationModalOpen && (
        <PurchaseAllocationModal
          isOpen={isAllocationModalOpen}
          onClose={() => setIsAllocationModalOpen(false)}
          onSuccess={() => {
            setActionMessage("Cost allocated successfully");
            setTimeout(() => setActionMessage(null), 4000);
            loadAllData();
          }}
          sourceType="manual"
          totalBaseAmount={0}
          masterProjects={[project]}
          defaultProjectId={projectId}
          projectStores={projectStores}
        />
      )}

      {isEstimateSelectorOpen && (
        <EstimateSelectorModal
          isOpen={isEstimateSelectorOpen}
          onClose={() => setIsEstimateSelectorOpen(false)}
          onConfirm={handleUpdateEstimates}
          currentProjectEstimateIds={(project.linkedEstimates || []).map((e: any) => e.estimateId || e.id)}
          clientId={project.clientId || project.client_id}
          brandId={project.brandId || project.brand_id}
          clients={clients}
          brands={brands}
          excludeProjectId={projectId}
        />
      )}
    </div>
  );
};

