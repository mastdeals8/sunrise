// Pure formatters for the Operations module. Extracted verbatim from
// the original Operations.tsx (`formatCurrency`) so behavior is unchanged.

export const formatCurrency = (val: number): string => {
  return "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
