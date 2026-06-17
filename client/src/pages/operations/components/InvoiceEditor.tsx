import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { isBoltMode } from "../../../lib/supabase";
import { fetchEstimates, fetchEstimateItems, fetchDeliveryChallans, fetchInvoiceById, createInvoice } from "../../../lib/api";
import { Link } from "wouter";
import { X, Plus, Trash2, Save, Send, Printer, ChevronLeft } from "lucide-react";
import { normalizeDisplayName } from "../../../../../shared/textFormat";

export interface InvoiceLineItem {
  itemName: string;
  description?: string;
  hsn?: string;
  quantity: number;
  unit: string;
  rate: number;
  taxPercent: number;
  amount: number;
  taxAmount: number;
  totalAmount: number;
}

interface InvoiceEditorProps {
  // Either editing an existing invoice (invoiceId) or creating a new one
  // from a delivery challan (estimateId + deliveryChallanId).
  open: boolean;
  invoiceId?: number | null;
  estimateId?: number | null;
  deliveryChallanId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

const formatCurrency = (val: number) =>
  "₹" + (val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const InvoiceEditor: React.FC<InvoiceEditorProps> = ({ open, invoiceId, estimateId, deliveryChallanId, onClose, onSaved }) => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [partyName, setPartyName] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [poReference, setPoReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [linkedEstimate, setLinkedEstimate] = useState<any>(null);
  const [linkedDc, setLinkedDc] = useState<any>(null);
  const [origInvoice, setOrigInvoice] = useState<any>(null);

  // Load: either an existing invoice OR build a draft from estimate + DC.
  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    (async () => {
      try {
        if (invoiceId) {
          let inv: any = null;
          if (isBoltMode) {
            inv = await fetchInvoiceById(token, invoiceId);
            if (inv) {
              setOrigInvoice(inv);
              setInvoiceNumber(inv.invoiceNumber || inv.invoice_number || "");
              setDate((inv.date || inv.invoice_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
              setDueDate((inv.dueDate || inv.due_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
              setPartyName(inv.partyName || inv.party_name || "");
              setClientId(inv.clientId ?? inv.client_id ?? null);
              setPoNumber(inv.poNumber || inv.po_number || "");
              setPoReference(inv.poReference || inv.po_reference || "");
              setRemarks(inv.remarks || "");
              setStatus(inv.status || "draft");
              const lines = Array.isArray(inv.lineItems || inv.line_items) ? (inv.lineItems || inv.line_items) : [];
              setItems(lines.length > 0 ? lines.map((l: any) => ({
                itemName: l.itemName || l.item_name || "",
                description: l.description || "",
                hsn: l.hsn || "",
                quantity: Number(l.quantity || 0),
                unit: l.unit || "nos",
                rate: Number(l.rate || 0),
                taxPercent: Number(l.taxPercent ?? l.tax_percent ?? 18),
                amount: Number(l.amount || 0),
                taxAmount: Number(l.taxAmount || l.tax_amount || 0),
                totalAmount: Number(l.totalAmount || l.total_amount || 0),
              })) : [blankRow()]);
            }
          } else {
            const r = await fetch(`/api/finance/invoices/${invoiceId}`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) {
              const data = await r.json();
              setOrigInvoice(data.invoice);
              setInvoiceNumber(data.invoice.invoiceNumber);
              setDate(data.invoice.date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
              setDueDate(data.invoice.dueDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
              setPartyName(data.invoice.partyName || "");
              setClientId(data.invoice.clientId ?? null);
              setPoNumber(data.invoice.poNumber || "");
              setPoReference(data.invoice.poReference || "");
              setRemarks(data.invoice.remarks || "");
              setStatus(data.invoice.status || "draft");
              setLinkedEstimate(data.estimate || null);
              setLinkedDc(data.deliveryChallan || null);
              const lines = Array.isArray(data.invoice.lineItems) ? data.invoice.lineItems : [];
              if (lines.length > 0) {
                setItems(lines.map((l: any) => ({
                  itemName: l.itemName || "",
                  description: l.description || "",
                  hsn: l.hsn || "",
                  quantity: Number(l.quantity || 0),
                  unit: l.unit || "nos",
                  rate: Number(l.rate || 0),
                  taxPercent: Number(l.taxPercent ?? 18),
                  amount: Number(l.amount || 0),
                  taxAmount: Number(l.taxAmount || 0),
                  totalAmount: Number(l.totalAmount || 0),
                })));
              } else if (data.estimateItems && data.estimateItems.length > 0) {
                setItems(estimateItemsToLines(data.estimateItems));
              } else {
                setItems([blankRow()]);
              }
            }
          }
        } else if (estimateId) {
          // Build new invoice from estimate items
          if (isBoltMode) {
            const [allEstimates, its, allDcs] = await Promise.all([
              fetchEstimates(token),
              fetchEstimateItems(token, estimateId),
              deliveryChallanId ? fetchDeliveryChallans(token) : Promise.resolve([]),
            ]);
            const est = (allEstimates as any[]).find((e: any) => e.id === estimateId);
            setLinkedEstimate(est || null);
            if (est) {
              setPartyName(est.billingLegalNameSnapshot || "");
              setClientId(est.clientId ?? null);
              setPoNumber(est.poNumber || "");
            }
            const its_ = its as any[];
            setItems(its_.length > 0 ? estimateItemsToLines(its_) : [blankRow()]);
            if (deliveryChallanId) {
              const dc = (allDcs as any[]).find((d: any) => d.id === deliveryChallanId);
              if (dc) setLinkedDc(dc);
            }
            setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
          } else {
            const [eRes, iRes, dRes, numRes] = await Promise.all([
              fetch(`/api/operations/estimates`, { headers: { Authorization: `Bearer ${token}` } }),
              fetch(`/api/operations/estimates/${estimateId}/items`, { headers: { Authorization: `Bearer ${token}` } }),
              deliveryChallanId
                ? fetch(`/api/operations/delivery-challans/${deliveryChallanId}`, { headers: { Authorization: `Bearer ${token}` } })
                : Promise.resolve(null),
              fetch(`/api/numbering/invoice/next`, { headers: { Authorization: `Bearer ${token}` } }),
            ]);
            if (eRes.ok) {
              const list = await eRes.json();
              const est = list.find((e: any) => e.id === estimateId);
              setLinkedEstimate(est || null);
              if (est) {
                setPartyName(est.billingLegalNameSnapshot || "");
                setClientId(est.clientId ?? null);
                setPoNumber(est.poNumber || "");
              }
            }
            if (iRes.ok) {
              const its = await iRes.json();
              setItems(estimateItemsToLines(its));
            } else {
              setItems([blankRow()]);
            }
            if (dRes && dRes.ok) {
              const dc = await dRes.json();
              setLinkedDc(dc);
            }
            if (numRes.ok) {
              const { number } = await numRes.json();
              setInvoiceNumber(number);
            }
          }
          setStatus("draft");
        }
      } catch (err) {
        console.error("Invoice editor load failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, invoiceId, estimateId, deliveryChallanId, token]);

  const subtotal = useMemo(() => items.reduce((s, it) => s + (Number(it.amount) || 0), 0), [items]);
  const taxTotal = useMemo(() => items.reduce((s, it) => s + (Number(it.taxAmount) || 0), 0), [items]);
  const grandTotal = subtotal + taxTotal;

  const updateRow = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setItems(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      const merged = { ...row, ...patch };
      const qty = Number(merged.quantity) || 0;
      const rate = Number(merged.rate) || 0;
      const amount = +(qty * rate).toFixed(2);
      const taxAmount = +(amount * ((Number(merged.taxPercent) || 0) / 100)).toFixed(2);
      const totalAmount = +(amount + taxAmount).toFixed(2);
      return { ...merged, amount, taxAmount, totalAmount };
    }));
  };
  const removeRow = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const addRow = () => setItems(prev => [...prev, blankRow()]);

  const save = async (mode: "draft" | "approved" | "stay") => {
    if (!token) return;
    if (!invoiceNumber.trim()) { alert("Invoice number required"); return; }
    if (items.length === 0 || items.every(it => !it.itemName)) { alert("Add at least one line item"); return; }
    setSaving(true);
    try {
      const payload: any = {
        invoiceNumber,
        type: "sales",
        partyName,
        amount: subtotal,
        taxAmount: taxTotal,
        totalAmount: grandTotal,
        date,
        dueDate,
        status: mode === "stay" ? (origInvoice?.status || status) : mode === "approved" ? "approved" : "draft",
        estimateId: linkedEstimate?.id || estimateId || null,
        clientId,
        paidAmount: origInvoice?.paidAmount ?? 0,
        balanceAmount: grandTotal - (origInvoice?.paidAmount ?? 0),
        deliveryChallanId: linkedDc?.id || deliveryChallanId || null,
        lineItems: items,
        poNumber: poNumber || null,
        poReference: poReference || null,
        remarks: remarks || null,
      };
      if (isBoltMode) {
        if (invoiceId || origInvoice?.id) {
          // Invoice update not yet migrated to Edge Function — warn but don't crash
          alert("Invoice update migration to Edge Function pending.");
          return;
        }
        await createInvoice(token, payload);
      } else {
        let r: Response;
        if (invoiceId || origInvoice?.id) {
          const id = invoiceId || origInvoice.id;
          r = await fetch(`/api/finance/invoices/${id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          r = await fetch(`/api/finance/invoices`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          alert(j.message || "Save failed");
          return;
        }
      }
      onSaved();
      onClose();
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
      <div className="border-b border-slate-200 bg-slate-50/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded text-xs font-semibold">
              <ChevronLeft className="w-4 h-4" /> Close
            </button>
            <div>
              <span className="text-[10px] font-black tracking-widest text-orange-500 uppercase">{invoiceId ? "Edit Invoice" : "New Invoice"}</span>
              <h2 className="text-lg font-bold text-slate-900">{invoiceNumber || "—"}</h2>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${statusClass(status)}`}>{status}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => save("draft")} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> Save Draft
            </button>
            <button onClick={() => save("approved")} disabled={saving} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Approve
            </button>
            {invoiceId && (
              <a href={`/invoice-packet?id=${invoiceId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold rounded">
                <Printer className="w-3.5 h-3.5" /> Print / PDF
              </a>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 text-sm">Loading invoice…</div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
          {/* Linked documents chain */}
          <div className="bg-orange-50/40 border border-orange-100 rounded-xl p-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-orange-700 font-black uppercase tracking-wider">Linked:</span>
            {linkedEstimate ? (
              <Link href={`/estimates#est-${linkedEstimate.id}`} className="px-2 py-1 bg-white border border-orange-200 rounded font-bold text-orange-700 hover:underline font-mono">Estimate {linkedEstimate.estimateNumber}</Link>
            ) : <span className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-400">No estimate</span>}
            <span className="text-orange-300">→</span>
            {poNumber ? (
              <span className="px-2 py-1 bg-white border border-purple-200 rounded font-bold text-purple-700 font-mono">PO {poNumber}</span>
            ) : <span className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-400">No PO</span>}
            <span className="text-orange-300">→</span>
            {linkedDc ? (
              <span className="px-2 py-1 bg-white border border-amber-200 rounded font-bold text-amber-700 font-mono">{linkedDc.dcNumber}</span>
            ) : <span className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-400">No DC/WCC</span>}
            <span className="text-orange-300">→</span>
            <span className="px-2 py-1 bg-white border border-blue-200 rounded font-bold text-blue-700 font-mono">{invoiceNumber || "INV ?"}</span>
          </div>

          {/* Header form */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Invoice No *"><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="input-compact font-mono font-bold" /></Field>
            <Field label="Invoice Date *"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-compact" /></Field>
            <Field label="Due Date *"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-compact" /></Field>
            <Field label="Status">
              <select value={status} onChange={e => setStatus(e.target.value)} className="input-compact font-bold">
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="hold">Hold</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Party (billed-to)"><input value={partyName} onChange={e => setPartyName(e.target.value)} className="input-compact" /></Field>
            </div>
            <Field label="PO Number"><input value={poNumber} onChange={e => setPoNumber(e.target.value)} className="input-compact font-mono" /></Field>
            <Field label="PO Reference"><input value={poReference} onChange={e => setPoReference(e.target.value)} className="input-compact" /></Field>
          </div>

          {/* Line items grid */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-600">Line items</h4>
              <button onClick={addRow} className="inline-flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold rounded">
                <Plus className="w-3 h-3" /> Add Row
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2 text-left w-8">#</th>
                    <th className="px-2 py-2 text-left">Element</th>
                    <th className="px-2 py-2 text-left">Product Details</th>
                    <th className="px-2 py-2 text-left">HSN</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-left">UOM</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-right">Tax %</th>
                    <th className="px-2 py-2 text-right">Tax</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="px-2 py-1 text-slate-400">{idx + 1}</td>
                      <td className="px-2 py-1"><input value={row.itemName} onChange={e => updateRow(idx, { itemName: e.target.value })} className="w-full px-1.5 py-1 bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1"><input value={row.description || ""} onChange={e => updateRow(idx, { description: e.target.value })} className="w-full px-1.5 py-1 bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1"><input value={row.hsn || ""} onChange={e => updateRow(idx, { hsn: e.target.value })} className="w-20 px-1.5 py-1 font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1 text-right"><input type="number" value={row.quantity} onChange={e => updateRow(idx, { quantity: Number(e.target.value) })} className="w-20 px-1.5 py-1 text-right font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1"><input value={row.unit} onChange={e => updateRow(idx, { unit: e.target.value })} className="w-16 px-1.5 py-1 bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1 text-right"><input type="number" value={row.rate} onChange={e => updateRow(idx, { rate: Number(e.target.value) })} className="w-24 px-1.5 py-1 text-right font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1 text-right font-mono font-bold text-slate-800">{row.amount.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right"><input type="number" value={row.taxPercent} onChange={e => updateRow(idx, { taxPercent: Number(e.target.value) })} className="w-16 px-1.5 py-1 text-right font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-orange-300 focus:bg-white rounded outline-none" /></td>
                      <td className="px-2 py-1 text-right font-mono text-slate-600">{row.taxAmount.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold text-orange-700">{row.totalAmount.toFixed(2)}</td>
                      <td className="px-2 py-1">
                        <button onClick={() => removeRow(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={7} className="px-2 py-2 text-right font-bold text-slate-600 text-xs uppercase tracking-wide">Subtotal</td>
                    <td className="px-2 py-2 text-right font-mono font-extrabold text-slate-900">{formatCurrency(subtotal)}</td>
                    <td colSpan={2} className="px-2 py-2 text-right font-bold text-slate-600">Tax</td>
                    <td className="px-2 py-2 text-right font-mono text-slate-700">{formatCurrency(taxTotal)}</td>
                    <td />
                  </tr>
                  <tr className="bg-orange-50">
                    <td colSpan={10} className="px-2 py-2 text-right font-black uppercase tracking-wide text-orange-700">Grand Total</td>
                    <td className="px-2 py-2 text-right font-mono font-extrabold text-orange-800 text-base">{formatCurrency(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <Field label="Remarks">
              <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} className="input-compact resize-none" />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
};

function blankRow(): InvoiceLineItem {
  return { itemName: "", description: "", hsn: "", quantity: 1, unit: "nos", rate: 0, taxPercent: 18, amount: 0, taxAmount: 0, totalAmount: 0 };
}

function estimateItemsToLines(its: any[]): InvoiceLineItem[] {
  return its.map((it) => {
    const qty = Number(it.quantity || 0);
    const rate = Number(it.rate || 0);
    const amount = +(qty * rate).toFixed(2);
    const taxPercent = (Number(it.cgstPercent || 0) + Number(it.sgstPercent || 0)) || Number(it.igstPercent || 0) || 18;
    const taxAmount = Number(it.cgstAmount || 0) + Number(it.sgstAmount || 0) + Number(it.igstAmount || 0);
    return {
      itemName: it.itemName || "",
      description: it.description || "",
      hsn: it.hsn || "",
      quantity: qty,
      unit: it.unit || "nos",
      rate,
      taxPercent,
      amount,
      taxAmount: +taxAmount.toFixed(2),
      totalAmount: +(amount + taxAmount).toFixed(2),
    };
  });
}

function statusClass(s: string): string {
  return ({
    draft: "bg-slate-100 text-slate-700 border-slate-200",
    approved: "bg-blue-50 text-blue-700 border-blue-200",
    hold: "bg-amber-50 text-amber-700 border-amber-200",
    partial: "bg-amber-50 text-amber-700 border-amber-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
  } as Record<string, string>)[s] || "bg-slate-100 text-slate-700 border-slate-200";
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">{label}</label>
    {children}
  </div>
);

export default InvoiceEditor;
