import type { EstimateItemInput } from "../types";

export const blankRowForStore = (storeIdStr: string, sl: number, gstType: string): EstimateItemInput => {
  const igst = gstType === "IGST";
  return {
    sl,
    productId: "",
    isStandard: true,
    hsn: "",
    materialCode: "",
    itemName: "",
    width: "",
    height: "",
    quantity: "1",
    unit: "sqft",
    calculationType: "sqft",
    rate: "",
    amount: "0",
    cgstPercent: igst ? "0" : "9",
    cgstAmount: "0",
    sgstPercent: igst ? "0" : "9",
    sgstAmount: "0",
    igstPercent: igst ? "18" : "0",
    igstAmount: "0",
    totalAmount: "0",
    storeId: storeIdStr,
    storeSortOrder: sl,
    rowSortOrder: sl,
    description: "",
    rateSource: "",
  };
};

export const INVALID_EXCEL_PASTE_MESSAGE = "Invalid Excel format. Please copy directly from Excel columns, not from the estimate grid.";

export type ExcelPasteParseResult =
  | { ok: true; rows: Array<Partial<EstimateItemInput>> }
  | { ok: false; error: string };

const parseExcelPasteRowsInternal = (text: string): ExcelPasteParseResult => {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      ok: false,
      error: "No rows detected. Paste rows copied from Excel (Element, HSN, Standard/Non, Product Details, Width, Height, Qty, Rate).",
    };
  }
  if (!raw.includes("\t") || lines.some(line => !line.includes("\t"))) {
    return { ok: false, error: INVALID_EXCEL_PASTE_MESSAGE };
  }

  const out: Array<Partial<EstimateItemInput>> = [];
  const num = (s?: string) => {
    if (s == null) return "";
    const cleaned = String(s).replace(/[₹,\s]/g, "").replace(/%$/, "");
    if (cleaned === "" || isNaN(Number(cleaned))) return "";
    return String(Number(cleaned));
  };
  for (const line of lines) {
    let cells = line.split("\t");
    cells = cells.map(c => c.trim());
    if (cells.length >= 9 && /^\d{1,3}$/.test(cells[0]) && cells[1] && isNaN(Number(cells[1]))) {
      cells = cells.slice(1);
    }
    if (cells.length < 8) {
      return { ok: false, error: INVALID_EXCEL_PASTE_MESSAGE };
    }
    const element = cells[0] || "";
    const hsn = cells[1] || "";
    const stdRaw = (cells[2] || "").toLowerCase();
    const description = cells[3] || "";
    const width = num(cells[4]);
    const height = num(cells[5]);
    const qtyRaw = num(cells[6]);
    let rate = num(cells[8]);
    if (rate === "" && cells.length <= 8) rate = num(cells[7]);
    if (!element && !description && width === "" && height === "" && qtyRaw === "" && rate === "") {
      return { ok: false, error: INVALID_EXCEL_PASTE_MESSAGE };
    }
    if (!element || !description || qtyRaw === "" || rate === "") {
      return { ok: false, error: INVALID_EXCEL_PASTE_MESSAGE };
    }
    const isStandard = !(stdRaw.startsWith("non") || stdRaw === "n" || stdRaw === "ns");
    const hasSize = width !== "" && height !== "" && Number(width) > 0 && Number(height) > 0;
    out.push({
      itemName: element,
      hsn,
      isStandard,
      description,
      width,
      height,
      quantity: qtyRaw === "" ? "1" : qtyRaw,
      rate: rate === "" ? "0" : rate,
      calculationType: hasSize ? "sqft" : "fixed",
      unit: hasSize ? "sqft" : "nos",
    });
  }
  if (out.length === 0) {
    return { ok: false, error: INVALID_EXCEL_PASTE_MESSAGE };
  }
  return { ok: true, rows: out };
};

export const parseExcelPasteRows = (text: string): Array<Partial<EstimateItemInput>> => {
  const result = parseExcelPasteRowsInternal(text);
  return result.ok ? result.rows : [];
};

export const validateExcelPasteRows = parseExcelPasteRowsInternal;
