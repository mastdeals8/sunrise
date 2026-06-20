import { orderedEstimateItems, orderedStoreKeysFromItems } from "./estimateOrdering";

export const downloadBlob = (blob: Blob, fileName: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

const SERVICE_LINE_TYPES = new Set(["packing", "installation", "transport"]);
const isServiceItem = (item: any) =>
  SERVICE_LINE_TYPES.has(String(item.lineType || "").toLowerCase());

const s = (v: any) => (v == null ? "" : String(v));
const n = (v: any) => Number(v) || 0;
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

// ── Column definitions (14, matching the PDF estimate table) ─────────────────
// SL | ELEMENT | HSN | Standard/Non | PRODUCT DETAILS | W | H | Qty | T.Sqft | Rate | Amount | GST % | GST Amount | Total
const COL = 14;
const COL_AMOUNT = 10;   // 0-based index of Amount column
const COL_GST_PCT = 11;  // GST %
const COL_GST_AMT = 12;  // GST Amount
const COL_TOTAL = 13;    // Total

type Row = (string | number)[];

const blank14 = (): Row => Array(COL).fill("");

/** Client-side Excel export matching the PDF estimate layout. */
export async function exportEstimateToExcel(
  estimate: any,
  items: any[],
  clientName?: string,
  sellerProfile?: any,
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const isIgst = estimate.gstType === "IGST";
  const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
  const hasGrouping = Object.keys(storeGrouping).length > 0;
  const sortedItems = orderedEstimateItems(items);

  // ── Resolve seller / billing info ────────────────────────────────────────
  const sp = sellerProfile || {};
  const companyName = s(sp.name || "Sunrise Media");
  const companyAddress = s(sp.address || "");
  const companyGstin = s(sp.gstin || "");
  const companyPan = s(sp.pan || "");
  const bankName = s(sp.bankName || "");
  const bankBranch = s(sp.bankBranch || "");
  const bankAccount = s(sp.bankAccountNumber || "");
  const bankIfsc = s(sp.bankIfsc || "");
  const termsRaw = s(sp.terms || "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the material.\n3. Transportation charges as per actual.\n4. Any additional work / rework will be extra.");
  const termsLines = termsRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  const billingName = s(estimate.billingLegalNameSnapshot || clientName || estimate.clientId || "");
  const billingAddr = s(estimate.billingAddressSnapshot || "");
  const billingGstin = s(estimate.billingGstinSnapshot || estimate.gstin || "");
  const billingStateCode = s(estimate.billingStateCodeSnapshot || "");
  const shippingRaw = s(estimate.shippingAddressSnapshot || estimate.shippingTo || "");
  const shippingHasOwn = shippingRaw.trim().length > 0 && shippingRaw.trim() !== billingAddr.trim();
  const shippingName = shippingHasOwn ? billingName : billingName;
  const shippingAddr = shippingHasOwn ? shippingRaw : billingAddr;

  const dateStr = (estimate.estimateDate || estimate.createdAt)
    ? new Date(estimate.estimateDate || estimate.createdAt)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-")
    : "";
  const estNo = s(estimate.estimateNumber ?? estimate.estimate_number ?? estimate.id);
  const vendorCode = s(estimate.vendorCode || "");
  const subject = s(estimate.subject || estimate.title || "");
  const poNumber = s(estimate.poNumber || "");

  // ── Rows accumulator ─────────────────────────────────────────────────────
  const rows: Row[] = [];

  // Track which row indices need special styles
  const companyNameRowIdx: number[] = [];
  const sectionLabelRowIdxs: number[] = [];   // "Billing To", "Shipping To" labels
  const storeHeaderRowIdxs: number[] = [];
  const columnHeaderRowIdx: number[] = [];
  const materialTotalRowIdxs: number[] = [];
  const serviceRowIdxs: number[] = [];
  const grandTotalRowIdxs: number[] = [];
  const bankRowIdxs: number[] = [];
  const termsTitleIdx: number[] = [];
  const termsBodyIdxs: number[] = [];

  const push = (...cells: (string | number)[]) => {
    const row: Row = [...cells];
    while (row.length < COL) row.push("");
    rows.push(row);
  };

  // ── HEADER SECTION ───────────────────────────────────────────────────────
  // Row 1: Company name (merged all cols)
  companyNameRowIdx.push(rows.length);
  push(companyName);

  // Row 2: Company address (merged)
  if (companyAddress) push(companyAddress);
  // Row 3: GSTIN / PAN
  if (companyGstin || companyPan) {
    push(`${companyGstin ? `GSTIN: ${companyGstin}` : ""}${companyGstin && companyPan ? "   |   " : ""}${companyPan ? `PAN: ${companyPan}` : ""}`);
  }

  push(...blank14()); // spacer

  // ── BILLING / SHIPPING + META ────────────────────────────────────────────
  // Left half (cols 0-6): Billing To; Right half (cols 7-13): Estimate meta
  // We simulate side-by-side by putting data in specific columns

  const billingLines = [
    `Billing To`,
    `M/S : ${billingName}`,
    ...billingAddr.split(/\n+/).map(l => l.trim()).filter(Boolean),
    billingStateCode ? `State Code: ${billingStateCode}` : "",
    billingGstin ? `GSTIN: ${billingGstin}` : "",
  ].filter(Boolean);

  const shippingLines = shippingHasOwn ? [
    "Shipping To",
    `M/S : ${shippingName}`,
    ...shippingAddr.split(/\n+/).map(l => l.trim()).filter(Boolean),
  ] : [`Shipping To`, `M/S : ${shippingName}`, ...billingAddr.split(/\n+/).map(l => l.trim()).filter(Boolean)];

  const metaLines: [string, string][] = [
    ["Date :", dateStr],
    ["Est No :", estNo],
    ...(vendorCode ? [["Vendor Code :", vendorCode] as [string, string]] : []),
    ...(poNumber ? [["PO No :", poNumber] as [string, string]] : []),
    ...(companyGstin ? [["GSTIN :", companyGstin] as [string, string]] : []),
    ...(companyPan ? [["PAN :", companyPan] as [string, string]] : []),
  ];

  const headerRows = Math.max(billingLines.length, shippingLines.length, metaLines.length, 3);
  for (let i = 0; i < headerRows; i++) {
    const row: Row = Array(COL).fill("");
    // Left: billing (cols 0-5)
    if (i < billingLines.length) row[0] = billingLines[i];
    // Middle: shipping (cols 6-9)
    if (i < shippingLines.length) row[6] = shippingLines[i];
    // Right: meta (cols 10-13) — label in col 10, value in col 12
    if (i < metaLines.length) {
      row[10] = metaLines[i][0];
      row[12] = metaLines[i][1];
    }
    if (i === 0) sectionLabelRowIdxs.push(rows.length);
    rows.push(row);
  }

  push(...blank14()); // spacer

  // ── TABLE: SUBJECT + COLUMN HEADERS ─────────────────────────────────────
  // Subject row (merged)
  push(`Subject : ${subject}`);

  // Column headers
  columnHeaderRowIdx.push(rows.length);
  push("SL", "ELEMENT", "HSN", "Standard / Non", "PRODUCT DETAILS", "W", "H", "Qty", "T.Sqft", "Rate", "Amount", "GST %", "GST Amount", "Total");

  // ── DATA ROWS ────────────────────────────────────────────────────────────
  let grandBeforeTax = 0;
  let grandGst = 0;

  const gstPctLabel = (item: any) => {
    const pct = isIgst ? n(item.igstPercent) : n(item.cgstPercent) + n(item.sgstPercent);
    return pct > 0 ? `${pct}%` : "";
  };
  const gstAmt = (item: any) =>
    isIgst ? n(item.igstAmount) : n(item.cgstAmount) + n(item.sgstAmount);

  const addItemRow = (item: any, sl: number) => {
    const amt = n(item.totalPrice ?? item.amount);
    const gst = gstAmt(item);
    const total = n(item.totalAmount ?? item.total_amount);
    push(
      sl, s(item.itemName || ""), s(item.hsn || ""), s(item.isStandard === false ? "Non-standard" : "Standard"),
      s(item.description || ""),
      item.width ? f2(n(item.width)) : "",
      item.height ? f2(n(item.height)) : "",
      item.quantity != null ? f2(n(item.quantity)) : "",
      item.totalSize != null ? f2(n(item.totalSize)) : "",
      item.rate != null ? f2(n(item.rate)) : "",
      f2(amt), gstPctLabel(item), f2(gst), f2(total),
    );
  };

  const addServiceRowXl = (item: any) => {
    const base = n(item.totalPrice ?? item.amount);
    const gst = gstAmt(item);
    const total = n(item.totalAmount ?? item.total_amount);
    const rateLabel = item.calculationType === "percentage" ? `${n(item.rate)}%` : "";
    serviceRowIdxs.push(rows.length);
    push(
      "", s(item.itemName || ""), s(item.hsn || "9987"), "Standard",
      s(item.itemName || ""),
      "", "", item.quantity != null ? f2(n(item.quantity)) : "",
      "", rateLabel, f2(base), gstPctLabel(item), f2(gst), f2(total),
    );
  };

  const addSyntheticServiceRow = (kind: string, descr: string, rateLabel: string, base: number) => {
    if (base <= 0) return;
    const SERVICE_TAX_PCT = 18;
    const gst = base * SERVICE_TAX_PCT / 100;
    const total = base + gst;
    serviceRowIdxs.push(rows.length);
    push(
      "", kind, "9987", "Standard", descr,
      "", "", "", "", rateLabel, f2(base), "18%", f2(gst), f2(total),
    );
  };

  const processStore = (storeLabel: string, storeCode: string, materialItems: any[], serviceItems: any[]) => {
    if (materialItems.length === 0 && serviceItems.length === 0) return;

    // Store header row (merged)
    storeHeaderRowIdxs.push(rows.length);
    push(`Store: ${storeLabel}${storeCode ? `,  Store Code : ${storeCode}` : ""}`);

    // Material item rows
    materialItems.forEach((it, idx) => addItemRow(it, idx + 1));

    // Material total row (yellow)
    const matBase = materialItems.reduce((sum, it) => sum + n(it.totalPrice ?? it.amount), 0);
    const matGst = materialItems.reduce((sum, it) => sum + gstAmt(it), 0);
    const matTotal = materialItems.reduce((sum, it) => sum + n(it.totalAmount ?? it.total_amount), 0);

    if (materialItems.length > 0) {
      materialTotalRowIdxs.push(rows.length);
      const r: Row = Array(COL).fill("");
      r[1] = "Total Material Cost";
      r[COL_AMOUNT] = f2(matBase);
      r[COL_GST_PCT] = "18%";
      r[COL_GST_AMT] = f2(matGst);
      r[COL_TOTAL] = f2(matTotal);
      rows.push(r);
    }

    // Service rows
    if (serviceItems.length > 0) {
      serviceItems.forEach(it => addServiceRowXl(it));
    }

    // Grand accumulate
    const allItems = [...materialItems, ...serviceItems];
    grandBeforeTax += allItems.reduce((sum, it) => sum + n(it.totalPrice ?? it.amount), 0);
    grandGst += allItems.reduce((sum, it) => sum + gstAmt(it), 0);
  };

  if (hasGrouping) {
    const storeKeys = orderedStoreKeysFromItems(sortedItems, storeGrouping);
    storeKeys.forEach((sidKey, sIdx) => {
      const groupData = storeGrouping[sidKey];
      const itemSls: number[] = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
      const slSet = new Set(itemSls.map(Number));
      const storeItems = sortedItems.filter(it => slSet.has(Number(it.sl)));
      if (storeItems.length === 0) return;

      const materialItems = storeItems.filter(it => !isServiceItem(it));
      const serviceItems = storeItems.filter(it => isServiceItem(it));
      const storeName = (!Array.isArray(groupData) && groupData?.storeName) ? s(groupData.storeName) : `Store ${sidKey}`;
      const storeCode = storeItems.find((it: any) => it.storeCode)?.storeCode || "";

      processStore(storeName, storeCode, materialItems, serviceItems);

      if (sIdx < storeKeys.length - 1) rows.push(blank14());
    });
  } else {
    const materialItems = sortedItems.filter(it => !isServiceItem(it));
    const serviceItems = sortedItems.filter(it => isServiceItem(it));
    const storeCode = sortedItems.find((it: any) => it.storeCode)?.storeCode || "";
    processStore(s(estimate.title || "Site"), storeCode, materialItems, serviceItems);
  }

  // ── GRAND TOTALS ─────────────────────────────────────────────────────────
  rows.push(blank14()); // spacer

  const makeTotal = (label: string, amtCol: number, val: number) => {
    const r: Row = Array(COL).fill("");
    r[amtCol - 1] = label;
    r[COL_TOTAL] = f2(val);
    grandTotalRowIdxs.push(rows.length);
    rows.push(r);
  };

  // TOTAL row
  const totalRow: Row = Array(COL).fill("");
  totalRow[1] = "TOTAL";
  totalRow[COL_AMOUNT] = f2(grandBeforeTax);
  totalRow[COL_GST_PCT] = "18%";
  totalRow[COL_GST_AMT] = f2(grandGst);
  totalRow[COL_TOTAL] = f2(grandBeforeTax + grandGst);
  grandTotalRowIdxs.push(rows.length);
  rows.push(totalRow);

  makeTotal("TOTAL AMOUNT BEFORE TAX", COL_TOTAL, grandBeforeTax);

  if (isIgst) {
    makeTotal("Add : IGST 18%", COL_TOTAL, grandGst);
  } else {
    const half = grandGst / 2;
    makeTotal("Add : CGST 9%", COL_TOTAL, half);
    makeTotal("Add : SGST 9%", COL_TOTAL, half);
  }

  makeTotal("TOTAL AMOUNT AFTER TAX", COL_TOTAL, grandBeforeTax + grandGst);

  // ── FOOTER: TERMS + BANK ─────────────────────────────────────────────────
  rows.push(blank14()); // spacer

  // Terms header
  termsTitleIdx.push(rows.length);
  push("Terms & Conditions :");

  // Terms lines (left), Bank details (right)
  const bankLines: [string, string][] = [
    ["Bank Name :", bankName],
    ["Branch Name :", bankBranch],
    ["C.A/c No :", bankAccount],
    ["IFSC No :", bankIfsc],
  ];

  const maxFooterRows = Math.max(termsLines.length, bankLines.length);
  for (let i = 0; i < maxFooterRows; i++) {
    const r: Row = Array(COL).fill("");
    if (i < termsLines.length) r[0] = termsLines[i];
    if (i < bankLines.length) {
      r[9] = bankLines[i][0];
      r[11] = bankLines[i][1];
      bankRowIdxs.push(rows.length);
    } else {
      termsBodyIdxs.push(rows.length);
    }
    if (i < termsLines.length && i >= bankLines.length) termsBodyIdxs.push(rows.length);
    rows.push(r);
  }

  // Signature line
  rows.push(blank14());
  const sigRow: Row = Array(COL).fill("");
  sigRow[11] = `For ${companyName.toUpperCase()}`;
  rows.push(sigRow);
  const authRow: Row = Array(COL).fill("");
  authRow[11] = "Authorised Signatory";
  rows.push(authRow);

  // ── BUILD WORKSHEET ───────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths matching PDF percentages (14 cols, A4 portrait, ~194mm printable)
  ws["!cols"] = [
    { wch: 5 },   // SL
    { wch: 14 },  // ELEMENT
    { wch: 7 },   // HSN
    { wch: 11 },  // Standard/Non
    { wch: 24 },  // PRODUCT DETAILS
    { wch: 6 },   // W
    { wch: 6 },   // H
    { wch: 6 },   // Qty
    { wch: 8 },   // T.Sqft
    { wch: 9 },   // Rate
    { wch: 11 },  // Amount
    { wch: 7 },   // GST %
    { wch: 11 },  // GST Amount
    { wch: 11 },  // Total
  ];

  // ── MERGES ────────────────────────────────────────────────────────────────
  const merges: any[] = [];
  const merge = (r: number, c1: number, c2: number) => merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  // Merge company name row and metadata rows across all 14 cols
  companyNameRowIdx.forEach(r => merge(r, 0, COL - 1));
  // Merge the row right after company name (address/GSTIN) - first few rows
  const companyBase = companyNameRowIdx[0] ?? 0;
  for (let r = companyBase + 1; r < companyBase + 4; r++) {
    if (r < rows.length) merge(r, 0, COL - 1);
  }

  // Merge store headers across all cols
  storeHeaderRowIdxs.forEach(r => merge(r, 0, COL - 1));

  // Merge subject row across all cols
  // (the subject row is just before column headers)
  const colHdrIdx = columnHeaderRowIdx[0] ?? 0;
  if (colHdrIdx > 0) merge(colHdrIdx - 1, 0, COL - 1);

  ws["!merges"] = merges;

  // ── STYLES ────────────────────────────────────────────────────────────────
  const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const setS = (r: number, c: number, style: any) => {
    const ref = enc(r, c);
    if (!ws[ref]) ws[ref] = { v: "", t: "s" };
    ws[ref].s = style;
  };
  const applyRow = (r: number, style: any, cols = COL) => {
    for (let c = 0; c < cols; c++) setS(r, c, style);
  };

  const darkBorder = { style: "thin", color: { rgb: "000000" } };
  const borders = { top: darkBorder, bottom: darkBorder, left: darkBorder, right: darkBorder };

  // Company name row — large bold centered
  companyNameRowIdx.forEach(r => applyRow(r, {
    font: { bold: true, sz: 14 },
    alignment: { horizontal: "center", vertical: "center" },
  }));

  // Company sub-rows (address/gstin)
  for (let r = (companyNameRowIdx[0] ?? 0) + 1; r < (companyNameRowIdx[0] ?? 0) + 4; r++) {
    if (r < rows.length) applyRow(r, { font: { sz: 9 }, alignment: { horizontal: "center", vertical: "center" } });
  }

  // Billing/shipping header rows (sectionLabelRowIdxs)
  sectionLabelRowIdxs.forEach(r => applyRow(r, { font: { bold: true, sz: 10 } }));

  // Column headers
  columnHeaderRowIdx.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: borders,
      });
    }
  });

  // Subject row (just before column headers)
  const subjR = (columnHeaderRowIdx[0] ?? 1) - 1;
  if (subjR >= 0) applyRow(subjR, { font: { bold: true, sz: 10 }, alignment: { horizontal: "center", vertical: "center" }, border: borders });

  // Store header rows — bold, light grey fill, bordered
  storeHeaderRowIdxs.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Material total rows — yellow, bold, bordered
  materialTotalRowIdxs.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "FFF066" } },
        alignment: { horizontal: c >= COL_AMOUNT ? "right" : c === 1 ? "left" : "center", vertical: "center" },
        border: borders,
      });
    }
  });

  // Service rows — light, bordered
  serviceRowIdxs.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { sz: 9 },
        alignment: { horizontal: c >= COL_AMOUNT ? "right" : "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Grand total rows — bold, light fill, bordered
  grandTotalRowIdxs.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F8FAFC" } },
        alignment: { horizontal: c >= COL_AMOUNT ? "right" : "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Terms title
  termsTitleIdx.forEach(r => applyRow(r, { font: { bold: true, sz: 9, color: { rgb: "B91C1C" } } }));

  // Bank rows
  bankRowIdxs.forEach(r => applyRow(r, { font: { sz: 9 } }));

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
