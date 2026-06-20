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

const safe = (v: any) => (v == null ? "" : String(v));
const n = (v: any) => Number(v) || 0;
const f2 = (v: number) => v.toFixed(2);

/** Client-side Excel export matching the approved Sunrise estimate format. */
export async function exportEstimateToExcel(
  estimate: any,
  items: any[],
  clientName?: string,
  companyName?: string,
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const cn = companyName || "Sunrise Media";
  const isIgst = estimate.gstType === "IGST";
  const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
  const hasGrouping = Object.keys(storeGrouping).length > 0;
  const sortedItems = orderedEstimateItems(items);

  // ── Row accumulator ────────────────────────────────────────────
  const rows: any[][] = [];
  const metaRowIdxs: number[] = [];
  const columnHeaderRowIdx: number[] = [];
  const storeHeaderRowIdxs: number[] = [];
  const materialTotalRowIdxs: number[] = [];
  const serviceTotalRowIdxs: number[] = [];
  const grandTotalRowIdxs: number[] = [];

  const push = (...row: any[]) => rows.push(row.length === 15 ? row : [...row, ...Array(15 - row.length).fill("")]);
  const blank = () => push("", "", "", "", "", "", "", "", "", "", "", "", "", "", "");

  // ── Header metadata ────────────────────────────────────────────
  metaRowIdxs.push(rows.length);
  push(cn, "", "", "", "", "", "", "", "", "", "", "", "", "", "");

  metaRowIdxs.push(rows.length);
  push(
    `Estimate No: ${safe(estimate.estimateNumber ?? estimate.estimate_number)}`,
    "", "",
    `Date: ${safe(estimate.estimateDate ?? estimate.estimate_date ?? "").slice(0, 10)}`,
    "", "", "", "", "", "", "", "", "", "", "",
  );

  metaRowIdxs.push(rows.length);
  push(
    `Client: ${safe(clientName || estimate.clientId)}`,
    "",
    estimate.title ? `Subject: ${safe(estimate.title)}` : "",
    "", "", "", "", "", "", "", "", "", "", "", "",
  );

  if (estimate.vendorCode) {
    metaRowIdxs.push(rows.length);
    push(`Vendor Code: ${safe(estimate.vendorCode)}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "");
  }

  if (estimate.poNumber) {
    metaRowIdxs.push(rows.length);
    push(`PO Number: ${safe(estimate.poNumber)}`, "", "", "", "", "", "", "", "", "", "", "", "", "", "");
  }

  blank();

  // ── Column headers ─────────────────────────────────────────────
  columnHeaderRowIdx.push(rows.length);
  push("SL", "Store Code", "Element / Product Details", "HSN", "Qty", "Unit", "Rate", "Amount",
    "CGST%", "CGST", "SGST%", "SGST", "IGST%", "IGST", "Total");

  // ── Store-grouped item rows ────────────────────────────────────
  let grandBeforeTax = 0;
  let grandCgst = 0;
  let grandSgst = 0;
  let grandIgst = 0;

  const addItemRow = (it: any, idx: number) => {
    push(
      idx + 1,
      safe(it.storeCode),
      safe(it.itemName || it.item_name || ""),
      safe(it.hsn),
      n(it.quantity),
      safe(it.unit),
      f2(n(it.rate)),
      f2(n(it.totalPrice ?? it.amount)),
      isIgst ? "" : f2(n(it.cgstPercent ?? it.cgst_percent)),
      isIgst ? "" : f2(n(it.cgstAmount ?? it.cgst_amount)),
      isIgst ? "" : f2(n(it.sgstPercent ?? it.sgst_percent)),
      isIgst ? "" : f2(n(it.sgstAmount ?? it.sgst_amount)),
      isIgst ? f2(n(it.igstPercent ?? it.igst_percent)) : "",
      isIgst ? f2(n(it.igstAmount ?? it.igst_amount)) : "",
      f2(n(it.totalAmount ?? it.total_amount)),
    );
  };

  const addServiceRow = (it: any) => {
    serviceTotalRowIdxs.push(rows.length);
    push(
      "",
      safe(it.storeCode),
      safe(it.itemName || it.item_name || ""),
      safe(it.hsn || "9987"),
      f2(n(it.quantity || 1)),
      safe(it.unit || "job"),
      f2(n(it.rate)),
      f2(n(it.totalPrice ?? it.amount)),
      isIgst ? "" : f2(n(it.cgstPercent ?? it.cgst_percent)),
      isIgst ? "" : f2(n(it.cgstAmount ?? it.cgst_amount)),
      isIgst ? "" : f2(n(it.sgstPercent ?? it.sgst_percent)),
      isIgst ? "" : f2(n(it.sgstAmount ?? it.sgst_amount)),
      isIgst ? f2(n(it.igstPercent ?? it.igst_percent)) : "",
      isIgst ? f2(n(it.igstAmount ?? it.igst_amount)) : "",
      f2(n(it.totalAmount ?? it.total_amount)),
    );
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
      const storeName = (!Array.isArray(groupData) && groupData?.storeName) ? String(groupData.storeName) : `Store ${sidKey}`;
      const storeCode = storeItems.find(it => it.storeCode)?.storeCode || "";

      // Store header
      storeHeaderRowIdxs.push(rows.length);
      push(
        `${storeName}${storeCode ? `  —  ${storeCode}` : ""}`,
        "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      );

      // Material rows
      materialItems.forEach((it, idx) => addItemRow(it, idx));

      // Material total (yellow)
      const matBase = materialItems.reduce((s, it) => s + n(it.totalPrice ?? it.amount), 0);
      const matCgst = materialItems.reduce((s, it) => s + n(it.cgstAmount ?? it.cgst_amount), 0);
      const matSgst = materialItems.reduce((s, it) => s + n(it.sgstAmount ?? it.sgst_amount), 0);
      const matIgst = materialItems.reduce((s, it) => s + n(it.igstAmount ?? it.igst_amount), 0);
      const matTotal = materialItems.reduce((s, it) => s + n(it.totalAmount ?? it.total_amount), 0);

      if (materialItems.length > 0) {
        materialTotalRowIdxs.push(rows.length);
        push("", "", "Total Material Cost", "", "", "", "",
          f2(matBase), "", isIgst ? "" : f2(matCgst), "", isIgst ? "" : f2(matSgst),
          isIgst ? f2(matIgst) : "", "", f2(matTotal));
      }

      // Service rows
      serviceItems.forEach(it => addServiceRow(it));

      // Accumulate
      const allItems = [...materialItems, ...serviceItems];
      grandBeforeTax += allItems.reduce((s, it) => s + n(it.totalPrice ?? it.amount), 0);
      grandCgst += allItems.reduce((s, it) => s + n(it.cgstAmount ?? it.cgst_amount), 0);
      grandSgst += allItems.reduce((s, it) => s + n(it.sgstAmount ?? it.sgst_amount), 0);
      grandIgst += allItems.reduce((s, it) => s + n(it.igstAmount ?? it.igst_amount), 0);

      if (sIdx < storeKeys.length - 1) blank();
    });
  } else {
    // Flat list (single store)
    const materialItems = sortedItems.filter(it => !isServiceItem(it));
    const serviceItems = sortedItems.filter(it => isServiceItem(it));

    materialItems.forEach((it, idx) => addItemRow(it, idx));

    const matBase = materialItems.reduce((s, it) => s + n(it.totalPrice ?? it.amount), 0);
    const matCgst = materialItems.reduce((s, it) => s + n(it.cgstAmount ?? it.cgst_amount), 0);
    const matSgst = materialItems.reduce((s, it) => s + n(it.sgstAmount ?? it.sgst_amount), 0);
    const matIgst = materialItems.reduce((s, it) => s + n(it.igstAmount ?? it.igst_amount), 0);
    const matTotal = materialItems.reduce((s, it) => s + n(it.totalAmount ?? it.total_amount), 0);

    if (materialItems.length > 0) {
      materialTotalRowIdxs.push(rows.length);
      push("", "", "Total Material Cost", "", "", "", "",
        f2(matBase), "", isIgst ? "" : f2(matCgst), "", isIgst ? "" : f2(matSgst),
        isIgst ? f2(matIgst) : "", "", f2(matTotal));
    }

    serviceItems.forEach(it => addServiceRow(it));

    grandBeforeTax = items.reduce((s, it) => s + n(it.totalPrice ?? it.amount), 0);
    grandCgst = items.reduce((s, it) => s + n(it.cgstAmount ?? it.cgst_amount), 0);
    grandSgst = items.reduce((s, it) => s + n(it.sgstAmount ?? it.sgst_amount), 0);
    grandIgst = items.reduce((s, it) => s + n(it.igstAmount ?? it.igst_amount), 0);
  }

  // ── Grand totals ───────────────────────────────────────────────
  blank();

  grandTotalRowIdxs.push(rows.length);
  push("", "", "", "", "", "", "", "Total Amount Before Tax", "", "", "", "", "", "", f2(grandBeforeTax));

  if (isIgst) {
    grandTotalRowIdxs.push(rows.length);
    push("", "", "", "", "", "", "", "Add: IGST 18%", "", "", "", "", "", "", f2(grandIgst));
  } else {
    grandTotalRowIdxs.push(rows.length);
    push("", "", "", "", "", "", "", "Add: CGST 9%", "", "", "", "", "", "", f2(grandCgst));
    grandTotalRowIdxs.push(rows.length);
    push("", "", "", "", "", "", "", "Add: SGST 9%", "", "", "", "", "", "", f2(grandSgst));
  }

  const grandTotal = grandBeforeTax + grandCgst + grandSgst + grandIgst;
  grandTotalRowIdxs.push(rows.length);
  push("", "", "", "", "", "", "", "Grand Total (incl. GST)", "", "", "", "", "", "", f2(grandTotal));

  // ── Worksheet ─────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!cols"] = [
    { wch: 5 },  // SL
    { wch: 16 }, // Store Code
    { wch: 42 }, // Element/Product Details
    { wch: 10 }, // HSN
    { wch: 8 },  // Qty
    { wch: 6 },  // Unit
    { wch: 10 }, // Rate
    { wch: 14 }, // Amount
    { wch: 7 },  // CGST%
    { wch: 12 }, // CGST
    { wch: 7 },  // SGST%
    { wch: 12 }, // SGST
    { wch: 7 },  // IGST%
    { wch: 12 }, // IGST
    { wch: 14 }, // Total
  ];

  // ── Styling helpers ────────────────────────────────────────────
  const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const setStyle = (r: number, c: number, s: any) => {
    const ref = enc(r, c);
    if (!ws[ref]) ws[ref] = { v: "", t: "s" };
    ws[ref].s = s;
  };
  const applyRowStyle = (r: number, style: any, cols = 15) => {
    for (let c = 0; c < cols; c++) setStyle(r, c, style);
  };

  const borderThin = { style: "thin", color: { rgb: "999999" } };
  const borderDark = { style: "thin", color: { rgb: "000000" } };
  const allBorders = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };
  const darkBorders = { top: borderDark, bottom: borderDark, left: borderDark, right: borderDark };

  // Company / meta rows — bold company name, plain meta
  metaRowIdxs.forEach((r, i) => {
    applyRowStyle(r, {
      font: { bold: i === 0, sz: i === 0 ? 12 : 10 },
      alignment: { horizontal: "left" },
    });
  });

  // Column headers — bold, centered, grey fill, border
  columnHeaderRowIdx.forEach(r => {
    for (let c = 0; c < 15; c++) {
      setStyle(r, c, {
        font: { bold: true, sz: 9, color: { rgb: "1E293B" } },
        fill: { patternType: "solid", fgColor: { rgb: "CBD5E1" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: darkBorders,
      });
    }
  });

  // Store header rows — bold, medium grey fill
  storeHeaderRowIdxs.forEach(r => {
    for (let c = 0; c < 15; c++) {
      setStyle(r, c, {
        font: { bold: true, sz: 9, color: { rgb: "1E293B" } },
        fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: darkBorders,
      });
    }
  });

  // Material total rows — yellow, bold
  materialTotalRowIdxs.forEach(r => {
    for (let c = 0; c < 15; c++) {
      setStyle(r, c, {
        font: { bold: true, sz: 9 },
        fill: { patternType: "solid", fgColor: { rgb: "FFF066" } },
        alignment: {
          horizontal: c === 2 || c >= 7 ? "right" : "left",
          vertical: "center",
        },
        border: darkBorders,
      });
    }
  });

  // Service total rows — light orange tint, italic
  serviceTotalRowIdxs.forEach(r => {
    for (let c = 0; c < 15; c++) {
      setStyle(r, c, {
        font: { sz: 9, italic: true },
        fill: { patternType: "solid", fgColor: { rgb: "FFF7ED" } },
        alignment: { horizontal: c >= 7 ? "right" : "left", vertical: "center" },
        border: allBorders,
      });
    }
  });

  // Grand total rows — bold, blue-grey fill
  grandTotalRowIdxs.forEach((r, i) => {
    const isLast = i === grandTotalRowIdxs.length - 1;
    for (let c = 0; c < 15; c++) {
      setStyle(r, c, {
        font: { bold: true, sz: 9, color: { rgb: isLast ? "7C3AED" : "1E293B" } },
        fill: { patternType: "solid", fgColor: { rgb: isLast ? "EDE9FE" : "F1F5F9" } },
        alignment: { horizontal: "right", vertical: "center" },
        border: darkBorders,
      });
    }
  });

  // ── Workbook ───────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estimate");

  const estNum = safe(estimate.estimateNumber ?? estimate.estimate_number ?? estimate.id);
  const fileName = `Estimate_${estNum.replace(/[\/\\:*?"<>|]+/g, "-")}.xlsx`;
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    fileName,
  );
}
