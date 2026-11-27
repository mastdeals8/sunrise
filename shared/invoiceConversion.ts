/** Convert saved estimate rows without replacing area-based totalPrice with quantity × rate. */
export function estimateItemsToInvoiceLines(items: any[], targetGstType?: "CGST+SGST" | "IGST"): any[] {
  return (items || []).map((item: any) => {
    const quantity = Number(item.quantity ?? 0);
    const rate = Number(item.rate ?? 0);
    const savedAmount = Number(item.totalPrice ?? item.total_price);
    const amount = Number.isFinite(savedAmount) ? savedAmount : +(quantity * rate).toFixed(2);
    const taxParts = [item.cgstAmount, item.cgst_amount, item.sgstAmount, item.sgst_amount, item.igstAmount, item.igst_amount]
      .map(Number).filter(Number.isFinite);
    const explicitTax = Number(item.taxAmount ?? item.tax_amount);
    const taxAmount = taxParts.length ? +taxParts.reduce((sum, value) => sum + value, 0).toFixed(2)
      : (Number.isFinite(explicitTax) ? +explicitTax.toFixed(2) : 0);
    const rawTaxPercent = Number(item.cgstPercent ?? item.cgst_percent ?? 0)
      + Number(item.sgstPercent ?? item.sgst_percent ?? 0)
      + Number(item.igstPercent ?? item.igst_percent ?? 0);
    const taxPercent = rawTaxPercent || 18;
    const savedTotal = Number(item.totalAmount ?? item.total_amount);
    const resolvedTaxAmount = taxParts.length ? taxAmount
      : (Number.isFinite(explicitTax) ? taxAmount
        : (Number.isFinite(savedTotal) ? +(savedTotal - amount).toFixed(2) : +(amount * (taxPercent / 100)).toFixed(2)));

    let cgstPercent: number | null = item.cgstPercent ?? item.cgst_percent ?? null;
    let cgstAmount: number | null = item.cgstAmount ?? item.cgst_amount ?? null;
    let sgstPercent: number | null = item.sgstPercent ?? item.sgst_percent ?? null;
    let sgstAmount: number | null = item.sgstAmount ?? item.sgst_amount ?? null;
    let igstPercent: number | null = item.igstPercent ?? item.igst_percent ?? null;
    let igstAmount: number | null = item.igstAmount ?? item.igst_amount ?? null;

    if (targetGstType === "IGST") {
      igstPercent = taxPercent;
      igstAmount = resolvedTaxAmount;
      cgstPercent = 0;
      cgstAmount = 0;
      sgstPercent = 0;
      sgstAmount = 0;
    } else if (targetGstType === "CGST+SGST") {
      cgstPercent = +(taxPercent / 2).toFixed(2);
      cgstAmount = +(resolvedTaxAmount / 2).toFixed(2);
      sgstPercent = +(taxPercent / 2).toFixed(2);
      sgstAmount = +(resolvedTaxAmount - cgstAmount).toFixed(2);
      igstPercent = 0;
      igstAmount = 0;
    }

    return {
      itemName: item.itemName ?? item.item_name ?? "",
      description: item.description ?? "",
      hsn: item.hsn ?? "",
      quantity,
      unit: item.unit ?? "nos",
      rate,
      amount: +amount.toFixed(2),
      taxPercent,
      taxAmount: resolvedTaxAmount,
      totalAmount: Number.isFinite(savedTotal) ? +savedTotal.toFixed(2) : +(amount + resolvedTaxAmount).toFixed(2),
      totalPrice: Number.isFinite(savedAmount) ? savedAmount : amount,
      width: item.width ?? null,
      height: item.height ?? null,
      totalSize: item.totalSize ?? item.total_size ?? null,
      lineType: item.lineType ?? item.line_type ?? "product",
      storeCode: item.storeCode ?? item.store_code ?? null,
      sl: item.sl ?? null,
      productId: item.productId ?? item.product_id ?? null,
      cgstPercent,
      cgstAmount,
      sgstPercent,
      sgstAmount,
      igstPercent,
      igstAmount,
    };
  });
}

export const invoiceLineToEditorLine = (line: any) => estimateItemsToInvoiceLines([line])[0];
