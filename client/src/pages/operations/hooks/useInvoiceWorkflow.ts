import { useState } from "react";
import { isBoltMode } from "../../../lib/supabase";
import { supabase } from "../../../lib/supabase";

type InvoiceEditorState = {
  open: boolean;
  invoiceId?: number | null;
  estimateId?: number | null;
  deliveryChallanId?: number | null;
};

type InvoiceRef = {
  id: number;
  invoiceNumber: string;
  paidAmount?: number;
};

export const useInvoiceWorkflow = (
  token: string | null,
  fetchLedgerData: () => Promise<void>,
) => {
  const [invoiceEditor, setInvoiceEditor] = useState<InvoiceEditorState>({ open: false });

  const openInvoiceEditor = (args: Omit<InvoiceEditorState, "open">) => {
    setInvoiceEditor({ open: true, ...args });
  };

  const closeInvoiceEditor = () => setInvoiceEditor({ open: false });

  const cancelInvoice = async (inv: InvoiceRef) => {
    if (!token) return;
    const reason = prompt(`Cancel invoice ${inv.invoiceNumber}?\n\nReason (optional):`);
    if (reason === null) return;
    const force = (inv.paidAmount || 0) > 0
      ? confirm("This invoice has recorded payments. Force-cancel anyway? Payments stay recorded.")
      : false;
    if (isBoltMode) {
      const { error } = await supabase.from("invoices").update({ status: "cancelled" }).eq("id", inv.id);
      if (error) { alert(error.message || "Cancel failed"); return; }
      await fetchLedgerData();
      return;
    }
    const r = await fetch(`/api/finance/invoices/${inv.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason, force }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.message || "Cancel failed");
      return;
    }
    await fetchLedgerData();
  };

  const deleteInvoice = async (inv: InvoiceRef) => {
    if (!token) return;
    if (!confirm(`Permanently delete invoice ${inv.invoiceNumber}? This cannot be undone.`)) return;
    if (isBoltMode) {
      const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
      if (error) { alert(error.message || "Delete failed"); return; }
      await fetchLedgerData();
      return;
    }
    const r = await fetch(`/api/finance/invoices/${inv.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.message || "Delete failed");
      return;
    }
    await fetchLedgerData();
  };

  return {
    invoiceEditor,
    openInvoiceEditor,
    closeInvoiceEditor,
    cancelInvoice,
    deleteInvoice,
  };
};
