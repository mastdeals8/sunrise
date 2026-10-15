import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  History,
  RotateCcw,
  GitCompare,
  Eye,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ArrowRight,
  Plus,
  Minus,
  Edit3,
  Calendar,
  Layers,
  Sparkles
} from "lucide-react";
import { fetchEstimateRevisions, fetchEstimateRevision, restoreEstimateRevision } from "../../../lib/api";
import EstimateDocument from "../../../components/EstimateDocument";
import { exportEstimateToExcel } from "../utils/exportHelpers";

export interface EstimateRevisionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  estimate: any;
  token: string | null;
  onRestored?: (restoredEstimate: any) => void;
  sellerProfile?: any;
  stores?: any[];
  clients?: any[];
  products?: any[];
  brands?: any[];
}

export const EstimateRevisionsModal: React.FC<EstimateRevisionsModalProps> = ({
  isOpen,
  onClose,
  estimate,
  token,
  onRestored,
  sellerProfile,
  stores = [],
  clients = [],
  products = [],
  brands = [],
}) => {
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected revision for preview
  const [selectedRevNum, setSelectedRevNum] = useState<number>(0);
  const [selectedRevData, setSelectedRevData] = useState<any | null>(null);
  const [loadingRevData, setLoadingRevData] = useState<boolean>(false);

  // Comparison state
  const [viewMode, setViewMode] = useState<"preview" | "compare">("preview");
  const [baseRevNum, setBaseRevNum] = useState<number>(0);
  const [compareRevNum, setCompareRevNum] = useState<number>(0);
  const [baseRevData, setBaseRevData] = useState<any | null>(null);
  const [compareRevData, setCompareRevData] = useState<any | null>(null);
  const [loadingCompare, setLoadingCompare] = useState<boolean>(false);

  // Restore dialog state
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<boolean>(false);
  const [restoreTargetRev, setRestoreTargetRev] = useState<number | null>(null);
  const [restoreNote, setRestoreNote] = useState<string>("");
  const [restoring, setRestoring] = useState<boolean>(false);

  const currentRevNum = estimate?.currentRevisionNumber ?? 0;

  // Load all revisions list
  const loadRevisions = async () => {
    if (!estimate?.id) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchEstimateRevisions(token, estimate.id);
      setRevisions(list || []);
      // Default selected revision to current revision or highest
      const defaultRev = estimate.currentRevisionNumber ?? (list[0]?.revisionNumber || 0);
      setSelectedRevNum(defaultRev);
      if (list.length > 1) {
        setBaseRevNum(list[list.length - 1]?.revisionNumber || 0);
        setCompareRevNum(defaultRev);
      }
    } catch (err: any) {
      console.error("[EstimateRevisionsModal] fetch error:", err);
      setError(err.message || "Failed to load revision history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && estimate?.id) {
      loadRevisions();
    }
  }, [isOpen, estimate?.id]);

  // Load snapshot for single preview
  useEffect(() => {
    if (!isOpen || !estimate?.id) return;
    let cancelled = false;
    setLoadingRevData(true);
    fetchEstimateRevision(token, estimate.id, selectedRevNum)
      .then((data) => {
        if (!cancelled) {
          setSelectedRevData(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[EstimateRevisionsModal] fetch detail error:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRevData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, estimate?.id, selectedRevNum]);

  // Load snapshots for comparison
  useEffect(() => {
    if (!isOpen || !estimate?.id || viewMode !== "compare") return;
    let cancelled = false;
    setLoadingCompare(true);
    Promise.all([
      fetchEstimateRevision(token, estimate.id, baseRevNum),
      fetchEstimateRevision(token, estimate.id, compareRevNum),
    ])
      .then(([baseData, compData]) => {
        if (!cancelled) {
          setBaseRevData(baseData);
          setCompareRevData(compData);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[EstimateRevisionsModal] comparison fetch error:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCompare(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, estimate?.id, viewMode, baseRevNum, compareRevNum]);

  // Open restore confirmation
  const handleOpenRestore = (revNum: number) => {
    setRestoreTargetRev(revNum);
    setRestoreNote(`Restored from Revision ${revNum}`);
    setShowRestoreConfirm(true);
  };

  // Perform restore
  const handleConfirmRestore = async () => {
    if (restoreTargetRev === null || !estimate?.id) return;
    setRestoring(true);
    try {
      const restored = await restoreEstimateRevision(
        token,
        estimate.id,
        restoreTargetRev,
        restoreNote
      );
      setShowRestoreConfirm(false);
      await loadRevisions();
      if (onRestored) {
        onRestored(restored);
      }
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    } finally {
      setRestoring(false);
    }
  };

  // Excel Export for historical revision
  const handleExportExcel = async (revData: any) => {
    if (!revData?.snapshot) return;
    const snap = revData.snapshot;
    const snapEst = snap.estimate || {};
    const snapItems = snap.items || [];
    const clientName = snap.client?.name || clients.find((c: any) => c.id === snapEst.clientId)?.name;
    await exportEstimateToExcel(
      snapEst,
      snapItems,
      clientName,
      sellerProfile,
      snap.stores || stores,
      products
    );
  };

  // Printable View
  const handlePrint = () => {
    window.print();
  };

  // Compute diff rows between base and compare
  const diffComparison = useMemo(() => {
    if (!baseRevData?.snapshot || !compareRevData?.snapshot) return null;
    const baseItems: any[] = baseRevData.snapshot.items || [];
    const compItems: any[] = compareRevData.snapshot.items || [];

    const baseMap = new Map<string, any>();
    baseItems.forEach((it, idx) => {
      const key = `${it.sl || idx + 1}-${it.itemName || it.item_name || ""}-${it.storeId || it.store_id || 0}`;
      baseMap.set(key, it);
    });

    const compMap = new Map<string, any>();
    compItems.forEach((it, idx) => {
      const key = `${it.sl || idx + 1}-${it.itemName || it.item_name || ""}-${it.storeId || it.store_id || 0}`;
      compMap.set(key, it);
    });

    const diffRows: any[] = [];

    // Checked compared items (modified or added)
    compItems.forEach((cIt, idx) => {
      const key = `${cIt.sl || idx + 1}-${cIt.itemName || cIt.item_name || ""}-${cIt.storeId || cIt.store_id || 0}`;
      const bIt = baseMap.get(key);
      if (!bIt) {
        diffRows.push({
          type: "added",
          sl: cIt.sl || idx + 1,
          name: cIt.itemName || cIt.item_name || "Item",
          store: cIt.storeCode || cIt.store_code || cIt.manualStoreName || "Store",
          oldRate: null,
          newRate: cIt.rate,
          oldQty: null,
          newQty: cIt.quantity,
          oldTotal: null,
          newTotal: cIt.totalAmount || cIt.total_amount || cIt.totalPrice || cIt.total_price,
        });
      } else {
        const rateChanged = Number(bIt.rate) !== Number(cIt.rate);
        const qtyChanged = Number(bIt.quantity) !== Number(cIt.quantity);
        const bTotal = Number(bIt.totalAmount || bIt.total_amount || bIt.totalPrice || bIt.total_price);
        const cTotal = Number(cIt.totalAmount || cIt.total_amount || cIt.totalPrice || cIt.total_price);
        const totalChanged = Math.abs(bTotal - cTotal) > 0.01;

        if (rateChanged || qtyChanged || totalChanged) {
          diffRows.push({
            type: "modified",
            sl: cIt.sl || idx + 1,
            name: cIt.itemName || cIt.item_name || "Item",
            store: cIt.storeCode || cIt.store_code || cIt.manualStoreName || "Store",
            oldRate: bIt.rate,
            newRate: cIt.rate,
            oldQty: bIt.quantity,
            newQty: cIt.quantity,
            oldTotal: bTotal,
            newTotal: cTotal,
          });
        } else {
          diffRows.push({
            type: "unchanged",
            sl: cIt.sl || idx + 1,
            name: cIt.itemName || cIt.item_name || "Item",
            store: cIt.storeCode || cIt.store_code || cIt.manualStoreName || "Store",
            oldRate: bIt.rate,
            newRate: cIt.rate,
            oldQty: bIt.quantity,
            newQty: cIt.quantity,
            oldTotal: bTotal,
            newTotal: cTotal,
          });
        }
      }
    });

    // Check removed items
    baseItems.forEach((bIt, idx) => {
      const key = `${bIt.sl || idx + 1}-${bIt.itemName || bIt.item_name || ""}-${bIt.storeId || bIt.store_id || 0}`;
      if (!compMap.has(key)) {
        diffRows.push({
          type: "removed",
          sl: bIt.sl || idx + 1,
          name: bIt.itemName || bIt.item_name || "Item",
          store: bIt.storeCode || bIt.store_code || bIt.manualStoreName || "Store",
          oldRate: bIt.rate,
          newRate: null,
          oldQty: bIt.quantity,
          newQty: null,
          oldTotal: Number(bIt.totalAmount || bIt.total_amount || bIt.totalPrice || bIt.total_price),
          newTotal: null,
        });
      }
    });

    diffRows.sort((a, b) => a.sl - b.sl);

    const baseTotal = Number(baseRevData.totalAmount ?? 0);
    const compTotal = Number(compareRevData.totalAmount ?? 0);
    const deltaTotal = compTotal - baseTotal;

    const baseSubtotal = Number(baseRevData.subtotal ?? 0);
    const compSubtotal = Number(compareRevData.subtotal ?? 0);
    const deltaSubtotal = compSubtotal - baseSubtotal;

    return {
      diffRows,
      baseTotal,
      compTotal,
      deltaTotal,
      baseSubtotal,
      compSubtotal,
      deltaSubtotal,
      baseItemsCount: baseItems.length,
      compItemsCount: compItems.length,
    };
  }, [baseRevData, compareRevData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white">
                  Estimate Revision History
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  {estimate?.estimateNumber || "Estimate"}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Current: Rev {currentRevNum}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Immutable audit trail, historical snapshot preview, diff comparison, and safe non-destructive restoration.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-slate-800 p-1 rounded-xl flex items-center border border-slate-700">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  viewMode === "preview"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Snapshot Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode("compare")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  viewMode === "compare"
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                Diff Compare
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body: Split Sidebar & Main Viewer */}
        <div className="flex-1 flex overflow-hidden bg-slate-50">
          {/* Left Sidebar: Revisions Timeline */}
          <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
            <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Revisions ({revisions.length})
              </span>
              <button
                type="button"
                onClick={loadRevisions}
                className="text-[11px] font-bold text-amber-600 hover:text-amber-700"
              >
                Refresh
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && revisions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">Loading revisions...</div>
              ) : revisions.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">No revisions recorded yet.</div>
              ) : (
                revisions.map((rev) => {
                  const isCurrent = rev.revisionNumber === currentRevNum;
                  const isSelected = selectedRevNum === rev.revisionNumber;
                  const dateStr = rev.createdAt
                    ? new Date(rev.createdAt).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Unknown date";

                  return (
                    <div
                      key={rev.id || rev.revisionNumber}
                      onClick={() => setSelectedRevNum(rev.revisionNumber)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        isSelected
                          ? "border-amber-500 bg-amber-50/50 shadow-sm ring-1 ring-amber-500"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-black ${
                              isCurrent
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                : "bg-slate-100 text-slate-800 border border-slate-200"
                            }`}
                          >
                            Rev {rev.revisionNumber}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              Active
                            </span>
                          )}
                          {rev.sourceRevisionNumber !== null && rev.sourceRevisionNumber !== undefined && (
                            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1 py-0.5 rounded border border-purple-200">
                              From R{rev.sourceRevisionNumber}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-black text-slate-900">
                          ₹{Number(rev.totalAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 font-medium line-clamp-2 mb-2">
                        {rev.revisionNote || (rev.revisionNumber === 0 ? "Initial estimate snapshot" : "Revision edit")}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-1.5 mt-1">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {rev.createdByName || "System"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {dateStr}
                        </span>
                      </div>

                      {/* Action buttons on card */}
                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-[11px]">
                        <span className="text-slate-500 font-medium">
                          {rev.itemsCount ?? 0} item{rev.itemsCount === 1 ? "" : "s"} • {rev.storeCount ?? 1} store{rev.storeCount === 1 ? "" : "s"}
                        </span>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenRestore(rev.revisionNumber);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-700 font-bold hover:bg-purple-100 transition"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restore
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Main Viewer: Snapshot Preview or Diff Compare */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {viewMode === "preview" ? (
              // Snapshot Preview Mode
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Snapshot Status Bar & Controls */}
                <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedRevNum === currentRevNum ? (
                      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-bold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Viewing Current Active Revision (Rev {selectedRevNum})</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Historical Snapshot: Revision {selectedRevNum} (Read-Only)</span>
                      </div>
                    )}

                    {selectedRevData && (
                      <span className="text-xs text-slate-500">
                        Saved {selectedRevData.createdAt ? new Date(selectedRevData.createdAt).toLocaleString("en-IN") : ""} by {selectedRevData.createdByName || "System"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedRevNum !== currentRevNum && (
                      <button
                        type="button"
                        onClick={() => handleOpenRestore(selectedRevNum)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore as New Revision
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleExportExcel(selectedRevData)}
                      disabled={!selectedRevData}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 rounded-lg text-xs font-bold transition disabled:opacity-50"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Export Excel
                    </button>

                    <button
                      type="button"
                      onClick={handlePrint}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-bold transition"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
                    </button>
                  </div>
                </div>

                {/* Canonical Document Render */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-100 flex justify-center">
                  {loadingRevData ? (
                    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                      Loading revision document...
                    </div>
                  ) : !selectedRevData?.snapshot ? (
                    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                      No document snapshot available for Revision {selectedRevNum}.
                    </div>
                  ) : (
                    <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden relative">
                      {selectedRevNum !== currentRevNum && (
                        <div className="bg-amber-500 text-slate-950 px-4 py-1 text-center text-xs font-black tracking-wider uppercase">
                          REVISION {selectedRevNum} SNAPSHOT — READ ONLY HISTORICAL ARCHIVE
                        </div>
                      )}
                      <div className="p-4 sm:p-8">
                        <EstimateDocument
                          estimate={selectedRevData.snapshot.estimate || estimate}
                          items={selectedRevData.snapshot.items || []}
                          stores={selectedRevData.snapshot.stores || stores}
                          clients={selectedRevData.snapshot.client ? [selectedRevData.snapshot.client] : clients}
                          products={products}
                          brands={selectedRevData.snapshot.brand ? [selectedRevData.snapshot.brand] : brands}
                          sellerProfile={sellerProfile}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Diff Comparison Mode
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                {/* Comparison Selector Toolbar */}
                <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">Base Revision:</span>
                      <select
                        value={baseRevNum}
                        onChange={(e) => setBaseRevNum(Number(e.target.value))}
                        className="px-2.5 py-1 text-xs font-bold border border-slate-300 rounded-lg bg-white"
                      >
                        {revisions.map((r) => (
                          <option key={r.revisionNumber} value={r.revisionNumber}>
                            Rev {r.revisionNumber} ({new Date(r.createdAt).toLocaleDateString("en-IN")})
                          </option>
                        ))}
                      </select>
                    </div>

                    <ArrowRight className="w-4 h-4 text-slate-400" />

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">Compare With:</span>
                      <select
                        value={compareRevNum}
                        onChange={(e) => setCompareRevNum(Number(e.target.value))}
                        className="px-2.5 py-1 text-xs font-bold border border-slate-300 rounded-lg bg-white"
                      >
                        {revisions.map((r) => (
                          <option key={r.revisionNumber} value={r.revisionNumber}>
                            Rev {r.revisionNumber} {r.revisionNumber === currentRevNum ? "(Current)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {diffComparison && (
                    <div className="flex items-center gap-4 text-xs font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Total Change:</span>
                        <span
                          className={`font-black ${
                            diffComparison.deltaTotal > 0
                              ? "text-emerald-600"
                              : diffComparison.deltaTotal < 0
                              ? "text-red-600"
                              : "text-slate-700"
                          }`}
                        >
                          {diffComparison.deltaTotal >= 0 ? "+" : ""}
                          ₹{diffComparison.deltaTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Diff Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {loadingCompare ? (
                    <div className="text-center py-12 text-xs text-slate-400">Loading revisions for comparison...</div>
                  ) : !diffComparison ? (
                    <div className="text-center py-12 text-xs text-slate-400">Select two revisions to view the line-by-line diff.</div>
                  ) : (
                    <div className="space-y-6">
                      {/* KPI Summary Cards */}
                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Subtotal</span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-sm font-bold text-slate-600">
                              ₹{diffComparison.baseSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 mx-1" />
                            <span className="text-sm font-black text-slate-900">
                              ₹{diffComparison.compSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="text-[11px] mt-1 font-bold text-slate-500">
                            Δ {diffComparison.deltaSubtotal >= 0 ? "+" : ""}₹{diffComparison.deltaSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Grand Total</span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-sm font-bold text-slate-600">
                              ₹{diffComparison.baseTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 mx-1" />
                            <span className="text-sm font-black text-slate-900">
                              ₹{diffComparison.compTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div
                            className={`text-[11px] mt-1 font-black ${
                              diffComparison.deltaTotal > 0 ? "text-emerald-600" : diffComparison.deltaTotal < 0 ? "text-red-600" : "text-slate-500"
                            }`}
                          >
                            Δ {diffComparison.deltaTotal >= 0 ? "+" : ""}₹{diffComparison.deltaTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Items Count</span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-sm font-bold text-slate-600">{diffComparison.baseItemsCount}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 mx-1" />
                            <span className="text-sm font-black text-slate-900">{diffComparison.compItemsCount}</span>
                          </div>
                          <div className="text-[11px] mt-1 font-bold text-slate-500">
                            Δ {diffComparison.compItemsCount - diffComparison.baseItemsCount >= 0 ? "+" : ""}{diffComparison.compItemsCount - diffComparison.baseItemsCount} items
                          </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</span>
                          <div className="text-xs font-bold text-slate-800">
                            Comparing Rev {baseRevNum} vs Rev {compareRevNum}
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium">
                            {diffComparison.diffRows.filter(r => r.type !== "unchanged").length} changes detected
                          </div>
                        </div>
                      </div>

                      {/* Line Item Diff Table */}
                      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                            Line Items Breakdown & Changes
                          </h3>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="flex items-center gap-1 text-emerald-700 font-bold">
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Added
                            </span>
                            <span className="flex items-center gap-1 text-red-700 font-bold">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Removed
                            </span>
                            <span className="flex items-center gap-1 text-amber-700 font-bold">
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Modified
                            </span>
                          </div>
                        </div>

                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-black">
                              <th className="py-2.5 px-3 w-12 text-center">SL</th>
                              <th className="py-2.5 px-3 w-20">Type</th>
                              <th className="py-2.5 px-3">Item / Description</th>
                              <th className="py-2.5 px-3 w-32">Store</th>
                              <th className="py-2.5 px-3 w-28 text-right">Qty</th>
                              <th className="py-2.5 px-3 w-32 text-right">Rate</th>
                              <th className="py-2.5 px-3 w-36 text-right">Line Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {diffComparison.diffRows.map((row, idx) => {
                              const isAdded = row.type === "added";
                              const isRemoved = row.type === "removed";
                              const isModified = row.type === "modified";

                              const rowBg = isAdded
                                ? "bg-emerald-50/60"
                                : isRemoved
                                ? "bg-red-50/60"
                                : isModified
                                ? "bg-amber-50/50"
                                : "hover:bg-slate-50/50";

                              return (
                                <tr key={idx} className={rowBg}>
                                  <td className="py-2 px-3 text-center font-bold text-slate-500">{row.sl}</td>
                                  <td className="py-2 px-3">
                                    {isAdded && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                        + ADDED
                                      </span>
                                    )}
                                    {isRemoved && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-800 border border-red-300">
                                        - REMOVED
                                      </span>
                                    )}
                                    {isModified && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                        ~ MODIFIED
                                      </span>
                                    )}
                                    {!isAdded && !isRemoved && !isModified && (
                                      <span className="text-[10px] font-bold text-slate-400">SAME</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 font-semibold text-slate-800">{row.name}</td>
                                  <td className="py-2 px-3 text-slate-600">{row.store}</td>
                                  <td className="py-2 px-3 text-right">
                                    {isModified && row.oldQty !== row.newQty ? (
                                      <span>
                                        <span className="line-through text-slate-400 mr-1">{row.oldQty}</span>
                                        <span className="font-bold text-slate-900">{row.newQty}</span>
                                      </span>
                                    ) : (
                                      <span className="font-bold text-slate-700">{row.newQty ?? row.oldQty}</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    {isModified && row.oldRate !== row.newRate ? (
                                      <span>
                                        <span className="line-through text-slate-400 mr-1">₹{Number(row.oldRate).toFixed(2)}</span>
                                        <span className="font-bold text-slate-900">₹{Number(row.newRate).toFixed(2)}</span>
                                      </span>
                                    ) : (
                                      <span className="font-bold text-slate-700">₹{Number(row.newRate ?? row.oldRate).toFixed(2)}</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    {isModified && Math.abs(row.oldTotal - row.newTotal) > 0.01 ? (
                                      <span>
                                        <span className="line-through text-slate-400 mr-1">₹{Number(row.oldTotal).toFixed(2)}</span>
                                        <span className="font-bold text-slate-900">₹{Number(row.newTotal).toFixed(2)}</span>
                                      </span>
                                    ) : (
                                      <span className="font-black text-slate-900">
                                        ₹{Number(row.newTotal ?? row.oldTotal).toFixed(2)}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Restore Confirmation Modal */}
        {showRestoreConfirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
              <div className="flex items-center gap-3 text-purple-600 mb-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Restore Revision {restoreTargetRev}?</h3>
                  <p className="text-xs text-slate-500">Recovers earlier estimate version safely</p>
                </div>
              </div>

              <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 mb-4 leading-relaxed">
                <strong>Non-destructive restore:</strong> This will create a <strong>new Revision {currentRevNum + 1}</strong> with the exact items, rates, and dimensions of Revision {restoreTargetRev}. No existing revisions will be erased or overwritten.
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Revision Note:
                </label>
                <input
                  type="text"
                  value={restoreNote}
                  onChange={(e) => setRestoreNote(e.target.value)}
                  placeholder={`Restored from Revision ${restoreTargetRev}`}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRestoreConfirm(false)}
                  disabled={restoring}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  {restoring ? "Restoring..." : "Confirm & Restore"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
