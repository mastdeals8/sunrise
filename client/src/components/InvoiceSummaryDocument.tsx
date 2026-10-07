import React, { useMemo, useState } from "react";
import { formatCurrency } from "@/utils/format";
import { getEstimateScopedStores, getInvoiceScopedStores } from "@shared/storeScoping";
import { Copy, Check, Mail } from "lucide-react";

export interface InvoiceSummaryRow {
  field: string;
  value: string;
}

interface InvoiceSummaryDocumentProps {
  packet: any;
  sellerProfile?: any;
  pages?: any[];
  onCopySuccess?: () => void;
}

export function getInvoiceSummaryRows(packet: any, sellerProfile: any, pages?: any[]): InvoiceSummaryRow[] {
  if (!packet) return [];

  // 1. PO No
  const rawPo = packet.invoice?.poNumber || packet.estimate?.poNumber;
  const poNo = rawPo && String(rawPo).trim() && String(rawPo).trim() !== "—" && String(rawPo).trim() !== "N/A"
    ? String(rawPo).trim()
    : "Not Available";

  // 2. Invoice No
  const invoiceNo = String(packet.invoice?.invoiceNumber || "").trim() || "—";

  // 3. Invoice Amt Post GST
  const rawTotal = packet.invoice?.totalAmount != null ? Number(packet.invoice.totalAmount) : 0;
  const invoiceAmtPostGst = formatCurrency(rawTotal);

  // 4. Invoice Date
  let invoiceDate = "—";
  const rawDate = packet.invoice?.date;
  if (rawDate) {
    if (typeof rawDate === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate.trim())) {
      invoiceDate = rawDate.trim();
    } else {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        invoiceDate = `${dd}/${mm}/${yyyy}`;
      } else {
        invoiceDate = String(rawDate);
      }
    }
  }

  // 5. Activity
  const activity = String(
    packet.estimate?.title ||
    packet.estimate?.subject ||
    packet.invoice?.title ||
    packet.invoice?.subject ||
    packet.invoice?.remarks ||
    "—"
  ).trim() || "—";

  // 6. Store & 8. No of Stores
  const estStores = getEstimateScopedStores(
    packet.estimate,
    packet.estimateItems || [],
    packet.stores || [],
    packet.challans || []
  );
  const scopedStores = getInvoiceScopedStores(
    estStores,
    packet.invoice,
    packet.stores || []
  );
  const storeCodesList = scopedStores.map(s => s.storeCode).filter(Boolean);
  const storeNamesList = scopedStores.map(s => s.storeName).filter(Boolean);

  const noOfStoresCount = scopedStores.length;
  const noOfStores = String(noOfStoresCount);
  const store = noOfStoresCount > 1 ? "Multiple" : noOfStoresCount === 1 ? (storeNamesList[0] || "—") : "—";

  // 7. Vendor
  const vendor = String(sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media").trim();

  // 9. WCC
  let wccStatus = "Pending";
  if (noOfStoresCount === 0) {
    if (packet.challans && packet.challans.length > 0) {
      const allSigned = packet.challans.every((dc: any) => Boolean(dc.signedChallanPath));
      wccStatus = allSigned ? "OK" : "Pending";
    } else {
      wccStatus = "Not Applicable";
    }
  } else {
    let allWccComplete = true;
    for (const sc of storeCodesList) {
      const hasWcc =
        (pages || []).some(
          p =>
            p.kind === "wcc" &&
            (p.filePath || p.storagePath) &&
            (storeCodesList.length === 1 || String(p.storeCode || "").trim() === sc)
        ) ||
        (packet.executionDocuments || []).some(
          (d: any) =>
            ["signed_wcc", "signed_dc"].includes(d.documentType) &&
            d.status !== "deleted" &&
            (d.filePath || d.storagePath) &&
            (storeCodesList.length === 1 || String(d.storeCode || "").trim() === sc)
        ) ||
        (packet.challans || []).some(
          (dc: any) =>
            Boolean(dc.signedChallanPath) &&
            (storeCodesList.length === 1 || String(dc.storeCode || dc.metadata?.storeCode || "").trim() === sc)
        );
      if (!hasWcc) {
        allWccComplete = false;
        break;
      }
    }
    wccStatus = allWccComplete ? "OK" : "Pending";
  }

  // 10. Photo Proof
  let photoStatus = "Pending";
  if (noOfStoresCount === 0) {
    if (packet.challans && packet.challans.length > 0) {
      const allPhotos = packet.challans.every((dc: any) => Boolean(dc.photoPath) || (Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0));
      photoStatus = allPhotos ? "OK" : "Pending";
    } else {
      photoStatus = "Not Applicable";
    }
  } else {
    let allPhotosComplete = true;
    for (const sc of storeCodesList) {
      const hasPhoto =
        (pages || []).some(
          p =>
            p.kind === "photo" &&
            (p.filePath || p.storagePath) &&
            (storeCodesList.length === 1 || String(p.storeCode || "").trim() === sc)
        ) ||
        (packet.executionDocuments || []).some(
          (d: any) =>
            ["photo", "installation_photo", "execution_photo", "completion_photo", "additional_photo"].includes(d.documentType) &&
            d.status !== "deleted" &&
            (d.filePath || d.storagePath) &&
            (storeCodesList.length === 1 || String(d.storeCode || "").trim() === sc)
        ) ||
        (packet.challans || []).some(
          (dc: any) =>
            (Boolean(dc.photoPath) || (Array.isArray(dc.metadata?.photos) && dc.metadata.photos.length > 0)) &&
            (storeCodesList.length === 1 || String(dc.storeCode || dc.metadata?.storeCode || "").trim() === sc)
        );
      if (!hasPhoto) {
        allPhotosComplete = false;
        break;
      }
    }
    photoStatus = allPhotosComplete ? "OK" : "Pending";
  }

  // 11. Transport Bill & 12. Transport Mode
  const hasTransportItem =
    (packet.estimateItems || []).some(
      (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
    ) ||
    (packet.invoice?.lineItems || []).some(
      (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
    );

  const hasTransportAmount =
    Number(packet.estimate?.transportAmount || 0) > 0 || Number(packet.invoice?.transportCost || 0) > 0;

  const hasStoreTransport = Object.values(packet.estimate?.storeGrouping || {}).some(
    (g: any) =>
      Number(g?.transportAmount) > 0 ||
      Number(g?.transportKm) > 0 ||
      (g?.transportType && g?.transportType !== "none" && g?.transportType !== "null")
  );

  const hasTransportDoc =
    (pages || []).some(
      p =>
        p.kind === "project" &&
        (p.filePath || p.storagePath) &&
        (p.label.toLowerCase().includes("transport") ||
          p.label.toLowerCase().includes("courier") ||
          p.label.toLowerCase().includes("lr copy") ||
          p.label.toLowerCase().includes("gate pass") ||
          p.label.toLowerCase().includes("eway"))
    ) ||
    (packet.executionDocuments || []).some(
      (d: any) =>
        ["transport_receipt", "lr_copy", "courier_receipt", "gate_pass", "eway_bill"].includes(d.documentType) &&
        d.status !== "deleted" &&
        (d.filePath || d.storagePath)
    ) ||
    (packet.challans || []).some((dc: any) => Boolean(dc.transportReceiptPath));

  const isTransportApplicable = hasTransportItem || hasTransportAmount || hasStoreTransport || hasTransportDoc;

  let transportBill = "Not Applicable";
  let transportMode = "Not Applicable";

  if (isTransportApplicable) {
    transportBill = hasTransportDoc ? "OK" : "Pending";

    let savedMode: string | null = null;
    // 1. Check storeGrouping
    for (const g of Object.values(packet.estimate?.storeGrouping || {}) as any[]) {
      if (g?.transportType === "outstation") {
        savedMode = "Outstation";
        break;
      }
      if (g?.transportType === "local") {
        savedMode = "Local";
      }
      if (g?.transportDescription && String(g.transportDescription).trim()) {
        savedMode = String(g.transportDescription).trim();
        break;
      }
    }

    // 2. Check estimate/invoice items
    if (!savedMode || savedMode === "Local") {
      const tItem = [...(packet.estimateItems || []), ...(packet.invoice?.lineItems || [])].find(
        (it: any) => it.lineType === "transport" || (it.itemName && it.itemName.toLowerCase().includes("transport"))
      );
      if (tItem) {
        const itemName = String(tItem.itemName || "").trim();
        const desc = String(tItem.description || "").trim();
        const unit = String(tItem.unit || "").trim().toLowerCase();
        if (unit === "km" || itemName.toLowerCase().includes("outstation") || desc.toLowerCase().includes("outstation")) {
          savedMode = "Outstation";
        } else if (itemName.toLowerCase().includes("local") || desc.toLowerCase().includes("local") || unit === "job") {
          savedMode = "Local";
        } else if (itemName) {
          savedMode = itemName;
        }
      }
    }

    // 3. Check deliveryChallans deliveredBy
    if (!savedMode) {
      const dcWithDelivered = (packet.challans || []).find((dc: any) => dc.deliveredBy && String(dc.deliveredBy).trim());
      if (dcWithDelivered) {
        savedMode = String(dcWithDelivered.deliveredBy).trim();
      }
    }

    transportMode = savedMode || "Local";
  }

  return [
    { field: "PO No", value: poNo },
    { field: "Invoice No", value: invoiceNo },
    { field: "Invoice Amt Post GST", value: invoiceAmtPostGst },
    { field: "Invoice Date", value: invoiceDate },
    { field: "Activity", value: activity },
    { field: "Store", value: store },
    { field: "Vendor", value: vendor },
    { field: "No of Stores", value: noOfStores },
    { field: "WCC", value: wccStatus },
    { field: "Photo Proof", value: photoStatus },
    { field: "Transport Bill", value: transportBill },
    { field: "Transport Mode", value: transportMode },
  ];
}

/**
 * Build the exact email-ready plain text summary.
 */
export function buildInvoiceSummaryEmailText(rows: InvoiceSummaryRow[]): string {
  const padField = (field: string) => {
    if (field === "Invoice Amt Post GST") return "Invoice Amt Post GST   ";
    if (field === "Transport Bill") return "Transport Bill ";
    if (field === "Transport Mode") return "Transport Mode ";
    return field.padEnd(13, " ");
  };

  const lines = [
    "Dear Sir / Madam,",
    "",
    "Attached is the invoice for your reference. Please let us know if you need any additional information.",
    "",
    "Kindly initiate the GRN process and notify us when it is completed.",
    "",
    ...rows.map(r => `${padField(r.field)}${r.value}`),
  ];
  return lines.join("\n");
}

/**
 * Build the HTML email summary for rich text clipboard pasting in Gmail/Outlook.
 */
export function buildInvoiceSummaryEmailHtml(rows: InvoiceSummaryRow[]): string {
  const escapeHtml = (val: any) =>
    String(val ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    }[ch] || ch));

  const tableRows = rows.map(r => `
    <tr>
      <td style="padding: 2px 24px 2px 0; font-weight: 600; color: #1e293b; white-space: nowrap; font-family: Arial, sans-serif;">${escapeHtml(r.field)}</td>
      <td style="padding: 2px 0; color: #0f172a; font-family: Arial, sans-serif;">${escapeHtml(r.value)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #0f172a;">
      <p style="margin: 0 0 12px 0;">Dear Sir / Madam,</p>
      <p style="margin: 0 0 12px 0;">Attached is the invoice for your reference. Please let us know if you need any additional information.</p>
      <p style="margin: 0 0 16px 0;">Kindly initiate the GRN process and notify us when it is completed.</p>
      <table style="border-collapse: collapse; font-size: 13px; font-family: Arial, sans-serif;">
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `.trim();
}

/**
 * Copy the complete invoice email summary to clipboard.
 * Supports both rich HTML and formatted plain text.
 */
export async function copyInvoiceSummaryToClipboard(
  packet: any,
  sellerProfile: any,
  pages?: any[]
): Promise<boolean> {
  if (!packet) return false;
  const rows = getInvoiceSummaryRows(packet, sellerProfile, pages);
  const plainText = buildInvoiceSummaryEmailText(rows);
  const html = buildInvoiceSummaryEmailHtml(rows);

  try {
    if (navigator.clipboard && "ClipboardItem" in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(plainText);
    }
    return true;
  } catch (err) {
    try {
      await navigator.clipboard.writeText(plainText);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Invoice Summary Document Component:
 * Dedicated Email Utility UI in Invoice Packet Builder.
 * Marked print:hidden so it is NEVER printed.
 */
const InvoiceSummaryDocument: React.FC<InvoiceSummaryDocumentProps> = ({
  packet,
  sellerProfile,
  pages,
  onCopySuccess,
}) => {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => getInvoiceSummaryRows(packet, sellerProfile, pages), [packet, sellerProfile, pages]);
  const emailText = useMemo(() => buildInvoiceSummaryEmailText(rows), [rows]);

  if (!packet) return null;

  const handleCopy = async () => {
    const ok = await copyInvoiceSummaryToClipboard(packet, sellerProfile, pages);
    if (ok) {
      setCopied(true);
      onCopySuccess?.();
      window.setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="invoice-summary-utility print:hidden bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden my-2">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-orange-600" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-800">Invoice Summary</h2>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                Email Utility Only
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Copy and paste directly into Gmail / Outlook for client handover. Not part of packet PDF or print.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied ✓" : "Copy Summary"}
          </button>
          {copied && <span className="text-xs font-bold text-emerald-600">Copied ✓</span>}
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="text-xs text-slate-700 bg-slate-50/70 border border-slate-200 rounded-lg p-3 leading-relaxed space-y-1">
          <p className="font-semibold text-slate-800">Dear Sir / Madam,</p>
          <p>Attached is the invoice for your reference. Please let us know if you need any additional information.</p>
          <p>Kindly initiate the GRN process and notify us when it is completed.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="py-2 px-3 font-semibold text-slate-600 border-b border-slate-100 w-1/3 whitespace-nowrap">
                    {row.field}
                  </td>
                  <td className="py-2 px-3 text-slate-900 font-mono font-medium border-b border-slate-100">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pt-2 flex items-center justify-between text-xs text-slate-400 border-t border-slate-100">
          <span>Click "Copy Summary" to copy the exact text formatted for email.</span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-emerald-700 hover:text-emerald-800 font-bold hover:underline"
          >
            {copied ? "Copied ✓" : "Copy to Clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceSummaryDocument;
