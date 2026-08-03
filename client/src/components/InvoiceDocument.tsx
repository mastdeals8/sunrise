import React, { useState } from "react";
import { formatCurrency } from "@/utils/format";
import { companyAssetUrl } from "../utils/companyAssets";
import { isServiceLineType } from "../pages/operations/utils/estimateCalculations";

export interface InvoiceDocumentProps {
  invoice: any;
  estimate?: any;
  estimateItems?: any[];
  client?: any;
  sellerProfile?: any;
  assetToken?: string | null;
}

const amountInWords = (num: number): string => {
  if (!num) return "Zero Only";
  const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const padded = ("000000000" + Math.floor(num)).slice(-9);
  const match = padded.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return "";
  const words = (value: string) => a[Number(value)] || `${b[Number(value[0])]} ${a[Number(value[1])]}`;
  let result = "";
  if (Number(match[1])) result += `${words(match[1])}Crore `;
  if (Number(match[2])) result += `${words(match[2])}Lakh `;
  if (Number(match[3])) result += `${words(match[3])}Thousand `;
  if (Number(match[4])) result += `${a[Number(match[4])]}Hundred `;
  if (Number(match[5])) result += `${result ? "and " : ""}${words(match[5])}`;
  return `${result.trim()} Only`;
};

const InvoiceLogo: React.FC<{ src: string; companyName: string }> = ({ src, companyName }) => {
  const [failed, setFailed] = useState(!src);
  return failed
    ? <div className="font-black text-lg uppercase">{companyName}</div>
    : <img src={src} alt={companyName} onError={() => setFailed(true)} className="h-14 w-auto max-w-[180px] object-contain" />;
};

const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ invoice: inv, estimate: est, estimateItems = [], client, sellerProfile = {}, assetToken }) => {
  const sourceLines = estimateItems.length ? estimateItems : (inv.lineItems || []);
  const lines = sourceLines.filter((row: any) => !isServiceLineType(row.lineType));
  const subtotal = Number(inv.amount ?? lines.reduce((sum: number, row: any) => sum + Number(row.amount ?? row.totalPrice ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
  const totalTax = Number(inv.taxAmount ?? Math.max(0, Number(inv.totalAmount || 0) - subtotal));
  const igst = Number(est?.igstAmount || 0) > 0 ? totalTax : 0;
  const cgst = igst ? 0 : Number(est?.cgstAmount ?? totalTax / 2);
  const sgst = igst ? 0 : Number(est?.sgstAmount ?? totalTax - cgst);
  const beforeRound = subtotal + cgst + sgst + igst;
  const roundOff = Number((Number(inv.totalAmount || beforeRound) - beforeRound).toFixed(2));
  const companyName = sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media";
  const logoSrc = companyAssetUrl(sellerProfile?.logoPath, assetToken);

  return <article className="invoice-print a4-sheet bg-white text-slate-900" data-source="invoice-print" data-print-document="true">
    <header className="flex justify-between gap-6 border-b-2 border-slate-900 pb-4">
      <div className="flex gap-3 items-start">
        <InvoiceLogo src={logoSrc} companyName={companyName} />
        <div><h1 className="text-lg font-black uppercase">{companyName}</h1><p className="text-[10px] whitespace-pre-line">{sellerProfile?.address || sellerProfile?.registeredAddress || ""}</p><p className="text-[10px]">GSTIN: {sellerProfile?.gstin || "—"}</p></div>
      </div>
      <div className="text-right"><h2 className="text-2xl font-black tracking-widest">INVOICE</h2><p className="font-mono font-bold mt-2">{inv.invoiceNumber}</p><p className="text-xs">Date: {inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</p></div>
    </header>
    <section className="grid grid-cols-2 gap-6 py-4 border-b border-slate-300 text-xs">
      <div><p className="text-[10px] uppercase font-bold text-slate-500">Bill To</p><p className="font-bold text-sm">{inv.partyName}</p><p className="whitespace-pre-line">{est?.billingAddressSnapshot || client?.address || ""}</p><p>GSTIN: {est?.billingGstinSnapshot || client?.gstin || "—"}</p></div>
      <div className="grid grid-cols-2 gap-x-3 content-start"><span className="text-slate-500">PO Number</span><b>{inv.poNumber || est?.poNumber || "—"}</b><span className="text-slate-500">Due Date</span><b>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}</b><span className="text-slate-500">Place of Supply</span><b>{est?.billingStateSnapshot || client?.state || "—"}</b></div>
    </section>
    <table className="w-full text-[11px] invoice-lines mt-4">
      <thead><tr><th>Sr.</th><th className="text-left">Product Name</th><th className="text-left">Description</th><th>Total Sq.Ft</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>{lines.map((row: any, index: number) => {
        const qty = Number(row.quantity || 0); const rate = Number(row.rate || 0); const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
        return <tr key={row.id || index}><td>{index + 1}</td><td className="text-left font-semibold">{row.itemName || row.productName || "Item"}</td><td className="text-left whitespace-pre-wrap">{row.description || "—"}</td><td>{Number(row.totalSize ?? row.totalSqft ?? 0).toFixed(2)}</td><td>{qty}</td><td className="text-right">{formatCurrency(rate)}</td><td className="text-right font-semibold">{formatCurrency(amount)}</td></tr>;
      })}</tbody>
    </table>
    <section className="ml-auto mt-4 w-full max-w-sm text-xs summary-table">
      <div><span>Subtotal</span><b>{formatCurrency(subtotal)}</b></div>
      {cgst > 0 && <div><span>CGST</span><b>{formatCurrency(cgst)}</b></div>}
      {sgst > 0 && <div><span>SGST</span><b>{formatCurrency(sgst)}</b></div>}
      {igst > 0 && <div><span>IGST</span><b>{formatCurrency(igst)}</b></div>}
      {roundOff !== 0 && <div><span>Round Off</span><b>{formatCurrency(roundOff)}</b></div>}
      <div className="grand"><span>Grand Total</span><b>{formatCurrency(inv.totalAmount || beforeRound + roundOff)}</b></div>
    </section>
    <p className="mt-4 border-t border-slate-300 pt-3 text-xs"><b>Amount in words:</b> {amountInWords(inv.totalAmount || 0)}</p>
    {inv.remarks && <p className="mt-2 text-xs"><b>Remarks:</b> {inv.remarks}</p>}
    <footer className="mt-12 text-right text-xs"><p>For <b>{companyName.toUpperCase()}</b></p><div className="h-12"/><p className="font-bold">Authorised Signatory</p></footer>
  </article>;
};

export default InvoiceDocument;
