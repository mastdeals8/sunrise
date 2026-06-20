import { orderedEstimateItems, orderedStoreKeysFromItems } from "./estimateOrdering";

export const downloadBlob = (blob: Blob, fileName: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Pre-resolved store section — built in EstimatePreview using same logic as PDF rendering.
// This avoids store ID lookup issues in the export function.
export type XlSection = {
  storeName: string;
  storeCode: string;
  materialItems: any[];  // non-service items
  serviceItems: any[];   // packing / installation / transport items
};

// ── Column layout matches approved template (A-Q, 17 cols) ───────────────────
// A(0)=spacer | B(1)=SL | C(2)=TYPE | D(3)=HSN | E(4)=Std/Non | F(5)=PRODUCT DETAILS
// G(6)=W | H(7)=H | I(8)=Qty | J(9)=T.Sqft | K(10)=Rate | L(11)=Amount
// M(12)=SGST% | N(13)=SGST Amt | O(14)=CGST% | P(15)=CGST Amt | Q(16)=Total
const NCOLS = 17;
const C_SL    = 1;
const C_TYPE  = 2;
const C_HSN   = 3;
const C_STD   = 4;
const C_DESC  = 5;
const C_W     = 6;
const C_H     = 7;
const C_QTY   = 8;
const C_TSQFT = 9;
const C_RATE  = 10;
const C_AMT   = 11;
const C_SGSTR = 12;
const C_SGSTA = 13;
const C_CGSTR = 14;
const C_CGSTA = 15;
const C_TOTAL = 16;

const s = (v: any) => (v == null ? "" : String(v));
const n = (v: any) => Number(v) || 0;
const f2 = (v: number) => parseFloat((Math.round(v * 100) / 100).toFixed(2));

type Row = (string | number)[];
const blank = (): Row => Array(NCOLS).fill("");

/**
 * Export estimate to Excel.
 * @param estimate  Estimate record
 * @param sections  Pre-resolved store sections (built in EstimatePreview using same logic as PDF)
 * @param clientName Optional client name fallback
 * @param sellerProfile Seller/company settings
 */
export async function exportEstimateToExcel(
  estimate: any,
  sections: XlSection[],
  clientName?: string,
  sellerProfile?: any,
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const isIgst = estimate.gstType === "IGST";

  // ── Seller info ───────────────────────────────────────────────────────────
  const sp = sellerProfile || {};
  const companyName  = s(sp.name  || "Sunrise Media");
  const companyAddr  = s(sp.address || "");
  const companyGstin = s(sp.gstin  || "");
  const companyPan   = s(sp.pan    || "");
  const bankName     = s(sp.bankName   || "");
  const bankBranch   = s(sp.bankBranch || "");
  const bankAccount  = s(sp.bankAccountNumber || "");
  const bankIfsc     = s(sp.bankIfsc   || "");
  const termsRaw     = s(sp.terms ||
    "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the material.\n3. Transportation charges as per actual.\n4. Any additional work / rework will be extra.");
  const termsLines   = termsRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  // ── Billing / Shipping info ───────────────────────────────────────────────
  const billingName    = s(estimate.billingLegalNameSnapshot || clientName || "");
  const billingAddrRaw = s(estimate.billingAddressSnapshot || "");
  const billingGstin   = s(estimate.billingGstinSnapshot || estimate.gstin || "");
  const billingState   = s(estimate.billingStateCodeSnapshot || "");
  const billingAddrLines = billingAddrRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  const shippingRaw = s(estimate.shippingAddressSnapshot || estimate.shippingTo || "");
  const shippingHasOwn = shippingRaw.trim().length > 0;
  let shippingName = billingName;
  let shippingAddrLines = billingAddrLines;
  if (shippingHasOwn) {
    const shipLines = shippingRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
    if (shipLines.length > 0 && /^M\/S\s*:/i.test(shipLines[0])) {
      shippingName = shipLines[0].replace(/^M\/S\s*:?\s*/i, "").trim();
      shippingAddrLines = shipLines.slice(1);
    } else {
      shippingAddrLines = shipLines;
    }
  }

  const dateStr = (estimate.estimateDate || estimate.createdAt)
    ? new Date(estimate.estimateDate || estimate.createdAt)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-")
    : "";
  const estNo      = s(estimate.estimateNumber ?? estimate.estimate_number ?? estimate.id);
  const vendorCode = s(estimate.vendorCode || "");
  const subject    = s(estimate.subject || estimate.title || "");
  const poNumber   = s(estimate.poNumber || "");

  // ── Row / merge / height accumulators ────────────────────────────────────
  const rows: Row[] = [];
  const rowHeights: number[] = [];
  const merges: any[] = [];

  const merge = (r: number, c1: number, c2: number) =>
    c2 > c1 && merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  const addRow = (cells: Row, hpt = 14.25): number => {
    while (cells.length < NCOLS) cells.push("");
    rows.push(cells);
    rowHeights.push(hpt);
    return rows.length - 1;
  };

  // Style tracking (0-based row indices)
  const companyRows: number[] = [];
  const companySubRows: number[] = [];
  const billingHdrRows: number[] = [];
  const billingBodyRows: number[] = [];
  const subjectRows: number[] = [];
  const colHdrRows: number[] = [];
  const storeHdrRows: number[] = [];
  const itemRowIdxs: number[] = [];
  const matTotalRows: number[] = [];
  const svcRowIdxs: number[] = [];
  const grandTotalRows: number[] = [];
  const grandBeforeTaxRows: number[] = [];
  const termsHdrRows: number[] = [];
  const termsBodyRows: number[] = [];
  const bankLabelRows: number[] = [];
  const spacerRows: number[] = [];

  // ── COMPANY HEADER ────────────────────────────────────────────────────────
  {
    const r0 = addRow([...Array(NCOLS).fill("")].map((_, i) => i === C_TYPE ? companyName : ""), 20);
    companyRows.push(r0);
    merge(r0, C_SL, C_TOTAL);

    if (companyAddr) {
      const row: Row = blank();
      row[C_TYPE] = companyAddr;
      const r1 = addRow(row, 14.25);
      companySubRows.push(r1);
      merge(r1, C_SL, C_TOTAL);
    }
    if (companyGstin || companyPan) {
      const row: Row = blank();
      row[C_TYPE] = `${companyGstin ? `GSTIN: ${companyGstin}` : ""}${companyGstin && companyPan ? "   |   " : ""}${companyPan ? `PAN: ${companyPan}` : ""}`;
      const r2 = addRow(row, 14.25);
      companySubRows.push(r2);
      merge(r2, C_SL, C_TOTAL);
    }
  }

  // Spacer
  { const r = addRow(blank(), 6); spacerRows.push(r); }

  // ── BILLING + META + SHIPPING ─────────────────────────────────────────────
  // Layout: col C:J (indices 2-9) = billing/shipping text   |   col K (10) = meta label   |   col L:M (11-12) = meta value
  //
  // Rows 0..max(billing, meta)-1: billing side-by-side with meta
  // Rows billing..billing+shipping-1: shipping text in col C

  const billingLines: string[] = [
    "Billing To",
    `M/S : ${billingName}`,
    ...billingAddrLines,
    billingState ? `State Code: ${billingState}` : "",
    billingGstin ? `GSTN - ${billingGstin}` : "",
  ].filter(Boolean);

  const metaLines: [string, string][] = [
    ["Date :", dateStr],
    ["Est - No -", estNo],
    ...(companyGstin ? [["GSTN -", companyGstin] as [string, string]] : []),
    ...(companyPan ? [["PAN -", companyPan] as [string, string]] : []),
    ...(vendorCode ? [["Vendor Code -", vendorCode] as [string, string]] : []),
    ...(poNumber ? [["PO No -", poNumber] as [string, string]] : []),
  ];

  const shippingLines: string[] = [
    "Shipping To",
    `M/S : ${shippingName}`,
    ...shippingAddrLines,
    billingGstin ? `GSTN - ${billingGstin}` : "",
  ].filter(Boolean);

  // Billing + meta block
  const billingBlockStart = rows.length;
  const billingRows = Math.max(billingLines.length, metaLines.length);
  for (let i = 0; i < billingRows; i++) {
    const row: Row = blank();
    if (i < billingLines.length) row[C_TYPE] = billingLines[i];
    if (i < metaLines.length) {
      row[C_RATE] = metaLines[i][0];    // col K
      row[C_AMT]  = metaLines[i][1];    // col L
    }
    const ri = addRow(row, 14.25);
    merge(ri, C_TYPE, C_RATE - 1);    // C:J for billing text
    merge(ri, C_AMT, C_AMT + 1);      // L:M for meta value
    if (i === 0) billingHdrRows.push(ri);
    else billingBodyRows.push(ri);
  }

  // Shipping block (below billing)
  for (let i = 0; i < shippingLines.length; i++) {
    const row: Row = blank();
    row[C_TYPE] = shippingLines[i];
    const ri = addRow(row, 14.25);
    merge(ri, C_TYPE, C_RATE - 1);
    if (i === 0) billingHdrRows.push(ri);
    else billingBodyRows.push(ri);
  }

  // Spacer
  { const r = addRow(blank(), 6); spacerRows.push(r); }

  // ── SUBJECT ───────────────────────────────────────────────────────────────
  {
    const row: Row = blank();
    row[C_SL] = `Subject : ${subject}`;
    const ri = addRow(row, 14.25);
    merge(ri, C_SL, C_TOTAL);
    subjectRows.push(ri);
  }

  // ── COLUMN HEADERS ────────────────────────────────────────────────────────
  {
    const hdr: Row = [
      "",          // A spacer
      "SL",        // B
      "TYPE",      // C
      "HSN",       // D
      "Standard / Non", // E
      "PRODUCT DETAILS", // F
      "W",         // G
      "H",         // H
      "Qty",       // I
      "T.Sqft",    // J
      "Rate",      // K
      "Amount",    // L
      isIgst ? "IGST%" : "SGST%",  // M
      isIgst ? "IGST Amt" : "SGST Amt", // N
      isIgst ? "" : "CGST%",       // O
      isIgst ? "" : "CGST Amt",    // P
      "Total",     // Q
    ];
    const ri = addRow(hdr, 18);
    colHdrRows.push(ri);
  }

  // ── DATA ROWS ─────────────────────────────────────────────────────────────
  let grandBeforeTax = 0;
  let grandSgst      = 0;
  let grandCgst      = 0;
  let grandIgst      = 0;

  const sgstPct = (item: any): number => n(item.sgstPercent);
  const cgstPct = (item: any): number => n(item.cgstPercent);
  const igstPct = (item: any): number => n(item.igstPercent);

  const sgstAmt = (item: any) => n(item.sgstAmount);
  const cgstAmt = (item: any) => n(item.cgstAmount);
  const igstAmt = (item: any) => n(item.igstAmount);

  const addItemRow = (item: any, sl: number) => {
    const amt   = n(item.totalPrice ?? item.amount);
    const sa    = sgstAmt(item);
    const ca    = cgstAmt(item);
    const ia    = igstAmt(item);
    const total = n(item.totalAmount ?? item.total_amount);
    const row: Row = [
      "",
      sl,
      s(item.itemName || ""),
      s(item.hsn || ""),
      s(item.isStandard === false ? "Non-standard" : "Standard"),
      s(item.description || ""),
      item.width    ? f2(n(item.width))    : "",
      item.height   ? f2(n(item.height))   : "",
      item.quantity != null ? f2(n(item.quantity)) : "",
      item.totalSize != null ? f2(n(item.totalSize)) : "",
      item.rate != null ? f2(n(item.rate)) : "",
      f2(amt),
      isIgst ? (igstPct(item) || "") : (sgstPct(item) ? `${sgstPct(item)}%` : ""),
      isIgst ? f2(ia) : f2(sa),
      isIgst ? "" : (cgstPct(item) ? `${cgstPct(item)}%` : ""),
      isIgst ? "" : f2(ca),
      f2(total),
    ];
    const ri = addRow(row, 14.25);
    itemRowIdxs.push(ri);
    grandBeforeTax += amt;
    grandSgst += sa;
    grandCgst += ca;
    grandIgst += ia;
  };

  const addServiceRow = (item: any, sl: number | "") => {
    const base  = n(item.totalPrice ?? item.amount);
    const sa    = sgstAmt(item);
    const ca    = cgstAmt(item);
    const ia    = igstAmt(item);
    const total = n(item.totalAmount ?? item.total_amount);
    const rateLabel = item.calculationType === "percentage" ? `${n(item.rate)}%` : (item.rate != null ? f2(n(item.rate)) : "");
    const row: Row = [
      "",
      sl,
      s(item.itemName || ""),
      s(item.hsn || "9987"),
      "Standard",
      s(item.description || item.itemName || ""),
      "",
      "",
      item.quantity != null ? f2(n(item.quantity)) : "",
      "",
      rateLabel,
      f2(base),
      isIgst ? (igstPct(item) || "") : (sgstPct(item) ? `${sgstPct(item)}%` : ""),
      isIgst ? f2(ia) : f2(sa),
      isIgst ? "" : (cgstPct(item) ? `${cgstPct(item)}%` : ""),
      isIgst ? "" : f2(ca),
      f2(total),
    ];
    const ri = addRow(row, 14.25);
    svcRowIdxs.push(ri);
    grandBeforeTax += base;
    grandSgst += sa;
    grandCgst += ca;
    grandIgst += ia;
  };

  sections.forEach((sec, sIdx) => {
    if (sec.materialItems.length === 0 && sec.serviceItems.length === 0) return;

    // Store header row — text in col C, no explicit merge (text overflows)
    const storeLabel = `Store: ${sec.storeName}${sec.storeCode ? `,  Store Code : ${sec.storeCode}` : ""}`;
    const shRow: Row = blank();
    shRow[C_TYPE] = storeLabel;
    const shri = addRow(shRow, 14.25);
    storeHdrRows.push(shri);
    merge(shri, C_SL, C_TOTAL); // merge full width for store header

    // Material items
    sec.materialItems.forEach((it, idx) => addItemRow(it, idx + 1));

    // Total material row (yellow)
    if (sec.materialItems.length > 0) {
      const matBase = sec.materialItems.reduce((sum: number, it: any) => sum + n(it.totalPrice ?? it.amount), 0);
      const matSgst = sec.materialItems.reduce((sum: number, it: any) => sum + sgstAmt(it), 0);
      const matCgst = sec.materialItems.reduce((sum: number, it: any) => sum + cgstAmt(it), 0);
      const matIgst = sec.materialItems.reduce((sum: number, it: any) => sum + igstAmt(it), 0);
      const matTotal = sec.materialItems.reduce((sum: number, it: any) => sum + n(it.totalAmount ?? it.total_amount), 0);
      const matRow: Row = blank();
      matRow[C_W] = "Total Material Cost";  // col G
      matRow[C_AMT]   = f2(matBase);
      matRow[C_SGSTR] = "";
      matRow[C_SGSTA] = isIgst ? f2(matIgst) : f2(matSgst);
      matRow[C_CGSTR] = "";
      matRow[C_CGSTA] = isIgst ? "" : f2(matCgst);
      matRow[C_TOTAL] = f2(matTotal);
      const mri = addRow(matRow, 14.25);
      matTotalRows.push(mri);
      merge(mri, C_W, C_RATE); // G:K for label
    }

    // Service items
    sec.serviceItems.forEach((it, idx) => addServiceRow(it, sec.materialItems.length + idx + 1));

    // Spacer between stores (not after last)
    if (sIdx < sections.length - 1) {
      const si = addRow(blank(), 6);
      spacerRows.push(si);
    }
  });

  // ── GRAND TOTALS ──────────────────────────────────────────────────────────
  { const r = addRow(blank(), 8); spacerRows.push(r); }

  const addGrandRow = (label: string, amt: number, sgst: number, cgst: number, igst: number, total: number, isTaxRow = false) => {
    const row: Row = blank();
    row[C_W] = label;             // col G (will be merged G:K)
    if (!isTaxRow) row[C_AMT] = f2(amt);
    if (!isTaxRow) row[C_SGSTA] = isIgst ? f2(igst) : f2(sgst);
    if (!isTaxRow && !isIgst) row[C_CGSTA] = f2(cgst);
    row[C_TOTAL] = f2(total);
    const ri = addRow(row, 14.25);
    grandTotalRows.push(ri);
    merge(ri, C_W, C_RATE);      // G:K label
    return ri;
  };

  const addBeforeAfterTaxRow = (label: string, total: number) => {
    const row: Row = blank();
    row[C_W] = label;
    row[C_TOTAL] = f2(total);
    const ri = addRow(row, 14.25);
    grandBeforeTaxRows.push(ri);
    merge(ri, C_W, C_CGSTA);    // G:P label (very wide)
    return ri;
  };

  // TOTAL row (with SGST/CGST breakdown)
  const grandTotal = grandBeforeTax + grandSgst + grandCgst + grandIgst;
  addGrandRow("TOTAL", grandBeforeTax, grandSgst, grandCgst, grandIgst, grandTotal);

  // Before / after tax
  addBeforeAfterTaxRow("TOTAL AMOUNT BEFORE TAX", grandBeforeTax);
  if (isIgst) {
    addBeforeAfterTaxRow(`Add  :  IGST  18%`, grandIgst);
  } else {
    addBeforeAfterTaxRow(`Add  :  CGST  9%`, grandCgst);
    addBeforeAfterTaxRow(`Add  :  SGST  9%`, grandSgst);
  }
  addBeforeAfterTaxRow("TOTAL AMOUNT AFTER TAX", grandTotal);

  // ── FOOTER: TERMS + BANK ──────────────────────────────────────────────────
  { const r = addRow(blank(), 8); spacerRows.push(r); }

  {
    const row: Row = blank();
    row[C_TYPE] = "Terms & Condition :";
    const ri = addRow(row, 14.25);
    termsHdrRows.push(ri);
  }

  const bankLines = [
    `Bank Name : ${bankName}`,
    `Branch Name : ${bankBranch}`,
    `C.A/c No : ${bankAccount}`,
    `IFSC No : ${bankIfsc}`,
  ];

  const footerLen = Math.max(termsLines.length, bankLines.length);
  for (let i = 0; i < footerLen; i++) {
    const row: Row = blank();
    if (i < termsLines.length) row[C_TYPE] = termsLines[i];
    if (i < bankLines.length) row[C_DESC] = bankLines[i];   // col F
    const ri = addRow(row, 14.25);
    termsBodyRows.push(ri);
    if (i < bankLines.length) bankLabelRows.push(ri);
  }

  // Signature
  { const r = addRow(blank(), 8); spacerRows.push(r); }
  {
    const row: Row = blank();
    row[C_SGSTR] = `For ${companyName.toUpperCase()}`;
    addRow(row, 14.25);
  }
  {
    const row: Row = blank();
    row[C_SGSTR] = "Authorised Signatory";
    addRow(row, 14.25);
  }

  // ── BUILD WORKSHEET ───────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths from approved template
  ws["!cols"] = [
    { wch: 0.5  },  // A: spacer
    { wch: 3.5  },  // B: SL
    { wch: 25   },  // C: TYPE/item name
    { wch: 6.17 },  // D: HSN
    { wch: 12.67},  // E: Standard/Non
    { wch: 39.83},  // F: PRODUCT DETAILS
    { wch: 3.83 },  // G: W
    { wch: 4.5  },  // H: H
    { wch: 5.67 },  // I: Qty
    { wch: 7.67 },  // J: T.Sqft
    { wch: 7.67 },  // K: Rate
    { wch: 11   },  // L: Amount
    { wch: 4.67 },  // M: SGST%
    { wch: 8.17 },  // N: SGST Amt
    { wch: 4.67 },  // O: CGST%
    { wch: 8.17 },  // P: CGST Amt
    { wch: 11.33},  // Q: Total
  ];

  ws["!rows"] = rowHeights.map(hpt => ({ hpt, hpx: hpt }));
  ws["!merges"] = merges;

  ws["!pageSetup"] = {
    paperSize: 9,          // A4
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 };

  // ── STYLES ────────────────────────────────────────────────────────────────
  const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const setS = (r: number, c: number, style: any) => {
    const ref = enc(r, c);
    if (!ws[ref]) ws[ref] = { v: "", t: "s" };
    ws[ref].s = style;
  };
  const applyRow = (r: number, style: any, from = 0, to = NCOLS - 1) => {
    for (let c = from; c <= to; c++) setS(r, c, style);
  };

  const thin = { style: "thin", color: { rgb: "AAAAAA" } };
  const darkThin = { style: "thin", color: { rgb: "000000" } };
  const bord = { top: thin, bottom: thin, left: thin, right: thin };
  const darkBord = { top: darkThin, bottom: darkThin, left: darkThin, right: darkThin };

  // Company name
  companyRows.forEach(r => applyRow(r, {
    font: { bold: true, sz: 14 },
    alignment: { horizontal: "center", vertical: "center" },
  }));
  companySubRows.forEach(r => applyRow(r, {
    font: { sz: 9 },
    alignment: { horizontal: "center", vertical: "center" },
  }));

  // Billing headers
  billingHdrRows.forEach(r => applyRow(r, {
    font: { bold: true, sz: 9 },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
  }));
  billingBodyRows.forEach(r => applyRow(r, {
    font: { sz: 9 },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  }));

  // Subject row
  subjectRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: "center", vertical: "center" },
        border: darkBord,
      });
    }
  });

  // Column headers
  colHdrRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: darkBord,
      });
    }
  });

  // Store header rows
  storeHdrRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "EEF2F7" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: darkBord,
      });
    }
  });

  // Item rows
  itemRowIdxs.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      const isNum = c >= C_W && c !== C_SGSTR && c !== C_CGSTR;
      setS(r, c, {
        font: { sz: 9 },
        alignment: {
          horizontal: c === C_SL ? "center" : isNum ? "right" : "left",
          vertical: "center",
          wrapText: c === C_DESC,
        },
        border: bord,
      });
    }
  });

  // Material total rows (yellow)
  matTotalRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "FFF066" } },
        alignment: {
          horizontal: c >= C_AMT ? "right" : c === C_W ? "left" : "center",
          vertical: "center",
        },
        border: darkBord,
      });
    }
  });

  // Service rows
  svcRowIdxs.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { sz: 9 },
        alignment: { horizontal: c >= C_AMT ? "right" : "left", vertical: "center" },
        border: bord,
      });
    }
  });

  // Grand total rows (TOTAL row with SGST/CGST)
  grandTotalRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F0F4F8" } },
        alignment: { horizontal: c >= C_AMT ? "right" : "left", vertical: "center" },
        border: darkBord,
      });
    }
  });

  // Before/after tax rows
  grandBeforeTaxRows.forEach(r => {
    for (let c = 0; c < NCOLS; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F0F4F8" } },
        alignment: { horizontal: c >= C_TOTAL ? "right" : "left", vertical: "center" },
        border: darkBord,
      });
    }
  });

  // Terms
  termsHdrRows.forEach(r => applyRow(r, {
    font: { bold: true, sz: 9, color: { rgb: "881C1C" } },
    alignment: { horizontal: "left", vertical: "center" },
  }));
  termsBodyRows.forEach(r => applyRow(r, {
    font: { sz: 9 },
    alignment: { horizontal: "left", vertical: "top", wrapText: true },
  }));
  bankLabelRows.forEach(r => {
    setS(r, C_DESC, { font: { bold: true, sz: 9 }, alignment: { horizontal: "left" } });
  });

  // Spacer rows — no border/fill needed
  spacerRows.forEach(r => applyRow(r, {}));

  // ── WORKBOOK ──────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estimate");

  const fileName = `Estimate_${estNo.replace(/[\/\\:*?"<>|]+/g, "-")}.xlsx`;
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName,
  );
}
