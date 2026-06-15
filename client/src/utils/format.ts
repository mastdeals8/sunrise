/**
 * Shared formatting helpers (Phase 2 cleanup).
 * Consolidates the formatCurrency copies that previously lived in 8 pages.
 * Output format is identical to all prior local definitions:
 * "₹" + Indian-locale grouping with exactly 2 decimals; null/undefined → ₹0.00.
 */
export const formatCurrency = (val: number) =>
  "₹" + (val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
