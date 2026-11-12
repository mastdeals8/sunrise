import React, { useState, useEffect, useMemo } from "react";
import { X, Plus, Trash2, Split, Check, AlertCircle, IndianRupee } from "lucide-react";
import { formatCurrency } from "../utils/formatters";
import { createProjectCostAllocations } from "../../../lib/api";

interface StoreOption {
  storeCode: string;
  storeName: string;
  estimateId?: number;
}

interface AllocationRow {
  id: string;
  storeCode?: string;
  storeName?: string;
  estimateId?: number;
  costCategory: string;
  baseAmount: string;
  gstAmount: string;
  isRecoverableGst: boolean;
  ineligibleGstAmount: string;
  notes?: string;
}

interface PurchaseAllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // Source info
  sourceType: "purchase_invoice" | "petty_cash" | "contractor_work_order" | "manual";
  sourceId?: number;
  sourceReference?: string;
  supplierName?: string;
  totalBaseAmount: number;
  totalGstAmount?: number;
  // Project info
  masterProjects: Array<{ id: number; name: string; projectCode?: string | null; clientId: number }>;
  defaultProjectId?: number;
  projectStores?: StoreOption[];
}

export const PurchaseAllocationModal: React.FC<PurchaseAllocationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  sourceType,
  sourceId,
  sourceReference,
  supplierName,
  totalBaseAmount,
  totalGstAmount = 0,
  masterProjects,
  defaultProjectId,
  projectStores = [],
}) => {
  const [projectId, setProjectId] = useState<number | undefined>(defaultProjectId || masterProjects[0]?.id);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [splitMode, setSplitMode] = useState<"fixed" | "percentage">("fixed");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize with one default row if empty
  useEffect(() => {
    if (isOpen) {
      setProjectId(defaultProjectId || masterProjects[0]?.id);
      setErrorMessage(null);
      if (rows.length === 0) {
        setRows([
          {
            id: Math.random().toString(),
            costCategory: "materials",
            baseAmount: totalBaseAmount > 0 ? String(totalBaseAmount) : "",
            gstAmount: totalGstAmount > 0 ? String(totalGstAmount) : "0",
            isRecoverableGst: true,
            ineligibleGstAmount: "0",
          },
        ]);
      }
    }
  }, [isOpen, defaultProjectId, masterProjects, totalBaseAmount, totalGstAmount]);

  const addStoreRow = (store?: StoreOption) => {
    setRows((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        storeCode: store?.storeCode,
        storeName: store?.storeName,
        estimateId: store?.estimateId,
        costCategory: "materials",
        baseAmount: "",
        gstAmount: "0",
        isRecoverableGst: true,
        ineligibleGstAmount: "0",
      },
    ]);
  };

  const addOverheadRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        storeCode: undefined, // undefined indicates project-wide overhead
        costCategory: "other",
        baseAmount: "",
        gstAmount: "0",
        isRecoverableGst: true,
        ineligibleGstAmount: "0",
      },
    ]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof AllocationRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };

        // If toggling recoverable GST
        if (field === "isRecoverableGst") {
          if (value === true) {
            updated.ineligibleGstAmount = "0";
          } else {
            updated.ineligibleGstAmount = updated.gstAmount || "0";
          }
        }
        return updated;
      })
    );
  };

  // Calculations
  const totalAllocatedBase = useMemo(() => {
    return rows.reduce((sum, r) => sum + (Number(r.baseAmount) || 0), 0);
  }, [rows]);

  const remainingBase = useMemo(() => {
    return +(totalBaseAmount - totalAllocatedBase).toFixed(2);
  }, [totalBaseAmount, totalAllocatedBase]);

  const isOverAllocated = remainingBase < -0.01;

  const handleEqualSplit = () => {
    if (rows.length === 0 || totalBaseAmount <= 0) return;
    const splitBase = +(totalBaseAmount / rows.length).toFixed(2);
    const splitGst = +(totalGstAmount / rows.length).toFixed(2);

    setRows((prev) =>
      prev.map((r, idx) => {
        // adjust last item for rounding differences
        const isLast = idx === prev.length - 1;
        const assignedBase = isLast ? +(totalBaseAmount - splitBase * (prev.length - 1)).toFixed(2) : splitBase;
        const assignedGst = isLast ? +(totalGstAmount - splitGst * (prev.length - 1)).toFixed(2) : splitGst;

        return {
          ...r,
          baseAmount: String(assignedBase),
          gstAmount: String(assignedGst),
          ineligibleGstAmount: r.isRecoverableGst ? "0" : String(assignedGst),
        };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) {
      setErrorMessage("Please select a Master Project");
      return;
    }

    if (rows.length === 0) {
      setErrorMessage("Please add at least one allocation line");
      return;
    }

    if (isOverAllocated) {
      setErrorMessage(
        `Total allocated base (₹${totalAllocatedBase.toFixed(2)}) cannot exceed the invoice base (₹${totalBaseAmount.toFixed(2)})`
      );
      return;
    }

    for (const r of rows) {
      const amt = Number(r.baseAmount);
      if (isNaN(amt) || amt <= 0) {
        setErrorMessage("All allocation rows must have a base amount greater than zero");
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const token = localStorage.getItem("token");

      const payload = rows.map((r) => {
        const base = Number(r.baseAmount);
        const gst = Number(r.gstAmount || 0);
        const inelig = r.isRecoverableGst ? 0 : Number(r.ineligibleGstAmount || gst);
        const total = base + gst;
        const recognisedCost = +(base + inelig).toFixed(2);

        return {
          projectId,
          estimateId: r.estimateId || null,
          storeCode: r.storeCode || null,
          sourceType,
          sourceId: sourceId || null,
          sourceReference: sourceReference || null,
          costCategory: r.costCategory,
          baseAmount: base,
          gstAmount: gst,
          totalAmount: total,
          isRecoverableGst: r.isRecoverableGst,
          ineligibleGstAmount: inelig,
          recognisedCost,
          notes: r.notes || null,
          status: "active",
        };
      });

      await createProjectCostAllocations(token, payload);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Failed to save allocations:", err);
      setErrorMessage(err.message || "Failed to save project cost allocations");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Split className="w-5 h-5 text-orange-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Project Cost Allocation & Multi-Store Split</h2>
              <p className="text-xs text-slate-500">
                Allocate expense / purchase invoice across individual project stores or project-wide overhead.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Source details card */}
        <div className="p-4 bg-orange-50/40 border-b border-orange-100 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div>
            <span className="text-slate-500">Source: </span>
            <span className="font-bold text-slate-900 capitalize">{sourceType.replace("_", " ")}</span>
            {sourceReference && <span className="font-semibold text-slate-700 ml-1">({sourceReference})</span>}
            {supplierName && <span className="text-slate-500 ml-2">• Vendor: {supplierName}</span>}
          </div>
          <div className="flex items-center gap-4">
            <div>
              <span className="text-slate-500">Base Amount: </span>
              <span className="font-bold text-slate-900">{formatCurrency(totalBaseAmount)}</span>
            </div>
            {totalGstAmount > 0 && (
              <div>
                <span className="text-slate-500">GST: </span>
                <span className="font-bold text-slate-900">{formatCurrency(totalGstAmount)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Project & Split controls */}
        <div className="p-4 border-b border-slate-200 bg-white grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Target Master Project *</label>
            <select
              value={projectId || ""}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
            >
              <option value="">Select Master Project...</option>
              {masterProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode ? `[${p.projectCode}] ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleEqualSplit}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
            >
              Split Equally Across Rows
            </button>
            <button
              type="button"
              onClick={addOverheadRow}
              className="px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              + Project Overhead
            </button>
            <button
              type="button"
              onClick={() => addStoreRow()}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              + Store Row
            </button>
          </div>
        </div>

        {/* Allocation Rows Table */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {rows.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400">
              No allocation rows. Click "+ Store Row" or "+ Project Overhead" to begin.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-200 uppercase">
                  <tr>
                    <th className="p-2.5">Allocation Target</th>
                    <th className="p-2.5">Cost Category</th>
                    <th className="p-2.5 w-28">Base (₹)</th>
                    <th className="p-2.5 w-24">GST (₹)</th>
                    <th className="p-2.5 w-28 text-center">Recoverable ITC</th>
                    <th className="p-2.5 w-28 text-right">Recognised Cost</th>
                    <th className="p-2.5 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const base = Number(r.baseAmount) || 0;
                    const gst = Number(r.gstAmount) || 0;
                    const inelig = r.isRecoverableGst ? 0 : Number(r.ineligibleGstAmount || gst);
                    const recognised = +(base + inelig).toFixed(2);

                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        {/* Target (Store or Overhead) */}
                        <td className="p-2.5">
                          {projectStores.length > 0 ? (
                            <select
                              value={r.storeCode || ""}
                              onChange={(e) => {
                                const selected = projectStores.find((s) => s.storeCode === e.target.value);
                                updateRow(r.id, "storeCode", selected?.storeCode);
                                updateRow(r.id, "storeName", selected?.storeName);
                                updateRow(r.id, "estimateId", selected?.estimateId);
                              }}
                              className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:border-orange-500"
                            >
                              <option value="">(Project-wide Overhead)</option>
                              {projectStores.map((s) => (
                                <option key={s.storeCode} value={s.storeCode}>
                                  {s.storeCode} - {s.storeName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              placeholder="Store Code (blank for overhead)"
                              value={r.storeCode || ""}
                              onChange={(e) => updateRow(r.id, "storeCode", e.target.value)}
                              className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:border-orange-500 uppercase"
                            />
                          )}
                        </td>

                        {/* Cost Category */}
                        <td className="p-2.5">
                          <select
                            value={r.costCategory}
                            onChange={(e) => updateRow(r.id, "costCategory", e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:border-orange-500"
                          >
                            <option value="materials">Materials</option>
                            <option value="printing">Printing</option>
                            <option value="fabrication">Fabrication</option>
                            <option value="installation">Installation</option>
                            <option value="transport">Transport</option>
                            <option value="petty_cash">Petty Cash</option>
                            <option value="other">Other / Overhead</option>
                          </select>
                        </td>

                        {/* Base Amount */}
                        <td className="p-2.5">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={r.baseAmount}
                            onChange={(e) => updateRow(r.id, "baseAmount", e.target.value)}
                            className="w-full text-xs font-semibold border border-slate-200 rounded px-2 py-1 focus:border-orange-500 text-right"
                          />
                        </td>

                        {/* GST Amount */}
                        <td className="p-2.5">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={r.gstAmount}
                            onChange={(e) => updateRow(r.id, "gstAmount", e.target.value)}
                            className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:border-orange-500 text-right"
                          />
                        </td>

                        {/* Recoverable ITC Checkbox */}
                        <td className="p-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={r.isRecoverableGst}
                            onChange={(e) => updateRow(r.id, "isRecoverableGst", e.target.checked)}
                            className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 h-4 w-4 cursor-pointer"
                          />
                        </td>

                        {/* Recognised Cost */}
                        <td className="p-2.5 text-right font-bold text-slate-800">
                          {formatCurrency(recognised)}
                        </td>

                        {/* Remove */}
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeRow(r.id)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Balance Status Bar & Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs">
            <div>
              Total Allocated Base:{" "}
              <span className={`font-bold ${isOverAllocated ? "text-red-600" : "text-slate-900"}`}>
                {formatCurrency(totalAllocatedBase)}
              </span>
            </div>
            <div>
              Remaining Unallocated:{" "}
              <span
                className={`font-bold ${
                  remainingBase < 0 ? "text-red-600" : remainingBase === 0 ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {formatCurrency(remainingBase)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting || isOverAllocated || rows.length === 0}
              onClick={handleSubmit}
              className="px-5 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Check className="w-3.5 h-3.5" />
              {isSubmitting ? "Saving..." : "Confirm & Allocate Costs"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

