import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Building2,
  Receipt,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Calendar,
} from "lucide-react";
import { fetchEstimateItems, createInvoice, fetchNextInvoiceNumber } from "@/lib/api";
import { computeStoreBreakdown, StoreBreakdownItem } from "@shared/storeBreakdown";

interface StoreWiseInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  estimate: any;
  clients: any[];
  stores: any[];
  invoices: any[];
  token: string | null;
  onSuccess: () => Promise<void> | void;
  openInvoiceEditor?: (opts: { invoiceId?: number; estimateId?: number }) => void;
}

interface GenerationResult {
  storeId: number;
  storeName: string;
  storeCode: string;
  status: "pending" | "processing" | "success" | "error" | "existing";
  invoiceNumber?: string;
  invoiceId?: number;
  error?: string;
}

export const StoreWiseInvoiceModal: React.FC<StoreWiseInvoiceModalProps> = ({
  isOpen,
  onClose,
  estimate,
  clients,
  stores,
  invoices,
  token,
  onSuccess,
  openInvoiceEditor,
}) => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState<number[]>([]);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [storeInvoiceNumbers, setStoreInvoiceNumbers] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generationResults, setGenerationResults] = useState<GenerationResult[]>([]);
  const [generationComplete, setGenerationComplete] = useState(false);

  // Client info
  const client = useMemo(() => {
    if (!estimate) return null;
    return clients.find((c: any) => c.id === (estimate.clientId || estimate.client_id));
  }, [estimate, clients]);

  // Load estimate items when modal opens
  useEffect(() => {
    if (!isOpen || !estimate) {
      setItems([]);
      setLoading(false);
      setGenerationResults([]);
      setGenerationComplete(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setGenerationResults([]);
    setGenerationComplete(false);

    fetchEstimateItems(token, estimate.id)
      .then((data) => {
        if (!isMounted) return;
        setItems(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error("Failed to load estimate items for store breakdown:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, estimate, token]);

  // Compute breakdown
  const storeBreakdowns = useMemo(() => {
    if (!estimate) return [];
    return computeStoreBreakdown(estimate, items, stores, invoices);
  }, [estimate, items, stores, invoices]);

  // Initial selection of stores that are NOT already invoiced
  useEffect(() => {
    if (storeBreakdowns.length > 0 && !generationComplete) {
      const uninvoiced = storeBreakdowns
        .filter((sb) => !sb.existingInvoice)
        .map((sb) => sb.storeId);
      setSelectedStoreIds(uninvoiced);
    }
  }, [storeBreakdowns, generationComplete]);

  // Pre-fill smart sequential editable invoice numbers for un-invoiced stores
  useEffect(() => {
    if (!isOpen || storeBreakdowns.length === 0) return;
    const uninvoiced = storeBreakdowns.filter((sb) => !sb.existingInvoice);
    if (uninvoiced.length === 0) return;

    let isCurrent = true;
    fetchNextInvoiceNumber(token, invoiceDate)
      .then((startNum) => {
        if (!isCurrent) return;
        const match = startNum.match(/^(.*\/SM\/)(\d+)$/i) || startNum.match(/^(.*\/)(\d+)$/);
        const prefix = match ? match[1] : `${startNum}-`;
        let seq = match ? parseInt(match[2], 10) : 1;

        setStoreInvoiceNumbers((prev) => {
          const nextMap: Record<number, string> = { ...prev };
          uninvoiced.forEach((sb) => {
            if (!nextMap[sb.storeId]) {
              nextMap[sb.storeId] = `${prefix}${seq++}`;
            }
          });
          return nextMap;
        });
      })
      .catch((err) => {
        console.warn("Failed to fetch next invoice number for stores:", err);
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, storeBreakdowns, invoiceDate, token]);

  if (!isOpen || !estimate) return null;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(val || 0);
  };

  const uninvoicedStores = storeBreakdowns.filter((sb) => !sb.existingInvoice);
  const allEligibleSelected =
    uninvoicedStores.length > 0 &&
    uninvoicedStores.every((sb) => selectedStoreIds.includes(sb.storeId));

  const toggleSelectAll = () => {
    if (allEligibleSelected) {
      setSelectedStoreIds([]);
    } else {
      setSelectedStoreIds(uninvoicedStores.map((sb) => sb.storeId));
    }
  };

  const toggleStore = (storeId: number) => {
    setSelectedStoreIds((prev) =>
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]
    );
  };

  // Selected totals
  const selectedStores = storeBreakdowns.filter((sb) => selectedStoreIds.includes(sb.storeId));
  const selectedTotal = selectedStores.reduce((acc, s) => acc + s.totalAmount, 0);

  // Invoice creation execution
  const handleGenerateInvoices = async () => {
    if (selectedStoreIds.length === 0) return;

    // Validate that every selected store has an invoice number and no duplicates within the batch
    const numbersSeen = new Set<string>();
    for (const store of selectedStores) {
      const invNum = (storeInvoiceNumbers[store.storeId] || "").trim();
      if (!invNum) {
        alert(`Please enter an invoice number for store "${store.storeName}".`);
        return;
      }
      if (numbersSeen.has(invNum)) {
        alert(`Duplicate invoice number "${invNum}" entered. Each invoice must have a unique number.`);
        return;
      }
      numbersSeen.add(invNum);
    }

    setIsSubmitting(true);

    const initialResults: GenerationResult[] = selectedStores.map((sb) => ({
      storeId: sb.storeId,
      storeName: sb.storeName,
      storeCode: sb.storeCode,
      status: "pending",
    }));
    setGenerationResults(initialResults);

    const updatedResults = [...initialResults];

    for (let i = 0; i < selectedStores.length; i++) {
      const store = selectedStores[i];
      const invNumber = (storeInvoiceNumbers[store.storeId] || "").trim();
      updatedResults[i].status = "processing";
      setGenerationResults([...updatedResults]);

      try {
        const clientObj = clients.find((c: any) => c.id === (estimate?.clientId || estimate?.client_id));
        const resolvedPartyName = (
          estimate?.billingLegalNameSnapshot ||
          clientObj?.name ||
          estimate?.clientName ||
          estimate?.title ||
          "Customer"
        ).trim();

        const payload = {
          invoiceNumber: invNumber,
          estimateId: estimate.id,
          clientId: estimate.clientId || estimate.client_id,
          partyName: resolvedPartyName,
          party_name: resolvedPartyName,
          storeId: store.storeId,
          storeCode: store.storeCode,
          storeName: store.storeName,
          amount: store.subtotal,
          cgst: store.cgstAmount,
          sgst: store.sgstAmount,
          igst: store.igstAmount,
          taxAmount: store.taxAmount,
          totalAmount: store.totalAmount,
          date: invoiceDate,
          dueDate: dueDate,
          status: "draft",
          paidAmount: 0,
          balanceAmount: store.totalAmount,
          lineItems: store.items,
          poNumber: estimate.poNumber || null,
          remarks: `Store-wise invoice for ${store.storeName} (${store.storeCode}) from Estimate ${estimate.estimateNumber}`,
          packetSettings: {
            source: "store_wise_generator",
            storeId: store.storeId,
            storeCode: store.storeCode,
            storeName: store.storeName,
            itemCount: store.items.length,
          },
        };

        const created = await createInvoice(token, payload);
        updatedResults[i].status = "success";
        updatedResults[i].invoiceNumber = created.invoiceNumber || created.invoice_number;
        updatedResults[i].invoiceId = created.id;
      } catch (err: any) {
        console.error(`Failed to create invoice for store ${store.storeName}:`, err);
        updatedResults[i].status = "error";
        updatedResults[i].error = err.message || "Failed to generate invoice";
      }

      setGenerationResults([...updatedResults]);
    }

    setIsSubmitting(false);
    setGenerationComplete(true);

    // Refresh parent data so invoice register and badges update immediately
    try {
      await onSuccess();
    } catch (err) {
      console.warn("Error refreshing parent data after invoice creation:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600 shadow-xs">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Store-wise Invoice Generator</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-200">
                  {estimate.estimateNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Client: <span className="font-semibold text-slate-800">{client?.name || "Customer"}</span>
                {estimate.totalAmount && (
                  <> • Master Total: <span className="font-mono font-bold text-slate-800">{formatCurrency(estimate.totalAmount)}</span></>
                )}
                {storeBreakdowns.length > 0 && (
                  <> • Stores Detected: <span className="font-bold text-slate-800">{storeBreakdowns.length}</span></>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              <p className="text-sm font-medium">Analyzing estimate line items and store allocations...</p>
            </div>
          ) : storeBreakdowns.length === 0 ? (
            <div className="py-12 px-6 rounded-lg bg-amber-50 border border-amber-200 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-amber-600 mx-auto" />
              <h3 className="text-sm font-bold text-amber-900">No Store Grouping or Store Assignment Found</h3>
              <p className="text-xs text-amber-700 max-w-md mx-auto">
                This estimate does not have store groupings or a store assigned. For single-store or multi-store estimates, ensure stores are mapped before generating store-wise invoices.
              </p>
            </div>
          ) : generationComplete ? (
            /* Results Screen */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-emerald-900">
                    Store-wise Invoices Processed
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Individual store invoices have been generated and linked to this master estimate. Each invoice opens an isolated invoice packet with that store&apos;s specific documents.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2.5">Store</th>
                      <th className="px-3 py-2.5">Code</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Invoice No.</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {generationResults.map((res) => (
                      <tr key={res.storeId} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-medium text-slate-800">{res.storeName}</td>
                        <td className="px-3 py-2.5 font-mono text-slate-600">{res.storeCode || "—"}</td>
                        <td className="px-3 py-2.5">
                          {res.status === "success" && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Created
                            </span>
                          )}
                          {res.status === "error" && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200" title={res.error}>
                              <AlertCircle className="w-3 h-3" /> Error
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                          {res.invoiceNumber || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right space-x-2">
                          {res.invoiceId && (
                            <>
                              <button
                                type="button"
                                onClick={() => openInvoiceEditor?.({ invoiceId: res.invoiceId })}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold hover:bg-blue-100 transition shadow-2xs"
                              >
                                <Receipt className="w-3 h-3" /> Invoice
                              </button>
                              <a
                                href={`/invoice-packet?id=${res.invoiceId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-white font-semibold hover:bg-slate-800 transition shadow-2xs"
                              >
                                <FileText className="w-3 h-3" /> Packet <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Selection & Configuration Screen */
            <>
              {/* Date pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-500" /> Invoice Date
                  </label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full text-xs font-semibold px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-500" /> Payment Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full text-xs font-semibold px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Duplicate protection notice */}
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>
                    Duplicate prevention active: Stores with existing invoices are locked from re-creation.
                  </span>
                </div>
                {uninvoicedStores.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    disabled={isSubmitting}
                    className="font-bold text-orange-600 hover:text-orange-700 underline text-xs"
                  >
                    {allEligibleSelected ? "Deselect All" : "Select All Un-invoiced"}
                  </button>
                )}
              </div>

              {/* Stores Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={allEligibleSelected}
                          onChange={toggleSelectAll}
                          disabled={uninvoicedStores.length === 0 || isSubmitting}
                          className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                        />
                      </th>
                      <th className="px-3 py-2">Store Name</th>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2 text-center">Items</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                      <th className="px-3 py-2 text-right">Taxes</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2">Invoice No. *</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {storeBreakdowns.map((sb) => {
                      const hasInvoice = Boolean(sb.existingInvoice);
                      const isSelected = selectedStoreIds.includes(sb.storeId);

                      return (
                        <tr
                          key={sb.storeId}
                          className={`transition ${
                            hasInvoice
                              ? "bg-slate-50/70 opacity-80"
                              : isSelected
                              ? "bg-orange-50/40"
                              : "hover:bg-slate-50/50"
                          }`}
                        >
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={hasInvoice || isSubmitting}
                              onChange={() => toggleStore(sb.storeId)}
                              className="rounded border-slate-300 text-orange-600 focus:ring-orange-500 disabled:opacity-40"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900">{sb.storeName}</div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-600">
                            {sb.storeCode || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-center font-medium text-slate-600">
                            {sb.itemCount}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600">
                            {formatCurrency(sb.subtotal)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-500 text-[11px]">
                            {formatCurrency(sb.taxAmount)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(sb.totalAmount)}
                          </td>
                          <td className="px-3 py-2.5">
                            {hasInvoice ? (
                              <div className="inline-flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-mono">
                                  {sb.existingInvoice.invoiceNumber || sb.existingInvoice.invoice_number}
                                </span>
                                <a
                                  href={`/invoice-packet?id=${sb.existingInvoice.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="View Store Invoice Packet"
                                  className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={storeInvoiceNumbers[sb.storeId] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setStoreInvoiceNumbers((prev) => ({ ...prev, [sb.storeId]: val }));
                                }}
                                disabled={isSubmitting}
                                placeholder="e.g. 26-27/SM/171"
                                className="w-32 px-2 py-1 text-xs font-mono font-bold bg-white border border-slate-300 rounded focus:border-orange-500 focus:ring-1 focus:ring-orange-500 focus:outline-hidden"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {hasInvoice ? (
                              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                                Invoiced
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                Ready to Bill
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            {!generationComplete && storeBreakdowns.length > 0 && (
              <div className="text-xs text-slate-600">
                <span className="font-bold text-slate-900">{selectedStoreIds.length}</span> of{" "}
                <span>{storeBreakdowns.length}</span> stores selected • Subtotal:{" "}
                <span className="font-mono font-bold text-slate-900">
                  {formatCurrency(selectedTotal)}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {generationComplete ? (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition shadow-xs"
              >
                Close & Return
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerateInvoices}
                  disabled={selectedStoreIds.length === 0 || isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating Invoices...
                    </>
                  ) : (
                    <>
                      <Receipt className="w-3.5 h-3.5" />
                      Generate {selectedStoreIds.length} Store {selectedStoreIds.length === 1 ? "Invoice" : "Invoices"}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default StoreWiseInvoiceModal;
