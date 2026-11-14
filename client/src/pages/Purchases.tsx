import React, { useEffect, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import {
  fetchPurchases,
  createPurchase,
  payPurchase,
  fetchSuppliers,
  fetchProducts,
  fetchMasterProjects,
  fetchProjectCostingOptions,
} from "../lib/api";
import {
  ShoppingBag,
  Plus,
  Filter,
  Building2,
  Briefcase,
  MapPin,
  Coins,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Trash2,
  Eye,
  X,
  CreditCard,
  Truck,
} from "lucide-react";

interface PurchaseBill {
  id: number;
  companyId?: number;
  invoiceNumber: string;
  partyName: string;
  date: string;
  dueDate?: string | null;
  amount: number;
  taxAmount: number;
  transportCost?: number | null;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  poNumber?: string | null;
  storeCode?: string | null;
  remarks?: string | null;
  lineItems?: any[] | null;
}

export const PurchasesPage: React.FC = () => {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"bills" | "suppliers">("bills");

  const [purchases, setPurchases] = useState<PurchaseBill[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [productsList, setProductsList] = useState<any[]>([]);
  const [masterProjectsList, setMasterProjectsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const syncHash = () => {
      const h = (window.location.hash || "").toLowerCase();
      if (h === "#suppliers") {
        setActiveTab("suppliers");
      } else if (h === "#payments") {
        setActiveTab("bills");
        setStatusFilter("paid");
      } else if (h === "#outstanding" || h === "#payables") {
        setActiveTab("bills");
        setStatusFilter("pending");
      } else if (h === "#bills" || !h) {
        setActiveTab("bills");
      }
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  // Create Bill Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [poReference, setPoReference] = useState("");
  const [freightCharges, setFreightCharges] = useState("");
  const [notes, setNotes] = useState("");
  const [isRecoverableGst, setIsRecoverableGst] = useState(true);

  // Line items state
  const [items, setItems] = useState<Array<{
    productId?: number;
    productName: string;
    description: string;
    quantity: number;
    unit: string;
    rate: number;
    discountPercent: number;
    gstPercent: number;
  }>>([
    { productName: "", description: "", quantity: 1, unit: "pcs", rate: 0, discountPercent: 0, gstPercent: 18 }
  ]);

  // Project linkage
  const [selectedMasterProjectId, setSelectedMasterProjectId] = useState<number | undefined>(undefined);
  const [availableEstimates, setAvailableEstimates] = useState<any[]>([]);
  const [availableStores, setAvailableStores] = useState<any[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | undefined>(undefined);
  const [selectedStoreCode, setSelectedStoreCode] = useState("");

  // Payment Modal
  const [paymentBill, setPaymentBill] = useState<PurchaseBill | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [payLoading, setPayLoading] = useState(false);

  // View Bill Modal
  const [viewBill, setViewBill] = useState<PurchaseBill | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pList, sList, prodList, projList] = await Promise.all([
        fetchPurchases(token, { status: statusFilter, supplier: supplierFilter, search: searchQuery }),
        fetchSuppliers(token).catch(() => []),
        fetchProducts(token).catch(() => []),
        fetchMasterProjects(token).catch(() => []),
      ]);
      setPurchases(pList || []);
      setSuppliers(sList || []);
      setProductsList(prodList || []);
      setMasterProjectsList(projList || []);
    } catch (err) {
      console.error("Error loading purchases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, statusFilter, supplierFilter]);

  const handleMasterProjectChange = async (pIdStr: string) => {
    const pId = pIdStr ? Number(pIdStr) : undefined;
    setSelectedMasterProjectId(pId);
    setSelectedEstimateId(undefined);
    setSelectedStoreCode("");
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

  const handleAddItem = () => {
    setItems([
      ...items,
      { productName: "", description: "", quantity: 1, unit: "pcs", rate: 0, discountPercent: 0, gstPercent: 18 }
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: string, value: any) => {
    const updated = [...items];
    (updated[idx] as any)[field] = value;

    if (field === "productId") {
      const prod = productsList.find((p) => p.id === Number(value));
      if (prod) {
        updated[idx].productName = prod.name;
        updated[idx].unit = prod.unit || "pcs";
        updated[idx].rate = Number(prod.rate || 0);
        updated[idx].gstPercent = Number(prod.gstPercent || 18);
      }
    }
    setItems(updated);
  };

  // Computed Totals for Form
  const formSubtotal = items.reduce((sum, it) => {
    const base = Number(it.quantity || 0) * Number(it.rate || 0) * (1 - (Number(it.discountPercent || 0) / 100));
    return sum + base;
  }, 0);

  const formTotalGst = items.reduce((sum, it) => {
    const base = Number(it.quantity || 0) * Number(it.rate || 0) * (1 - (Number(it.discountPercent || 0) / 100));
    return sum + base * (Number(it.gstPercent || 0) / 100);
  }, 0);

  const formFreight = Number(freightCharges || 0);
  const formGrandTotal = formSubtotal + formTotalGst + formFreight;

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierName.trim()) {
      alert("Supplier name is required");
      return;
    }

    try {
      await createPurchase(token, {
        invoiceNumber: billNumber || null,
        partyName: supplierName.trim(),
        supplierGstin: supplierGstin || null,
        date: billDate,
        dueDate: dueDate || null,
        poNumber: poReference || null,
        transportCost: formFreight,
        remarks: notes || null,
        lineItems: items,
        masterProjectId: selectedMasterProjectId || null,
        estimateId: selectedEstimateId || null,
        storeCode: selectedStoreCode || null,
        isRecoverableGst,
      });

      setShowCreateModal(false);
      resetCreateForm();
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to create purchase bill");
    }
  };

  const resetCreateForm = () => {
    setSupplierName("");
    setSupplierGstin("");
    setBillNumber("");
    setBillDate(new Date().toISOString().split("T")[0]);
    setDueDate("");
    setPoReference("");
    setFreightCharges("");
    setNotes("");
    setIsRecoverableGst(true);
    setItems([{ productName: "", description: "", quantity: 1, unit: "pcs", rate: 0, discountPercent: 0, gstPercent: 18 }]);
    setSelectedMasterProjectId(undefined);
    setSelectedEstimateId(undefined);
    setSelectedStoreCode("");
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentBill) return;
    const amt = Number(payAmount);
    if (isNaN(amt) || amt <= 0) return;

    try {
      setPayLoading(true);
      await payPurchase(token, paymentBill.id, {
        amount: amt,
        paymentMethod,
        paymentReference: paymentRef || null,
        paymentDate,
      });
      setPaymentBill(null);
      setPayAmount("");
      setPaymentRef("");
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to record payment");
    } finally {
      setPayLoading(false);
    }
  };

  // Summary Metrics
  const totalPurchasesAmount = purchases.reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
  const totalPaidAmount = purchases.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);
  const totalOutstandingBalance = purchases.reduce((sum, p) => sum + Number(p.balanceAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Procurement & Supplier Bills</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Manage purchase invoices, supplier credit balances, freight landed cost, and project material allocations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowCreateModal(true); resetCreateForm(); }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
          >
            <Plus className="w-4 h-4" />
            New Supplier Bill
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Total Purchases</span>
            <ShoppingBag className="w-4 h-4 text-slate-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(totalPurchasesAmount)}</div>
          <span className="text-[11px] text-slate-400 block mt-0.5">{purchases.length} supplier invoices</span>
        </div>

        <div className="p-4 bg-white border border-red-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-red-700 uppercase tracking-wider">
            <span>Accounts Payable (Due)</span>
            <AlertCircle className="w-4 h-4 text-red-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-red-700">{formatCurrency(totalOutstandingBalance)}</div>
          <span className="text-[11px] text-red-600 block mt-0.5">Unsettled supplier liability</span>
        </div>

        <div className="p-4 bg-white border border-emerald-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span>Disbursed to Suppliers</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(totalPaidAmount)}</div>
          <span className="text-[11px] text-emerald-600 block mt-0.5">Settled via bank / RTGS</span>
        </div>

        <div className="p-4 bg-white border border-blue-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-blue-700 uppercase tracking-wider">
            <span>Active Suppliers</span>
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-blue-700">{suppliers.length} vendors</div>
          <span className="text-[11px] text-blue-600 block mt-0.5">Material & hardware partners</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        <button
          onClick={() => {
            setActiveTab("bills");
            if (window.location.hash !== "#bills") {
              window.location.hash = "#bills";
            }
          }}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "bills" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Purchase Bills Register ({purchases.length})
          {activeTab === "bills" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>

        <button
          onClick={() => {
            setActiveTab("suppliers");
            if (window.location.hash !== "#suppliers") {
              window.location.hash = "#suppliers";
            }
          }}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "suppliers" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Supplier Directory & Ledger ({suppliers.length})
          {activeTab === "suppliers" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>
      </div>

      {activeTab === "bills" ? (
        <div className="space-y-4">
          {/* Filter Bar */}
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
                  <option value="pending">Pending Payment</option>
                  <option value="partial">Partially Paid</option>
                  <option value="paid">Fully Settled</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <span>Supplier:</span>
                <select
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-orange-500 max-w-[200px]"
                >
                  <option value="all">All Suppliers</option>
                  {suppliers.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Search bill #, supplier, PO..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") loadData(); }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 w-52"
              />
            </div>
            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-800">{purchases.length}</span> purchase bills
            </div>
          </div>

          {/* Bills Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5">Bill # / Date</th>
                    <th className="px-5 py-3.5">Supplier Name</th>
                    <th className="px-5 py-3.5">Line Items</th>
                    <th className="px-5 py-3.5">Store / PO</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Taxable Base</th>
                    <th className="px-5 py-3.5 text-right">Total Bill</th>
                    <th className="px-5 py-3.5 text-right">Balance Due</th>
                    <th className="px-5 py-3.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchases.map((bill) => {
                    const itemCount = Array.isArray(bill.lineItems) ? bill.lineItems.length : 0;
                    return (
                      <tr key={bill.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                          <span className="font-bold text-slate-900 block font-mono">{bill.invoiceNumber}</span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-800">
                          {bill.partyName}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-600">
                          <button
                            onClick={() => setViewBill(bill)}
                            className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-bold"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {itemCount} SKU{itemCount === 1 ? "" : "s"}
                          </button>
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                          {bill.storeCode ? (
                            <span className="font-bold text-blue-700 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-blue-500" />
                              Store: {bill.storeCode}
                            </span>
                          ) : bill.poNumber ? (
                            <span className="text-slate-500 font-mono text-[11px]">PO: {bill.poNumber}</span>
                          ) : (
                            <span className="text-slate-400 italic">Central Stock</span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {bill.status === "paid" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-emerald-50 text-emerald-700 border-emerald-200">
                              Paid
                            </span>
                          ) : bill.status === "partial" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-amber-50 text-amber-700 border-amber-200">
                              Partial
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border bg-red-50 text-red-700 border-red-200">
                              Unpaid
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right font-medium text-slate-700 whitespace-nowrap text-xs">
                          {formatCurrency(bill.amount)}
                        </td>

                        <td className="px-5 py-3.5 text-right font-black text-slate-900 whitespace-nowrap text-xs">
                          {formatCurrency(bill.totalAmount)}
                          {bill.transportCost ? (
                            <span className="block text-[10px] font-normal text-slate-400">
                              +₹{bill.transportCost} freight
                            </span>
                          ) : null}
                        </td>

                        <td className="px-5 py-3.5 text-right font-bold whitespace-nowrap text-xs text-red-600">
                          {formatCurrency(bill.balanceAmount)}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {bill.balanceAmount > 0 && (
                              <button
                                onClick={() => {
                                  setPaymentBill(bill);
                                  setPayAmount(String(bill.balanceAmount));
                                }}
                                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition"
                              >
                                <Coins className="w-3 h-3" /> Record Payment
                              </button>
                            )}
                            <button
                              onClick={() => setViewBill(bill)}
                              title="View Details"
                              className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {purchases.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-slate-400 text-xs">
                        No purchase bills recorded. Click "+ New Supplier Bill" to log incoming supplier invoices.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Suppliers Tab */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Supplier Name</th>
                  <th className="px-5 py-3.5">GSTIN</th>
                  <th className="px-5 py-3.5">Total Bills</th>
                  <th className="px-5 py-3.5">Last Bill Date</th>
                  <th className="px-5 py-3.5 text-right">Total Billed</th>
                  <th className="px-5 py-3.5 text-right">Total Paid</th>
                  <th className="px-5 py-3.5 text-right">Outstanding Balance (AP)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <tr key={s.name} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5 whitespace-nowrap font-bold text-slate-900 text-xs">
                      {s.name}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-slate-500">
                      {s.gstin || "Unregistered / Composition"}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-semibold text-slate-700">
                      {s.totalBills} bills
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                      {s.lastBillDate ? new Date(s.lastBillDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-semibold text-slate-800 text-xs">
                      {formatCurrency(s.totalBilled)}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-semibold text-emerald-700 text-xs">
                      {formatCurrency(s.totalPaid)}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-black text-red-600 text-xs">
                      {formatCurrency(s.totalBalance)}
                    </td>
                  </tr>
                ))}

                {suppliers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 text-xs">
                      No suppliers in directory. Log your first supplier bill to auto-populate supplier records.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Supplier Bill Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreatePurchase} className="bg-white rounded-xl max-w-4xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base">New Supplier Purchase Bill</h3>
                <p className="text-xs text-slate-500">Record incoming raw material, hardware, acrylic, or vinyl purchase bills.</p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Supplier / Vendor *</label>
                <input
                  type="text"
                  required
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Modern Acrylics Pune"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-semibold focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Supplier GSTIN</label>
                <input
                  type="text"
                  value={supplierGstin}
                  onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                  placeholder="27AABCM8291M1Z8"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Bill / Invoice Number</label>
                <input
                  type="text"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="e.g. INV-9921"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Bill Date *</label>
                <input
                  type="date"
                  required
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Payment Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Reference PO #</label>
                <input
                  type="text"
                  value={poReference}
                  onChange={(e) => setPoReference(e.target.value)}
                  placeholder="e.g. PO-2026-004"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Line Items Section */}
            <div className="pt-2 border-t border-slate-200">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wider">Purchase Line Items</span>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="text-xs text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Row
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {items.map((it, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 grid grid-cols-12 gap-2 text-xs items-center">
                    <div className="col-span-4">
                      <select
                        value={it.productId || ""}
                        onChange={(e) => handleItemChange(idx, "productId", e.target.value ? Number(e.target.value) : undefined)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs font-semibold focus:outline-none"
                      >
                        <option value="">Select Catalog SKU...</option>
                        {productsList.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {!it.productId && (
                        <input
                          type="text"
                          placeholder="Or type custom item name"
                          value={it.productName}
                          onChange={(e) => handleItemChange(idx, "productName", e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-xs mt-1"
                        />
                      )}
                    </div>

                    <div className="col-span-2">
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={it.quantity}
                        onChange={(e) => handleItemChange(idx, "quantity", Number(e.target.value))}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-center"
                      />
                    </div>

                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Rate ₹"
                        value={it.rate}
                        onChange={(e) => handleItemChange(idx, "rate", Number(e.target.value))}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs text-right font-semibold"
                      />
                    </div>

                    <div className="col-span-2">
                      <select
                        value={it.gstPercent}
                        onChange={(e) => handleItemChange(idx, "gstPercent", Number(e.target.value))}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                      >
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="28">28%</option>
                      </select>
                    </div>

                    <div className="col-span-1 text-right font-bold text-slate-800">
                      ₹{((it.quantity * it.rate * (1 - it.discountPercent / 100)) * (1 + it.gstPercent / 100)).toFixed(0)}
                    </div>

                    <div className="col-span-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-slate-400 hover:text-red-600 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Freight & Project Linkage */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-200">
              <div className="space-y-3">
                <div>
                  <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Freight / Transport Charges (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="₹ 0 (Apportioned into landed cost)"
                    value={freightCharges}
                    onChange={(e) => setFreightCharges(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isRecoverableGst}
                      onChange={(e) => setIsRecoverableGst(e.target.checked)}
                      className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                    />
                    <span className="text-xs font-semibold text-slate-700">
                      Input GST is Recoverable (ITC) - Excluded from product inventory cost
                    </span>
                  </label>
                </div>
              </div>

              {/* Project Linkage */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wider block">
                  Project Allocation (Optional)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Master Project</label>
                    <select
                      value={selectedMasterProjectId || ""}
                      onChange={(e) => handleMasterProjectChange(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs"
                    >
                      <option value="">(Central Stock)</option>
                      {masterProjectsList.map((p) => (
                        <option key={p.id} value={p.id}>[{p.projectCode}] {p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Target Store</label>
                    <select
                      disabled={!selectedMasterProjectId || availableStores.length === 0}
                      value={selectedStoreCode}
                      onChange={(e) => setSelectedStoreCode(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded text-xs disabled:opacity-50"
                    >
                      <option value="">(All Project Stores)</option>
                      {availableStores.map((st) => (
                        <option key={`${st.estimateId}-${st.storeCode}`} value={st.storeCode}>{st.storeCode}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Totals Summary */}
            <div className="p-3 bg-orange-50/50 rounded-lg border border-orange-200/60 flex justify-between items-center text-xs">
              <div className="space-y-0.5">
                <span className="text-slate-500">Taxable Subtotal: <b>{formatCurrency(formSubtotal)}</b></span>
                <span className="text-slate-500 ml-4">Total GST: <b>{formatCurrency(formTotalGst)}</b></span>
                <span className="text-slate-500 ml-4">Freight: <b>{formatCurrency(formFreight)}</b></span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Grand Total</span>
                <span className="text-lg font-black text-slate-900">{formatCurrency(formGrandTotal)}</span>
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
                Confirm Purchase Bill
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentBill && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleRecordPayment} className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-base">Record Supplier Payment</h3>
              </div>
              <button type="button" onClick={() => setPaymentBill(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Supplier:</span>
                <span className="font-bold text-slate-800">{paymentBill.partyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bill Number:</span>
                <span className="font-mono text-slate-800">{paymentBill.invoiceNumber}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-black">
                <span className="text-slate-700">Remaining Due:</span>
                <span className="text-red-600">{formatCurrency(paymentBill.balanceAmount)}</span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Payment Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-sm font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Payment Mode</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-500"
                >
                  <option value="Bank Transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI / GPay / PhonePe</option>
                  <option value="Cheque">Company Cheque</option>
                  <option value="Card">Company Card</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">UTR / Cheque Reference #</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. UTR-982181729"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Disbursement Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setPaymentBill(null)}
                className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={payLoading}
                className="py-2 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
              >
                {payLoading ? "Disbursing..." : "Confirm Payment"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* View Bill Details Modal */}
      {viewBill && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <div>
                <span className="text-xs font-bold text-slate-400 block font-mono">SUPPLIER BILL #{viewBill.invoiceNumber}</span>
                <h3 className="font-bold text-slate-900 text-base">{viewBill.partyName}</h3>
              </div>
              <button onClick={() => setViewBill(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg text-xs">
              <div>
                <span className="text-slate-400 block">Bill Date</span>
                <span className="font-bold text-slate-800">
                  {new Date(viewBill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Total Bill</span>
                <span className="font-black text-slate-900">{formatCurrency(viewBill.totalAmount)}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Remaining Due</span>
                <span className="font-black text-red-600">{formatCurrency(viewBill.balanceAmount)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-xs text-slate-700 uppercase tracking-wider block">Line Item Breakdown</span>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600 uppercase font-bold">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-center">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">GST</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(viewBill.lineItems || []).map((it: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium">{it.productName || "Item"}</td>
                        <td className="px-3 py-2 text-center">{it.quantity} {it.unit}</td>
                        <td className="px-3 py-2 text-right">₹{it.rate}</td>
                        <td className="px-3 py-2 text-right">₹{it.gstAmount} ({it.gstPercent}%)</td>
                        <td className="px-3 py-2 text-right font-bold">₹{it.totalAmount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setViewBill(null)}
                className="py-1.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchasesPage;
