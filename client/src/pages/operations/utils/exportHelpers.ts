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

// 14 columns matching the PDF estimate layout:
// SL | ELEMENT | HSN | Standard/Non | PRODUCT DETAILS | W | H | Qty | T.Sqft | Rate | Amount | GST% | GST Amount | Total
const COL = 14;
const COL_AMOUNT = 10;
const COL_GST_PCT = 11;
const COL_GST_AMT = 12;
const COL_TOTAL = 13;

type Row = (string | number)[];
const blank14 = (): Row => Array(COL).fill("");

/** Client-side Excel export matching the PDF estimate layout. */
export async function exportEstimateToExcel(
  estimate: any,
  items: any[],
  clientName?: string,
  sellerProfile?: any,
  stores?: any[],
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const isIgst = estimate.gstType === "IGST";
  const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
  const hasGrouping = Object.keys(storeGrouping).length > 0;
  const sortedItems = orderedEstimateItems(items);

  // ── Seller / billing info ────────────────────────────────────────────────
  const sp = sellerProfile || {};
  const companyName = s(sp.name || "Sunrise Media");
  const companyAddress = s(sp.address || "");
  const companyGstin = s(sp.gstin || "");
  const companyPan = s(sp.pan || "");
  const bankName = s(sp.bankName || "");
  const bankBranch = s(sp.bankBranch || "");
  const bankAccount = s(sp.bankAccountNumber || "");
  const bankIfsc = s(sp.bankIfsc || "");
  const termsRaw = s(sp.terms ||
    "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the material.\n3. Transportation charges as per actual.\n4. Any additional work / rework will be extra.");
  const termsLines = termsRaw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);

  const billingName = s(estimate.billingLegalNameSnapshot || clientName || estimate.clientId || "");
  const billingAddr = s(estimate.billingAddressSnapshot || "");
  const billingGstin = s(estimate.billingGstinSnapshot || estimate.gstin || "");
  const billingStateCode = s(estimate.billingStateCodeSnapshot || "");
  const shippingRaw = s(estimate.shippingAddressSnapshot || estimate.shippingTo || "");
  const shippingHasOwn = shippingRaw.trim().length > 0 && shippingRaw.trim() !== billingAddr.trim();
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

  // ── Row accumulator ──────────────────────────────────────────────────────
  const rows: Row[] = [];
  const rowHeights: number[] = []; // hpt per row index

  // Style tracking by row index
  const companyNameRows: number[] = [];
  const companySubRows: number[] = [];
  const billingHeaderRows: number[] = [];  // "Billing To" / "Shipping To" label row
  const billingBodyRows: number[] = [];    // rest of billing block
  const storeHeaderRows: number[] = [];
  const columnHeaderRows: number[] = [];
  const itemRows: number[] = [];
  const materialTotalRows: number[] = [];
  const serviceRows: number[] = [];
  const grandTotalRows: number[] = [];
  const bankRows: number[] = [];
  const termsRows: number[] = [];
  const spacerRows: number[] = [];

  // Merge ranges to apply
  const merges: any[] = [];
  const merge = (r: number, c1: number, c2: number) =>
    merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  const addRow = (cells: Row, hpt = 14) => {
    while (cells.length < COL) cells.push("");
    rows.push(cells);
    rowHeights.push(hpt);
    return rows.length - 1; // 0-based index
  };

  // ── COMPANY HEADER ────────────────────────────────────────────────────────
  const r0 = addRow([companyName], 22);
  companyNameRows.push(r0);

  if (companyAddress) {
    const r1 = addRow([companyAddress], 14);
    companySubRows.push(r1);
  }
  if (companyGstin || companyPan) {
    const r2 = addRow([
      `${companyGstin ? `GSTIN: ${companyGstin}` : ""}${companyGstin && companyPan ? "   |   " : ""}${companyPan ? `PAN: ${companyPan}` : ""}`,
    ], 14);
    companySubRows.push(r2);
  }

  // Spacer
  const spacer1 = addRow(blank14(), 6);
  spacerRows.push(spacer1);

  // ── BILLING / SHIPPING / META ─────────────────────────────────────────────
  // Layout: cols 0-5 = Billing, cols 6-9 = Shipping, cols 10-11 = meta label, cols 12-13 = meta value

  const billingLines = [
    "Billing To",
    `M/S : ${billingName}`,
    ...billingAddr.split(/\n+/).map((l: string) => l.trim()).filter(Boolean),
    billingStateCode ? `State Code: ${billingStateCode}` : "",
    billingGstin ? `GSTIN: ${billingGstin}` : "",
  ].filter(Boolean);

  const shippingLines = [
    "Shipping To",
    `M/S : ${billingName}`,
    ...shippingAddr.split(/\n+/).map((l: string) => l.trim()).filter(Boolean),
  ].filter(Boolean);

  const metaLines: [string, string][] = [
    ["Date :", dateStr],
    ["Est No :", estNo],
    ...(vendorCode ? [["Vendor Code :", vendorCode] as [string, string]] : []),
    ...(poNumber ? [["PO No :", poNumber] as [string, string]] : []),
    ...(companyGstin ? [["GSTIN :", companyGstin] as [string, string]] : []),
    ...(companyPan ? [["PAN :", companyPan] as [string, string]] : []),
  ];

  const billingBlockStart = rows.length;
  const headerRows = Math.max(billingLines.length, shippingLines.length, metaLines.length, 3);

  for (let i = 0; i < headerRows; i++) {
    const row: Row = Array(COL).fill("");
    if (i < billingLines.length) row[0] = billingLines[i];
    if (i < shippingLines.length) row[6] = shippingLines[i];
    if (i < metaLines.length) {
      row[10] = metaLines[i][0];
      row[12] = metaLines[i][1];
    }
    const ri = addRow(row, 14);
    if (i === 0) billingHeaderRows.push(ri);
    else billingBodyRows.push(ri);
  }

  // Merge billing block cols 0-5, shipping cols 6-9, meta label 10-11, meta value 12-13
  for (let r = billingBlockStart; r < rows.length; r++) {
    merge(r, 0, 5);
    merge(r, 6, 9);
    merge(r, 10, 11);
    merge(r, 12, 13);
  }

  // Spacer
  const spacer2 = addRow(blank14(), 6);
  spacerRows.push(spacer2);

  // ── SUBJECT + COLUMN HEADERS ──────────────────────────────────────────────
  const subjectRow = addRow([`Subject : ${subject}`], 16);
  merge(subjectRow, 0, COL - 1);

  const colHdrRow = addRow(
    ["SL", "ELEMENT", "HSN", "Standard / Non", "PRODUCT DETAILS", "W", "H", "Qty", "T.Sqft", "Rate", "Amount", "GST %", "GST Amount", "Total"],
    30,
  );
  columnHeaderRows.push(colHdrRow);

  // ── DATA ROWS ─────────────────────────────────────────────────────────────
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
    const ri = addRow([
      sl,
      s(item.itemName || ""),
      s(item.hsn || ""),
      s(item.isStandard === false ? "Non-standard" : "Standard"),
      s(item.description || ""),
      item.width ? f2(n(item.width)) : "",
      item.height ? f2(n(item.height)) : "",
      item.quantity != null ? f2(n(item.quantity)) : "",
      item.totalSize != null ? f2(n(item.totalSize)) : "",
      item.rate != null ? f2(n(item.rate)) : "",
      f2(amt),
      gstPctLabel(item),
      f2(gst),
      f2(total),
    ], 14);
    itemRows.push(ri);
  };

  const addServiceRow = (item: any) => {
    const base = n(item.totalPrice ?? item.amount);
    const gst = gstAmt(item);
    const total = n(item.totalAmount ?? item.total_amount);
    const rateLabel = item.calculationType === "percentage" ? `${n(item.rate)}%` : "";
    const ri = addRow([
      "",
      s(item.itemName || ""),
      s(item.hsn || "9987"),
      "Standard",
      s(item.itemName || ""),
      "",
      "",
      item.quantity != null ? f2(n(item.quantity)) : "",
      "",
      rateLabel,
      f2(base),
      gstPctLabel(item),
      f2(gst),
      f2(total),
    ], 14);
    serviceRows.push(ri);
  };

  const processStore = (storeLabelText: string, materialItems: any[], serviceItems: any[]) => {
    if (materialItems.length === 0 && serviceItems.length === 0) return;

    const shri = addRow([storeLabelText], 18);
    storeHeaderRows.push(shri);
    merge(shri, 0, COL - 1);

    materialItems.forEach((it, idx) => addItemRow(it, idx + 1));

    if (materialItems.length > 0) {
      const matBase = materialItems.reduce((sum, it) => sum + n(it.totalPrice ?? it.amount), 0);
      const matGst = materialItems.reduce((sum, it) => sum + gstAmt(it), 0);
      const matTotal = materialItems.reduce((sum, it) => sum + n(it.totalAmount ?? it.total_amount), 0);
      const matRow: Row = Array(COL).fill("");
      matRow[1] = "Total Material Cost";
      matRow[COL_AMOUNT] = f2(matBase);
      matRow[COL_GST_PCT] = "18%";
      matRow[COL_GST_AMT] = f2(matGst);
      matRow[COL_TOTAL] = f2(matTotal);
      const mri = addRow(matRow, 14);
      materialTotalRows.push(mri);
    }

    serviceItems.forEach(it => addServiceRow(it));

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
      const storeItems = sortedItems.filter((it: any) => slSet.has(Number(it.sl)));
      if (storeItems.length === 0) return;

      const materialItems = storeItems.filter((it: any) => !isServiceItem(it));
      const serviceItems = storeItems.filter((it: any) => isServiceItem(it));

      // Resolve store name: prefer stores array lookup, then groupData.storeName, then fallback
      const tStore = stores?.find((st: any) => st.id === Number(sidKey));
      const storeName = tStore?.name
        || (!Array.isArray(groupData) && groupData?.storeName)
        || "";
      const storeCode = tStore?.storeCode
        || storeItems.find((it: any) => it.storeCode)?.storeCode
        || "";

      const storeLabel = `Store: ${storeName || sidKey}${storeCode ? `,  Store Code : ${storeCode}` : ""}`;
      processStore(storeLabel, materialItems, serviceItems);

      if (sIdx < storeKeys.length - 1) {
        const si = addRow(blank14(), 6);
        spacerRows.push(si);
      }
    });
  } else {
    const targetStore = stores?.find((st: any) => st.id === estimate.storeId);
    const materialItems = sortedItems.filter((it: any) => !isServiceItem(it));
    const serviceItems = sortedItems.filter((it: any) => isServiceItem(it));
    const storeName = targetStore?.name || s(estimate.title || "Site");
    const storeCode = targetStore?.storeCode || sortedItems.find((it: any) => it.storeCode)?.storeCode || "";
    const storeLabel = `Store: ${storeName}${storeCode ? `,  Store Code : ${storeCode}` : ""}`;
    processStore(storeLabel, materialItems, serviceItems);
  }

  // ── GRAND TOTALS ──────────────────────────────────────────────────────────
  const spacer3 = addRow(blank14(), 6);
  spacerRows.push(spacer3);

  const makeGrandRow = (label: string, amount: number) => {
    const r: Row = Array(COL).fill("");
    r[COL_TOTAL - 1] = label;
    r[COL_TOTAL] = f2(amount);
    const ri = addRow(r, 14);
    grandTotalRows.push(ri);
  };

  // Main TOTAL row
  const totalRowArr: Row = Array(COL).fill("");
  totalRowArr[1] = "TOTAL";
  totalRowArr[COL_AMOUNT] = f2(grandBeforeTax);
  totalRowArr[COL_GST_PCT] = "18%";
  totalRowArr[COL_GST_AMT] = f2(grandGst);
  totalRowArr[COL_TOTAL] = f2(grandBeforeTax + grandGst);
  const totalRi = addRow(totalRowArr, 14);
  grandTotalRows.push(totalRi);

  makeGrandRow("TOTAL AMOUNT BEFORE TAX", grandBeforeTax);
  if (isIgst) {
    makeGrandRow("Add : IGST 18%", grandGst);
  } else {
    const half = grandGst / 2;
    makeGrandRow("Add : CGST 9%", half);
    makeGrandRow("Add : SGST 9%", half);
  }
  makeGrandRow("TOTAL AMOUNT AFTER TAX", grandBeforeTax + grandGst);

  // ── FOOTER: TERMS + BANK ──────────────────────────────────────────────────
  const spacer4 = addRow(blank14(), 6);
  spacerRows.push(spacer4);

  // Terms header
  const termsTitleRi = addRow(["Terms & Conditions :"], 14);
  termsRows.push(termsTitleRi);
  merge(termsTitleRi, 0, COL - 1);

  const bankLines: [string, string][] = [
    ["Bank Name :", bankName],
    ["Branch Name :", bankBranch],
    ["A/C No :", bankAccount],
    ["IFSC No :", bankIfsc],
  ];

  const footerStart = rows.length;
  const maxFooterRows = Math.max(termsLines.length, bankLines.length);
  for (let i = 0; i < maxFooterRows; i++) {
    const r: Row = Array(COL).fill("");
    if (i < termsLines.length) r[0] = termsLines[i];
    if (i < bankLines.length) {
      r[9] = bankLines[i][0];
      r[11] = bankLines[i][1];
    }
    const ri = addRow(r, 13);
    termsRows.push(ri);
    bankRows.push(ri);
  }

  // Merge terms cols 0-8, bank label 9-10, bank value 11-13 in each footer row
  for (let r = footerStart; r < rows.length; r++) {
    merge(r, 0, 8);
    merge(r, 9, 10);
    merge(r, 11, 13);
  }

  // Signature
  addRow(blank14(), 8);
  const sigRow: Row = Array(COL).fill("");
  sigRow[11] = `For ${companyName.toUpperCase()}`;
  addRow(sigRow, 14);
  const authRow: Row = Array(COL).fill("");
  authRow[11] = "Authorised Signatory";
  addRow(authRow, 14);

  // ── BUILD WORKSHEET ───────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths (14 cols) — proportioned to fit A4 portrait with fitToWidth
  ws["!cols"] = [
    { wch: 5 },   // SL
    { wch: 14 },  // ELEMENT
    { wch: 8 },   // HSN
    { wch: 10 },  // Standard/Non
    { wch: 38 },  // PRODUCT DETAILS (wide — most important)
    { wch: 6 },   // W
    { wch: 6 },   // H
    { wch: 7 },   // Qty
    { wch: 8 },   // T.Sqft
    { wch: 9 },   // Rate
    { wch: 11 },  // Amount
    { wch: 7 },   // GST %
    { wch: 11 },  // GST Amount
    { wch: 11 },  // Total
  ];

  // Row heights
  ws["!rows"] = rowHeights.map(hpt => ({ hpt }));

  // Merges
  ws["!merges"] = merges;

  // Page setup — A4 portrait, fit to 1 page wide
  ws["!pageSetup"] = {
    paperSize: 9,        // A4
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
  const applyStyle = (r: number, style: any, from = 0, to = COL - 1) => {
    for (let c = from; c <= to; c++) setS(r, c, style);
  };

  const thin = { style: "thin", color: { rgb: "000000" } };
  const borders = { top: thin, bottom: thin, left: thin, right: thin };
  const noBorder = {};

  // Company name — large bold centered
  companyNameRows.forEach(r =>
    applyStyle(r, { font: { bold: true, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } }),
  );

  // Company sub-rows — small centered
  companySubRows.forEach(r =>
    applyStyle(r, { font: { sz: 9 }, alignment: { horizontal: "center", vertical: "center" } }),
  );

  // Billing header row — bold
  billingHeaderRows.forEach(r =>
    applyStyle(r, { font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center", wrapText: true } }),
  );

  // Billing body rows — normal
  billingBodyRows.forEach(r =>
    applyStyle(r, { font: { sz: 9 }, alignment: { horizontal: "left", vertical: "top", wrapText: true } }),
  );

  // Subject row — bold centered, bordered
  applyStyle(subjectRow, {
    font: { bold: true, sz: 10 },
    alignment: { horizontal: "center", vertical: "center" },
    border: borders,
  });

  // Column headers — bold, grey fill, centered, bordered, wrapped
  columnHeaderRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: borders,
      });
    }
  });

  // Store header rows — bold, light grey fill, bordered
  storeHeaderRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F1F5F9" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Item rows — normal, bordered
  itemRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      const isNum = c >= 5 && c !== COL_GST_PCT; // W onwards except GST%
      setS(r, c, {
        font: { sz: 9 },
        alignment: {
          horizontal: c === 0 ? "center" : isNum ? "right" : "left",
          vertical: "center",
          wrapText: c === 4, // wrap product details
        },
        border: borders,
      });
    }
  });

  // Material total rows — yellow, bold, bordered
  materialTotalRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "FFF066" } },
        alignment: {
          horizontal: c >= COL_AMOUNT ? "right" : c === 1 ? "left" : "center",
          vertical: "center",
        },
        border: borders,
      });
    }
  });

  // Service rows — normal, bordered
  serviceRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { sz: 9 },
        alignment: { horizontal: c >= COL_AMOUNT ? "right" : "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Grand total rows — bold, light fill, bordered
  grandTotalRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "F0F4F8" } },
        alignment: { horizontal: c >= COL_TOTAL - 1 ? "right" : "left", vertical: "center" },
        border: borders,
      });
    }
  });

  // Terms rows
  termsRows.forEach(r =>
    applyStyle(r, { font: { sz: 9 }, alignment: { horizontal: "left", vertical: "top", wrapText: true } }),
  );

  // Bank label/value columns (override within terms rows)
  bankRows.forEach(r => {
    setS(r, 9, { font: { bold: true, sz: 9 }, alignment: { horizontal: "left", vertical: "top" } });
    setS(r, 10, { font: { bold: true, sz: 9 }, alignment: { horizontal: "left", vertical: "top" } });
    setS(r, 11, { font: { sz: 9 }, alignment: { horizontal: "left", vertical: "top" } });
    setS(r, 12, { font: { sz: 9 }, alignment: { horizontal: "left", vertical: "top" } });
    setS(r, 13, { font: { sz: 9 }, alignment: { horizontal: "left", vertical: "top" } });
  });

  // Spacer rows — no style needed, already blank
  spacerRows.forEach(r => {
    for (let c = 0; c < COL; c++) {
      setS(r, c, { border: noBorder });
    }
  });

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
