// =========================================================================
// EstimateDocument — single source of truth for the A4 Sunrise document
// template. Renders the same dense ERP layout used by:
//   - Estimate preview/PDF (Operations → Estimates)
//   - Invoice preview/PDF (Invoice Packet builder, /invoice-packet)
//   - Estimate summary page inside an Invoice Packet
//
// Layout (top → bottom):
//   1. Billing/Shipping block (left) + Sunrise wordmark + meta (right)
//   2. Subject / TAX INVOICE banner
//   3. 16-column item grid (SL, ELEMENT, HSN, Standard/Non, PRODUCT DETAILS,
//      Sizes W/H, T.Sqft/Qty, P.Sqft, Amount, SGST %/Amt, CGST %/Amt, Total)
//      with one section per store. Each section ends with a yellow Total
//      Material Cost row + Packing/Installation/Transport rows.
//   4. Grand TOTAL row, stacked tax block (TOTAL BEFORE / +CGST / +SGST / +TOTAL)
//   5. Terms & Conditions / Bank details / Authorised Signatory
//   6. Orange branding banner
//
// The Excel export route on the server (server/routes.ts) renders the same
// 16-column structure with xlsx-js-style styling — keep them in sync.
// =========================================================================

import React from "react";
import { formatProductDetails } from "../../../shared/productDetails";
import { companyAssetUrl } from "../utils/companyAssets";
import type { Estimate, EstimateItem, Store, Client, Brand, Product } from "../pages/operations/types";
import { orderedEstimateItems, orderedStoreKeysFromItems } from "../pages/operations/utils/estimateOrdering";

export type DocumentKind = "estimate" | "invoice";

export interface EstimateDocumentProps {
  estimate: Estimate;
  items: EstimateItem[];
  stores: Store[];
  clients: Client[];
  products?: Product[];
  brands?: Brand[];
  /** "estimate" labels the meta row "Est - No -" and the subject band "Subject :".
   *  "invoice" labels it "Inv - No -" and shows a "TAX INVOICE" banner. */
  docKind?: DocumentKind;
  /** Override the document number — used when rendering an invoice that has a
   *  separate invoiceNumber from the linked estimate's estimateNumber. */
  docNumber?: string;
  /** ISO date string (or any Date-parseable). Overrides est.createdAt for invoices. */
  docDate?: string;
  /** Optional remarks / invoice subject used when docKind === "invoice" — replaces
   *  the subject band text. Defaults to estimate.subject / estimate.title. */
  subjectOverride?: string;
  sellerProfile?: any;
  assetToken?: string | null;
}

export const numberToWords = (num: number): string => {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  let internalNum = Math.floor(num);
  if (internalNum === 0) return 'Zero';
  const g = (n: number): string => {
    if (n < 20) return a[n];
    const digit = n % 10;
    return b[Math.floor(n / 10)] + (digit ? '-' + a[digit] : '');
  };
  const h = (n: number): string => {
    if (n === 0) return '';
    if (n < 100) return g(n) + ' ';
    return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 === 0 ? '' : 'and ' + g(n % 100) + ' ');
  };
  let str = '';
  const cr = Math.floor(internalNum / 10000000);
  internalNum %= 10000000;
  if (cr) str += h(cr) + 'Crore ';
  const lk = Math.floor(internalNum / 100000);
  internalNum %= 100000;
  if (lk) str += h(lk) + 'Lakh ';
  const th = Math.floor(internalNum / 1000);
  internalNum %= 1000;
  if (th) str += h(th) + 'Thousand ';
  if (internalNum) str += h(internalNum);
  return 'Rupees ' + str.trim() + ' Only';
};

const EstimateDocument: React.FC<EstimateDocumentProps> = ({
  estimate: est,
  items,
  stores,
  clients,
  products = [],
  docKind = "estimate",
  docNumber,
  docDate,
  subjectOverride,
  sellerProfile = {},
  assetToken,
}) => {
  const targetClient = clients.find(c => c.id === est.clientId);
  const targetStore = stores.find(s => s.id === est.storeId);
  const hasStoreGrouping = Boolean(est.storeGrouping && Object.keys(est.storeGrouping as any).length > 0);
  const sortedItems = React.useMemo(() => orderedEstimateItems(items), [items]);

  // Billing block — first non-empty source wins. Billing snapshot beats user-
  // entered estBillingTo beats client.address.
  const billingRaw = est.billingTo || "";
  const billingLines = billingRaw.split("\n").map(s => s.trim()).filter(Boolean);
  const billingNameSnap = est.billingLegalNameSnapshot || "";
  const billingAddrSnap = est.billingAddressSnapshot || "";
  let billingName = billingNameSnap;
  let billingAddress = billingAddrSnap;
  if (!billingName) {
    const first = (billingLines[0] || "").replace(/^M\/S\s*:?\s*/i, "").trim();
    billingName = first || targetClient?.name || "";
  }
  if (!billingAddress) {
    if (billingLines.length > 1) {
      billingAddress = billingLines.slice(1).join("\n");
    } else if (billingNameSnap && billingRaw && billingRaw !== billingNameSnap) {
      billingAddress = billingRaw;
    } else {
      billingAddress = targetClient?.address || "";
    }
  }
  const billingGstin = est.billingGstinSnapshot || est.gstin || targetClient?.gstNumber || "";
  const billingStateCode = est.billingStateCodeSnapshot || est.stateCode || "";
  const billingPan = est.pan || targetClient?.pan || "";

  // Shipping
  const shippingRaw = est.shippingAddressSnapshot || est.shippingTo || "";
  const shippingHasOwn = shippingRaw.trim().length > 0;
  let shippingName = billingName;
  let shippingAddress = billingAddress;
  if (shippingHasOwn) {
    const shipLines = shippingRaw.split("\n").map(s => s.trim()).filter(Boolean);
    if (shipLines.length > 0 && /^M\/S\s*:/i.test(shipLines[0])) {
      shippingName = shipLines[0].replace(/^M\/S\s*:?\s*/i, "").trim();
      shippingAddress = shipLines.slice(1).join("\n");
    } else {
      shippingAddress = shippingRaw;
    }
  }
  const shippingGstin = billingGstin;

  // Sections (one per store from storeGrouping; otherwise single)
  type SectionRow = {
    label: string;
    type: string;
    hsn: string;
    stdLabel: string;
    description: string;
    width: string;
    height: string;
    qty: string;
    tsqft: string;
    psqft: string;
    amount: number;
    sgstPercent: number;
    sgstAmt: number;
    cgstPercent: number;
    cgstAmt: number;
    total: number;
  };
  type Section = {
    storeName: string;
    storeCode: string;
    itemRows: SectionRow[];
    packingPercent: number;
    implPercent: number;
    transportAmt: number;
    materialBase: number;
    materialSgst: number;
    materialCgst: number;
    materialTotal: number;
    packingBase: number;
    implBase: number;
    transportBase: number;
  };

  const itemToRow = (item: EstimateItem, idx: number): SectionRow => ({
    label: String(idx + 1),
    type: item.itemName || "",
    hsn: item.hsn || "",
    stdLabel: item.isStandard ? "Standard" : "Non-standard",
    description: formatProductDetails(
      item.productId ? products.find(product => product.id === item.productId) : null,
      item.description || "",
      item.itemName || "",
    ),
    width: item.width != null && Number(item.width) > 0 ? Number(item.width).toFixed(2) : "",
    height: item.height != null && Number(item.height) > 0 ? Number(item.height).toFixed(2) : "",
    qty: item.quantity != null ? Number(item.quantity).toFixed(2) : "",
    tsqft: item.totalSize != null && Number(item.totalSize) > 0 ? Number(item.totalSize).toFixed(2) : "",
    psqft: item.rate != null ? Number(item.rate).toFixed(2) : "",
    amount: Number(item.totalPrice) || 0,
    sgstPercent: Number(item.sgstPercent) || 0,
    sgstAmt: Number(item.sgstAmount) || 0,
    cgstPercent: Number(item.cgstPercent) || 0,
    cgstAmt: Number(item.cgstAmount) || 0,
    total: Number(item.totalAmount) || 0,
  });

  const sections: Section[] = [];
  if (hasStoreGrouping) {
    orderedStoreKeysFromItems(sortedItems, est.storeGrouping as Record<string, any>).forEach((sidKey) => {
      const tStore = stores.find(s => s.id === Number(sidKey));
      const groupData = (est.storeGrouping as any)[sidKey] || [];
      const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
      const storeItems = sortedItems.filter(it => itemSls.includes(it.sl || 0));
      if (storeItems.length === 0) return;
      const packPct = !Array.isArray(groupData) && groupData.packingPercent !== undefined
        ? Number(groupData.packingPercent)
        : Number(est.packingPercent || 0);
      const implPct = !Array.isArray(groupData) && groupData.implementationPercent !== undefined
        ? Number(groupData.implementationPercent)
        : Number(est.implementationPercent || 0);
      const transAmt = !Array.isArray(groupData) && groupData.transportAmount !== undefined
        ? Number(groupData.transportAmount)
        : 0;
      const materialBase = storeItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
      const materialSgst = storeItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0);
      const materialCgst = storeItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0);
      sections.push({
        storeName: tStore?.name || `Store ${sidKey}`,
        storeCode: tStore?.storeCode || "",
        itemRows: storeItems.map((it, idx) => itemToRow(it, idx)),
        packingPercent: packPct,
        implPercent: implPct,
        transportAmt: transAmt,
        materialBase,
        materialSgst,
        materialCgst,
        materialTotal: materialBase + materialSgst + materialCgst,
        packingBase: materialBase * (packPct / 100),
        implBase: materialBase * (implPct / 100),
        transportBase: transAmt,
      });
    });
  } else {
    const materialBase = sortedItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const materialSgst = sortedItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0);
    const materialCgst = sortedItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0);
    const packPct = Number(est.packingPercent || 0);
    const implPct = Number(est.implementationPercent || 0);
    const transAmt = Number(est.transportAmount || 0);
    sections.push({
      storeName: targetStore?.name || est.title || "Site",
      storeCode: targetStore?.storeCode || "",
      itemRows: sortedItems.map((it, idx) => itemToRow(it, idx)),
      packingPercent: packPct,
      implPercent: implPct,
      transportAmt: transAmt,
      materialBase,
      materialSgst,
      materialCgst,
      materialTotal: materialBase + materialSgst + materialCgst,
      packingBase: materialBase * (packPct / 100),
      implBase: materialBase * (implPct / 100),
      transportBase: transAmt,
    });
  }

  const SERVICE_TAX_PCT = 9;
  let grandBeforeTax = 0;
  let grandSgst = 0;
  let grandCgst = 0;
  sections.forEach(sec => {
    grandBeforeTax += sec.materialBase + sec.packingBase + sec.implBase + sec.transportBase;
    grandSgst += sec.materialSgst + (sec.packingBase + sec.implBase + sec.transportBase) * SERVICE_TAX_PCT / 100;
    grandCgst += sec.materialCgst + (sec.packingBase + sec.implBase + sec.transportBase) * SERVICE_TAX_PCT / 100;
  });
  const grandTotal = grandBeforeTax + grandSgst + grandCgst;

  const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateSource = docDate || est.createdAt;
  const dateStr = dateSource
    ? new Date(dateSource).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";

  const cellBase: React.CSSProperties = { border: "1px solid #000", padding: "2px 4px", fontSize: "10px", lineHeight: 1.25, verticalAlign: "top" };
  const cellRight: React.CSSProperties = { ...cellBase, textAlign: "right" };
  const cellCenter: React.CSSProperties = { ...cellBase, textAlign: "center" };
  const headCell: React.CSSProperties = { ...cellBase, fontWeight: 700, textAlign: "center", backgroundColor: "#fff" };
  const yellowRow: React.CSSProperties = { backgroundColor: "#fff066" };
  const COL_COUNT = 16;

  const serviceRow = (
    kind: "Packing" | "Installation" | "Transport",
    descr: string,
    percentLabel: string,
    base: number,
    sectionKey: string,
  ) => {
    const sgstAmt = base * SERVICE_TAX_PCT / 100;
    const cgstAmt = base * SERVICE_TAX_PCT / 100;
    return (
      <tr key={`${sectionKey}-${kind}`}>
        <td style={cellCenter}></td>
        <td style={cellBase}>{kind}</td>
        <td style={cellBase}>9987</td>
        <td style={cellBase}>Standard</td>
        <td style={cellBase}>{descr}</td>
        <td style={cellBase}></td>
        <td style={cellBase}></td>
        <td style={cellBase}></td>
        <td style={cellBase}></td>
        <td style={cellRight}>{percentLabel}</td>
        <td style={cellRight}>{num(base)}</td>
        <td style={cellRight}>{SERVICE_TAX_PCT}%</td>
        <td style={cellRight}>{num(sgstAmt)}</td>
        <td style={cellRight}>{SERVICE_TAX_PCT}%</td>
        <td style={cellRight}>{num(cgstAmt)}</td>
        <td style={cellRight}>{num(base + sgstAmt + cgstAmt)}</td>
      </tr>
    );
  };

  const isInvoice = docKind === "invoice";
  const numberLabel = isInvoice ? "Inv - No -" : "Est - No -";
  const numberValue = docNumber || est.estimateNumber;
  const subjectText = subjectOverride || est.subject || est.title || "";
  const companyName = sellerProfile.name || "Sunrise Media";
  const companyAddress = sellerProfile.address || "";
  const companyEmail = sellerProfile.email || "";
  const companyMobile = sellerProfile.mobile || "";
  const logoSrc = companyAssetUrl(sellerProfile.logoPath, assetToken);
  const signatureStampSrc = companyAssetUrl(sellerProfile.signatureStampPath, assetToken);
  const termsLines = String(sellerProfile.terms || "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the meterial.\n3. Transportation charges As per Actual.\n4. Any additional work / rework will be extra.")
    .split(/\n+/)
    .map((line: string) => line.trim())
    .filter(Boolean);
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
    <div className="estimate-print" data-print-document="true" style={{ background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif" }}>
      {/* Top: Billing/Shipping (left) — Logo + meta (right) */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
              {shippingGstin && <div style={{ fontWeight: 700 }}>GSTN - {shippingGstin}</div>}
            </td>
            <td style={{ padding: "8px 12px", width: "40%", textAlign: "right", fontSize: "11px", verticalAlign: "top" }}>
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt={companyName}
                  style={{ width: 230, maxWidth: "100%", height: "auto", objectFit: "contain" }}
                />
              ) : (
                <div style={{ fontWeight: 900, fontSize: "22px", lineHeight: 1.1, textAlign: "right" }}>{companyName}</div>
              )}
              {isInvoice && (
                <div style={{ marginTop: "8px", fontWeight: 900, fontSize: "14px", letterSpacing: "2px", color: "#000" }}>
                  TAX INVOICE
                </div>
              )}
              <table style={{ marginTop: "14px", marginLeft: "auto", borderCollapse: "collapse", tableLayout: "fixed", width: "262px" }}>
                <tbody>
                  {metaRow("Date :", dateStr)}
                  {metaRow(numberLabel, numberValue, true)}
                  {/* When viewing an invoice, also surface the linked estimate's number for traceability. */}
                  {isInvoice && est.estimateNumber && est.estimateNumber !== numberValue && (
                    metaRow("Ref Est -", est.estimateNumber)
                  )}
                  {billingGstin && metaRow("GSTN -", billingGstin)}
                  {billingPan && metaRow("PAN -", billingPan)}
                  {est.vendorCode && metaRow("Vendor Code -", est.vendorCode)}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Main dense table */}
      <table className="estimate-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
        <thead>
          <tr>
            <td colSpan={COL_COUNT} style={{ ...cellCenter, fontWeight: 700, padding: "4px 8px" }}>
              Subject : {subjectText}
            </td>
          </tr>
          <tr>
            <td style={headCell} rowSpan={2}>SL</td>
            <td style={headCell} rowSpan={2}>ELEMENT</td>
            <td style={headCell} rowSpan={2}>HSN</td>
            <td style={headCell} rowSpan={2}>Standard / Non</td>
            <td style={headCell} rowSpan={2}>PRODUCT DETAILS</td>
            <td style={headCell} colSpan={2}>Sizes</td>
            <td style={headCell} colSpan={2}>T Sqft / Qty</td>
            <td style={headCell} rowSpan={2}>P.Sqft</td>
            <td style={headCell} rowSpan={2}>Amount</td>
            <td style={headCell} colSpan={2}>SGST<br/>Rate Amount</td>
            <td style={headCell} colSpan={2}>CGST<br/>Rate Amount</td>
            <td style={headCell} rowSpan={2}>Total</td>
          </tr>
          <tr>
            <td style={headCell}>W</td>
            <td style={headCell}>H</td>
            <td style={headCell}>Qty</td>
            <td style={headCell}>T.Sqft</td>
            <td style={headCell}>%</td>
            <td style={headCell}>Amt</td>
            <td style={headCell}>%</td>
            <td style={headCell}>Amt</td>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, sIdx) => (
            <React.Fragment key={`sec-${sIdx}`}>
              <tr>
                <td colSpan={COL_COUNT} style={{ ...cellBase, fontWeight: 700, padding: "4px 8px" }}>
                  Store: {sec.storeName}{sec.storeCode ? `,  Store Code : ${sec.storeCode}` : ""}
                </td>
              </tr>
              {sec.itemRows.map((row, rIdx) => (
                <tr key={`sec-${sIdx}-row-${rIdx}`}>
                  <td style={cellCenter}>{row.label}</td>
                  <td style={cellBase}>{row.type}</td>
                  <td style={cellBase}>{row.hsn || ""}</td>
                  <td style={cellBase}>{row.stdLabel}</td>
                  <td style={cellBase}>{row.description}</td>
                  <td style={cellRight}>{row.width}</td>
                  <td style={cellRight}>{row.height}</td>
                  <td style={cellRight}>{row.qty}</td>
                  <td style={cellRight}>{row.tsqft}</td>
                  <td style={cellRight}>{row.psqft}</td>
                  <td style={cellRight}>{num(row.amount)}</td>
                  <td style={cellRight}>{row.sgstPercent}%</td>
                  <td style={cellRight}>{num(row.sgstAmt)}</td>
                  <td style={cellRight}>{row.cgstPercent}%</td>
                  <td style={cellRight}>{num(row.cgstAmt)}</td>
                  <td style={cellRight}>{num(row.total)}</td>
                </tr>
              ))}
              <tr style={yellowRow}>
                <td style={{ ...cellBase, fontWeight: 700 }} colSpan={5}>Total Materail Cost</td>
                <td style={cellBase}></td>
                <td style={cellBase}></td>
                <td style={cellBase}></td>
                <td style={cellBase}></td>
                <td style={cellBase}></td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialBase)}</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>9%</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialSgst)}</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>9%</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialCgst)}</td>
                <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialTotal)}</td>
              </tr>
              {sec.packingPercent > 0 && serviceRow("Packing", `Packing charges ${sec.packingPercent}%`, `${sec.packingPercent}%`, sec.packingBase, `s${sIdx}`)}
              {sec.implPercent > 0 && serviceRow("Installation", `Installation charges ${sec.implPercent}%`, `${sec.implPercent}%`, sec.implBase, `s${sIdx}`)}
              {sec.transportAmt > 0 && serviceRow("Transport", "Local Transport", "", sec.transportBase, `s${sIdx}`)}
              {sIdx < sections.length - 1 && (
                <tr>
                  <td colSpan={COL_COUNT} style={{ ...cellBase, height: "6px", padding: 0 }}></td>
                </tr>
              )}
            </React.Fragment>
          ))}

          {/* Grand TOTAL row */}
          <tr>
            <td colSpan={9} style={cellBase}></td>
            <td style={{ ...cellRight, fontWeight: 700 }}>TOTAL</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandBeforeTax)}</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>9%</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandSgst)}</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>9%</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandCgst)}</td>
            <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
          </tr>
          {/* Stacked tax summary */}
          <tr>
            <td colSpan={14} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>TOTAL AMOUNT BEFORE TAX</td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandBeforeTax)}</td>
          </tr>
          <tr>
            <td colSpan={14} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>Add : CGST 9%</td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandCgst)}</td>
          </tr>
          <tr>
            <td colSpan={14} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>Add : SGST 9%</td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandSgst)}</td>
          </tr>
          <tr>
            <td colSpan={14} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>TOTAL AMOUNT AFTER TAX</td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
          </tr>
          <tr>
            <td colSpan={COL_COUNT} style={{ ...cellBase, fontWeight: 700, fontStyle: "italic" }}>
              Amount in Words: {numberToWords(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="estimate-footer-block">
        {/* Terms + Bank + Signature footer */}
        <table className="estimate-document-footer" style={{ width: "100%", borderCollapse: "collapse", marginTop: "-1px" }}>
          <tbody>
            <tr style={{ verticalAlign: "top" }}>
              <td style={{ ...cellBase, padding: "8px 10px", width: "38%" }}>
                <div style={{ color: "#b91c1c", fontWeight: 700, textDecoration: "underline", marginBottom: "4px" }}>Terms &amp; Condition :</div>
                {termsLines.map((line: string, idx: number) => <div key={idx}>{line}</div>)}
              </td>
              <td style={{ ...cellBase, padding: "8px 10px", width: "34%" }}>
                <div style={{ fontWeight: 700, marginBottom: "4px" }}>BANK ACCOUNT DETAILS</div>
                <div>Bank Name : {sellerProfile.bankName || ""}</div>
                <div>Branch Name : {sellerProfile.bankBranch || ""}</div>
                <div>C.A/c No : {sellerProfile.bankAccountNumber || ""}</div>
                <div>IFSC NO : {sellerProfile.bankIfsc || ""}</div>
              </td>
              <td className="estimate-signature-cell" style={{ ...cellBase, padding: "8px 10px", width: "28%", textAlign: "right", verticalAlign: "bottom" }}>
                <div style={{ fontWeight: 700 }}>For {companyName.toUpperCase()}</div>
                <div className="estimate-signature-space" style={{ height: "52px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {signatureStampSrc && (
                    <img
                      src={signatureStampSrc}
                      alt="Signature and stamp"
                      className="estimate-signature-stamp"
                      style={{ maxHeight: "48px", maxWidth: "150px", objectFit: "contain" }}
                    />
                  )}
                </div>
                <div style={{ fontWeight: 700 }}>Authorised Signatory</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Orange branding banner — compact ERP footer */}
        <div className="estimate-brand-footer" style={{ backgroundColor: "#f59e0b", color: "#fff", textAlign: "center", padding: "6px 8px", letterSpacing: "0.3px" }}>
          <div className="estimate-brand-footer-title" style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "1.5px", lineHeight: 1.1 }}>{companyName.toUpperCase()}</div>
          {companyAddress && <div style={{ fontSize: "9px", marginTop: "3px", lineHeight: 1.25 }}>{companyAddress}</div>}
          {(companyMobile || companyEmail) && <div style={{ fontSize: "9px", marginTop: "1px", lineHeight: 1.25 }}>{[companyMobile, companyEmail].filter(Boolean).join("  ·  ")}</div>}
        </div>
      </div>
    </div>
  );
};

export default EstimateDocument;
