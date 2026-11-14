import React, { useState, useEffect, useMemo } from "react";
import { Search, Filter, Check, X, Building2, Store, FileText, IndianRupee, Layers } from "lucide-react";
import { fetchAvailableEstimatesForProject } from "../../../lib/api";
import { formatCurrency } from "../utils/formatters";

interface EstimateSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedEstimateIds: number[]) => void;
  currentProjectEstimateIds?: number[];
  clientId?: number;
  brandId?: number;
  clients: Array<{ id: number; name: string }>;
  brands: Array<{ id: number; name: string; clientId?: number | null }>;
  excludeProjectId?: number;
}

export const EstimateSelectorModal: React.FC<EstimateSelectorModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentProjectEstimateIds = [],
  clientId: initialClientId,
  brandId: initialBrandId,
  clients,
  brands,
  excludeProjectId,
}) => {
  const [selectedClientId, setSelectedClientId] = useState<number | undefined>(initialClientId);
  const [selectedBrandId, setSelectedBrandId] = useState<number | undefined>(initialBrandId);
  const [searchQuery, setSearchQuery] = useState("");
  const [estimates, setEstimates] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(currentProjectEstimateIds));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial client and current project estimate ids when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedClientId(initialClientId);
      setSelectedBrandId(initialBrandId);
      setSelectedIds(new Set(currentProjectEstimateIds));
      loadEstimates(initialClientId, initialBrandId, "");
    }
  }, [isOpen, initialClientId, initialBrandId, currentProjectEstimateIds]);

  // Dynamically filter brands by selected client
  const filteredBrands = useMemo(() => {
    if (!selectedClientId) return brands;
    return brands.filter((b: any) => {
      const bClientId = b.clientId ?? b.parentClientId ?? b.parent_client_id;
      return !bClientId || bClientId === selectedClientId;
    });
  }, [brands, selectedClientId]);

  const loadEstimates = async (cId?: number, bId?: number, q?: string) => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem("token");
      const list = await fetchAvailableEstimatesForProject(token, {
        clientId: cId,
        brandId: bId,
        search: q || undefined,
        excludeProjectId,
      });
      setEstimates(list || []);
    } catch (err: any) {
      console.error("Failed to load available estimates:", err);
      setError(err.message || "Failed to load estimates");
    } finally {
      setLoading(false);
    }
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value ? Number(e.target.value) : undefined;
    setSelectedClientId(val);
    setSelectedBrandId(undefined); // Reset brand when client changes
    loadEstimates(val, undefined, searchQuery);
  };

  const handleBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value ? Number(e.target.value) : undefined;
    setSelectedBrandId(val);
    loadEstimates(selectedClientId, val, searchQuery);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    loadEstimates(selectedClientId, selectedBrandId, val);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedIds);
    estimates.forEach((e) => next.add(e.id));
    setSelectedIds(next);
  };

  const deselectAllFiltered = () => {
    const next = new Set(selectedIds);
    estimates.forEach((e) => next.delete(e.id));
    setSelectedIds(next);
  };

  // Selected summaries
  const selectedEstimatesList = useMemo(() => {
    // Collect from current available estimates + any preselected that might not be in filtered view
    return estimates.filter((e) => selectedIds.has(e.id));
  }, [estimates, selectedIds]);

  const totalSelectedCount = selectedIds.size;
  const totalQuotedValue = useMemo(() => {
    return selectedEstimatesList.reduce((sum, e) => sum + (Number(e.total_amount) || Number(e.subtotal) || 0), 0);
  }, [selectedEstimatesList]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-orange-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Select Estimates for Master Project</h2>
              <p className="text-xs text-slate-500">
                Only unlinked estimates or estimates already in this project can be selected.
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

        {/* Filter bar */}
        <div className="p-4 border-b border-slate-200 bg-white space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Client selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Corporate Client</label>
              <select
                value={selectedClientId || ""}
                onChange={handleClientChange}
                className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:border-orange-500 focus:outline-none"
              >
                <option value="">All Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Brand selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Brand / Sub-Brand</label>
              <select
                value={selectedBrandId || ""}
                onChange={handleBrandChange}
                className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:border-orange-500 focus:outline-none"
              >
                <option value="">All Brands</option>
                {filteredBrands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Search Estimates</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Estimate #, Project, PO #..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-xs">
            <span className="text-slate-500">
              Showing {estimates.length} candidate estimate{estimates.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 underline"
              >
                Select All ({estimates.length})
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={deselectAllFiltered}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 underline"
              >
                Deselect All
              </button>
            </div>
          </div>
        </div>

        {/* Estimates Table / List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading estimates...</div>
          ) : error ? (
            <div className="py-12 text-center text-xs text-red-500 font-medium">{error}</div>
          ) : estimates.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              No matching unlinked estimates found for the selected client/brand filters.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
              {estimates.map((est) => {
                const isSelected = selectedIds.has(est.id);
                return (
                  <div
                    key={est.id}
                    onClick={() => toggleSelect(est.id)}
                    className={`p-3 flex items-center justify-between cursor-pointer transition select-none ${
                      isSelected ? "bg-orange-50/70 hover:bg-orange-50" : "hover:bg-slate-50 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // handled by row click
                        className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 h-4 w-4 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900">
                            {est.estimateNumber || est.estimate_number || `Estimate #${est.id}`}
                          </span>
                          {(est.title || est.projectName || est.project_name) && (
                            <span className="text-[11px] font-medium text-slate-600">
                              • {est.title || est.projectName || est.project_name}
                            </span>
                          )}
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {est.status || "draft"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-1">
                          {est.clientName && (
                            <span className="text-slate-700">
                              Client: <span className="font-semibold text-slate-900">{est.clientName}</span>
                            </span>
                          )}
                          {est.brandName && (
                            <span className="text-slate-700">
                              Brand: <span className="font-semibold text-orange-700">{est.brandName}</span>
                            </span>
                          )}
                          {(est.poNumber || est.po_number || est.purchaseOrderNumber) ? (
                            <span className="text-emerald-700 font-medium">
                              PO: <span className="font-semibold">{est.poNumber || est.po_number || est.purchaseOrderNumber}</span>
                            </span>
                          ) : null}
                          {(est.estimateDate || est.poDate || est.po_date || est.createdAt || est.created_at) && (
                            <span>
                              Date: {new Date(est.estimateDate || est.poDate || est.po_date || est.createdAt || est.created_at).toLocaleDateString("en-GB")}
                            </span>
                          )}
                          {(est.storeCount > 0 || est.storesSummary) && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 font-bold border border-amber-200">
                              {est.storeCount || 1} Store{est.storeCount === 1 ? "" : "s"}{est.storesSummary && est.storesSummary !== "1 store" ? ` (${est.storesSummary})` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold text-slate-900">
                        {formatCurrency(Number(est.totalAmount || est.total_amount || est.subtotal || 0))}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Tax Base: {formatCurrency(Number(est.subtotal || 0))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Summary & Actions */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs font-medium text-slate-700">
            <div>
              Selected: <span className="font-bold text-orange-600">{totalSelectedCount}</span> estimate{totalSelectedCount === 1 ? "" : "s"}
            </div>
            {totalQuotedValue > 0 && (
              <div>
                Total Value: <span className="font-bold text-slate-900">{formatCurrency(totalQuotedValue)}</span>
              </div>
            )}
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
              onClick={() => onConfirm(Array.from(selectedIds))}
              className="px-5 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-xs flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Attach Selected Estimates ({totalSelectedCount})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

