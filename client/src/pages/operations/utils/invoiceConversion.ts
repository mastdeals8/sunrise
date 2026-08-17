/** Convert saved estimate rows without replacing area-based totalPrice with quantity × rate. */
export function estimateItemsToInvoiceLines(items: any[]): any[] {
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
    const taxPercent = Number(item.cgstPercent ?? item.cgst_percent ?? 0)
      + Number(item.sgstPercent ?? item.sgst_percent ?? 0)
      + Number(item.igstPercent ?? item.igst_percent ?? 0);
    const savedTotal = Number(item.totalAmount ?? item.total_amount);
    const resolvedTaxAmount = taxParts.length ? taxAmount
      : (Number.isFinite(explicitTax) ? taxAmount
        : (Number.isFinite(savedTotal) ? +(savedTotal - amount).toFixed(2) : 0));
    return {
      itemName: item.itemName ?? item.item_name ?? "", description: item.description ?? "", hsn: item.hsn ?? "",
      quantity, unit: item.unit ?? "nos", rate, amount: +amount.toFixed(2), taxPercent: taxPercent || 18,
      taxAmount: resolvedTaxAmount,
      totalAmount: Number.isFinite(savedTotal) ? +savedTotal.toFixed(2) : +(amount + resolvedTaxAmount).toFixed(2),
      totalPrice: Number.isFinite(savedAmount) ? savedAmount : amount,
      width: item.width ?? null, height: item.height ?? null, totalSize: item.totalSize ?? item.total_size ?? null,
      lineType: item.lineType ?? item.line_type ?? "product", storeCode: item.storeCode ?? item.store_code ?? null,
      sl: item.sl ?? null, productId: item.productId ?? item.product_id ?? null,
      cgstPercent: item.cgstPercent ?? item.cgst_percent ?? null, cgstAmount: item.cgstAmount ?? item.cgst_amount ?? null,
      sgstPercent: item.sgstPercent ?? item.sgst_percent ?? null, sgstAmount: item.sgstAmount ?? item.sgst_amount ?? null,
      igstPercent: item.igstPercent ?? item.igst_percent ?? null, igstAmount: item.igstAmount ?? item.igst_amount ?? null,
    };
  });
}

export const invoiceLineToEditorLine = (line: any) => estimateItemsToInvoiceLines([line])[0];
