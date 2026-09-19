// InvoiceDocument is the canonical Sunrise Media Tax Invoice renderer for
// preview, browser print/PDF export, and the invoice page inside Invoice Packet.
// It implements clean A4 multi-page pagination with running headers and footers.

import React, { useEffect, useMemo, useState } from "react";
import { companyAssetUrl } from "../utils/companyAssets";
import { orderedStoreKeysFromGrouping } from "../pages/operations/utils/estimateOrdering";

export interface InvoiceDocumentProps {
  invoice: any;
  estimate?: any;
  client?: any;
  sellerProfile?: any;
  assetToken?: string | null;
  products?: any[];
  stores?: any[];
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

const useDataUrl = (url: string): { dataUrl: string; ready: boolean } => {
  const [dataUrl, setDataUrl] = useState("");
  const [ready, setReady] = useState(!url);

  useEffect(() => {
    if (!url) { setReady(true); return; }
    let cancelled = false;
    setReady(false);
    fetch(url, { mode: "cors" })
      .then(res => { if (!res.ok) throw new Error("fetch failed"); return res.blob(); })
      .then(blob => {
        if (cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          if (cancelled) return;
          const result = reader.result as string;
          if (result) setDataUrl(result);
          setReady(true);
        };
        reader.onerror = () => { if (!cancelled) setReady(true); };
        reader.readAsDataURL(blob);
      })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [url]);

  return { dataUrl: dataUrl || url, ready };
};

const InvoiceLogo: React.FC<{ src: string; companyName: string; maxWidth?: number }> = ({ src, companyName, maxWidth = 185 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const effectiveSrc = src || "/brand/logo.png";
  return failed ? (
    <div style={{ fontWeight: 900, fontSize: "18px", lineHeight: 1.1 }}>{companyName}</div>
  ) : (
    <img
      src={effectiveSrc}
      alt={companyName}
      onError={() => setFailed(true)}
      style={{ width: maxWidth, maxWidth: "100%", height: "auto", maxHeight: "42px", objectFit: "contain", display: "block" }}
    />
  );
};

const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PlaceholderNames = new Set(["all", "alll", "item", "", "-", "n/a", "na"]);
const resolveItemName = (row: any, products: any[]): string => {
  const saved = String(row.itemName ?? row.item_name ?? row.productName ?? row.product_name ?? "").trim();
  if (saved && !PlaceholderNames.has(saved.toLowerCase())) return saved;
  const productId = Number(row.productId ?? row.product_id ?? 0);
  if (productId) {
    const product = products.find((p: any) => Number(p.id) === productId);
    if (product?.name) return product.name;
  }
  return saved || "Item";
};

interface StoreGroup {
  storeCode: string;
  storeName: string;
  items: any[];
}


const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({
  invoice: inv,
  estimate: est,
  client,
  sellerProfile = {},
  assetToken: token,
  products = [],
  stores = [],
}) => {
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

  const logoUrl = companyAssetUrl(sellerProfile?.logoPath || "/brand/file-1780929283382-585314307.png", token);
  const { dataUrl: logoDataUrl, ready: logoReady } = useDataUrl(logoUrl);
  const sigUrl = companyAssetUrl(sellerProfile?.signatureStampPath || "/brand/file-1780897714393-225895475.png", token);
  const { dataUrl: sigDataUrl, ready: sigReady } = useDataUrl(sigUrl);

  useEffect(() => {
    if (logoReady && sigReady) {
      document.documentElement.setAttribute("data-invoice-images-ready", "true");
    }
  }, [logoReady, sigReady]);

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

  const storeGroups = useMemo<StoreGroup[]>(() => {
    const storeByCode = new Map<string, any>();
    (stores || []).forEach((s: any) => {
      const code = String(s.storeCode || s.code || "").trim();
      if (code) storeByCode.set(code, s);
    });

    const estimateGrouping = (est?.storeGrouping || {}) as Record<string, any>;
    const orderedSids = orderedStoreKeysFromGrouping(estimateGrouping);
    const slToStoreCode = new Map<number, string>();
    const sidToStoreCode = new Map<string, string>();
    orderedSids.forEach(sid => {
      const s = (stores || []).find((st: any) => st.id === Number(sid));
      const code = String(s?.storeCode || s?.code || "").trim();
      if (code) {
        sidToStoreCode.set(sid, code);
        const groupData = estimateGrouping[sid];
        const itemSls: number[] = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
        itemSls.forEach((sl: any) => {
          const parsed = Number(sl);
          if (Number.isFinite(parsed)) slToStoreCode.set(parsed, code);
        });
      }
    });

    const orderedStoreCodes = orderedSids.map(sid => sidToStoreCode.get(sid)).filter(Boolean) as string[];

    const groups: StoreGroup[] = [];
    const seenCodes: string[] = [];

    const ensureGroup = (code: string) => {
      if (seenCodes.includes(code)) return;
      seenCodes.push(code);
      const store = storeByCode.get(code);
      const storeName = store?.name || code || "Store";
      const city = String(store?.city || "").trim();
      const fullStoreName = city && !storeName.toLowerCase().includes(city.toLowerCase())
        ? `${storeName}, ${city}`
        : storeName;
      groups.push({
        storeCode: code,
        storeName: fullStoreName,
        items: [],
      });
    };

    orderedStoreCodes.forEach(code => ensureGroup(code));

    lines.forEach((line: any) => {
      let code = String(line.storeCode ?? line.store_code ?? "").trim();
      if (!code) {
        const sl = Number(line.sl ?? 0);
        if (sl > 0 && slToStoreCode.has(sl)) {
          code = slToStoreCode.get(sl)!;
        }
      }
      ensureGroup(code);
      const group = groups.find(g => g.storeCode === code);
      if (group) group.items.push(line);
    });

    return groups.filter(g => g.items.length > 0);
  }, [lines, stores, est]);

  const hasStoreHeadings = storeGroups.length > 1 || (storeGroups.length === 1 && storeGroups[0].storeCode !== "" && storeGroups[0].storeCode !== "default");

  let itemCounter = 0;

  const subjectText = String(est?.subject || inv.subject || est?.title || inv.title || "").trim();

  // Column widths: Item has enough space for full text on one line; Description wraps
  // Sr(4%) Item(24%) Description(25%) HSN(8%) Total Sqft(8%) Qty(5%) Rate(12%) Amount(14%)
  const columnWidths = ["4%", "24%", "25%", "8%", "8%", "5%", "12%", "14%"];
  const COL_COUNT = 8;

  const cellBase: React.CSSProperties = {
    border: "1px solid #000",
    padding: "5.5px 7px",
    fontSize: "9.5px",
    lineHeight: 1.35,
    verticalAlign: "middle",
    fontWeight: 400,
  };
  const cellLeft: React.CSSProperties = { ...cellBase, textAlign: "left" };
  const cellRight: React.CSSProperties = { ...cellBase, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const cellCenter: React.CSSProperties = { ...cellBase, textAlign: "center" };
  const headCell: React.CSSProperties = {
    ...cellBase,
    fontWeight: 700,
    textAlign: "center",
    verticalAlign: "middle",
    backgroundColor: "#fff",
  };

  const storeHeadingStyle: React.CSSProperties = {
    ...cellBase,
    fontWeight: 600,
    backgroundColor: "#f1f5f9",
    padding: "5px 8px",
    fontSize: "9.5px",
    textAlign: "center",
  };

  const metaLabelCell: React.CSSProperties = {
    padding: "1px 6px 1px 0",
    textAlign: "left",
    whiteSpace: "nowrap",
    verticalAlign: "top",
    fontSize: "10px",
  };
  const metaValueCell: React.CSSProperties = {
    textAlign: "left",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.25,
    verticalAlign: "top",
    fontSize: "10px",
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
      style={{
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Top Header: Logo, GST/UIN, TAX INVOICE title, Bill To, Ship To, Metadata */}
      <table className="invoice-document-header" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          {/* Logo row - spans all 3 columns */}
          <tr>
            <td colSpan={3} style={{ border: "1px solid #000", padding: "6px 10px" }}>
              <InvoiceLogo src={logoDataUrl} companyName={companyName} maxWidth={200} />
            </td>
          </tr>
          {/* GST/UIN row - spans all 3 columns */}
          <tr>
            <td colSpan={3} style={{ border: "1px solid #000", padding: "4px 10px", textAlign: "center", fontSize: "11px", fontWeight: 800 }}>
              GST / UIN : {sellerGstin}
            </td>
          </tr>
          {/* TAX INVOICE row - spans all 3 columns */}
          <tr>
            <td colSpan={3} style={{ border: "1px solid #000", padding: "5px 10px", textAlign: "center", fontSize: "14px", fontWeight: 800, letterSpacing: "0.5px" }}>
              TAX INVOICE
            </td>
          </tr>
          {/* Bill To (left 37%) | Ship To (middle 37%) | Invoice metadata (right 26%) */}
          <tr style={{ verticalAlign: "top" }}>
            <td style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "9.5px", lineHeight: 1.35, width: "37%" }}>
              <div style={{ fontWeight: 800, marginBottom: "2px" }}>Bill To,</div>
              <div style={{ fontWeight: 700 }}>{billingName}</div>
              {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{billingAddress}</div>}
              {billingStateCode && <div>State : {billingStateCode === "27" ? "Maharashtra" : billingStateCode}</div>}
              {billingGstin && <div style={{ fontWeight: 700 }}>GSTIN : {billingGstin}</div>}
              {billingPan && <div>PAN : {billingPan}</div>}
            </td>
            <td style={{ border: "1px solid #000", padding: "6px 8px", fontSize: "9.5px", lineHeight: 1.35, width: "37%" }}>
              <div style={{ fontWeight: 800, marginBottom: "2px" }}>Ship To,</div>
              <div style={{ fontWeight: 700 }}>{billingName}</div>
              {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{billingAddress}</div>}
              {billingStateCode && <div>State : {billingStateCode === "27" ? "Maharashtra" : billingStateCode}</div>}
              {billingGstin && <div style={{ fontWeight: 700 }}>GSTIN : {billingGstin}</div>}
            </td>
            <td style={{ border: "1px solid #000", padding: "6px 8px", width: "26%", fontSize: "9.5px", verticalAlign: "top" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  {metaRow("Bill No. :", inv.invoiceNumber, true)}
                  {metaRow("Bill Date :", dateStr)}
                  {poNumber && metaRow("P.O. No. :", poNumber)}
                  {poDateStr && metaRow("P.O.Date :", poDateStr)}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Main Table: Running column headers */}
      <table className="invoice-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: "-1px", boxSizing: "border-box" }}>
        <colgroup>
          {columnWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead data-pdf-thead style={{ display: "table-header-group" }}>
          {subjectText && (
            <tr data-pdf-row>
              <td colSpan={COL_COUNT} style={{ ...cellCenter, fontWeight: 600, padding: "5px 8px", backgroundColor: "#fff", border: "1px solid #000", fontSize: "10px" }}>
                Subject : {subjectText}
              </td>
            </tr>
          )}
          <tr data-pdf-col-header="true">
            <td style={headCell}>Sr.</td>
            <td style={headCell}>Item</td>
            <td style={headCell}>Description</td>
            <td style={headCell}>HSN / SAC</td>
            <td style={headCell}>Total Sqft</td>
            <td style={headCell}>Qty</td>
            <td style={headCell}>Rate</td>
            <td style={headCell}>Amount</td>
          </tr>
        </thead>
        <tbody>
          {storeGroups.map((group, gIdx) => (
            <React.Fragment key={group.storeCode || `g-${gIdx}`}>
              {hasStoreHeadings && (
                <tr data-pdf-row data-pdf-store-heading="true">
                  <td colSpan={COL_COUNT} style={storeHeadingStyle}>
                    Store: {group.storeName}{group.storeCode && ` \u2014 Store Code: ${group.storeCode}`}
                  </td>
                </tr>
              )}
              {group.items.map((row: any, rIdx: number) => {
                itemCounter++;
                const qty = Number(row.quantity || 0);
                const rate = Number(row.rate || 0);
                const amount = Number(row.amount ?? row.totalPrice ?? qty * rate);
                const description = String(row.description ?? "").trim();
                const estItem = Array.isArray(est?.items || est?.estimateItems)
                  ? (est.items || est.estimateItems).find((it: any) => it.sl === row.sl || (row.id && it.id === row.id))
                  : null;
                const rawTotalSqft = row.totalSqft ?? row.total_sqft ?? row.totalSize ?? row.total_size ?? row.tsqft ?? row.sqft ?? estItem?.totalSqft ?? estItem?.total_sqft ?? estItem?.totalSize ?? estItem?.total_size;
                let totalSqftVal = Number(rawTotalSqft || 0);
                if (!totalSqftVal && row.width && row.height) {
                  totalSqftVal = (Number(row.width) || 0) * (Number(row.height) || 0) * (Number(row.quantity) || 1);
                }
                const totalSqftStr = totalSqftVal > 0 ? (Number.isInteger(totalSqftVal) ? totalSqftVal.toString() : totalSqftVal.toFixed(2)) : "-";

                return (
                  <tr key={row.id || `row-${gIdx}-${rIdx}`} data-pdf-row>
                    <td style={cellCenter}>{itemCounter}</td>
                    <td style={{ ...cellLeft, fontWeight: 400, whiteSpace: "nowrap" }}>{resolveItemName(row, products)}</td>
                    <td style={{ ...cellLeft, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "normal" }}>{description}</td>
                    <td style={cellCenter}>{row.hsn || ""}</td>
                    <td style={cellCenter}>{totalSqftStr}</td>
                    <td style={cellCenter}>{qty}</td>
                    <td style={cellRight}>{num(rate)}</td>
                    <td style={cellRight}>{num(amount)}</td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>

        {/* Totals Section */}
        <tbody className="invoice-totals-keep">
          <tr data-pdf-row>
            <td colSpan={7} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
              TOTAL AMOUNT BEFORE TAX
            </td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(subtotal)}</td>
          </tr>
          {isIgst ? (
            <tr data-pdf-row>
              <td colSpan={7} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
                Add : IGST
              </td>
              <td style={{ ...cellRight, fontWeight: 700 }}>{num(igst)}</td>
            </tr>
          ) : (
            <>
              <tr data-pdf-row>
                <td colSpan={7} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
                  Output CGST
                </td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(cgst)}</td>
              </tr>
              <tr data-pdf-row>
                <td colSpan={7} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
                  Output SGST
                </td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sgst)}</td>
              </tr>
            </>
          )}
          <tr data-pdf-row style={{ backgroundColor: "#f8fafc" }}>
            <td colSpan={7} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
              GRAND TOTAL
            </td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
          </tr>
          <tr data-pdf-row>
            <td colSpan={COL_COUNT} style={{ ...cellBase, fontWeight: 700, fontStyle: "italic", padding: "5px 8px" }}>
              Amount in Words: {amountInWords(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer Block: Terms (38%), Bank Details (34%), Signatory (28%) & Orange Banner */}
      <div className="invoice-footer-block" data-pdf-row style={{ width: "100%", marginTop: "-1px", boxSizing: "border-box" }}>
        <table className="invoice-document-footer" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "38%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "28%" }} />
          </colgroup>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ ...cellBase, padding: "6px 8px" }}>
                <div style={{ fontWeight: 800, marginBottom: "3px", fontSize: "9.5px" }}>Terms &amp; Conditions :</div>
                {termsLines.map((line: string, idx: number) => <div key={idx} style={{ fontSize: "8.5px", lineHeight: 1.35 }}>{line}</div>)}
                <div style={{ fontSize: "7.5px", fontWeight: 700, marginTop: "4px", color: "#334155" }}>
                  [NOTE : PLEASE MENTION BILL NO. WHILE REMITTING PAYMENT]
                </div>
              </td>
              <td style={{ ...cellBase, padding: "6px 8px" }}>
                <div style={{ fontWeight: 800, marginBottom: "3px", fontSize: "9.5px" }}>Bank Details</div>
                <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>Bank Name : {sellerProfile?.bankName || "HDFC Bank"}</div>
                <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>Branch Name : {sellerProfile?.bankBranch || "Baner, Pune"}</div>
                <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>C.A/c No. : {sellerProfile?.bankAccountNumber || "50200019250720"}</div>
                <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>IFSC No. : {sellerProfile?.bankIfsc || "HDFC0001794"}</div>
              </td>
              <td style={{ ...cellBase, padding: "6px 8px", textAlign: "center", verticalAlign: "bottom" }}>
                <div style={{ height: "44px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {sigDataUrl && (
                    <img
                      src={sigDataUrl}
                      alt="Signature and stamp"
                      style={{ maxHeight: "42px", maxWidth: "130px", objectFit: "contain" }}
                    />
                  )}
                </div>
                <div style={{ fontSize: "8.5px", fontWeight: 700, marginTop: "2px" }}>For {companyName}</div>
                <div style={{ fontWeight: 700, fontSize: "9px" }}>Authorised Signatory</div>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="invoice-brand-footer" style={{ backgroundColor: "#f59e0b", color: "#fff", textAlign: "center", padding: "6px 8px", letterSpacing: "0.3px", border: "1px solid #000", borderTop: "none", boxSizing: "border-box", width: "100%" }}>
          <div style={{ fontSize: "14px", fontWeight: 900, letterSpacing: "1.5px", lineHeight: 1.1 }}>{companyName.toUpperCase()}</div>
          {companyAddress && <div style={{ fontSize: "8.5px", marginTop: "2px", lineHeight: 1.25 }}>{companyAddress}</div>}
          {(companyMobile || companyEmail) && <div style={{ fontSize: "8.5px", marginTop: "1px", lineHeight: 1.25 }}>{[companyMobile, companyEmail].filter(Boolean).join("  \u00b7  ")}</div>}
        </div>
      </div>
    </div>
  );
};

export default InvoiceDocument;
