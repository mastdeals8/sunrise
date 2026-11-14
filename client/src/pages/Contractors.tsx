import React, { useEffect, useState, useMemo } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchContractorWorkOrders,
  createContractorWorkOrder,
  approveContractorVariation,
  recordContractorBill,
  fetchMasterProjects,
  fetchProjectCostingOptions,
} from "../lib/api";
import {
  HardHat,
  Plus,
  Filter,
  Building2,
  Briefcase,
  MapPin,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Coins,
  TrendingUp,
  X,
  Search,
  Check,
} from "lucide-react";

interface ContractorWorkOrder {
  id: number;
  companyId?: number;
  projectId: number;
  estimateId?: number | null;
  storeId?: number | null;
  woNumber: string;
  contractorName: string;
  contractorGstin?: string | null;
  scopeOfWork: string;
  workCategory: string;
  committedAmount: string | number;
  billedAmount: string | number;
  approvedVariationAmount: string | number;
  status: string;
  issueDate: string;
  expectedCompletion?: string | null;
}

const CATEGORIES = [
  { value: "fabrication", label: "Structural & Metal Fabrication" },
  { value: "installation", label: "Site Signage Installation" },
  { value: "civil", label: "Civil Works & Foundation" },
  { value: "transport", label: "Heavy Transport & Crane Logistics" },
  { value: "electrical", label: "Electrical & LED Cabling" },
  { value: "other", label: "Other Contractor Services" },
];

export const ContractorsPage: React.FC = () => {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"work_orders" | "contractors">("work_orders");

  const [workOrders, setWorkOrders] = useState<ContractorWorkOrder[]>([]);
  const [masterProjectsList, setMasterProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Create Work Order Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [woNumber, setWoNumber] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [contractorGstin, setContractorGstin] = useState("");
  const [workCategory, setWorkCategory] = useState("installation");
  const [scopeOfWork, setScopeOfWork] = useState("");
  const [committedAmount, setCommittedAmount] = useState("");
  const [expectedCompletion, setExpectedCompletion] = useState("");

  // Cascading Project Costing
  const [selectedMasterProjectId, setSelectedMasterProjectId] = useState<number | undefined>(undefined);
  const [availableEstimates, setAvailableEstimates] = useState<any[]>([]);
  const [availableStores, setAvailableStores] = useState<any[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | undefined>(undefined);
  const [selectedStoreId, setSelectedStoreId] = useState<number | undefined>(undefined);

  // Variation Modal
  const [variationModalWo, setVariationModalWo] = useState<ContractorWorkOrder | null>(null);
  const [variationAmount, setVariationAmount] = useState("");
  const [variationReason, setVariationReason] = useState("");
  const [variationLoading, setVariationLoading] = useState(false);

  // Bill Modal
  const [billModalWo, setBillModalWo] = useState<ContractorWorkOrder | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().split("T")[0]);
  const [billNotes, setBillNotes] = useState("");
  const [billLoading, setBillLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [woList, projList] = await Promise.all([
        fetchContractorWorkOrders(token, {
          projectId: projectFilter !== "all" ? Number(projectFilter) : undefined,
          status: statusFilter,
        }),
        fetchMasterProjects(token).catch(() => []),
      ]);
      setWorkOrders(woList || []);
      setMasterProjectsList(projList || []);
    } catch (err) {
      console.error("Error loading contractor work orders:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, statusFilter, projectFilter]);

  const handleMasterProjectChange = async (pIdStr: string) => {
    const pId = pIdStr ? Number(pIdStr) : undefined;
    setSelectedMasterProjectId(pId);
    setSelectedEstimateId(undefined);
    setSelectedStoreId(undefined);
    setAvailableEstimates([]);
    setAvailableStores([]);

    if (!pId) return;

    try {
      const res = await fetchProjectCostingOptions(token, pId);
      setAvailableEstimates(res.estimates || []);
      setAvailableStores(res.stores || []);
    } catch (err) {
      console.error("Failed to load project options:", err);
    }
  };

  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMasterProjectId) {
      alert("Master project is required for a contractor work order");
      return;
    }
    if (!contractorName.trim() || !scopeOfWork.trim() || !committedAmount) {
      alert("Please fill all required work order fields");
      return;
    }

    try {
      const autoWoNumber = woNumber.trim() || `WO-${Date.now().toString().slice(-6)}`;
      await createContractorWorkOrder(token, {
        projectId: selectedMasterProjectId,
        estimateId: selectedEstimateId || null,
        storeId: selectedStoreId || null,
        woNumber: autoWoNumber,
        contractorName: contractorName.trim(),
        contractorGstin: contractorGstin.trim() || null,
        workCategory,
        scopeOfWork: scopeOfWork.trim(),
        committedAmount: Number(committedAmount),
        expectedCompletion: expectedCompletion || null,
        status: "issued",
      });

      setShowCreateModal(false);
      resetCreateForm();
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to issue work order");
    }
  };

  const resetCreateForm = () => {
    setWoNumber("");
    setContractorName("");
    setContractorGstin("");
    setWorkCategory("installation");
    setScopeOfWork("");
    setCommittedAmount("");
    setExpectedCompletion("");
    setSelectedMasterProjectId(undefined);
    setSelectedEstimateId(undefined);
    setSelectedStoreId(undefined);
  };

  const handleApproveVariation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variationModalWo) return;
    const vAmt = Number(variationAmount);
    if (isNaN(vAmt) || vAmt <= 0) return;

    try {
      setVariationLoading(true);
      await approveContractorVariation(token, variationModalWo.id, vAmt, variationReason);
      setVariationModalWo(null);
      setVariationAmount("");
      setVariationReason("");
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to approve variation");
    } finally {
      setVariationLoading(false);
    }
  };

  const handleRecordBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billModalWo) return;
    const bAmt = Number(billAmount);
    if (isNaN(bAmt) || bAmt <= 0) return;

    try {
      setBillLoading(true);
      await recordContractorBill(token, billModalWo.id, {
        billNumber: billNumber || `CB-${Date.now().toString().slice(-4)}`,
        billAmount: bAmt,
        billDate,
        notes: billNotes,
      });
      setBillModalWo(null);
      setBillNumber("");
      setBillAmount("");
      setBillNotes("");
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to record contractor bill");
    } finally {
      setBillLoading(false);
    }
  };

  // Filtered List
  const filteredWorkOrders = workOrders.filter((wo) => {
    if (categoryFilter !== "all" && wo.workCategory !== categoryFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (wo.contractorName || "").toLowerCase().includes(q);
      const matchWo = (wo.woNumber || "").toLowerCase().includes(q);
      const matchScope = (wo.scopeOfWork || "").toLowerCase().includes(q);
      if (!matchName && !matchWo && !matchScope) return false;
    }
    return true;
  });

  // Aggregated Contractor Directory
  const contractorDirectory = useMemo(() => {
    const map = new Map<string, {
      name: string;
      gstin: string | null;
      contractsCount: number;
      totalCommitted: number;
      totalBilled: number;
      totalRemaining: number;
    }>();

    for (const wo of workOrders) {
      const name = (wo.contractorName || "Contractor").trim();
      const existing = map.get(name) || {
        name,
        gstin: wo.contractorGstin || null,
        contractsCount: 0,
        totalCommitted: 0,
        totalBilled: 0,
        totalRemaining: 0,
      };

      const committed = Number(wo.committedAmount || 0) + Number(wo.approvedVariationAmount || 0);
      const billed = Number(wo.billedAmount || 0);
      const remaining = Math.max(0, committed - billed);

      existing.contractsCount += 1;
      existing.totalCommitted += committed;
      existing.totalBilled += billed;
      existing.totalRemaining += remaining;
      map.set(name, existing);
    }

    return Array.from(map.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [workOrders]);

  // Aggregate Metrics
  const totalCommittedValue = workOrders.reduce((sum, wo) => sum + Number(wo.committedAmount || 0) + Number(wo.approvedVariationAmount || 0), 0);
  const totalBilledValue = workOrders.reduce((sum, wo) => sum + Number(wo.billedAmount || 0), 0);
  const totalRemainingCommitments = Math.max(0, totalCommittedValue - totalBilledValue);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Contractor Management & Work Orders</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Issue work orders, manage approved variations, record contractor bills, and monitor open project commitments.
          </p>
        </div>
        <button
          onClick={() => { setShowCreateModal(true); resetCreateForm(); }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
        >
          <Plus className="w-4 h-4" />
          Issue Work Order
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Total Contract Value</span>
            <HardHat className="w-4 h-4 text-slate-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(totalCommittedValue)}</div>
          <span className="text-[11px] text-slate-400 block mt-0.5">{workOrders.length} work orders issued</span>
        </div>

        <div className="p-4 bg-white border border-emerald-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span>Billed Work Done</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(totalBilledValue)}</div>
          <span className="text-[11px] text-emerald-600 block mt-0.5">Actual recognized contractor cost</span>
        </div>

        <div className="p-4 bg-white border border-amber-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-amber-700 uppercase tracking-wider">
            <span>Open Commitments</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-700">{formatCurrency(totalRemainingCommitments)}</div>
          <span className="text-[11px] text-amber-600 block mt-0.5">Remaining unbilled committed work</span>
        </div>

        <div className="p-4 bg-white border border-blue-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-blue-700 uppercase tracking-wider">
            <span>Active Contractors</span>
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-blue-700">{contractorDirectory.length} partners</div>
          <span className="text-[11px] text-blue-600 block mt-0.5">Fabrication & installation vendors</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        <button
          onClick={() => setActiveTab("work_orders")}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "work_orders" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Work Orders Register ({workOrders.length})
          {activeTab === "work_orders" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>

        <button
          onClick={() => setActiveTab("contractors")}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "contractors" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Contractor Directory & Balances ({contractorDirectory.length})
          {activeTab === "contractors" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>
      </div>

      {activeTab === "work_orders" ? (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Filter className="w-3.5 h-3.5 text-orange-600" />
                <span>Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="issued">Issued / Open</option>
                  <option value="partially_billed">Partially Billed</option>
                  <option value="fully_billed">Fully Billed</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <span>Category:</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500"
                >
                  <option value="all">All Categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <span>Project:</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500 max-w-[200px]"
                >
                  <option value="all">All Master Projects</option>
                  {masterProjectsList.map((p) => (
                    <option key={p.id} value={String(p.id)}>[{p.projectCode}] {p.name}</option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Search contractor, WO #, scope..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 w-52"
              />
            </div>
            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-800">{filteredWorkOrders.length}</span> work orders
            </div>
          </div>

          {/* Work Orders Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5">WO # / Date</th>
                    <th className="px-5 py-3.5">Contractor</th>
                    <th className="px-5 py-3.5">Category & Scope</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Committed</th>
                    <th className="px-5 py-3.5 text-right">Approved Var.</th>
                    <th className="px-5 py-3.5 text-right">Billed Amount</th>
                    <th className="px-5 py-3.5 text-right">Remaining Commitment</th>
                    <th className="px-5 py-3.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredWorkOrders.map((wo) => {
                    const committed = Number(wo.committedAmount || 0);
                    const variation = Number(wo.approvedVariationAmount || 0);
                    const totalVal = committed + variation;
                    const billed = Number(wo.billedAmount || 0);
                    const remaining = Math.max(0, totalVal - billed);

                    return (
                      <tr key={wo.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                          <span className="font-bold text-slate-900 block font-mono">{wo.woNumber}</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(wo.issueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-800">
                          {wo.contractorName}
                        </td>

                        <td className="px-5 py-3.5 text-xs max-w-xs truncate">
                          <span className="font-bold text-slate-700 capitalize block">{wo.workCategory}</span>
                          <span className="text-slate-500 text-[11px] truncate block">{wo.scopeOfWork}</span>
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {wo.status === "fully_billed" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Fully Billed
                            </span>
                          ) : wo.status === "partially_billed" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-amber-50 text-amber-700 border-amber-200">
                              Partially Billed
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-blue-50 text-blue-700 border-blue-200">
                              Issued
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right font-medium text-slate-700 whitespace-nowrap text-xs">
                          {formatCurrency(committed)}
                        </td>

                        <td className="px-5 py-3.5 text-right font-medium whitespace-nowrap text-xs text-blue-600">
                          {variation > 0 ? `+${formatCurrency(variation)}` : "-"}
                        </td>

                        <td className="px-5 py-3.5 text-right font-bold text-slate-900 whitespace-nowrap text-xs">
                          {formatCurrency(billed)}
                        </td>

                        <td className="px-5 py-3.5 text-right font-black whitespace-nowrap text-xs text-amber-600">
                          {formatCurrency(remaining)}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {remaining > 0 && (
                              <button
                                onClick={() => {
                                  setBillModalWo(wo);
                                  setBillAmount(String(remaining));
                                }}
                                className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold transition"
                              >
                                Record Bill
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setVariationModalWo(wo);
                                setVariationAmount("");
                                setVariationReason("");
                              }}
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                            >
                              + Variation
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredWorkOrders.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-400 text-xs">
                        No contractor work orders found. Click "+ Issue Work Order" to create commitments.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Contractors Directory Tab */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Contractor Name</th>
                  <th className="px-5 py-3.5">GSTIN</th>
                  <th className="px-5 py-3.5">Issued Work Orders</th>
                  <th className="px-5 py-3.5 text-right">Total Contract Value</th>
                  <th className="px-5 py-3.5 text-right">Total Billed</th>
                  <th className="px-5 py-3.5 text-right">Remaining Commitment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contractorDirectory.map((c) => (
                  <tr key={c.name} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5 whitespace-nowrap font-bold text-slate-900 text-xs">
                      {c.name}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-slate-500">
                      {c.gstin || "Unregistered Contractor"}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-700">
                      {c.contractsCount} orders
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-semibold text-slate-800 text-xs">
                      {formatCurrency(c.totalCommitted)}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-semibold text-emerald-700 text-xs">
                      {formatCurrency(c.totalBilled)}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-black text-amber-600 text-xs">
                      {formatCurrency(c.totalRemaining)}
                    </td>
                  </tr>
                ))}

                {contractorDirectory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-400 text-xs">
                      No contractors found in directory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issue Work Order Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateWorkOrder} className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Issue Contractor Work Order</h3>
                <p className="text-xs text-slate-500">Commit fabrication, installation, or logistics budget for a project.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Contractor / Vendor *</label>
                <input
                  type="text"
                  required
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                  placeholder="e.g. Apex Signage Installers"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-semibold focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Contractor GSTIN</label>
                <input
                  type="text"
                  value={contractorGstin}
                  onChange={(e) => setContractorGstin(e.target.value.toUpperCase())}
                  placeholder="27AABCM8291M1Z8"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Work Order # (Auto/Custom)</label>
                <input
                  type="text"
                  value={woNumber}
                  onChange={(e) => setWoNumber(e.target.value)}
                  placeholder="e.g. WO-2026-001"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Work Category *</label>
                <select
                  value={workCategory}
                  onChange={(e) => setWorkCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-semibold focus:outline-none focus:border-orange-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Committed Budget Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={committedAmount}
                  onChange={(e) => setCommittedAmount(e.target.value)}
                  placeholder="₹ 50000"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Expected Completion Date</label>
                <input
                  type="date"
                  value={expectedCompletion}
                  onChange={(e) => setExpectedCompletion(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Project Cascading */}
              <div className="md:col-span-2 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wider block">Project Allocation *</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Master Project *</label>
                    <select
                      required
                      value={selectedMasterProjectId || ""}
                      onChange={(e) => handleMasterProjectChange(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-semibold"
                    >
                      <option value="">Select Project...</option>
                      {masterProjectsList.map((p) => (
                        <option key={p.id} value={p.id}>[{p.projectCode}] {p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Estimate (Optional)</label>
                    <select
                      disabled={!selectedMasterProjectId || availableEstimates.length === 0}
                      value={selectedEstimateId || ""}
                      onChange={(e) => setSelectedEstimateId(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                    >
                      <option value="">(All Project Estimates)</option>
                      {availableEstimates.map((est) => (
                        <option key={est.id} value={est.id}>{est.estimateNumber}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Store (Optional)</label>
                    <select
                      disabled={!selectedMasterProjectId || availableStores.length === 0}
                      value={selectedStoreId || ""}
                      onChange={(e) => setSelectedStoreId(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                    >
                      <option value="">(Project-wide Work)</option>
                      {availableStores.map((st) => (
                        <option key={`${st.estimateId}-${st.storeCode}`} value={st.storeId || 0}>{st.storeCode}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Detailed Scope of Work *</label>
                <textarea
                  rows={3}
                  required
                  value={scopeOfWork}
                  onChange={(e) => setScopeOfWork(e.target.value)}
                  placeholder="Specific tasks, site locations, materials provided, delivery deadlines..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 resize-none"
                ></textarea>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-md"
              >
                Issue Work Order
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Approve Variation Modal */}
      {variationModalWo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleApproveVariation} className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base">Approve Contract Variation</h3>
              <button type="button" onClick={() => setVariationModalWo(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
              <div>Contractor: <b>{variationModalWo.contractorName}</b></div>
              <div>WO #: <b>{variationModalWo.woNumber}</b></div>
              <div>Current Base Budget: <b>{formatCurrency(Number(variationModalWo.committedAmount) || 0)}</b></div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Approved Variation Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={variationAmount}
                  onChange={(e) => setVariationAmount(e.target.value)}
                  placeholder="₹ 5000"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Variation Reason / Justification</label>
                <textarea
                  rows={2}
                  value={variationReason}
                  onChange={(e) => setVariationReason(e.target.value)}
                  placeholder="Extra scaffold requirement, site height increase, additional electrical run..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 resize-none"
                ></textarea>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setVariationModalWo(null)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={variationLoading}
                className="py-2 px-5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
              >
                {variationLoading ? "Approving..." : "Confirm Variation"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Contractor Bill Modal */}
      {billModalWo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleRecordBill} className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-900 text-base">Record Contractor Bill</h3>
              <button type="button" onClick={() => setBillModalWo(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
              <div>Contractor: <b>{billModalWo.contractorName}</b></div>
              <div>WO #: <b>{billModalWo.woNumber}</b></div>
              <div className="flex justify-between pt-1 border-t border-slate-200 font-bold">
                <span>Remaining Ceiling:</span>
                <span className="text-amber-600">
                  {formatCurrency(Number(billModalWo.committedAmount) + Number(billModalWo.approvedVariationAmount) - Number(billModalWo.billedAmount))}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Contractor Bill Number</label>
                <input
                  type="text"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="e.g. CB-2026-04"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Bill Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Bill Date</label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setBillModalWo(null)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={billLoading}
                className="py-2 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
              >
                {billLoading ? "Recording..." : "Record Bill"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ContractorsPage;
