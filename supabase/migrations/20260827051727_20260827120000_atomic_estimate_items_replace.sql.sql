/*
# Atomic estimate items replacement

## Problem
The estimate-save edge function previously did DELETE-then-INSERT for item
replacement. If the INSERT failed (e.g. a column mismatch), the old items
were already deleted, leaving the estimate with zero line items and no way
to view or edit it.

## Solution
Create a SECURITY DEFINER function `replace_estimate_items` that:
1. Inserts new item rows (JSON array, normalized to snake_case by the caller)
2. Deletes all old items for the same estimate_id
3. Returns the count of inserted rows

Both steps run inside a single database transaction. If the INSERT fails,
the DELETE never executes, and the old items are preserved.

## Security
- SECURITY DEFINER so the edge function (service_role) can call it
- REVOKE from PUBLIC, GRANT to service_role only
- No change to RLS policies
*/

CREATE OR REPLACE FUNCTION public.replace_estimate_items(
  p_estimate_id integer,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer;
BEGIN
  -- Insert new items first (preserves old data if this fails)
  INSERT INTO estimate_items (
    estimate_id, product_id, item_name, description, quantity, unit, rate,
    total_price, sl, is_standard, hsn, material_code, material_code_id,
    material_description, width, height, total_size,
    cgst_percent, cgst_amount, sgst_percent, sgst_amount,
    igst_percent, igst_amount, total_amount,
    store_code, store_sort_order, row_sort_order,
    manual_store_name, line_type, calculation_type,
    material_code_snapshot, product_snapshot
  )
  SELECT
    p_estimate_id,
    (item->>'product_id')::integer,
    item->>'item_name',
    item->>'description',
    COALESCE((item->>'quantity')::real, 1),
    COALESCE(item->>'unit', 'pcs'),
    COALESCE((item->>'rate')::real, 0),
    COALESCE((item->>'total_price')::real, 0),
    (item->>'sl')::integer,
    COALESCE((item->>'is_standard')::boolean, true),
    item->>'hsn',
    item->>'material_code',
    (item->>'material_code_id')::integer,
    item->>'material_description',
    (item->>'width')::real,
    (item->>'height')::real,
    (item->>'total_size')::real,
    COALESCE((item->>'cgst_percent')::real, 9),
    COALESCE((item->>'cgst_amount')::real, 0),
    COALESCE((item->>'sgst_percent')::real, 9),
    COALESCE((item->>'sgst_amount')::real, 0),
    COALESCE((item->>'igst_percent')::real, 0),
    COALESCE((item->>'igst_amount')::real, 0),
    COALESCE((item->>'total_amount')::real, 0),
    item->>'store_code',
    (item->>'store_sort_order')::integer,
    (item->>'row_sort_order')::integer,
    item->>'manual_store_name',
    COALESCE(item->>'line_type', 'product'),
    COALESCE(item->>'calculation_type', 'fixed'),
    (item->'material_code_snapshot')::jsonb,
    (item->'product_snapshot')::jsonb
  FROM jsonb_array_elements(p_items) AS t(item);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Delete old items only after successful insert
  DELETE FROM estimate_items
  WHERE estimate_id = p_estimate_id
    AND id NOT IN (
      SELECT id FROM estimate_items
      WHERE estimate_id = p_estimate_id
      ORDER BY id DESC
      LIMIT v_inserted
    );

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_estimate_items(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_estimate_items(integer, jsonb) TO service_role;
