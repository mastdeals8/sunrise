/**
 * Shared Canonical Financial Calculations for Sunrise Media ERP
 * 
 * Provides unified, deterministic monetary, GST, round-off, and line calculations.
 * Avoids floating-point drift and ensures exact alignment across:
 * - Estimate creation & preview
 * - Invoice creation & editor
 * - Invoice preview & printable document
 * - Tally XML export
 * - Financial ledger & aging calculations
 */

export interface LineItemFinancialInput {
  rate?: number | string | null;
  quantity?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  totalSize?: number | string | null;
  total_size?: number | string | null;
  amount?: number | string | null;
  cgstPercent?: number | string | null;
  cgst_percent?: number | string | null;
  sgstPercent?: number | string | null;
  sgst_percent?: number | string | null;
  igstPercent?: number | string | null;
  igst_percent?: number | string | null;
  taxableAmount?: number | string | null;
  taxable_amount?: number | string | null;
}

export interface LineItemFinancialOutput {
  rate: number;
  quantity: number;
  width: number;
  height: number;
  totalSize: number;
  amount: number; // Taxable line total (rate * qty or rate * totalSize)
  taxableAmount: number;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface CalculationTotalsOptions {
  placeOfSupplyStateCode?: string | null;
  sellerStateCode?: string | null;
  targetGstType?: 'intrastate' | 'interstate' | 'auto';
  applyRoundOff?: boolean;
  roundOffPreference?: 'nearest' | 'exact';
}

export interface FinancialTotalsOutput {
  subtotal: number;       // Taxable subtotal (exact sum of line amounts rounded to 2 decimals)
  cgstAmount: number;     // CGST total
  sgstAmount: number;     // SGST total
  igstAmount: number;     // IGST total
  taxAmount: number;      // Total GST (cgst + sgst + igst)
  rawGrandTotal: number;  // subtotal + taxAmount before round-off
  roundOff: number;       // difference between rounded grand total and raw total
  grandTotal: number;     // Final payable invoice total
  isInterstate: boolean;
}

/**
 * Rounds a number to a specified number of decimal places using standard commercial rounding.
 */
export function roundTo(value: number, decimals: number = 2): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Extracts a clean 2-digit state code from a GSTIN or state code string.
 */
export function extractStateCode(gstinOrCode?: string | null): string {
  if (!gstinOrCode) return '';
  const cleaned = gstinOrCode.trim();
  if (cleaned.length >= 2 && /^\d{2}/.test(cleaned)) {
    return cleaned.substring(0, 2);
  }
  return '';
}

/**
 * Determines whether a transaction is interstate or intrastate based on GSTINs or state codes.
 */
export function isInterstateTransaction(
  sellerGstinOrCode?: string | null,
  recipientGstinOrCode?: string | null
): boolean {
  const sellerState = extractStateCode(sellerGstinOrCode);
  const recipientState = extractStateCode(recipientGstinOrCode);
  if (!sellerState || !recipientState) return false;
  return sellerState !== recipientState;
}

/**
 * Computes individual line financials accurately.
 */
export function calculateLineFinancials(
  item: LineItemFinancialInput,
  options?: { targetGstType?: 'intrastate' | 'interstate' | 'auto'; defaultGstPercent?: number }
): LineItemFinancialOutput {
  const rate = Number(item.rate ?? 0);
  const qty = Number(item.quantity ?? 1);
  const width = Number(item.width ?? 0);
  const height = Number(item.height ?? 0);
  let totalSize = Number(item.totalSize ?? item.total_size ?? 0);

  if (totalSize <= 0 && width > 0 && height > 0) {
    totalSize = roundTo((width * height) / 144, 4);
  }

  // Calculate taxable line amount
  let lineTaxable = 0;
  if (item.amount !== undefined && item.amount !== null && !isNaN(Number(item.amount)) && Number(item.amount) > 0) {
    lineTaxable = roundTo(Number(item.amount), 2);
  } else if (totalSize > 0) {
    lineTaxable = roundTo(rate * totalSize, 2);
  } else {
    lineTaxable = roundTo(rate * qty, 2);
  }

  // Tax rates
  let cgstP = Number(item.cgstPercent ?? item.cgst_percent ?? 0);
  let sgstP = Number(item.sgstPercent ?? item.sgst_percent ?? 0);
  let igstP = Number(item.igstPercent ?? item.igst_percent ?? 0);

  const gstType = options?.targetGstType || 'auto';

  if (gstType === 'interstate') {
    if (igstP === 0 && (cgstP > 0 || sgstP > 0)) {
      igstP = cgstP + sgstP;
    } else if (igstP === 0 && options?.defaultGstPercent) {
      igstP = options.defaultGstPercent;
    }
    cgstP = 0;
    sgstP = 0;
  } else if (gstType === 'intrastate') {
    if ((cgstP === 0 || sgstP === 0) && igstP > 0) {
      cgstP = roundTo(igstP / 2, 2);
      sgstP = roundTo(igstP / 2, 2);
    } else if (cgstP === 0 && sgstP === 0 && options?.defaultGstPercent) {
      cgstP = roundTo(options.defaultGstPercent / 2, 2);
      sgstP = roundTo(options.defaultGstPercent / 2, 2);
    }
    igstP = 0;
  }

  const cgstAmount = roundTo((lineTaxable * cgstP) / 100, 2);
  const sgstAmount = roundTo((lineTaxable * sgstP) / 100, 2);
  const igstAmount = roundTo((lineTaxable * igstP) / 100, 2);
  const lineTax = roundTo(cgstAmount + sgstAmount + igstAmount, 2);

  return {
    rate,
    quantity: qty,
    width,
    height,
    totalSize,
    amount: lineTaxable,
    taxableAmount: lineTaxable,
    cgstPercent: cgstP,
    sgstPercent: sgstP,
    igstPercent: igstP,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxAmount: lineTax,
    totalAmount: roundTo(lineTaxable + lineTax, 2),
  };
}

/**
 * Calculates financial totals across all line items with rigorous GST segregation and round-off.
 */
export function calculateFinancialTotals(
  lines: LineItemFinancialInput[],
  options?: CalculationTotalsOptions
): FinancialTotalsOutput {
  let isInterstate = false;
  if (options?.targetGstType === 'interstate') {
    isInterstate = true;
  } else if (options?.targetGstType === 'intrastate') {
    isInterstate = false;
  } else if (options?.sellerStateCode && options?.placeOfSupplyStateCode) {
    isInterstate = isInterstateTransaction(options.sellerStateCode, options.placeOfSupplyStateCode);
  }

  let subtotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const line of lines) {
    const calc = calculateLineFinancials(line, {
      targetGstType: isInterstate ? 'interstate' : 'intrastate'
    });
    subtotal = roundTo(subtotal + calc.amount, 2);
    cgstTotal = roundTo(cgstTotal + calc.cgstAmount, 2);
    sgstTotal = roundTo(sgstTotal + calc.sgstAmount, 2);
    igstTotal = roundTo(igstTotal + calc.igstAmount, 2);
  }

  const taxAmount = roundTo(cgstTotal + sgstTotal + igstTotal, 2);
  const rawGrandTotal = roundTo(subtotal + taxAmount, 2);

  let grandTotal = rawGrandTotal;
  let roundOff = 0;

  if (options?.applyRoundOff !== false) {
    grandTotal = Math.round(rawGrandTotal);
    roundOff = roundTo(grandTotal - rawGrandTotal, 2);
  }

  return {
    subtotal,
    cgstAmount: cgstTotal,
    sgstAmount: sgstTotal,
    igstAmount: igstTotal,
    taxAmount,
    rawGrandTotal,
    roundOff,
    grandTotal,
    isInterstate,
  };
}
