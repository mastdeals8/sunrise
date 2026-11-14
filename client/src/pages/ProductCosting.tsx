import React, { useEffect, useState, useMemo } from "react";
import { formatCurrency } from "@/utils/format";
import { useAuth } from "../contexts/AuthContext";
import { fetchProductCostingSummary, fetchProducts, fetchPurchases } from "../lib/api";
import {
  Calculator,
  Layers,
  TrendingUp,
  Percent,
  Truck,
  Package,
  ArrowRight,
  Info,
  CheckCircle2,
  DollarSign,
  Search,
} from "lucide-react";

export const ProductCostingPage: React.FC = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<"catalog" | "calculator">("catalog");

  const [productsSummary, setProductsSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Landed Cost Simulation Tool State
  const [simBaseRate, setSimBaseRate] = useState("120");
  const [simQty, setSimQty] = useState("100");
  const [simFreight, setSimFreight] = useState("1500");
  const [simHandling, setSimHandling] = useState("500");
  const [simGstRate, setSimGstRate] = useState("18");
  const [simIsGstRecoverable, setSimIsGstRecoverable] = useState(true);
  const [simTargetMargin, setSimTargetMargin] = useState("35");

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await fetchProductCostingSummary(token);
      setProductsSummary(data || []);
    } catch (err) {
      console.error("Error loading product costing summary:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  // Simulation Calculations
  const simResults = useMemo(() => {
    const rate = Number(simBaseRate) || 0;
    const qty = Number(simQty) || 1;
    const freight = Number(simFreight) || 0;
    const handling = Number(simHandling) || 0;
    const gstPct = Number(simGstRate) || 0;
    const margin = Number(simTargetMargin) || 0;

    const baseCostTotal = rate * qty;
    const gstTotal = baseCostTotal * (gstPct / 100);
    // If GST is recoverable ITC, it is NOT an inventory cost
    const taxInCost = simIsGstRecoverable ? 0 : gstTotal;
    const totalLandedCost = baseCostTotal + freight + handling + taxInCost;
    const unitLandedCost = qty > 0 ? totalLandedCost / qty : 0;

    // Selling price for target margin: Selling = Cost / (1 - Margin/100)
    const suggestedSellingPrice = margin < 100 ? unitLandedCost / (1 - margin / 100) : 0;
    const unitGrossProfit = suggestedSellingPrice - unitLandedCost;

    return {
      baseCostTotal,
      gstTotal,
      totalSharedCharges: freight + handling,
      totalLandedCost,
      unitLandedCost: +unitLandedCost.toFixed(2),
      suggestedSellingPrice: +suggestedSellingPrice.toFixed(2),
      unitGrossProfit: +unitGrossProfit.toFixed(2),
    };
  }, [simBaseRate, simQty, simFreight, simHandling, simGstRate, simIsGstRecoverable, simTargetMargin]);

  const filteredProducts = productsSummary.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (p.productName || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q) ||
      (p.latestSupplier || "").toLowerCase().includes(q)
    );
  });

  // Aggregates
  const totalProductsCount = productsSummary.length;
  const avgMarginAcrossCatalog = useMemo(() => {
    if (productsSummary.length === 0) return 0;
    const sum = productsSummary.reduce((s, p) => s + (Number(p.grossMarginPercent) || 0), 0);
    return +(sum / productsSummary.length).toFixed(1);
  }, [productsSummary]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Product Landed Cost & Margin Intelligence</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Audit true unit landed costs, allocate freight & handling, separate recoverable ITC, and calibrate sales rate margins.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
            <span>Tracked Signage SKUs</span>
            <Package className="w-4 h-4 text-slate-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{totalProductsCount} SKUs</div>
          <span className="text-[11px] text-slate-400 block mt-0.5">Acrylic, ACP, vinyl, LED & hardware</span>
        </div>

        <div className="p-4 bg-white border border-blue-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-blue-700 uppercase tracking-wider">
            <span>Catalog Average Margin</span>
            <Percent className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-blue-700">{avgMarginAcrossCatalog}%</div>
          <span className="text-[11px] text-blue-600 block mt-0.5">Average gross margin above landed cost</span>
        </div>

        <div className="p-4 bg-white border border-emerald-200 rounded-xl shadow-sm">
          <div className="flex justify-between items-center text-xs font-bold text-emerald-700 uppercase tracking-wider">
            <span>Accounting Compliance</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-base font-black text-emerald-700">100% ITC Recoverable</div>
          <span className="text-[11px] text-emerald-600 block mt-0.5">Input GST strictly decoupled from landed cost</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-4">
        <button
          onClick={() => setActiveTab("catalog")}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "catalog" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Product Cost & Margin Register ({productsSummary.length})
          {activeTab === "catalog" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>

        <button
          onClick={() => setActiveTab("calculator")}
          className={`pb-2.5 text-xs font-bold transition-all relative ${
            activeTab === "calculator" ? "text-orange-600" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          Interactive Landed Cost Simulator
          {activeTab === "calculator" && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600" />}
        </button>
      </div>

      {activeTab === "catalog" ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search SKU name, category, supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-orange-500 w-64"
              />
            </div>
            <div className="text-xs text-slate-500">
              Showing <span className="font-bold text-slate-800">{filteredProducts.length}</span> SKUs
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3.5">Product SKU</th>
                    <th className="px-5 py-3.5">Category</th>
                    <th className="px-5 py-3.5">Unit</th>
                    <th className="px-5 py-3.5 text-right">Latest Purchase Rate</th>
                    <th className="px-5 py-3.5 text-right">Effective Landed Cost</th>
                    <th className="px-5 py-3.5 text-right">Selling Benchmark</th>
                    <th className="px-5 py-3.5 text-right">Gross Margin %</th>
                    <th className="px-5 py-3.5">Primary Vendor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const margin = Number(p.grossMarginPercent || 0);
                    const isHealthy = margin >= 30;
                    return (
                      <tr key={p.productId} className="hover:bg-slate-50/70 transition">
                        <td className="px-5 py-3.5 whitespace-nowrap font-bold text-slate-900 text-xs">
                          {p.productName}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-600">
                          {p.category}
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                          {p.unit}
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap text-xs font-semibold text-slate-700">
                          ₹{p.latestPurchaseRate}
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap text-xs font-bold text-orange-700">
                          ₹{p.averageLandedCost}
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap text-xs font-black text-slate-900">
                          ₹{p.sellingRate}
                        </td>

                        <td className="px-5 py-3.5 text-right whitespace-nowrap text-xs">
                          <span className={`px-2 py-0.5 rounded font-black text-[11px] ${
                            isHealthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}>
                            {margin}%
                          </span>
                        </td>

                        <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500">
                          {p.latestSupplier}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-slate-400 text-xs">
                        No product landed cost data found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Landed Cost Simulator */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Procurement Landed Cost Simulator</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulate bulk material purchase orders with freight, customs/porterage, and GST to establish minimum profitable rate card pricing.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Base Purchase Rate (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={simBaseRate}
                  onChange={(e) => setSimBaseRate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-900 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Batch Quantity (Units) *</label>
                <input
                  type="number"
                  min="1"
                  value={simQty}
                  onChange={(e) => setSimQty(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-900 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Freight / Transit Charges (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={simFreight}
                  onChange={(e) => setSimFreight(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Handling / Porterage (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={simHandling}
                  onChange={(e) => setSimHandling(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">GST Rate %</label>
                <select
                  value={simGstRate}
                  onChange={(e) => setSimGstRate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                >
                  <option value="0">0%</option>
                  <option value="5">5%</option>
                  <option value="12">12%</option>
                  <option value="18">18%</option>
                  <option value="28">28%</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-600 uppercase tracking-wider mb-1">Target Gross Margin %</label>
                <input
                  type="number"
                  min="5"
                  max="90"
                  value={simTargetMargin}
                  onChange={(e) => setSimTargetMargin(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-blue-700 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={simIsGstRecoverable}
                  onChange={(e) => setSimIsGstRecoverable(e.target.checked)}
                  className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                />
                <span className="text-xs font-semibold text-slate-700">
                  Input GST is Recoverable (ITC Asset) — Exclude GST from product cost
                </span>
              </label>
            </div>
          </div>

          {/* Results Summary Box */}
          <div className="p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl shadow-lg flex flex-col justify-between space-y-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-orange-400 block mb-1">
                CALCULATED LANDED METRICS
              </span>
              <h4 className="text-lg font-black text-white">Batch Unit Cost & Target Selling Price</h4>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs border-y border-slate-700 py-3">
              <div>
                <span className="text-slate-400 block text-[11px]">Direct Material Total</span>
                <span className="font-bold text-white text-sm">{formatCurrency(simResults.baseCostTotal)}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Freight + Handling Total</span>
                <span className="font-bold text-white text-sm">{formatCurrency(simResults.totalSharedCharges)}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">GST Total (ITC)</span>
                <span className={`font-bold text-sm ${simIsGstRecoverable ? "text-emerald-400" : "text-amber-400"}`}>
                  {formatCurrency(simResults.gstTotal)} {simIsGstRecoverable ? "(Excluded)" : "(Absorbed)"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Total Landed Outflow</span>
                <span className="font-bold text-white text-sm">{formatCurrency(simResults.totalLandedCost)}</span>
              </div>
            </div>

            <div className="p-4 bg-white/10 rounded-lg flex justify-between items-center">
              <div>
                <span className="text-xs text-orange-300 font-bold block uppercase tracking-wider">True Landed Cost / Unit</span>
                <span className="text-2xl font-black text-white">₹{simResults.unitLandedCost}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-emerald-300 font-bold block uppercase tracking-wider">Target Selling Price ({simTargetMargin}%)</span>
                <span className="text-2xl font-black text-emerald-400">₹{simResults.suggestedSellingPrice}</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span>Unit gross profit at target margin: <b>₹{simResults.unitGrossProfit}</b> per unit.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCostingPage;
