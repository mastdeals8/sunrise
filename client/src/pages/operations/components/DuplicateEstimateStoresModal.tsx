import React, { useState, useMemo } from "react";
import {
  X,
  Search,
  CheckSquare,
  Square,
  Copy,
  AlertCircle,
  CheckCircle2,
  Store as StoreIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { Estimate, Store, Client } from "../types";
import { duplicateEstimateForStore } from "../../../lib/api";

interface DuplicateEstimateStoresModalProps {
  isOpen: boolean;
  onClose: () => void;
  estimate: Estimate | null;
  clients: Client[];
  stores: Store[];
  token: string | null;
  clientBillingProfilesList?: any[];
  onSuccess: (newEstimates: any[]) => void;
  showSuccess?: (msg: string) => void;
}

export const DuplicateEstimateStoresModal: React.FC<DuplicateEstimateStoresModalProps> = ({
  isOpen,
  onClose,
  estimate,
  clients,
  stores,
  token,
  clientBillingProfilesList = [],
  onSuccess,
  showSuccess,
}) => {
  const [search, setSearch] = useState("");
  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; storeName: string } | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    successes: Array<{ store: Store; estimate: any }>;
    failures: Array<{ store: Store; error: string }>;
  } | null>(null);

  // Target client & original store
  const client = useMemo(
    () => (estimate ? clients.find((c) => c.id === estimate.clientId) : null),
    [estimate, clients]
  );

  const origStore = useMemo(
    () => (estimate?.storeId ? stores.find((s) => s.id === estimate.storeId) : null),
    [estimate, stores]
  );

  // Determine eligible stores from client/store/brand relationship
  const eligibleStores = useMemo(() => {
    if (!estimate) return [];
    return stores.filter((s) => {
      if (s.isActive === false) return false;
      if (s.clientId !== estimate.clientId) return false;
      // If brandId is specified on both store and estimate, require match
      if (estimate.brandId && s.brandId && s.brandId !== estimate.brandId) return false;
      return true;
    });
  }, [estimate, stores]);

  // Search filtered stores
  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleStores;
    return eligibleStores.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.storeCode || "").toLowerCase().includes(q) ||
        (s.city || "").toLowerCase().includes(q) ||
        (s.location || "").toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q)
    );
  }, [eligibleStores, search]);

  // Reset state when opening a new estimate
  React.useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedStoreIds(new Set());
      setResultSummary(null);
      setProgress(null);
      setIsSubmitting(false);
    }
  }, [isOpen, estimate?.id]);

  if (!isOpen || !estimate) return null;

  const toggleStore = (storeId: number) => {
    if (isSubmitting) return;
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    if (isSubmitting) return;
    setSelectedStoreIds((prev) => {
      const next = new Set(prev);
      filteredStores.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const handleClearSelection = () => {
    if (isSubmitting) return;
    setSelectedStoreIds(new Set());
  };

  const handleConfirmDuplicate = async () => {
    if (selectedStoreIds.size === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setResultSummary(null);

    const storesToDuplicate = eligibleStores.filter((s) => selectedStoreIds.has(s.id));
    const total = storesToDuplicate.length;
    const successes: Array<{ store: Store; estimate: any }> = [];
    const failures: Array<{ store: Store; error: string }> = [];

    for (let i = 0; i < total; i++) {
      const store = storesToDuplicate[i];
      setProgress({ current: i + 1, total, storeName: store.name });

      try {
        const newEst = await duplicateEstimateForStore(token, estimate, store, {
          origStore,
          billingProfiles: clientBillingProfilesList,
        });
        successes.push({ store, estimate: newEst });
      } catch (err: any) {
        console.error(`Failed to duplicate estimate for store ${store.name}:`, err);
        failures.push({ store, error: err.message || "Failed to create estimate" });
      }
    }

    setIsSubmitting(false);
    setProgress(null);

    // If there were any successes, inform parent to refresh register
    if (successes.length > 0) {
      onSuccess(successes.map((s) => s.estimate));
    }

    if (failures.length === 0) {
      showSuccess?.(
        `Successfully created ${successes.length} estimate${
          successes.length === 1 ? "" : "s"
        } for selected store${successes.length === 1 ? "" : "s"}.`
      );
      onClose();
    } else {
      // Keep only failed stores selected for easy and safe retry without duplicating successful ones
      setSelectedStoreIds(new Set(failures.map((f) => f.store.id)));
      setResultSummary({ successes, failures });
    }
  };

  const selectedCount = selectedStoreIds.size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-orange-50 via-white to-amber-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-sm">
              <Copy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Duplicate Estimate for Stores
              </h3>
              <p className="text-xs text-slate-500">
                Generate independent estimates with store-specific numbering and details
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Original Estimate Summary Card */}
        <div className="px-6 py-3 bg-slate-50/70 border-b border-slate-200 text-xs text-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Original Estimate
            </span>
            <div className="font-bold text-orange-700 font-mono text-sm mt-0.5">
              {estimate.estimateNumber}
            </div>
            <div className="text-slate-600 truncate mt-0.5" title={estimate.title}>
              {estimate.title}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Customer &amp; Current Store
            </span>
            <div className="font-semibold text-slate-800 truncate mt-0.5">
              {client?.name || `Customer ID: ${estimate.clientId}`}
            </div>
            <div className="text-slate-500 text-[11px] truncate mt-0.5">
              {origStore ? `${origStore.name} (${origStore.storeCode || "No Code"})` : "No specific store"}
            </div>
          </div>
        </div>

        {/* Failure/Success summary banner after partial failures */}
        {resultSummary && (
          <div className="px-6 py-3 border-b bg-amber-50/80 border-amber-200 text-xs">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">
                  {resultSummary.successes.length} created, {resultSummary.failures.length} failed
                </p>
                {resultSummary.successes.length > 0 && (
                  <p className="text-[11px] text-green-700 mt-1">
                    ✓ Created estimates:{" "}
                    {resultSummary.successes
                      .map((s) => `${s.store.name} (${s.estimate.estimateNumber})`)
                      .join(", ")}
                  </p>
                )}
                {resultSummary.failures.length > 0 && (
                  <div className="text-[11px] text-red-700 mt-1 space-y-0.5">
                    <span className="font-semibold">✗ Failed stores:</span>
                    {resultSummary.failures.map((f, i) => (
                      <div key={i}>
                        • {f.store.name} ({f.store.storeCode || "—"}): {f.error}
                      </div>
                    ))}
                    <p className="text-slate-600 italic mt-1">
                      Successful stores have been unselected. You can safely retry the remaining failed stores below.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Progress indicator during execution */}
        {progress && (
          <div className="px-6 py-4 bg-orange-50 border-b border-orange-200">
            <div className="flex items-center justify-between text-xs font-semibold text-orange-800 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
                Duplicating estimate ({progress.current} of {progress.total})...
              </span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-orange-200 h-2 rounded-full overflow-hidden">
              <div
                className="bg-orange-600 h-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-orange-700 truncate mt-1">
              Store: <span className="font-bold">{progress.storeName}</span>
            </p>
          </div>
        )}

        {/* Search & Bulk Selection Toolbar */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              disabled={isSubmitting}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search store name, code, city..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:border-orange-500 focus:bg-white transition"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting || filteredStores.length === 0}
              onClick={handleSelectAllFiltered}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition disabled:opacity-50"
            >
              Select All ({filteredStores.length})
            </button>
            <button
              type="button"
              disabled={isSubmitting || selectedCount === 0}
              onClick={handleClearSelection}
              className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition disabled:opacity-50"
            >
              Clear
            </button>
            <span className="text-xs font-semibold px-2.5 py-1 bg-orange-100/80 text-orange-800 rounded-md">
              {selectedCount} selected
            </span>
          </div>
        </div>

        {/* Store List */}
        <div className="flex-1 overflow-y-auto px-6 py-2 divide-y divide-slate-100">
          {filteredStores.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <StoreIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {eligibleStores.length === 0
                ? "No stores linked to this customer yet."
                : "No stores match your search."}
            </div>
          ) : (
            filteredStores.map((s) => {
              const isSelected = selectedStoreIds.has(s.id);
              const isCurrent = origStore?.id === s.id;
              const locationStr = [s.city, s.state, s.location].filter(Boolean).join(", ");

              return (
                <div
                  key={s.id}
                  onClick={() => toggleStore(s.id)}
                  className={`py-2.5 px-3 rounded-lg flex items-center justify-between gap-3 cursor-pointer transition select-none ${
                    isSelected ? "bg-orange-50/70" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStore(s.id);
                      }}
                      className="text-orange-600 focus:outline-none"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-orange-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-300" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 text-xs truncate">
                          {s.name}
                        </span>
                        {s.storeCode && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {s.storeCode}
                          </span>
                        )}
                        {isCurrent && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Current Store
                          </span>
                        )}
                      </div>
                      {locationStr && (
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {locationStr}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {selectedCount > 0 ? (
              <span>
                Ready to create <strong className="text-slate-800">{selectedCount}</strong> new{" "}
                {selectedCount === 1 ? "estimate" : "estimates"}
              </span>
            ) : (
              <span>Select one or more stores to duplicate</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || isSubmitting}
              onClick={handleConfirmDuplicate}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Duplicating...
                </>
              ) : resultSummary && resultSummary.failures.length > 0 ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry for {selectedCount} Store{selectedCount === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate for {selectedCount} Store{selectedCount === 1 ? "" : "s"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
