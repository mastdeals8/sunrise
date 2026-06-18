export const downloadBlob = (blob: Blob, fileName: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

/**
 * Client-side Excel export for Bolt mode (no Express backend).
 * Generates a simple estimate workbook using xlsx-js-style.
 */
export async function exportEstimateToExcel(
  estimate: any,
  items: any[],
  clientName?: string
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const safe = (v: any) => (v == null ? "" : String(v));
  const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0);
  const fmt = (v: number) => v.toFixed(2);

  const header = [
    "SL", "Store", "Item / Description", "HSN", "Qty", "Unit",
    "Rate", "Amount", "CGST%", "CGST", "SGST%", "SGST", "IGST%", "IGST", "Total",
  ];

  const rows: any[][] = [header];
  for (const it of items) {
    rows.push([
      safe(it.sl ?? it.position),
      safe(it.storeCode),
      safe(it.itemName || it.item_name),
      safe(it.hsn),
      num(it.quantity),
      safe(it.unit),
      fmt(num(it.rate)),
      fmt(num(it.totalPrice ?? it.amount)),
      fmt(num(it.cgstPercent ?? it.cgst_percent)),
      fmt(num(it.cgstAmount ?? it.cgst_amount)),
      fmt(num(it.sgstPercent ?? it.sgst_percent)),
      fmt(num(it.sgstAmount ?? it.sgst_amount)),
      fmt(num(it.igstPercent ?? it.igst_percent)),
      fmt(num(it.igstAmount ?? it.igst_amount)),
      fmt(num(it.totalAmount ?? it.total_amount)),
    ]);
  }

  // Totals row
  const subtotal = items.reduce((s, it) => s + num(it.totalPrice ?? it.amount), 0);
  const tax = items.reduce(
    (s, it) => s + num(it.cgstAmount ?? it.cgst_amount) + num(it.sgstAmount ?? it.sgst_amount) + num(it.igstAmount ?? it.igst_amount), 0
  );
  rows.push(["", "", "TOTAL", "", "", "", "", fmt(subtotal), "", "", "", "", "", "", fmt(subtotal + tax)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Basic column widths
  ws["!cols"] = [
    { wch: 5 }, { wch: 14 }, { wch: 40 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
    { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 7 }, { wch: 10 },
    { wch: 7 }, { wch: 10 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estimate");

  // Meta sheet
  const meta = XLSX.utils.aoa_to_sheet([
    ["Estimate Number", safe(estimate.estimateNumber ?? estimate.estimate_number)],
    ["Client", safe(clientName || estimate.clientId)],
    ["Date", safe(estimate.estimateDate ?? estimate.estimate_date)],
    ["Title", safe(estimate.title)],
    ["Subtotal", fmt(subtotal)],
    ["Tax", fmt(tax)],
    ["Grand Total", fmt(subtotal + tax)],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, "Summary");

  const fileName = `estimate_${safe((estimate.estimateNumber ?? estimate.estimate_number) || estimate.id)}.xlsx`;
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  downloadBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
}
