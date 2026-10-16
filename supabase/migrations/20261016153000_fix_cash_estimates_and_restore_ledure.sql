-- Migration: 20261016153000_fix_cash_estimates_and_restore_ledure.sql
-- Description:
-- 1. Restore Client 22 (Ledure Lighting Limited) under Company 2 (Delhi Company)
-- 2. Ensure Cash brand exists for Cash client
-- 3. Make estimates.brand_id and estimates.store_id nullable
-- 4. Update create_estimate_atomic to allow nullable brand_id/store_id for non-ABFRL/cash estimates

-- 1. Restore Ledure Lighting Limited (Client ID 22) in Company 2
INSERT INTO public.clients (id, name, company_id, client_type, is_active, format, created_at)
VALUES (22, 'Ledure Lighting Limited', 2, 'normal', true, 'normal', now())
ON CONFLICT (id) DO UPDATE SET
  company_id = 2,
  name = 'Ledure Lighting Limited',
  is_active = true,
  client_type = 'normal',
  format = 'normal';

SELECT setval('clients_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM public.clients), 1), 59));

-- 2. Ensure Cash brand exists for client 2 (Cash) under Company 1 (and Company 2 if needed)
INSERT INTO public.brands (name, parent_client_id, company_id, is_active)
SELECT 'Cash', 2, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.brands WHERE parent_client_id = 2 AND company_id = 1
);

-- 3. Allow estimates.brand_id and estimates.store_id to be nullable for Cash / non-store estimates
ALTER TABLE public.estimates ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE public.estimates ALTER COLUMN store_id DROP NOT NULL;

-- 4. Update create_estimate_atomic to support nullable brand_id and store_id
CREATE OR REPLACE FUNCTION public.create_estimate_atomic(p_estimate jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_estimate_id integer;
  v_client_id integer;
  v_brand_id integer;
  v_store_id integer;
  v_estimate_number text;
  v_estimate_date timestamp;
  v_created public.estimates%ROWTYPE;
  v_snapshot jsonb;
  v_user_id integer;
  v_user_name text;
BEGIN
  -- Extract company_id strictly
  v_company_id := COALESCE(
    (p_estimate->>'company_id')::integer,
    (p_estimate->>'companyId')::integer
  );

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required' USING ERRCODE = '23502';
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  v_client_id := (COALESCE(p_estimate->>'client_id', p_estimate->>'clientId'))::integer;
  v_brand_id := (COALESCE(p_estimate->>'brand_id', p_estimate->>'brandId'))::integer;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required' USING ERRCODE = '23502';
  END IF;

  -- Verify client belongs to this company
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client_id AND company_id = v_company_id) THEN
    RAISE EXCEPTION 'Client % does not belong to company %', v_client_id, v_company_id USING ERRCODE = '42501';
  END IF;

  -- Auto-resolve brand_id if omitted
  IF v_brand_id IS NULL THEN
    SELECT id INTO v_brand_id FROM public.brands
    WHERE parent_client_id = v_client_id AND company_id = v_company_id
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  -- Verify brand if brand_id is specified
  IF v_brand_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand_id AND company_id = v_company_id) THEN
    RAISE EXCEPTION 'Brand % does not belong to company %', v_brand_id, v_company_id USING ERRCODE = '42501';
  END IF;

  v_store_id := COALESCE(
    (COALESCE(p_estimate->>'store_id', p_estimate->>'storeId'))::integer,
    (COALESCE(p_items->0->>'store_id', p_items->0->>'storeId'))::integer,
    NULL
  );

  -- Verify store if store_id is specified
  IF v_store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_store_id AND company_id = v_company_id) THEN
    -- If store does not belong to company, do not reject if store is not strictly required, just nullify it
    v_store_id := NULL;
  END IF;

  v_estimate_date := COALESCE(
    (p_estimate->>'estimate_date')::timestamp,
    (p_estimate->>'estimateDate')::timestamp,
    CURRENT_TIMESTAMP
  );

  v_estimate_number := NULLIF(TRIM(COALESCE(p_estimate->>'estimate_number', p_estimate->>'estimateNumber', '')), '');
  IF v_estimate_number IS NULL OR v_estimate_number = '' THEN
    v_estimate_number := public.next_sunrise_document_number('estimate', v_estimate_date::date, v_company_id);
  END IF;

  v_user_id := COALESCE(
    (p_estimate->>'created_by')::integer,
    (p_estimate->>'createdBy')::integer,
    public.get_current_user_id()
  );

  SELECT COALESCE(name, username) INTO v_user_name
  FROM public.users WHERE id = v_user_id;

  -- 1. Insert estimate with current_revision_number = 0
  INSERT INTO public.estimates (
    company_id, estimate_number, client_id, brand_id, store_id, title, description,
    subtotal, tax_amount, total_amount, status, client_format, subject,
    billing_to, shipping_to, gstin, pan, state_code, vendor_code, gst_type,
    packing_percent, implementation_percent, transport_amount,
    store_grouping, po_number, po_date, po_amount, po_file_path, po_remarks,
    format_profile_code, billing_profile_id, billing_legal_name_snapshot,
    billing_gstin_snapshot, billing_state_snapshot, billing_state_code_snapshot,
    billing_address_snapshot, shipping_address_snapshot, abfrl_project_type,
    created_by, current_revision_number, revision_count,
    estimate_date, created_at, updated_at
  ) VALUES (
    v_company_id,
    v_estimate_number,
    v_client_id,
    v_brand_id,
    v_store_id,
    COALESCE(p_estimate->>'title', 'Estimate ' || v_estimate_number),
    p_estimate->>'description',
    COALESCE((COALESCE(p_estimate->>'subtotal', p_estimate->>'subTotal'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'tax_amount', p_estimate->>'taxAmount'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'total_amount', p_estimate->>'totalAmount'))::real, 0),
    COALESCE(p_estimate->>'status', 'draft'),
    COALESCE(p_estimate->>'client_format', p_estimate->>'clientFormat', 'normal'),
    p_estimate->>'subject',
    COALESCE(p_estimate->>'billing_to', p_estimate->>'billingTo'),
    COALESCE(p_estimate->>'shipping_to', p_estimate->>'shippingTo'),
    p_estimate->>'gstin',
    p_estimate->>'pan',
    COALESCE(p_estimate->>'state_code', p_estimate->>'stateCode'),
    COALESCE(p_estimate->>'vendor_code', p_estimate->>'vendorCode'),
    COALESCE(p_estimate->>'gst_type', p_estimate->>'gstType', 'CGST+SGST'),
    (COALESCE(p_estimate->>'packing_percent', p_estimate->>'packingPercent'))::real,
    (COALESCE(p_estimate->>'implementation_percent', p_estimate->>'implementationPercent'))::real,
    (COALESCE(p_estimate->>'transport_amount', p_estimate->>'transportAmount'))::real,
    CASE WHEN p_estimate ? 'store_grouping' OR p_estimate ? 'storeGrouping'
         THEN COALESCE(p_estimate->'store_grouping', p_estimate->'storeGrouping')
         ELSE NULL END,
    COALESCE(p_estimate->>'po_number', p_estimate->>'poNumber'),
    (COALESCE(p_estimate->>'po_date', p_estimate->>'poDate'))::timestamp,
    (COALESCE(p_estimate->>'po_amount', p_estimate->>'poAmount'))::real,
    COALESCE(p_estimate->>'po_file_path', p_estimate->>'poFilePath'),
    COALESCE(p_estimate->>'po_remarks', p_estimate->>'poRemarks'),
    COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode'),
    (COALESCE(p_estimate->>'billing_profile_id', p_estimate->>'billingProfileId'))::integer,
    COALESCE(p_estimate->>'billing_legal_name_snapshot', p_estimate->>'billingLegalNameSnapshot'),
    COALESCE(p_estimate->>'billing_gstin_snapshot', p_estimate->>'billingGstinSnapshot'),
    COALESCE(p_estimate->>'billing_state_snapshot', p_estimate->>'billingStateSnapshot'),
    COALESCE(p_estimate->>'billing_state_code_snapshot', p_estimate->>'billingStateCodeSnapshot'),
    COALESCE(p_estimate->>'billing_address_snapshot', p_estimate->>'billingAddressSnapshot'),
    COALESCE(p_estimate->>'shipping_address_snapshot', p_estimate->>'shippingAddressSnapshot'),
    COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType'),
    v_user_id,
    0,
    0,
    v_estimate_date,
    now(),
    now()
  ) RETURNING * INTO v_created;

  v_estimate_id := v_created.id;

  -- 2. Insert items
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
      v_estimate_id,
      COALESCE((item->>'product_id')::integer, (item->>'productId')::integer),
      COALESCE(item->>'item_name', item->>'itemName', item->>'name', 'Item'),
      item->>'description',
      COALESCE((item->>'quantity')::real, 1),
      COALESCE(item->>'unit', 'pcs'),
      COALESCE((NULLIF(regexp_replace(COALESCE(item->>'rate', '0'), '[^0-9.]', '', 'g'), ''))::real, 0),
      COALESCE((COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
      (item->>'sl')::integer,
      COALESCE((item->>'is_standard')::boolean, (item->>'isStandard')::boolean, true),
      COALESCE(item->>'hsn', item->>'hsn_sac'),
      COALESCE(item->>'material_code', item->>'materialCode'),
      COALESCE((item->>'material_code_id')::integer, (item->>'materialCodeId')::integer),
      COALESCE(item->>'material_description', item->>'materialDescription'),
      (NULLIF(item->>'width', ''))::real,
      (NULLIF(item->>'height', ''))::real,
      COALESCE((item->>'total_size')::real, (item->>'totalSize')::real),
      COALESCE((item->>'cgst_percent')::real, (item->>'cgstPercent')::real, 0),
      COALESCE((item->>'cgst_amount')::real, (item->>'cgstAmount')::real, 0),
      COALESCE((item->>'sgst_percent')::real, (item->>'sgstPercent')::real, 0),
      COALESCE((item->>'sgst_amount')::real, (item->>'sgstAmount')::real, 0),
      COALESCE((item->>'igst_percent')::real, (item->>'igstPercent')::real, 0),
      COALESCE((item->>'igst_amount')::real, (item->>'igstAmount')::real, 0),
      COALESCE((item->>'total_amount')::real, (item->>'totalAmount')::real, (COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
      COALESCE((item->>'store_id')::integer, (item->>'storeId')::integer, v_store_id),
      COALESCE(item->>'store_code', item->>'storeCode'),
      COALESCE((item->>'store_sort_order')::integer, (item->>'storeSortOrder')::integer),
      COALESCE((item->>'row_sort_order')::integer, (item->>'rowSortOrder')::integer),
      COALESCE(item->>'manual_store_name', item->>'manualStoreName'),
      COALESCE(item->>'line_type', item->>'lineType', 'product'),
      COALESCE(item->>'calculation_type', item->>'calculationType', 'fixed'),
      CASE WHEN item ? 'material_code_snapshot' OR item ? 'materialCodeSnapshot'
           THEN COALESCE(item->'material_code_snapshot', item->'materialCodeSnapshot')
           ELSE NULL END,
      CASE WHEN item ? 'product_snapshot' OR item ? 'productSnapshot'
           THEN COALESCE(item->'product_snapshot', item->'productSnapshot')
           ELSE NULL END
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  -- 3. Create baseline revision 0
  v_snapshot := jsonb_build_object(
    'estimate', to_jsonb(v_created),
    'items', COALESCE(p_items, '[]'::jsonb)
  );

  INSERT INTO public.estimate_revisions (
    company_id, estimate_id, revision_number, revision_note,
    subtotal, tax_amount, total_amount, items_count,
    created_by, created_by_name, snapshot, created_at
  ) VALUES (
    v_company_id,
    v_estimate_id,
    0,
    'Initial creation',
    v_created.subtotal,
    v_created.tax_amount,
    v_created.total_amount,
    COALESCE(jsonb_array_length(p_items), 0),
    v_user_id,
    v_user_name,
    v_snapshot,
    now()
  );

  RETURN to_jsonb(v_created);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) TO authenticated, service_role;
