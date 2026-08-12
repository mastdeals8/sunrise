// InvoiceDocument is the single React renderer for invoice preview,
// browser print/PDF export, and the invoice page inside Invoice Packet.
// It mirrors the Sunrise Media Estimate visual language (black borders,
// Arial, orange brand footer, bank details, signature stamp) so the two
// documents are recognisable sister documents.

import React, { useState } from "react";
import { formatProductDetails } from "../../../shared/productDetails";
import { isServiceLineType } from "../pages/operations/utils/estimateCalculations";
import { companyAssetUrl } from "../utils/companyAssets";

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
    ? <div style={{ fontWeight: 900, fontSize: "22px", lineHeight: 1.1, textAlign: "right" }}>{companyName}</div>
    : <img src={src} alt={companyName} onError={() => setFailed(true)} style={{ width: 230, maxWidth: "100%", height: "auto", objectFit: "contain" }} />;
};

const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ invoice: inv, estimate: est, estimateItems = [], client, sellerProfile = {}, assetToken: token }) => {
  const sourceLines = estimateItems.length ? estimateItems : (inv.lineItems || []);
  const lines = sourceLines.filter((row: any) => !isServiceLineType(row.lineType));
  const subtotal = Number(inv.amount ?? lines.reduce((sum: number, row: any) => sum + Number(row.amount ?? row.totalPrice ?? Number(row.quantity || 0) * Number(row.rate || 0)), 0));
  const totalTax = Number(inv.taxAmount ?? Math.max(0, Number(inv.totalAmount || 0) - subtotal));
  const isIgst = Boolean(est?.gstType === "IGST" || (est?.igstAmount && Number(est.igstAmount) > 0));
  const igst = isIgst ? totalTax : 0;
  const cgst = isIgst ? 0 : Number(est?.cgstAmount ?? totalTax / 2);
  const sgst = isIgst ? 0 : Number(est?.sgstAmount ?? totalTax - cgst);
  const grandTotal = Number(inv.totalAmount || subtotal + cgst + sgst + igst);

  const companyName = sellerProfile?.name || sellerProfile?.companyName || "Sunrise Media";
  const companyAddress = sellerProfile?.address || "";
  const companyEmail = sellerProfile?.email || "";
  const companyMobile = sellerProfile?.mobile || "";
  const logoSrc = companyAssetUrl(sellerProfile?.logoPath, token);
  const signatureStampSrc = companyAssetUrl(sellerProfile?.signatureStampPath, token);

  const billingName = est?.billingLegalNameSnapshot || inv.partyName || client?.name || "";
  const billingAddress = est?.billingAddressSnapshot || client?.address || "";
  const billingGstin = est?.billingGstinSnapshot || client?.gstin || "";
  const billingStateCode = est?.billingStateCodeSnapshot || "";

  const shippingRaw = est?.shippingAddressSnapshot || est?.shippingTo || "";
  const shippingHasOwn = shippingRaw.trim().length > 0;
  let shippingName = billingName;
  let shippingAddress = billingAddress;
  if (shippingHasOwn) {
    const shipLines = shippingRaw.split("\n").map((s: string) => s.trim()).filter(Boolean);
    if (shipLines.length > 0 && /^M\/S\s*:/i.test(shipLines[0])) {
      shippingName = shipLines[0].replace(/^M\/S\s*:?\s*/i, "").trim();
      shippingAddress = shipLines.slice(1).join("\n");
    } else {
      shippingAddress = shippingRaw;
    }
  }

  const dateStr = inv.date
    ? new Date(inv.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";
  const dueDateStr = inv.dueDate
    ? new Date(inv.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
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

  // 6 columns: Sr, Product Name, Description, Total Sqft, Qty, Rate, Amount
  const COL_COUNT = 7;
  const columnWidths = ["4%", "20%", "30%", "11%", "7%", "11%", "17%"];

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
      {/* Document header — identical layout to the estimate */}
      <table className="invoice-document-header" style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr style={{ verticalAlign: "top" }}>
            <td style={{ padding: "8px 12px", fontSize: "11px", lineHeight: 1.45, width: "60%" }}>
              <div style={{ fontWeight: 700 }}>Billing To</div>
              <div style={{ fontWeight: 700 }}>M/S : {billingName}</div>
              {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{billingAddress}</div>}
              {billingStateCode && <div>State Code: {billingStateCode}</div>}
              {billingGstin && <div style={{ fontWeight: 700 }}>GSTN - {billingGstin}</div>}
              <div style={{ marginTop: "10px", fontWeight: 700 }}>Shipping To</div>
              <div style={{ fontWeight: 700 }}>M/S : {shippingName}</div>
              {shippingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{shippingAddress}</div>}
            </td>
            <td style={{ padding: "8px 12px", width: "40%", textAlign: "right", fontSize: "11px", verticalAlign: "top" }}>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <InvoiceLogo src={logoSrc} companyName={companyName} />
              </div>
              <table style={{ marginTop: "18px", marginLeft: "auto", borderCollapse: "collapse", tableLayout: "fixed", width: "262px" }}>
                <tbody>
                  {metaRow("Date :", dateStr)}
                  {metaRow("Inv - No -", inv.invoiceNumber, true)}
                  {dueDateStr && metaRow("Due Date -", dueDateStr)}
                  {inv.poNumber && metaRow("PO No -", inv.poNumber)}
                  {sellerProfile?.gstin && metaRow("GSTN -", sellerProfile.gstin)}
                  {sellerProfile?.pan && metaRow("PAN -", sellerProfile.pan)}
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
            <td colSpan={COL_COUNT} style={{ ...cellCenter, fontWeight: 700, padding: "4px 8px" }}>
              Subject : {est?.subject || est?.title || ""}
            </td>
          </tr>
          <tr>
            <td style={headCell} rowSpan={2}>Sr.</td>
            <td style={headCell} rowSpan={2}>Product Name</td>
            <td style={headCell} rowSpan={2}>Description</td>
            <td style={headCell}>Total Sq.Ft</td>
            <td style={headCell}>Qty</td>
            <td style={headCell} rowSpan={2}>Rate</td>
            <td style={headCell} rowSpan={2}>Amount</td>
          </tr>
          <tr>
            <td style={headCell}>&nbsp;</td>
            <td style={headCell}>&nbsp;</td>
          </tr>
        </thead>
        <tbody>
          {lines.map((row: any, index: number) => {
            const qty = Number(row.quantity || 0);
            const rate = Number(row.rate || 0);
            const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
            const totalSqft = Number(row.totalSize ?? row.totalSqft ?? 0);
            return (
              <tr key={row.id || index}>
                <td style={cellCenter}>{index + 1}</td>
                <td style={{ ...cellBase, fontWeight: 600 }}>{row.itemName || row.productName || "Item"}</td>
                <td style={cellBase}>{formatProductDetails(null, row.description || "", row.itemName || "")}</td>
                <td style={cellRight}>{totalSqft > 0 ? totalSqft.toFixed(2) : ""}</td>
                <td style={cellCenter}>{qty}</td>
                <td style={cellRight}>{num(rate)}</td>
                <td style={{ ...cellRight, fontWeight: 600 }}>{num(amount)}</td>
              </tr>
            );
          })}
          {/* Totals */}
          <tr style={{ backgroundColor: "#fff066" }}>
            <td colSpan={5} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>TOTAL AMOUNT BEFORE TAX</td>
            <td style={cellBase}></td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(subtotal)}</td>
          </tr>
          {isIgst ? (
            <tr>
              <td colSpan={5} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : IGST 18%</td>
              <td style={cellBase}></td>
              <td style={{ ...cellRight, fontWeight: 700 }}>{num(igst)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={5} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : CGST 9%</td>
                <td style={cellBase}></td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(cgst)}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>Add : SGST 9%</td>
                <td style={cellBase}></td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sgst)}</td>
              </tr>
            </>
          )}
          <tr>
            <td colSpan={5} style={{ ...cellBase, fontWeight: 700, textAlign: "right", paddingRight: "10px" }}>TOTAL AMOUNT AFTER TAX</td>
            <td style={cellBase}></td>
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
