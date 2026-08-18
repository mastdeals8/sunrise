-- Targeted repair for the two confirmed pre-P0 invoices only.
-- Rebuilds line_items from the saved estimate rows using the same commercial
-- fields as estimateItemsToInvoiceLines: total_price, GST components,
-- dimensions, services, store code and estimate row order.
with rebuilt as (
  select i.id, jsonb_agg(jsonb_build_object(
    'itemName', coalesce(ei.item_name, ''), 'description', coalesce(ei.description, ''),
    'hsn', coalesce(ei.hsn, ''), 'quantity', coalesce(ei.quantity, 0),
    'unit', coalesce(ei.unit, 'nos'), 'rate', coalesce(ei.rate, 0),
    'amount', round(coalesce(ei.total_price, coalesce(ei.quantity,0) * coalesce(ei.rate,0))::numeric, 2),
    'taxPercent', coalesce(ei.cgst_percent,0) + coalesce(ei.sgst_percent,0) + coalesce(ei.igst_percent,0),
    'taxAmount', round((coalesce(ei.cgst_amount,0) + coalesce(ei.sgst_amount,0) + coalesce(ei.igst_amount,0))::numeric, 2),
    'totalAmount', round(coalesce(ei.total_amount, coalesce(ei.total_price,0) + coalesce(ei.cgst_amount,0) + coalesce(ei.sgst_amount,0) + coalesce(ei.igst_amount,0))::numeric, 2),
    'totalPrice', coalesce(ei.total_price, 0), 'width', ei.width, 'height', ei.height,
    'totalSize', ei.total_size, 'lineType', coalesce(ei.line_type, 'product'),
    'storeCode', ei.store_code, 'sl', ei.sl, 'productId', ei.product_id,
    'cgstPercent', ei.cgst_percent, 'cgstAmount', ei.cgst_amount,
    'sgstPercent', ei.sgst_percent, 'sgstAmount', ei.sgst_amount,
    'igstPercent', ei.igst_percent, 'igstAmount', ei.igst_amount
  ) order by ei.id) as line_items,
  round(sum(coalesce(ei.total_price, coalesce(ei.quantity,0) * coalesce(ei.rate,0)))::numeric, 2) as amount,
  round(sum(coalesce(ei.cgst_amount,0) + coalesce(ei.sgst_amount,0) + coalesce(ei.igst_amount,0))::numeric, 2) as tax_amount,
  round(sum(coalesce(ei.total_amount, coalesce(ei.total_price,0) + coalesce(ei.cgst_amount,0) + coalesce(ei.sgst_amount,0) + coalesce(ei.igst_amount,0)))::numeric, 2) as total_amount
  from public.invoices i join public.estimate_items ei on ei.estimate_id = i.estimate_id
  where i.id in (6, 8) and i.estimate_id in (3, 8)
  group by i.id
)
update public.invoices i
set line_items = r.line_items, amount = r.amount, tax_amount = r.tax_amount,
    total_amount = r.total_amount,
    balance_amount = greatest(0, r.total_amount - coalesce(i.paid_amount,0)),
    status = case when greatest(0, r.total_amount - coalesce(i.paid_amount,0)) <= 0 then 'paid'
                  when coalesce(i.paid_amount,0) > 0 then 'partial' else i.status end
from rebuilt r where i.id = r.id;
