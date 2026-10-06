-- Migration: 20261006180000_estimate_items_store_id_and_atomic_save.sql
-- Description: Add store_id to estimate_items and provide atomic estimate creation RPC.

-- 1. Additive column for store_id on estimate_items
ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS store_id integer REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_items_store_id ON public.estimate_items(store_id);

-- 2. Update replace_estimate_items to include store_id
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
    store_id, store_code, store_sort_order, row_sort_order,
    manual_store_name, line_type, calculation_type,
    material_code_snapshot, product_snapshot
  )
  SELECT
    p_estimate_id,
    COALESCE((item->>'product_id')::integer, (item->>'productId')::integer),
    COALESCE(item->>'item_name', item->>'itemName'),
    item->>'description',
    COALESCE((item->>'quantity')::real, 1),
    COALESCE(item->>'unit', 'pcs'),
    COALESCE((item->>'rate')::real, 0),
    COALESCE((COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
    (item->>'sl')::integer,
    COALESCE((COALESCE(item->>'is_standard', item->>'isStandard'))::boolean, true),
    item->>'hsn',
    COALESCE(item->>'material_code', item->>'materialCode'),
    COALESCE((item->>'material_code_id')::integer, (item->>'materialCodeId')::integer),
    COALESCE(item->>'material_description', item->>'materialDescription'),
    (item->>'width')::real,
    (item->>'height')::real,
    COALESCE((item->>'total_size')::real, (item->>'totalSize')::real),
    COALESCE((COALESCE(item->>'cgst_percent', item->>'cgstPercent'))::real, 9),
    COALESCE((COALESCE(item->>'cgst_amount', item->>'cgstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'sgst_percent', item->>'sgstPercent'))::real, 9),
    COALESCE((COALESCE(item->>'sgst_amount', item->>'sgstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'igst_percent', item->>'igstPercent'))::real, 0),
    COALESCE((COALESCE(item->>'igst_amount', item->>'igstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'total_amount', item->>'totalAmount'))::real, 0),
    COALESCE((item->>'store_id')::integer, (item->>'storeId')::integer),
    COALESCE(item->>'store_code', item->>'storeCode'),
    COALESCE((item->>'store_sort_order')::integer, (item->>'storeSortOrder')::integer),
    COALESCE((item->>'row_sort_order')::integer, (item->>'rowSortOrder')::integer),
    COALESCE(item->>'manual_store_name', item->>'manualStoreName'),
    COALESCE(item->>'line_type', item->>'lineType', 'product'),
    COALESCE(item->>'calculation_type', item->>'calculationType', 'fixed'),
    COALESCE(item->'material_code_snapshot', item->'materialCodeSnapshot'),
    COALESCE(item->'product_snapshot', item->'productSnapshot')
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
GRANT EXECUTE ON FUNCTION public.replace_estimate_items(integer, jsonb) TO authenticated, service_role;

-- 3. Atomic estimate creation RPC: inserts estimate header and items in a single transaction.
-- If any item insertion fails, the entire transaction rolls back automatically.
CREATE OR REPLACE FUNCTION public.create_estimate_atomic(
  p_estimate jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estimate_id integer;
  v_estimate_number text;
  v_client_id integer;
  v_brand_id integer;
  v_store_id integer;
  v_result jsonb;
BEGIN
  -- Resolve estimate number
  v_estimate_number := COALESCE(
    NULLIF(p_estimate->>'estimate_number', ''),
    NULLIF(p_estimate->>'estimateNumber', '')
  );
  IF v_estimate_number IS NULL OR v_estimate_number LIKE 'TEMP-%' OR v_estimate_number LIKE 'EST-%' THEN
    v_estimate_number := public.next_sunrise_document_number('estimate');
  END IF;

  v_client_id := COALESCE((p_estimate->>'client_id')::integer, (p_estimate->>'clientId')::integer);
  v_brand_id  := COALESCE((p_estimate->>'brand_id')::integer, (p_estimate->>'brandId')::integer);
  v_store_id  := COALESCE((p_estimate->>'store_id')::integer, (p_estimate->>'storeId')::integer);

  -- 1. Insert into estimates
  INSERT INTO estimates (
    estimate_number, estimate_date, po_date, client_id, brand_id, store_id,
    title, description, subtotal, tax_amount, total_amount, status,
    client_format, format_profile_code, abfrl_project_type, subject,
    billing_to, shipping_to, gstin, pan, state_code, vendor_code,
    gst_type, packing_percent, implementation_percent, transport_amount,
    store_grouping, billing_profile_id, billing_legal_name_snapshot,
    billing_gstin_snapshot, billing_state_snapshot, billing_state_code_snapshot,
    billing_address_snapshot, shipping_address_snapshot, created_by
  )
  VALUES (
    v_estimate_number,
    COALESCE((COALESCE(p_estimate->>'estimate_date', p_estimate->>'estimateDate'))::timestamp, NOW()),
    (COALESCE(p_estimate->>'po_date', p_estimate->>'poDate'))::timestamp,
    v_client_id,
    v_brand_id,
    v_store_id,
    COALESCE(p_estimate->>'title', v_estimate_number),
    COALESCE(p_estimate->>'description', p_estimate->>'desc'),
    COALESCE((COALESCE(p_estimate->>'subtotal', p_estimate->>'subTotal'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'tax_amount', p_estimate->>'taxAmount'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'total_amount', p_estimate->>'totalAmount'))::real, 0),
    COALESCE(p_estimate->>'status', 'draft'),
    COALESCE(p_estimate->>'client_format', p_estimate->>'clientFormat', 'normal'),
    COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode'),
    COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType'),
    p_estimate->>'subject',
    COALESCE(p_estimate->>'billing_to', p_estimate->>'billingTo'),
    COALESCE(p_estimate->>'shipping_to', p_estimate->>'shippingTo'),
    p_estimate->>'gstin',
    p_estimate->>'pan',
    COALESCE(p_estimate->>'state_code', p_estimate->>'stateCode'),
    COALESCE(p_estimate->>'vendor_code', p_estimate->>'vendorCode'),
    COALESCE(p_estimate->>'gst_type', p_estimate->>'gstType', 'CGST+SGST'),
    COALESCE((COALESCE(p_estimate->>'packing_percent', p_estimate->>'packingPercent'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'implementation_percent', p_estimate->>'implementationPercent'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'transport_amount', p_estimate->>'transportAmount'))::real, 0),
    COALESCE(p_estimate->'store_grouping', p_estimate->'storeGrouping'),
    COALESCE((p_estimate->>'billing_profile_id')::integer, (p_estimate->>'billingProfileId')::integer),
    COALESCE(p_estimate->>'billing_legal_name_snapshot', p_estimate->>'billingLegalNameSnapshot'),
    COALESCE(p_estimate->>'billing_gstin_snapshot', p_estimate->>'billingGstinSnapshot'),
    COALESCE(p_estimate->>'billing_state_snapshot', p_estimate->>'billingStateSnapshot'),
    COALESCE(p_estimate->>'billing_state_code_snapshot', p_estimate->>'billingStateCodeSnapshot'),
    COALESCE(p_estimate->>'billing_address_snapshot', p_estimate->>'billingAddressSnapshot'),
    COALESCE(p_estimate->>'shipping_address_snapshot', p_estimate->>'shippingAddressSnapshot'),
    COALESCE((p_estimate->>'created_by')::integer, (p_estimate->>'createdBy')::integer)
  )
  RETURNING id INTO v_estimate_id;

  -- 2. Insert into estimate_items
  INSERT INTO estimate_items (
    estimate_id, product_id, item_name, description, quantity, unit, rate,
    total_price, sl, is_standard, hsn, material_code, material_code_id,
    material_description, width, height, total_size,
    cgst_percent, cgst_amount, sgst_percent, sgst_amount,
    igst_percent, igst_amount, total_amount,
    store_id, store_code, store_sort_order, row_sort_order,
    manual_store_name, line_type, calculation_type,
    material_code_snapshot, product_snapshot
  )
  SELECT
    v_estimate_id,
    COALESCE((item->>'product_id')::integer, (item->>'productId')::integer),
    COALESCE(item->>'item_name', item->>'itemName'),
    item->>'description',
    COALESCE((item->>'quantity')::real, 1),
    COALESCE(item->>'unit', 'pcs'),
    COALESCE((item->>'rate')::real, 0),
    COALESCE((COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
    (item->>'sl')::integer,
    COALESCE((COALESCE(item->>'is_standard', item->>'isStandard'))::boolean, true),
    item->>'hsn',
    COALESCE(item->>'material_code', item->>'materialCode'),
    COALESCE((item->>'material_code_id')::integer, (item->>'materialCodeId')::integer),
    COALESCE(item->>'material_description', item->>'materialDescription'),
    (item->>'width')::real,
    (item->>'height')::real,
    COALESCE((item->>'total_size')::real, (item->>'totalSize')::real),
    COALESCE((COALESCE(item->>'cgst_percent', item->>'cgstPercent'))::real, 9),
    COALESCE((COALESCE(item->>'cgst_amount', item->>'cgstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'sgst_percent', item->>'sgstPercent'))::real, 9),
    COALESCE((COALESCE(item->>'sgst_amount', item->>'sgstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'igst_percent', item->>'igstPercent'))::real, 0),
    COALESCE((COALESCE(item->>'igst_amount', item->>'igstAmount'))::real, 0),
    COALESCE((COALESCE(item->>'total_amount', item->>'totalAmount'))::real, 0),
    COALESCE((item->>'store_id')::integer, (item->>'storeId')::integer, v_store_id),
    COALESCE(item->>'store_code', item->>'storeCode'),
    COALESCE((item->>'store_sort_order')::integer, (item->>'storeSortOrder')::integer),
    COALESCE((item->>'row_sort_order')::integer, (item->>'rowSortOrder')::integer),
    COALESCE(item->>'manual_store_name', item->>'manualStoreName'),
    COALESCE(item->>'line_type', item->>'lineType', 'product'),
    COALESCE(item->>'calculation_type', item->>'calculationType', 'fixed'),
    COALESCE(item->'material_code_snapshot', item->'materialCodeSnapshot'),
    COALESCE(item->'product_snapshot', item->'productSnapshot')
  FROM jsonb_array_elements(p_items) AS t(item);

  -- 3. Return full estimate row as jsonb
  SELECT to_jsonb(e.*) INTO v_result FROM estimates e WHERE e.id = v_estimate_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) TO authenticated, service_role;
