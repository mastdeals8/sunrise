import { useEffect, useState } from "react";
import type { EstimateItemInput } from "../types";
import { calculateEstimateTotals } from "../utils/estimateCalculations";

export const useEstimateBuilder = (
  items: EstimateItemInput[],
  packing: string,
  implementation: string,
  transport: string,
  gstType: string,
) => {
  const [calculatedSubtotal, setCalculatedSubtotal] = useState(0);
  const [calculatedTax, setCalculatedTax] = useState(0);
  const [calculatedGrandTotal, setCalculatedGrandTotal] = useState(0);

  useEffect(() => {
    const totals = calculateEstimateTotals(items, packing, implementation, transport);
    setCalculatedSubtotal(totals.subtotal);
    setCalculatedTax(totals.tax);
    setCalculatedGrandTotal(totals.grandTotal);
  }, [items, packing, implementation, transport, gstType]);

  return {
    calculatedSubtotal,
    calculatedTax,
    calculatedGrandTotal,
  };
};
