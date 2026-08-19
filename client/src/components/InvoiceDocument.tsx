// InvoiceDocument is the single React renderer for invoice preview,
// browser print/PDF export, and the invoice page inside Invoice Packet.
// It is the canonical Sunrise Media Tax Invoice for preview, print/PDF, and
// invoice packets. Saved invoice values remain the commercial source of truth.

import React, { useState } from "react";
import { formatProductDetails } from "../../../shared/productDetails";
import { companyAssetUrl } from "../utils/companyAssets";

export interface InvoiceDocumentProps {
  invoice: any;
  estimate?: any;
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

const InvoiceLogo: React.FC<{ src: string; companyName: string; maxWidth?: number }> = ({ src, companyName, maxWidth = 230 }) => {
  const [failed, setFailed] = useState(!src);
  return failed
    ? <div style={{ fontWeight: 900, fontSize: "22px", lineHeight: 1.1, textAlign: "right" }}>{companyName}</div>
    : <img src={src} alt={companyName} onError={() => setFailed(true)} style={{ width: maxWidth, maxWidth: "100%", height: "auto", objectFit: "contain" }} />;
};

const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ invoice: inv, estimate: est, client, sellerProfile = {}, assetToken: token }) => {
  // Saved invoice lines are the sole commercial source for invoice preview,
  // print and packet rendering. Estimate rows are not a fallback here.
  const lines = Array.isArray(inv.lineItems || inv.line_items) ? (inv.lineItems || inv.line_items) : [];
  const subtotal = Number(inv.amount ?? lines.reduce((sum: number, row: any) => sum + Number(row.amount ?? row.totalPrice ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
  const totalTax = Number(inv.taxAmount ?? Math.max(0, Number(inv.totalAmount || 0) - subtotal));
  const componentTax = lines.reduce((totals: { cgst: number; sgst: number; igst: number }, row: any) => ({
    cgst: totals.cgst + Number(row.cgstAmount ?? row.cgst_amount ?? 0),
    sgst: totals.sgst + Number(row.sgstAmount ?? row.sgst_amount ?? 0),
    igst: totals.igst + Number(row.igstAmount ?? row.igst_amount ?? 0),
  }), { cgst: 0, sgst: 0, igst: 0 });
  const hasComponentTax = componentTax.cgst !== 0 || componentTax.sgst !== 0 || componentTax.igst !== 0;
  const isIgst = hasComponentTax ? componentTax.igst > 0 : Boolean(est?.gstType === "IGST" || (est?.igstAmount && Number(est.igstAmount) > 0));
  const componentTotal = componentTax.cgst + componentTax.sgst + componentTax.igst;
  const useSavedComponents = hasComponentTax && Math.abs(componentTotal - totalTax) < 0.01;
  const igst = useSavedComponents ? componentTax.igst : (isIgst ? totalTax : 0);
  const cgst = useSavedComponents ? componentTax.cgst : (isIgst ? 0 : totalTax / 2);
  const sgst = useSavedComponents ? componentTax.sgst : (isIgst ? 0 : totalTax - cgst);
  const grandTotal = Number(inv.totalAmount || subtotal + cgst + sgst + igst);

  const companyName = sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media";
  const companyAddress = sellerProfile?.address || "";
  const companyEmail = sellerProfile?.email || "";
  const companyMobile = sellerProfile?.mobile || "";
  const sellerGstin = sellerProfile?.gstin || "27ABZFS5736R1ZR";
  const logoSrc = companyAssetUrl(sellerProfile?.logoPath, token);
  const signatureStampSrc = companyAssetUrl(sellerProfile?.signatureStampPath, token);

  const billingName = est?.billingLegalNameSnapshot || inv.partyName || client?.name || "";
  const billingAddress = est?.billingAddressSnapshot || client?.address || "";
  const billingGstin = est?.billingGstinSnapshot || est?.gstin || client?.gstin || client?.gstNumber || "";
  const billingStateCode = est?.billingStateCodeSnapshot || "";
  const billingPan = est?.pan || client?.pan || "";
  const poNumber = inv.poNumber || est?.poNumber || "";
  const poDateValue = inv.poDate || inv.po_date || est?.poDate || est?.po_date || "";

  const dateStr = inv.date
    ? new Date(inv.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";
  const poDateStr = poDateValue
    ? new Date(poDateValue).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";

  const termsLines = String(sellerProfile?.terms || "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the meterial.\n3. Transportation charges As per Actual.\n4. Any additional work / rework will be extra.")
    .split(/\n+/)
    .map((line: string) => line.trim())
    .filter(Boolean);

  // Inline styles — same paradigm as EstimateDocument, so they survive
  // print without depending on Tailwind classes.
  const cellBase: React.CSSProperties = { border: "1px solid #000", padding: "3px 5px", fontSize: "10px", lineHeight: 1.3, verticalAlign: "top" };
  const cellRight: React.CSSProperties = { ...cellBase, textAlign: "right" };
  const cellCenter: React.CSSProperties = { ...cellBase, textAlign: "center" };
  const headCell: React.CSSProperties = { ...cellBase, fontWeight: 700, textAlign: "center", backgroundColor: "#fff" };

  // Controlled Tax Invoice columns: descriptions may wrap while commercial
  // values stay aligned in their own cells for browser print and packets.
  const COL_COUNT = 8;
  const columnWidths = ["4%", "23%", "27%", "10%", "7%", "8%", "10%", "11%"];

  const metaLabelCell: React.CSSProperties = {
    padding: "1px 8px 1px 0",
    textAlign: "left",
    whiteSpace: "nowrap",
    width: "92px",
    verticalAlign: "top",
  };
  const metaValueCell: React.CSSProperties = {
    textAlign: "left",
    width: "170px",
    maxWidth: "170px",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.25,
    verticalAlign: "top",
  };
  const metaRow = (label: string, value: React.ReactNode, bold = false) => (
    <tr>
      <td style={metaLabelCell}>{label}</td>
      <td style={{ ...metaValueCell, fontWeight: bold ? 700 : undefined }}>{value}</td>
    </tr>
  );

  return (
    <div
      className="invoice-print"
      data-source="invoice-print"
      data-print-document="true"
      style={{ background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {/* Tax Invoice header. No Ship To block: Sunrise invoices bill the client directly. */}
      <table className="invoice-document-header" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          <tr>
            <td colSpan={2} style={{ border: "1px solid #000", padding: "7px 10px", textAlign: "center", fontSize: "15px", fontWeight: 800, letterSpacing: "0.6px" }}>
              TAX INVOICE
            </td>
          </tr>
          <tr style={{ verticalAlign: "top" }}>
            <td style={{ border: "1px solid #000", padding: "8px 10px", fontSize: "10px", lineHeight: 1.4, width: "57%" }}>
              <div style={{ fontWeight: 800, marginBottom: "3px" }}>Bill To</div>
              <div style={{ fontWeight: 700 }}>M/S : {billingName}</div>
              {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{billingAddress}</div>}
              {billingStateCode && <div>State Code: {billingStateCode}</div>}
              {billingGstin && <div style={{ fontWeight: 700 }}>GSTIN : {billingGstin}</div>}
              {billingPan && <div style={{ fontWeight: 700 }}>PAN : {billingPan}</div>}
            </td>
            <td style={{ border: "1px solid #000", padding: "8px 10px", width: "43%", textAlign: "right", fontSize: "10px", verticalAlign: "top" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <div style={{ textAlign: "left", fontWeight: 800, whiteSpace: "nowrap" }}>GST/UIN : {sellerGstin}</div>
                <InvoiceLogo src={logoSrc} companyName={companyName} maxWidth={155} />
              </div>
              <table style={{ marginTop: "12px", marginLeft: "auto", borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
                <tbody>
                  {metaRow("Invoice / Bill No. :", inv.invoiceNumber, true)}
                  {metaRow("Bill Date :", dateStr)}
                  {poNumber && metaRow("PO No. :", poNumber)}
                  {poDateStr && metaRow("PO Date :", poDateStr)}
                  {(est?.subject || est?.title) && metaRow("Job :", est?.subject || est?.title)}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Invoice table */}
      <table className="invoice-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: "4px" }}>
        <colgroup>
          {columnWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            <td style={headCell}>Sr.</td>
            <td style={headCell}>Item</td>
            <td style={headCell}>Description / Dimensions</td>
            <td style={headCell}>HSN / SAC</td>
            <td style={headCell}>GST %</td>
            <td style={headCell}>Quantity</td>
            <td style={headCell}>Rate</td>
            <td style={headCell}>Amount</td>
          </tr>
        </thead>
        <tbody>
          {lines.map((row: any, index: number) => {
            const qty = Number(row.quantity || 0);
            const rate = Number(row.rate || 0);
            const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
            const totalSqft = Number(row.totalSize ?? row.totalSqft ?? 0);
            const dimensions = row.width != null && row.height != null
              ? `W ${Number(row.width).toFixed(2)} × H ${Number(row.height).toFixed(2)}${totalSqft > 0 ? ` · ${totalSqft.toFixed(2)} Sq.Ft` : ""}`
              : totalSqft > 0 ? `${totalSqft.toFixed(2)} Sq.Ft` : "";
            const description = [formatProductDetails(null, row.description || "", row.itemName || ""), dimensions].filter(Boolean).join("\n");
            const taxPercent = Number(row.taxPercent ?? row.gstPercent ?? row.gst_percent ?? 0);
            return (
              <tr key={row.id || index}>
                <td style={cellCenter}>{index + 1}</td>
                <td style={{ ...cellBase, fontWeight: 600 }}>{row.itemName || row.productName || "Item"}</td>
                <td style={{ ...cellBase, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{description}</td>
                <td style={cellCenter}>{row.hsn || ""}</td>
                <td style={cellRight}>{taxPercent > 0 ? `${taxPercent}%` : ""}</td>
                <td style={cellRight}>{qty}{row.unit ? ` ${row.unit}` : ""}</td>
                <td style={cellRight}>{num(rate)}</td>
                <td style={{ ...cellRight, fontWeight: 600 }}>{num(amount)}</td>
              </tr>
            );
          })}
          {/* Totals */}
          <tr style={{ backgroundColor: "#fff066" }}>
            <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>TOTAL AMOUNT BEFORE TAX</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(subtotal)}</td>
          </tr>
          {isIgst ? (
            <tr>
              <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : IGST</td>
              <td style={{ ...cellRight, fontWeight: 700 }}>{num(igst)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : CGST</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(cgst)}</td>
              </tr>
              <tr>
                <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : SGST</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sgst)}</td>
              </tr>
            </>
          )}
          <tr>
            <td colSpan={7} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>GRAND TOTAL</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* Amount in words */}
      <div style={{ marginTop: "6px", fontSize: "10px", fontWeight: 700 }}>
        Rupees : {amountInWords(grandTotal)}
      </div>

      {/* Footer — identical structure to the estimate */}
      <div className="invoice-footer-block" style={{ marginTop: "8px" }}>
        <table className="invoice-document-footer" style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ ...cellBase, padding: "8px 10px", width: "38%" }}>
                <div style={{ color: "#b91c1c", fontWeight: 700, textDecoration: "underline", marginBottom: "4px" }}>Terms &amp; Condition :</div>
                {termsLines.map((line: string, idx: number) => <div key={idx}>{line}</div>)}
              </td>
              <td style={{ ...cellBase, padding: "8px 10px", width: "34%" }}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>BANK ACCOUNT DETAILS</div>
                <div>Bank Name : {sellerProfile?.bankName || ""}</div>
                <div>Branch Name : {sellerProfile?.bankBranch || ""}</div>
                <div>C.A/c No : {sellerProfile?.bankAccountNumber || ""}</div>
                <div>IFSC NO : {sellerProfile?.bankIfsc || ""}</div>
              </td>
              <td style={{ ...cellBase, padding: "8px 10px", width: "28%", textAlign: "right", verticalAlign: "bottom" }}>
                <div style={{ fontWeight: 700 }}>For {companyName.toUpperCase()}</div>
                <div style={{ height: "52px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {signatureStampSrc && (
                    <img
                      src={signatureStampSrc}
                      alt="Signature and stamp"
                      style={{ maxHeight: "48px", maxWidth: "150px", objectFit: "contain" }}
                    />
                  )}
                </div>
                <div style={{ fontWeight: 700 }}>Authorised Signatory</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ backgroundColor: "#f59e0b", color: "#fff", textAlign: "center", padding: "6px 8px", letterSpacing: "0.3px" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "1.5px", lineHeight: 1.1 }}>{companyName.toUpperCase()}</div>
          {companyAddress && <div style={{ fontSize: "9px", marginTop: "3px", lineHeight: 1.25 }}>{companyAddress}</div>}
          {(companyMobile || companyEmail) && <div style={{ fontSize: "9px", marginTop: "1px", lineHeight: 1.25 }}>{[companyMobile, companyEmail].filter(Boolean).join("  ·  ")}</div>}
        </div>
      </div>
    </div>
  );
};

export default InvoiceDocument;
