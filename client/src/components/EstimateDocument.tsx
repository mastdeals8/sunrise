// EstimateDocument is the single React renderer for estimate preview,
// browser print/PDF export, and the estimate page inside Invoice Packet.

import React, { useMemo, useState, useEffect } from "react";
import { formatProductDetails } from "../../../shared/productDetails";
import { isServiceEstimateItem, resolveServiceProduct, serviceProductLabel } from "../../../shared/serviceProductDisplay";
import { companyAssetUrl } from "../utils/companyAssets";
import type { Estimate, EstimateItem, Store, Client, Brand, Product } from "../pages/operations/types";
import { orderedEstimateItems, orderedStoreKeysFromItems } from "../pages/operations/utils/estimateOrdering";

export interface EstimateDocumentProps {
  estimate: Estimate;
  items: EstimateItem[];
  stores: Store[];
  clients: Client[];
  products?: Product[];
  brands?: Brand[];
  sellerProfile?: any;
  assetToken?: string | null;
}

const isServiceItem = (item: EstimateItem) => isServiceEstimateItem(item);

const wrapAddress = (value: string) => {
  const raw = String(value || "");
  if (raw.includes("\n")) return raw.split(/\n+/).map(line => line.trim()).filter(Boolean).join("\n");
  const normalized = raw.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").replace(/\s+-\s*/g, " - ").trim();
  if (!normalized) return "";
  const commaParts = normalized.split(",").map(part => part.trim()).filter(Boolean);
  const parts = commaParts.length > 1 ? commaParts.map((part, index) => index < commaParts.length - 1 ? `${part},` : part) : normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  parts.forEach(part => {
    const next = current ? `${current} ${part}` : part;
    if (next.length > 72 && current && lines.length < 2) { lines.push(current); current = part; return; }
    current = next;
  });
  if (current) lines.push(current);
  return lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(" ")].join("\n") : lines.join("\n");
};

const DocumentLogo: React.FC<{ src: string; companyName: string }> = ({ src, companyName }) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const effectiveSrc = src || "/brand/file-1780929283382-585314307.png";
  return failed ? (
    <div style={{ fontWeight: 900, fontSize: "22px", lineHeight: 1.1, textAlign: "right" }}>{companyName}</div>
  ) : (
    <img
      src={effectiveSrc}
      alt={companyName}
      onError={() => setFailed(true)}
      style={{ width: 220, maxWidth: "100%", height: "auto", maxHeight: "48px", objectFit: "contain", display: "inline-block" }}
    />
  );
};

const documentLogo = (src: string, companyName: string) => <DocumentLogo src={src} companyName={companyName} />;

const EstimateDocument: React.FC<EstimateDocumentProps> = ({
  estimate: est,
  items,
  stores,
  clients,
  products = [],
  sellerProfile = {},
  assetToken: token,
}) => {
  const targetClient = clients.find(c => c.id === est.clientId);
  const targetStore = stores.find(s => s.id === est.storeId);
  const sortedItems = orderedEstimateItems(items);
  // Unified flow: single vs multi-store is derived from storeGrouping
  // alone (no separate "abfrl_multi_store" mode). One store added on
  // the entry sheet → single-store render; many stores → multi-store.
  const hasStoreGrouping = Boolean(est.storeGrouping && Object.keys(est.storeGrouping as any).length > 0);

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

  // Shipping: if user typed shipping text, parse name+address from it.
  // Otherwise reuse the billing block (same name, same address).
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
  const isIgst = est.gstType === "IGST";

  // Build sections (one per store for ABFRL, single section otherwise)
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
    igstPercent: number;
    igstAmt: number;
    total: number;
  };
  type Section = {
    storeName: string;
    storeCode: string;
    itemRows: SectionRow[];
    serviceRows: EstimateItem[];
    packingPercent: number;
    implPercent: number;
    transportAmt: number;
    transportDescription?: string | null;
    materialBase: number; // items only (no packing/impl/transport)
    materialSgst: number;
    materialCgst: number;
    materialIgst: number;
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
    width: item.width ? Number(item.width).toFixed(2) : "",
    height: item.height ? Number(item.height).toFixed(2) : "",
    qty: item.quantity != null ? Number(item.quantity).toFixed(2) : "",
    tsqft: item.totalSize != null ? Number(item.totalSize).toFixed(2) : "",
    psqft: item.rate != null ? Number(item.rate).toFixed(2) : "",
    amount: Number(item.totalPrice) || 0,
    sgstPercent: Number(item.sgstPercent) || 0,
    sgstAmt: Number(item.sgstAmount) || 0,
    cgstPercent: Number(item.cgstPercent) || 0,
    cgstAmt: Number(item.cgstAmount) || 0,
    igstPercent: Number(item.igstPercent) || 0,
    igstAmt: Number(item.igstAmount) || 0,
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
      const materialItems = storeItems.filter(it => !isServiceItem(it));
      const serviceItems = storeItems.filter(isServiceItem);
      const packPct = !Array.isArray(groupData) && groupData.packingPercent !== undefined
        ? Number(groupData.packingPercent)
        : Number(est.packingPercent || 0);
      const implPct = !Array.isArray(groupData) && groupData.implementationPercent !== undefined
        ? Number(groupData.implementationPercent)
        : Number(est.implementationPercent || 0);
      const transAmt = !Array.isArray(groupData) && groupData.transportAmount !== undefined
        ? Number(groupData.transportAmount)
        : 0;
      const transportDescription = !Array.isArray(groupData) && groupData.transportDescription !== undefined
        ? groupData.transportDescription
        : null;
      const materialBase = materialItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
      const materialSgst = materialItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0);
      const materialCgst = materialItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0);
      const materialIgst = materialItems.reduce((s, it) => s + Number(it.igstAmount || 0), 0);
      const hasSavedServices = serviceItems.length > 0;
      sections.push({
        storeName: tStore?.name || (!Array.isArray(groupData) && groupData.storeName) || `Store ${sidKey}`,
        storeCode: tStore?.storeCode || "",
        itemRows: materialItems.map((it, idx) => itemToRow(it, idx)),
        serviceRows: serviceItems,
        packingPercent: packPct,
        implPercent: implPct,
        transportAmt: transAmt,
        transportDescription,
        materialBase,
        materialSgst,
        materialCgst,
        materialIgst,
        materialTotal: materialBase + materialSgst + materialCgst + materialIgst,
        packingBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "packing").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : materialBase * (packPct / 100),
        implBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "installation").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : materialBase * (implPct / 100),
        transportBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "transport").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : transAmt,
      });
    });
  } else {
    const materialItems = sortedItems.filter(it => !isServiceItem(it));
    const serviceItems = sortedItems.filter(isServiceItem);
    const materialBase = materialItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const materialSgst = materialItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0);
    const materialCgst = materialItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0);
    const materialIgst = materialItems.reduce((s, it) => s + Number(it.igstAmount || 0), 0);
    const packPct = Number(est.packingPercent || 0);
    const implPct = Number(est.implementationPercent || 0);
    const transAmt = Number(est.transportAmount || 0);
    const hasSavedServices = serviceItems.length > 0;
    sections.push({
      storeName: targetStore?.name || est.title || "Site",
      storeCode: targetStore?.storeCode || "",
      itemRows: materialItems.map((it, idx) => itemToRow(it, idx)),
      serviceRows: serviceItems,
      packingPercent: packPct,
      implPercent: implPct,
      transportAmt: transAmt,
      transportDescription: null,
      materialBase,
      materialSgst,
      materialCgst,
      materialIgst,
      materialTotal: materialBase + materialSgst + materialCgst + materialIgst,
      packingBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "packing").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : materialBase * (packPct / 100),
      implBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "installation").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : materialBase * (implPct / 100),
      transportBase: hasSavedServices ? serviceItems.filter(it => it.lineType === "transport").reduce((s, it) => s + Number(it.totalPrice || 0), 0) : transAmt,
    });
  }

  const SERVICE_TAX_PCT = isIgst ? 18 : 9;

  // Grand totals across all sections
  let grandBeforeTax = 0;
  let grandSgst = 0;
  let grandCgst = 0;
  let grandIgst = 0;
  sections.forEach(sec => {
    const savedServiceBase = sec.serviceRows.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const syntheticServiceBase = sec.serviceRows.length > 0 ? 0 : sec.packingBase + sec.implBase + sec.transportBase;
    grandBeforeTax += sec.materialBase + savedServiceBase + syntheticServiceBase;
    if (isIgst) {
      grandIgst += sec.materialIgst
        + sec.serviceRows.reduce((s, it) => s + Number(it.igstAmount || 0), 0)
        + syntheticServiceBase * 0.18;
    } else {
      grandSgst += sec.materialSgst
        + sec.serviceRows.reduce((s, it) => s + Number(it.sgstAmount || 0), 0)
        + syntheticServiceBase * 0.09;
      grandCgst += sec.materialCgst
        + sec.serviceRows.reduce((s, it) => s + Number(it.cgstAmount || 0), 0)
        + syntheticServiceBase * 0.09;
    }
  });
  const grandTotal = grandBeforeTax + grandSgst + grandCgst + grandIgst;

  const num = (n: number) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateStr = (est.estimateDate || est.createdAt)
    ? new Date(est.estimateDate || est.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
    : "";
  const companyName = sellerProfile.name || "Sunrise Media";
  const companyAddress = sellerProfile.address || "";
  const companyEmail = sellerProfile.email || "";
  const companyMobile = sellerProfile.mobile || "";
  const logoSrc = companyAssetUrl(sellerProfile.logoPath || "/brand/file-1780929283382-585314307.png", token);
  const signatureStampSrc = companyAssetUrl(sellerProfile.signatureStampPath || "/brand/file-1780897714393-225895475.png", token);
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

  // Cell + table styles for dense print-grade layout. Inline styles so
  // they survive print without depending on Tailwind classes.
  const cellBase: React.CSSProperties = {
    border: "1px solid #000",
    padding: "4.5px 5.5px",
    fontSize: "9px",
    lineHeight: 1.35,
    verticalAlign: "middle",
    fontWeight: 400,
  };
  const cellRight: React.CSSProperties = { ...cellBase, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const cellCenter: React.CSSProperties = { ...cellBase, textAlign: "center", whiteSpace: "nowrap" };
  const headCell: React.CSSProperties = { ...cellBase, fontWeight: 700, textAlign: "center", backgroundColor: "#fff", whiteSpace: "nowrap" };
  const totalRowStyle: React.CSSProperties = { backgroundColor: "#f8fafc" };
  const yellowRow: React.CSSProperties = { backgroundColor: "#f8fafc" };
  // 14 columns: SL, Element, HSN, Std/Non, Product Details, W, H, Qty,
  // T.Sqft, Rate, Amount, GST%, GST Amount, Total.
  const COL_COUNT = 14;

  // A service charges row (Packing / Installation / Transport).
  const serviceRow = (
    kind: string,
    descr: string,
    percentLabel: string,
    base: number,
    sectionKey: string,
  ) => {
    const firstTaxAmt = base * SERVICE_TAX_PCT / 100;
    const secondTaxAmt = isIgst ? 0 : base * SERVICE_TAX_PCT / 100;
    const gstAmt = firstTaxAmt + secondTaxAmt;
    return (
      <tr className="estimate-service-row-keep" data-pdf-row key={`${sectionKey}-${kind}`}>
        <td style={cellCenter}></td>
        <td style={cellBase}>{kind}</td>
        <td style={cellCenter}>9987</td>
        <td style={cellCenter}>Standard</td>
        <td style={cellBase}>{descr}</td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellRight}>{percentLabel}</td>
        <td style={cellRight}>{num(base)}</td>
        <td style={cellCenter}>{isIgst ? "18%" : "18%"}</td>
        <td style={cellRight}>{num(gstAmt)}</td>
        <td style={cellRight}>{num(base + gstAmt)}</td>
      </tr>
    );
  };

  const savedServiceRow = (item: EstimateItem, sectionKey: string) => {
    const base = Number(item.totalPrice) || 0;
    const service = resolveServiceProduct(item, products);
    const rateLabel = service.rateLabel;
    const gstPercent = service.gstPercent;
    const gstAmount = isIgst
      ? Number(item.igstAmount) || 0
      : (Number(item.sgstAmount) || 0) + (Number(item.cgstAmount) || 0);
    const label = service.label;
    return (
      <tr className="estimate-service-row-keep" data-pdf-row key={`${sectionKey}-${item.id || item.sl || item.itemName}`}>
        <td style={cellCenter}></td>
        <td style={cellBase}>{label}</td>
        <td style={cellCenter}>9987</td>
        <td style={cellCenter}>Standard</td>
        <td style={cellBase}>{item.description || label}</td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellCenter}></td>
        <td style={cellRight}>{rateLabel}</td>
        <td style={cellRight}>{num(base)}</td>
        <td style={cellCenter}>{gstPercent}%</td>
        <td style={cellRight}>{num(gstAmount)}</td>
        <td style={cellRight}>{num(base + gstAmount)}</td>
      </tr>
    );
  };

  // Portrait A4 printable width is 194mm at the 8mm page margins below.
  // Numeric columns are intentionally wide enough for Indian-formatted
  // five/six-digit values; the product-details column absorbs wrapping.
  const columnWidths = [
    "3.5%",  // SL
    "12%",   // Element
    "5.5%",  // HSN
    "6.5%",  // Std/Non
    "20.5%", // Product Details
    "4.5%",  // Size (W)
    "4.5%",  // Size (H)
    "4%",    // Qty
    "5%",    // T.Sqft
    "6.5%",  // Rate
    "8.5%",  // Amount
    "4.5%",  // GST %
    "7%",    // GST Amt
    "7.5%",  // Total
  ];

  const renderDocumentHeader = () => (
    <table className="estimate-document-header" style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        <tr style={{ verticalAlign: "top" }}>
          <td style={{ padding: "8px 12px", fontSize: "11px", lineHeight: 1.45, width: "60%" }}>
            <div style={{ fontWeight: 700 }}>Billing To</div>
            <div style={{ fontWeight: 700 }}>M/S : {billingName}</div>
            {billingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{wrapAddress(billingAddress)}</div>}
            {billingStateCode && <div>State Code: {billingStateCode}</div>}
            {billingGstin && <div style={{ fontWeight: 700 }}>GSTN - {billingGstin}</div>}
            <div style={{ marginTop: "10px", fontWeight: 700 }}>Shipping To</div>
            <div style={{ fontWeight: 700 }}>M/S : {shippingName}</div>
            {shippingAddress && <div style={{ whiteSpace: "pre-wrap" }}>{wrapAddress(shippingAddress)}</div>}
            {shippingGstin && <div style={{ fontWeight: 700 }}>GSTN - {shippingGstin}</div>}
          </td>
          <td style={{ padding: "8px 12px", width: "40%", textAlign: "right", fontSize: "11px", verticalAlign: "top" }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>{documentLogo(logoSrc, companyName)}</div>
            <table style={{ marginTop: "18px", marginLeft: "auto", borderCollapse: "collapse", tableLayout: "fixed", width: "262px" }}>
              <tbody>
                {metaRow("Date :", dateStr)}
                {metaRow("Est - No -", est.estimateNumber, true)}
                {sellerProfile.gstin && metaRow("GSTN -", sellerProfile.gstin)}
                {sellerProfile.pan && metaRow("PAN -", sellerProfile.pan)}
                {est.vendorCode && metaRow("Vendor Code -", est.vendorCode)}
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );

  const renderEstimateTableHead = () => (
    <thead data-pdf-thead style={{ display: "table-header-group" }}>
      <tr>
        <td colSpan={COL_COUNT} style={{ ...cellCenter, fontWeight: 700, padding: "5px 8px" }}>
          Subject : {est.subject || est.title}
        </td>
      </tr>
      <tr data-pdf-col-header="true">
        <td style={headCell}>SL</td>
        <td style={headCell}>Element</td>
        <td style={headCell}>HSN</td>
        <td style={headCell}>Std / Non</td>
        <td style={headCell}>Product Details</td>
        <td style={headCell}>Size (W)</td>
        <td style={headCell}>Size (H)</td>
        <td style={headCell}>Qty</td>
        <td style={headCell}>T.Sqft</td>
        <td style={headCell}>Rate</td>
        <td style={headCell}>Amount</td>
        <td style={headCell}>GST %</td>
        <td style={headCell}>GST Amt</td>
        <td style={headCell}>Total</td>
      </tr>
    </thead>
  );

  const renderStoreSection = (sec: Section, sIdx: number) => (
    <tbody
      className="estimate-store-section"
      key={`sec-${sIdx}-${sec.storeCode || sec.storeName}`}
      data-store-code={sec.storeCode}
      style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <tr data-pdf-row data-pdf-store-heading="true">
        <td colSpan={COL_COUNT} style={{ ...cellCenter, fontWeight: 700, padding: "4px 8px", backgroundColor: "#f1f5f9" }}>
          Store: {sec.storeName}{sec.storeCode ? `, Store Code : ${sec.storeCode}` : ""}
        </td>
      </tr>
      {sec.itemRows.map((row, rIdx) => (
        <tr key={`sec-${sIdx}-row-${rIdx}`} data-pdf-row>
          <td style={cellCenter}>{row.label}</td>
          <td style={cellBase}>{row.type}</td>
          <td style={cellCenter}>{row.hsn || ""}</td>
          <td style={{ ...cellCenter, fontSize: "9px" }}>{row.stdLabel}</td>
          <td style={cellBase}>{row.description}</td>
          <td style={cellRight}>{row.width}</td>
          <td style={cellRight}>{row.height}</td>
          <td style={cellCenter}>{row.qty}</td>
          <td style={cellRight}>{row.tsqft}</td>
          <td style={cellRight}>{row.psqft}</td>
          <td style={cellRight}>{num(row.amount)}</td>
          <td style={cellCenter}>{isIgst ? row.igstPercent : row.sgstPercent + row.cgstPercent}%</td>
          <td style={cellRight}>{num(isIgst ? row.igstAmt : row.sgstAmt + row.cgstAmt)}</td>
          <td style={cellRight}>{num(row.total)}</td>
        </tr>
      ))}
      <tr className="estimate-store-total-keep" data-pdf-row style={yellowRow}>
        <td colSpan={10} style={{ ...cellBase, fontWeight: 700, padding: "4px 6px" }}>Total Material Cost</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialBase)}</td>
        <td style={{ ...cellCenter, fontWeight: 700 }}>{isIgst ? "18%" : "18%"}</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(isIgst ? sec.materialIgst : sec.materialSgst + sec.materialCgst)}</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(sec.materialTotal)}</td>
      </tr>
      {sec.serviceRows.length > 0 ? sec.serviceRows.map(item => savedServiceRow(item, `s${sIdx}`)) : (
        <>
          {sec.packingPercent > 0 && (() => { const label = serviceProductLabel({ lineType: "packing", rate: sec.packingPercent, calculationType: "percentage" }, products); return serviceRow(label, label, `${sec.packingPercent}%`, sec.packingBase, `s${sIdx}`); })()}
          {sec.implPercent > 0 && (() => { const label = serviceProductLabel({ lineType: "installation", rate: sec.implPercent, calculationType: "percentage" }, products); return serviceRow(label, label, `${sec.implPercent}%`, sec.implBase, `s${sIdx}`); })()}
          {sec.transportAmt > 0 && (() => { const label = serviceProductLabel({ lineType: "transport", itemName: sec.transportDescription }, products); return serviceRow(label, label, "", sec.transportBase, `s${sIdx}`); })()}
        </>
      )}
      {sIdx < sections.length - 1 && (
        <tr className="estimate-store-spacer">
          <td colSpan={COL_COUNT} style={{ ...cellBase, height: "6px", padding: 0, border: "none" }}></td>
        </tr>
      )}
    </tbody>
  );

  const amountInWords = (numVal: number): string => {
    const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const rounded = Math.round(numVal);
    if (rounded === 0) return "Zero Only";
    const n = ("000000000" + rounded).slice(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    if (!n) return "";
    let str = "";
    const words = (v: string) => a[Number(v)] || `${b[Number(v[0])]} ${a[Number(v[1])]}`;
    if (Number(n[1])) str += `${words(n[1])}Crore `;
    if (Number(n[2])) str += `${words(n[2])}Lakh `;
    if (Number(n[3])) str += `${words(n[3])}Thousand `;
    if (Number(n[4])) str += `${words(n[4])}Hundred `;
    if (Number(n[5])) str += `${str ? "and " : ""}${words(n[5])}`;
    return `${str.trim()} Only`;
  };

  const renderTotalsBody = () => (
    <tbody className="estimate-totals-keep">
      <tr data-pdf-row style={totalRowStyle}>
        <td colSpan={10} style={{ ...cellRight, fontWeight: 700, paddingRight: "8px" }}>TOTAL</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandBeforeTax)}</td>
        <td style={{ ...cellCenter, fontWeight: 700 }}>18%</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(isIgst ? grandIgst : grandSgst + grandCgst)}</td>
        <td style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
      </tr>
      <tr data-pdf-row style={totalRowStyle}>
        <td colSpan={12} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
          TOTAL AMOUNT BEFORE TAX
        </td>
        <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandBeforeTax)}</td>
      </tr>
      {isIgst ? (
        <tr data-pdf-row>
          <td colSpan={12} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
            Add : IGST 18%
          </td>
          <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandIgst)}</td>
        </tr>
      ) : (
        <>
          <tr data-pdf-row>
            <td colSpan={12} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
              Add : CGST 9%
            </td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandCgst)}</td>
          </tr>
          <tr data-pdf-row>
            <td colSpan={12} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
              Add : SGST 9%
            </td>
            <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandSgst)}</td>
          </tr>
        </>
      )}
      <tr data-pdf-row style={totalRowStyle}>
        <td colSpan={12} style={{ ...cellRight, fontWeight: 700, paddingRight: "10px" }}>
          TOTAL AMOUNT AFTER TAX
        </td>
        <td colSpan={2} style={{ ...cellRight, fontWeight: 700 }}>{num(grandTotal)}</td>
      </tr>
      <tr data-pdf-row>
        <td colSpan={COL_COUNT} style={{ ...cellBase, fontWeight: 700, fontStyle: "italic", padding: "5px 8px" }}>
          Amount in Words: {amountInWords(grandTotal)}
        </td>
      </tr>
    </tbody>
  );

  const renderFooter = () => (
    <div className="estimate-footer-block" data-pdf-row style={{ width: "100%", marginTop: "-1px", boxSizing: "border-box" }}>
      <table className="estimate-document-footer" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "38%" }} />
          <col style={{ width: "34%" }} />
          <col style={{ width: "28%" }} />
        </colgroup>
        <tbody>
          <tr className="estimate-footer-columns" style={{ verticalAlign: "top" }}>
            <td className="estimate-footer-column" style={{ ...cellBase, padding: "6px 8px", verticalAlign: "top" }}>
              <div style={{ color: "#b91c1c", fontWeight: 700, textDecoration: "underline", marginBottom: "3px", fontSize: "9px" }}>Terms &amp; Condition :</div>
              {termsLines.map((line: string, idx: number) => <div key={idx} style={{ fontSize: "8.5px", lineHeight: 1.3 }}>{line}</div>)}
            </td>
            <td className="estimate-footer-column" style={{ ...cellBase, padding: "6px 8px", verticalAlign: "top" }}>
              <div style={{ fontWeight: 700, marginBottom: "3px", fontSize: "9px" }}>BANK ACCOUNT DETAILS</div>
              <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>Bank Name : {sellerProfile?.bankName || "HDFC BANK"}</div>
              <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>Branch Name : {sellerProfile?.bankBranch || "Baner Pune"}</div>
              <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>C.A/c No : {sellerProfile?.bankAccountNumber || "50200019250720"}</div>
              <div style={{ fontSize: "8.5px", lineHeight: 1.4 }}>IFSC NO : {sellerProfile?.bankIfsc || "HDFC0001794"}</div>
            </td>
            <td className="estimate-footer-column estimate-signature-cell" style={{ ...cellBase, padding: "6px 8px", textAlign: "right", verticalAlign: "top" }}>
              <div style={{ fontWeight: 700, fontSize: "9px" }}>For {companyName.toUpperCase()}</div>
              <div className="estimate-signature-space" style={{ height: "46px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                {signatureStampSrc && (
                  <img
                    src={signatureStampSrc}
                    alt="Signature and stamp"
                    className="estimate-signature-stamp"
                    style={{ maxHeight: "42px", maxWidth: "140px", objectFit: "contain" }}
                  />
                )}
              </div>
              <div style={{ fontWeight: 700, fontSize: "9px" }}>Authorised Signatory</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="estimate-brand-footer" style={{ width: "100%", boxSizing: "border-box", backgroundColor: "#f59e0b", color: "#fff", textAlign: "center", padding: "5px 8px", letterSpacing: "0.3px", border: "1px solid #f59e0b", borderTop: "none" }}>
        <div className="estimate-brand-footer-title" style={{ fontSize: "14px", fontWeight: 900, letterSpacing: "1.5px", lineHeight: 1.1 }}>{companyName.toUpperCase()}</div>
        {companyAddress && <div style={{ fontSize: "8px", marginTop: "2px", lineHeight: 1.25 }}>{companyAddress}</div>}
        {(companyMobile || companyEmail) && <div style={{ fontSize: "8px", marginTop: "1px", lineHeight: 1.25 }}>{[companyMobile, companyEmail].filter(Boolean).join("  ·  ")}</div>}
      </div>
    </div>
  );

  return (
    <div
      className="estimate-print"
      data-source="estimate-print"
      data-print-document="true"
      style={{
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <h1 className="estimate-print-title">ESTIMATE</h1>
      {renderDocumentHeader()}
      <table
        className="estimate-table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          boxSizing: "border-box",
        }}
      >
        <colgroup>
          {columnWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        {renderEstimateTableHead()}
        {sections.map((sec, sIdx) => renderStoreSection(sec, sIdx))}
        {renderTotalsBody()}
      </table>
      {renderFooter()}
    </div>
  );
};

export default EstimateDocument;
