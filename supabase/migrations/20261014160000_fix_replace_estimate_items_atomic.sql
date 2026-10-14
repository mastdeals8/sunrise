-- Migration: 20261014160000_fix_replace_estimate_items_atomic.sql
-- Fix CRITICAL BUG: replace_estimate_items was missing the DELETE statement,
-- causing every edit/save on an estimate to append rows without deleting old ones.
-- This caused duplicate estimates (e.g. SM/E/26-27/252) to accumulate old rows
-- and show massive discrepancies between Editor (5 items / Rs 12,535.38) and Summary (32 items / Rs 38,038.36).

CREATE OR REPLACE FUNCTION public.replace_estimate_items(p_estimate_id integer, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer := 1;
  v_inserted integer := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM public.estimates WHERE id = p_estimate_id;
  IF NOT FOUND OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Atomically delete existing items for this estimate first
  DELETE FROM public.estimate_items WHERE estimate_id = p_estimate_id;

  -- Insert new items with company_id if items are provided
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    INSERT INTO public.estimate_items (
      company_id, estimate_id, product_id, item_name, description, quantity, unit, rate,
      total_price, sl, is_standard, hsn, material_code, material_code_id,
      material_description, width, height, total_size,
      cgst_percent, cgst_amount, sgst_percent, sgst_amount,
      igst_percent, igst_amount, total_amount,
      store_id, store_code, store_sort_order, row_sort_order,
      manual_store_name, line_type, calculation_type,
      material_code_snapshot, product_snapshot
    )
    SELECT
      v_company_id,
      p_estimate_id,
      COALESCE((item->>'product_id')::integer, (item->>'productId')::integer),
      COALESCE(item->>'item_name', item->>'itemName', item->>'name', 'Item'),
      item->>'description',
      COALESCE((item->>'quantity')::real, 1),
      COALESCE(item->>'unit', 'pcs'),
      COALESCE((item->>'rate')::real, 0),
      COALESCE((COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
      (item->>'sl')::integer,
      COALESCE((item->>'is_standard')::boolean, (item->>'isStandard')::boolean, true),
      COALESCE(item->>'hsn', item->>'hsn_sac'),
      COALESCE(item->>'material_code', item->>'materialCode'),
      (COALESCE(item->>'material_code_id', item->>'materialCodeId'))::integer,
      COALESCE(item->>'material_description', item->>'materialDescription'),
      (item->>'width')::real,
      (item->>'height')::real,
      (COALESCE(item->>'total_size', item->>'totalSize'))::real,
      (COALESCE(item->>'cgst_percent', item->>'cgstPercent'))::real,
      (COALESCE(item->>'cgst_amount', item->>'cgstAmount'))::real,
      (COALESCE(item->>'sgst_percent', item->>'sgstPercent'))::real,
      (COALESCE(item->>'sgst_amount', item->>'sgstAmount'))::real,
      (COALESCE(item->>'igst_percent', item->>'igstPercent'))::real,
      (COALESCE(item->>'igst_amount', item->>'igstAmount'))::real,
      (COALESCE(item->>'total_amount', item->>'totalAmount'))::real,
      (COALESCE(item->>'store_id', item->>'storeId'))::integer,
      COALESCE(item->>'store_code', item->>'storeCode'),
      (COALESCE(item->>'store_sort_order', item->>'storeSortOrder'))::integer,
      (COALESCE(item->>'row_sort_order', item->>'rowSortOrder'))::integer,
      COALESCE(item->>'manual_store_name', item->>'manualStoreName'),
      COALESCE(item->>'line_type', item->>'lineType', 'product'),
      COALESCE(item->>'calculation_type', item->>'calculationType', 'fixed'),
      COALESCE(item->'material_code_snapshot', item->'materialCodeSnapshot'),
      COALESCE(item->'product_snapshot', item->'productSnapshot')
    FROM jsonb_array_elements(p_items) AS item;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_estimate_items(integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_estimate_items(integer, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_estimate_items(integer, jsonb) TO authenticated, service_role;

-- Clean up orphaned items for SM/E/26-27/252 (estimate ID 106)
-- Retain only the latest saved 8 items (IDs 8160 to 8167) that match the header subtotal of 10623.20 and total of 12535.38.
DELETE FROM public.estimate_items
WHERE estimate_id = 106 AND id < 8160;

-- Clean up orphaned items for SM/E/26-27/253 (estimate ID 107)
-- Retain only the latest saved 8 items (IDs 8144 to 8151) that match the header subtotal of 10623.20 and total of 12535.38.
DELETE FROM public.estimate_items
WHERE estimate_id = 107 AND id < 8144;
