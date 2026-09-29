export const calculateEstimateRowValues = (
  calcType: string,
  width: number,
  height: number,
  qty: number,
  rate: number,
  gstPct: number,
  gstType: string,
  unit?: string,
) => {
  let amount = 0;

  // Smart amount calculation (auto-detect billing mode):
  //   - percentage   → caller-handled rate (service products)
  //   - running_inch (unit === 'running_inch' or linear measure) → W × H × Q × Rate
  //   - feet / ft    → W × H × Q × Rate (dimensions already in feet)
  //   - piece / job  → Q × Rate (nos, job, pcs, or zero dimensions)
  //   - inch / sqft  → ((W × H × Q) / 144) × Rate (convert inch dimensions to sqft)
  if (calcType === "percentage") {
    amount = rate;
  } else {
    const normUnit = String(unit || "").toLowerCase().trim();
    const isFeet = normUnit === "feet" || normUnit === "ft";
    const isPiece = normUnit === "nos" || normUnit === "job" || normUnit === "pcs" || normUnit === "unit" || (width === 0 && height === 0);
    const isRunningInch = normUnit === "running_inch" || (calcType === "running_inch" && normUnit !== "inch" && normUnit !== "sqft");

    if (isPiece) {
      amount = qty * rate;
    } else if (isRunningInch) {
      amount = width * height * qty * rate;
    } else if (isFeet) {
      const sqft = width * height * qty;
      amount = sqft * rate;
    } else {
      // inch-based dimensions (unit === "inch", "sqft", or dimensions > 0)
      const sqft = (width * height * qty) / 144;
      amount = sqft > 0 ? sqft * rate : qty * rate;
    }
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
    totalAmount: totalAmount.toFixed(2)
  };
};

export const SERVICE_LINE_TYPES = ["packing", "installation", "transport"] as const;

export const isServiceLineType = (lineType?: string | null) =>
  SERVICE_LINE_TYPES.includes(String(lineType || "").toLowerCase() as typeof SERVICE_LINE_TYPES[number]);

export const parseRateInput = (value: string | number | null | undefined) => {
  const cleaned = String(value ?? "")
    .replace(/[₹,\s]/g, "")
    .replace(/%/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isPercentageRateInput = (value: string | number | null | undefined) =>
  String(value ?? "").includes("%");

export const formatServiceRateInput = (value: string | number | null | undefined, calculationType?: string | null) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("%")) return raw;
  return calculationType === "percentage" ? `${raw}%` : raw;
};

export const calculateServiceChargeRowValues = (
  rateInput: string | number | null | undefined,
  materialTotal: number,
  gstPct: number,
  gstType: string
) => {
  const rateValue = parseRateInput(rateInput);
  const amount = isPercentageRateInput(rateInput)
    ? materialTotal * (rateValue / 100)
    : rateValue;

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

export const calculateEstimateTotals = (
  items: Array<{ amount?: string; cgstAmount?: string; sgstAmount?: string; igstAmount?: string }>,
  packing: string,
  implementation: string,
  transport: string,
) => {
  let sub = 0;
  let tax = 0;

  items.forEach(item => {
    sub += Number(item.amount) || 0;
    tax += (Number(item.cgstAmount) || 0) + (Number(item.sgstAmount) || 0) + (Number(item.igstAmount) || 0);
  });

  const packingAmt = sub * ((Number(packing) || 0) / 100);
  const implementationAmt = sub * ((Number(implementation) || 0) / 100);
  const transportAmt = Number(transport) || 0;

  const baseAmount = sub + packingAmt + implementationAmt + transportAmt;
  const finalTax = baseAmount * 0.18;

  return {
    subtotal: sub,
    tax: finalTax,
    grandTotal: baseAmount + finalTax,
  };
};
