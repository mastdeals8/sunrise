import React, { useState, useMemo } from "react";
import {
  X,
  Search,
  CheckSquare,
  Square,
  Copy,
  AlertCircle,
  Store as StoreIcon,
  MapPin,
  Check,
} from "lucide-react";
import type { Store } from "../types";

export interface CopyToStoresModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceStoreId: string | null;
  stores: Store[];
  estItems: any[];
  estStoreOverrides: Record<string, any>;
  clientBillingProfilesList?: any[];
  estBillingProfileId?: string;
  clientId?: number;
  brandId?: number;
  activeStoreIds: string[];
  onConfirmCopy: (targetStoreIds: string[]) => void;
  isCopying?: boolean;
}

export const CopyToStoresModal: React.FC<CopyToStoresModalProps> = ({
  isOpen,
  onClose,
  sourceStoreId,
  stores,
  estItems,
  estStoreOverrides,
  clientBillingProfilesList = [],
  estBillingProfileId,
  clientId,
  brandId,
  activeStoreIds,
  onConfirmCopy,
  isCopying = false,
}) => {
  const [search, setSearch] = useState("");
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  // 1. Resolve source store information
  const sourceStore = useMemo(
    () => (sourceStoreId ? stores.find((s) => String(s.id) === String(sourceStoreId)) : null),
    [sourceStoreId, stores]
  );
  const sourceOverride = useMemo(
    () => (sourceStoreId ? estStoreOverrides[sourceStoreId] || {} : {}),
    [sourceStoreId, estStoreOverrides]
  );
  const sourceStoreName =
    sourceStore?.name || sourceOverride.storeName || (sourceStoreId ? `Store #${sourceStoreId}` : "Source Store");
  const sourceStoreCode = sourceStore?.storeCode || "";
  const sourceStoreCity = sourceStore?.city || sourceOverride.storeCity || "";
  const sourceStoreState = (sourceStore?.state || sourceOverride.storeState || "").trim();

  // Source item counts for context
  const sourceRowCount = useMemo(() => {
    if (!sourceStoreId) return 0;
    return estItems.filter((r) => String(r.storeId || "") === String(sourceStoreId)).length;
  }, [sourceStoreId, estItems]);

  // 2. Applicable state & GST profile matching Add Store
  const selectedBillingProfile = useMemo(
    () => clientBillingProfilesList.find((bp: any) => String(bp.id) === String(estBillingProfileId)),
    [clientBillingProfilesList, estBillingProfileId]
  );
  const billingProfileState = selectedBillingProfile?.state?.trim() || "";
  const targetState = (billingProfileState || sourceStoreState).toLowerCase();

  // 3. Filter eligible stores using identical rules to Add Store
  const eligibleStores = useMemo(() => {
    if (!sourceStoreId) return [];
    return stores.filter((s) => {
      // Must be active
      if (s.isActive === false) return false;
      // Exclude source store itself
      if (String(s.id) === String(sourceStoreId)) return false;
      // Exclude stores already in current estimate
      if (activeStoreIds.includes(String(s.id))) return false;
      // Must belong to the same client
      if (clientId && s.clientId !== clientId) return false;
      // Must belong to the same brand if brand is specified
      if (brandId && s.brandId && s.brandId !== brandId) return false;
      // Must match state / GST profile
      if (targetState) {
        const sState = (s.state || "").trim().toLowerCase();
        if (sState !== targetState) return false;
      }
      return true;
    });
  }, [stores, sourceStoreId, activeStoreIds, clientId, brandId, targetState]);

  // 4. Search filter
  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleStores;
    return eligibleStores.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const code = (s.storeCode || "").toLowerCase();
      const city = (s.city || "").toLowerCase();
      const location = (s.location || "").toLowerCase();
      const sap = (s.sapCode || "").toLowerCase();
      return name.includes(q) || code.includes(q) || city.includes(q) || location.includes(q) || sap.includes(q);
    });
  }, [eligibleStores, search]);

  // Reset state on modal open
  React.useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedStoreIds([]);
      setShowConfirm(false);
    }
  }, [isOpen, sourceStoreId]);

  if (!isOpen || !sourceStoreId) return null;

  const toggleStore = (sid: string) => {
    if (isCopying) return;
    setSelectedStoreIds((prev) =>
      prev.includes(sid) ? prev.filter((id) => id !== sid) : [...prev, sid]
    );
  };

  const handleSelectAll = () => {
    if (isCopying) return;
    const currentFilteredIds = filteredStores.map((s) => String(s.id));
    setSelectedStoreIds((prev) => Array.from(new Set([...prev, ...currentFilteredIds])));
  };

  const handleClearSelection = () => {
    if (isCopying) return;
    setSelectedStoreIds([]);
  };

  const handleProceedClick = () => {
    if (selectedStoreIds.length === 0 || isCopying) return;
    setShowConfirm(true);
  };

  const handleFinalExecute = () => {
    if (selectedStoreIds.length === 0 || isCopying) return;
    onConfirmCopy(selectedStoreIds);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full flex flex-col max-h-[88vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0">
              <Copy className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                Copy Store Estimate to Other Stores
              </h3>
              <p className="text-xs text-slate-500">
                Source: <span className="font-semibold text-slate-700">{sourceStoreName}</span>
                {sourceStoreCode && (
                  <span className="ml-1.5 font-mono text-[11px] px-1 py-0.2 bg-slate-200/70 text-slate-700 rounded">
                    {sourceStoreCode}
                  </span>
                )}
                <span className="ml-2 text-slate-400">({sourceRowCount} estimate rows)</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* GST / State Context Banner */}
        {targetState && (
          <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] text-blue-700 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-500" />
              Showing eligible stores in <strong className="capitalize">{targetState}</strong> matching the source store's GST profile.
            </span>
            <span className="text-[10px] text-blue-600 font-medium">
              {eligibleStores.length} eligible
            </span>
          </div>
        )}

        {/* Confirmation Screen */}
        {showConfirm ? (
          <div className="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
              <Copy className="w-6 h-6 text-orange-600" />
            </div>
            <div className="max-w-md space-y-2">
              <h4 className="text-base font-bold text-slate-800">
                Confirm Copy to {selectedStoreIds.length} Store{selectedStoreIds.length === 1 ? "" : "s"}
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                All <strong>{sourceRowCount}</strong> product rows, dimensions, quantities, rates, discounts,
                packing, installation, and transportation charges from{" "}
                <span className="font-semibold text-slate-800">{sourceStoreName}</span> will be copied as independent
                sections to each of the {selectedStoreIds.length} destination store{selectedStoreIds.length === 1 ? "" : "s"}.
              </p>
              <p className="text-[11px] text-slate-400">
                Each destination store can be edited independently after copying.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={isCopying}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Back to Selection
              </button>
              <button
                type="button"
                onClick={handleFinalExecute}
                disabled={isCopying}
                className="px-5 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 active:bg-orange-700 rounded-lg shadow-sm transition flex items-center gap-1.5"
              >
                {isCopying ? (
                  <span>Copying...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Confirm & Copy to {selectedStoreIds.length} Stores</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Filter & Selection Controls Toolbar */}
            <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-white">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search store name, store code, city..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 focus:bg-white text-slate-700 transition"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={filteredStores.length === 0}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded transition"
                >
                  Select All ({filteredStores.length})
                </button>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  disabled={selectedStoreIds.length === 0}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded transition"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            {/* Selected Count Indicator */}
            <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>
                Selected: <strong className="text-orange-600 font-bold">{selectedStoreIds.length}</strong> store
                {selectedStoreIds.length === 1 ? "" : "s"}
              </span>
              <span>
                Showing {filteredStores.length} of {eligibleStores.length} eligible
              </span>
            </div>

            {/* Store List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[380px]">
              {filteredStores.length === 0 ? (
                <div className="py-12 px-4 text-center">
                  <StoreIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">No matching stores found</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                    {search
                      ? "Try a different search term or clear the search filter."
                      : "All stores for this client/brand and GST profile are already in this estimate, or no other active stores exist."}
                  </p>
                </div>
              ) : (
                filteredStores.map((s) => {
                  const sid = String(s.id);
                  const isSelected = selectedStoreIds.includes(sid);
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleStore(sid)}
                      className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer select-none transition ${
                        isSelected ? "bg-orange-50/70 hover:bg-orange-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button
                          type="button"
                          className="text-slate-400 focus:outline-none flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStore(sid);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-orange-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 hover:text-slate-400" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-slate-800 truncate">
                              {s.name}
                            </span>
                            {s.storeCode && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700 font-bold">
                                {s.storeCode}
                              </span>
                            )}
                            {s.sapCode && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded">
                                SAP: {s.sapCode}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            {s.city && <span>{s.city}</span>}
                            {s.state && <span>• {s.state}</span>}
                            {s.location && s.location !== s.city && (
                              <span className="truncate">• {s.location}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                {selectedStoreIds.length === 0 ? (
                  <span>Select at least 1 destination store to copy</span>
                ) : (
                  <span>Ready to copy into <strong>{selectedStoreIds.length}</strong> stores</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleProceedClick}
                  disabled={selectedStoreIds.length === 0 || isCopying}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-500 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg shadow-sm transition flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    Copy to {selectedStoreIds.length > 0 ? selectedStoreIds.length : ""}{" "}
                    Selected Store{selectedStoreIds.length === 1 ? "" : "s"}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default CopyToStoresModal;
