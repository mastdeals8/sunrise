// Pure row-calculation helper for the Operations module. Smart amount math:
// the row's data (whether (W × H × Q) / 144 > 0) drives area-vs-piece mode,
// not the declared calculationType. Mirrors estimateCalculations.ts exactly —
// keep both in sync.
//
// Behavior contract:
// - percentage   : amount = rate (caller handles base-amount multiplication)
// - running_inch : width(letterHeight) * height(letters) * qty * rate
// - everything else (sqft / fixed / manual / nos / job / per_km):
//     if (W × H × Q) / 144 > 0 → amount = T.Sqft × rate (area-based)
//     else                       → amount = qty * rate    (piece-based)
//
// GST split:
// - CGST+SGST: gstPct is split equally
// - IGST    : full gstPct goes to IGST

export interface RowCalcResult {
  amount: string;
  cgstPercent: string;
  cgstAmount: string;
  sgstPercent: string;
  sgstAmount: string;
  igstPercent: string;
  igstAmount: string;
  totalAmount: string;
}

export const calculateRowValues = (
  calcType: string,
  width: number,
  height: number,
  qty: number,
  rate: number,
  gstPct: number,
  gstType: string
): RowCalcResult => {
  let amount = 0;

  if (calcType === "percentage") {
    amount = rate; // Will be computed relative to subtotal later or entered manually
  } else if (calcType === "running_inch") {
    amount = width * height * qty * rate;
  } else {
    // sqft / fixed / manual / nos / job / per_km — auto-detect billing mode.
    const sqft = (width * height * qty) / 144;
    amount = sqft > 0 ? sqft * rate : qty * rate;
  }

  let cgstPercent = 0;
  let sgstPercent = 0;
  let igstPercent = 0;

  if (gstType === "CGST+SGST") {
    cgstPercent = gstPct / 2;
    sgstPercent = gstPct / 2;
  } else {
    igstPercent = gstPct;
  }

  const cgstAmount = amount * (cgstPercent / 100);
  const sgstAmount = amount * (sgstPercent / 100);
  const igstAmount = amount * (igstPercent / 100);
  const totalAmount = amount + cgstAmount + sgstAmount + igstAmount;

  return {
    amount: amount.toFixed(2),
    cgstPercent: cgstPercent.toString(),
    cgstAmount: cgstAmount.toFixed(2),
    sgstPercent: sgstPercent.toString(),
    sgstAmount: sgstAmount.toFixed(2),
    igstPercent: igstPercent.toString(),
    igstAmount: igstAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
};
