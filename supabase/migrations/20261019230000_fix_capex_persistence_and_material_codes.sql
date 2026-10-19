-- Migration: 20261019230000_fix_capex_persistence_and_material_codes.sql
-- Description:
-- 1. Fix save_estimate_revision_atomic so changes to abfrl_project_type (SELEX vs CAPEX),
--    line item material codes, and document metadata are detected as business changes
--    and persisted to estimates, estimate_items, and estimate_revisions snapshot.
-- 2. Update resolve_customer_rate to return material_code_id, material_code, and material_description.

CREATE OR REPLACE FUNCTION public.save_estimate_revision_atomic(
  p_estimate_id integer,
  p_estimate jsonb,
  p_items jsonb,
  p_revision_note text DEFAULT NULL::text,
  p_expected_revision_number integer DEFAULT NULL::integer,
  p_user_id integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_est public.estimates%ROWTYPE;
  v_updated public.estimates%ROWTYPE;
  v_next_rev integer;
  v_new_subtotal real;
  v_new_tax real;
  v_new_total real;
  v_snapshot jsonb;
  v_user_id integer;
  v_user_name text;
  v_has_changes boolean := false;
  v_curr_items_count integer;
  v_new_items_count integer;
BEGIN
  -- Row-level lock to prevent concurrent overwrites
  SELECT * INTO v_est FROM public.estimates WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_est.company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_est.company_id USING ERRCODE = '42501';
  END IF;

  -- Optimistic concurrency check
  IF p_expected_revision_number IS NOT NULL AND v_est.current_revision_number != p_expected_revision_number THEN
    RAISE EXCEPTION 'Concurrency conflict: Estimate has been updated to Revision % by another user (expected %). Please reload before saving.',
      v_est.current_revision_number, p_expected_revision_number USING ERRCODE = '40001';
  END IF;

  v_user_id := COALESCE(p_user_id, public.get_current_user_id());
  SELECT COALESCE(name, username) INTO v_user_name FROM public.users WHERE id = v_user_id;

  v_new_subtotal := COALESCE(
    (COALESCE(p_estimate->>'subtotal', p_estimate->>'subTotal'))::real,
    v_est.subtotal
  );
  v_new_tax := COALESCE(
    (COALESCE(p_estimate->>'tax_amount', p_estimate->>'taxAmount'))::real,
    v_est.tax_amount
  );
  v_new_total := COALESCE(
    (COALESCE(p_estimate->>'total_amount', p_estimate->>'totalAmount'))::real,
    v_est.total_amount
  );

  SELECT count(*) INTO v_curr_items_count FROM public.estimate_items WHERE estimate_id = p_estimate_id;
  v_new_items_count := COALESCE(jsonb_array_length(p_items), 0);

  -- Check for substantive business changes
  IF ROUND(v_new_total::numeric, 2) != ROUND(v_est.total_amount::numeric, 2)
     OR ROUND(v_new_subtotal::numeric, 2) != ROUND(v_est.subtotal::numeric, 2)
     OR ROUND(v_new_tax::numeric, 2) != ROUND(v_est.tax_amount::numeric, 2)
     OR v_curr_items_count != v_new_items_count
     OR COALESCE(p_estimate->>'title', v_est.title) != v_est.title
     OR (jsonb_typeof(p_estimate->'store_grouping') = 'object' AND p_estimate->'store_grouping' != COALESCE(v_est.store_grouping, '{}'::jsonb))
     OR (NULLIF(TRIM(p_revision_note), '') IS NOT NULL)
     -- Detect project type change (SELEX <-> CAPEX)
     OR ((p_estimate ? 'abfrl_project_type' OR p_estimate ? 'abfrlProjectType')
         AND (COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType') IS DISTINCT FROM v_est.abfrl_project_type))
     -- Detect header metadata changes
     OR (p_estimate ? 'subject' AND p_estimate->>'subject' IS DISTINCT FROM v_est.subject)
     OR (p_estimate ? 'description' AND p_estimate->>'description' IS DISTINCT FROM v_est.description)
     OR (p_estimate ? 'status' AND p_estimate->>'status' IS DISTINCT FROM v_est.status)
     OR ((p_estimate ? 'po_number' OR p_estimate ? 'poNumber')
         AND (COALESCE(p_estimate->>'po_number', p_estimate->>'poNumber') IS DISTINCT FROM v_est.po_number))
     OR ((p_estimate ? 'billing_to' OR p_estimate ? 'billingTo')
         AND (COALESCE(p_estimate->>'billing_to', p_estimate->>'billingTo') IS DISTINCT FROM v_est.billing_to))
     OR ((p_estimate ? 'shipping_to' OR p_estimate ? 'shippingTo')
         AND (COALESCE(p_estimate->>'shipping_to', p_estimate->>'shippingTo') IS DISTINCT FROM v_est.shipping_to))
     OR ((p_estimate ? 'vendor_code' OR p_estimate ? 'vendorCode')
         AND (COALESCE(p_estimate->>'vendor_code', p_estimate->>'vendorCode') IS DISTINCT FROM v_est.vendor_code))
     OR ((p_estimate ? 'billing_profile_id' OR p_estimate ? 'billingProfileId')
         AND (COALESCE((p_estimate->>'billing_profile_id')::integer, (p_estimate->>'billingProfileId')::integer) IS DISTINCT FROM v_est.billing_profile_id))
     OR ((p_estimate ? 'format_profile_code' OR p_estimate ? 'formatProfileCode')
         AND (COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode') IS DISTINCT FROM v_est.format_profile_code))
     -- Detect changes in line items (e.g. material_code, material_code_id, description, hsn, rates)
     OR (p_items IS NOT NULL AND (
          (SELECT count(*) FROM (
            SELECT
              COALESCE((item->>'product_id')::integer, (item->>'productId')::integer) AS product_id,
              COALESCE(item->>'item_name', item->>'itemName', item->>'name', 'Item') AS item_name,
              COALESCE(item->>'description', '') AS description,
              COALESCE((item->>'quantity')::real, 1) AS quantity,
              COALESCE(item->>'unit', 'pcs') AS unit,
              COALESCE((NULLIF(regexp_replace(COALESCE(item->>'rate', '0'), '[^0-9.]', '', 'g'), ''))::real, 0) AS rate,
              (item->>'sl')::integer AS sl,
              COALESCE(item->>'hsn', item->>'hsn_sac', '') AS hsn,
              COALESCE(item->>'material_code', item->>'materialCode', '') AS material_code,
              COALESCE((item->>'material_code_id')::integer, (item->>'materialCodeId')::integer, 0) AS material_code_id
            FROM jsonb_array_elements(p_items) AS item
            EXCEPT
            SELECT
              product_id,
              item_name,
              COALESCE(description, ''),
              quantity,
              unit,
              rate,
              sl,
              COALESCE(hsn, ''),
              COALESCE(material_code, ''),
              COALESCE(material_code_id, 0)
            FROM public.estimate_items WHERE estimate_id = p_estimate_id
          ) diff) > 0
        ))
  THEN
    v_has_changes := true;
  END IF;

  -- If no changes were made and no revision note was provided, return existing state without duplicate revision
  IF NOT v_has_changes THEN
    RETURN to_jsonb(v_est);
  END IF;

  -- Next revision number
  v_next_rev := v_est.current_revision_number + 1;

  -- 1. Update working row in estimates
  UPDATE public.estimates
  SET
    title = COALESCE(p_estimate->>'title', title),
    description = COALESCE(p_estimate->>'description', description),
    subtotal = v_new_subtotal,
    tax_amount = v_new_tax,
    total_amount = v_new_total,
    status = COALESCE(p_estimate->>'status', status),
    client_format = COALESCE(p_estimate->>'client_format', p_estimate->>'clientFormat', client_format),
    format_profile_code = COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode', format_profile_code),
    subject = COALESCE(p_estimate->>'subject', subject),
    billing_to = COALESCE(p_estimate->>'billing_to', p_estimate->>'billingTo', billing_to),
    shipping_to = COALESCE(p_estimate->>'shipping_to', p_estimate->>'shippingTo', shipping_to),
    gstin = COALESCE(p_estimate->>'gstin', gstin),
    pan = COALESCE(p_estimate->>'pan', pan),
    state_code = COALESCE(p_estimate->>'state_code', p_estimate->>'stateCode', state_code),
    vendor_code = COALESCE(p_estimate->>'vendor_code', p_estimate->>'vendorCode', vendor_code),
    gst_type = COALESCE(p_estimate->>'gst_type', p_estimate->>'gstType', gst_type),
    store_grouping = CASE WHEN p_estimate ? 'store_grouping' OR p_estimate ? 'storeGrouping'
                          THEN COALESCE(p_estimate->'store_grouping', p_estimate->'storeGrouping')
                          ELSE store_grouping END,
    billing_profile_id = COALESCE((p_estimate->>'billing_profile_id')::integer, (p_estimate->>'billingProfileId')::integer, billing_profile_id),
    billing_legal_name_snapshot = COALESCE(p_estimate->>'billing_legal_name_snapshot', p_estimate->>'billingLegalNameSnapshot', billing_legal_name_snapshot),
    billing_gstin_snapshot = COALESCE(p_estimate->>'billing_gstin_snapshot', p_estimate->>'billingGstinSnapshot', billing_gstin_snapshot),
    billing_state_snapshot = COALESCE(p_estimate->>'billing_state_snapshot', p_estimate->>'billingStateSnapshot', billing_state_snapshot),
    billing_state_code_snapshot = COALESCE(p_estimate->>'billing_state_code_snapshot', p_estimate->>'billingStateCodeSnapshot', billing_state_code_snapshot),
    billing_address_snapshot = COALESCE(p_estimate->>'billing_address_snapshot', p_estimate->>'billingAddressSnapshot', billing_address_snapshot),
    shipping_address_snapshot = COALESCE(p_estimate->>'shipping_address_snapshot', p_estimate->>'shippingAddressSnapshot', shipping_address_snapshot),
    abfrl_project_type = CASE WHEN p_estimate ? 'abfrl_project_type' OR p_estimate ? 'abfrlProjectType'
                              THEN NULLIF(COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType'), '')
                              ELSE abfrl_project_type END,
    po_number = COALESCE(p_estimate->>'po_number', p_estimate->>'poNumber', po_number),
    po_date = COALESCE((p_estimate->>'po_date')::timestamp, (p_estimate->>'poDate')::timestamp, po_date),
    po_amount = COALESCE((p_estimate->>'po_amount')::real, (p_estimate->>'poAmount')::real, po_amount),
    po_file_path = COALESCE(p_estimate->>'po_file_path', p_estimate->>'poFilePath', po_file_path),
    po_remarks = COALESCE(p_estimate->>'po_remarks', p_estimate->>'poRemarks', po_remarks),
    current_revision_number = v_next_rev,
    revision_count = v_est.revision_count + 1,
    updated_at = now()
  WHERE id = p_estimate_id
  RETURNING * INTO v_updated;

  -- 2. Atomically replace child items
  DELETE FROM public.estimate_items WHERE estimate_id = p_estimate_id;

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
      v_est.company_id,
      p_estimate_id,
      COALESCE((item->>'product_id')::integer, (item->>'productId')::integer),
      COALESCE(item->>'item_name', item->>'itemName', item->>'name', 'Item'),
      item->>'description',
      COALESCE((item->>'quantity')::real, 1),
      COALESCE(item->>'unit', 'pcs'),
      COALESCE((NULLIF(regexp_replace(COALESCE(item->>'rate', '0'), '[^0-9.]', '', 'g'), ''))::real, (item->>'rate')::real, 0),
      COALESCE((COALESCE(item->>'total_price', item->>'totalPrice'))::real, 0),
      (item->>'sl')::integer,
      COALESCE((item->>'is_standard')::boolean, (item->>'isStandard')::boolean, true),
      COALESCE(item->>'hsn', item->>'hsn_sac'),
      COALESCE(item->>'material_code', item->>'materialCode'),
      (COALESCE(item->>'material_code_id', item->>'materialCodeId'))::integer,
      COALESCE(item->>'material_description', item->>'materialDescription'),
      (NULLIF(item->>'width', ''))::real,
      (NULLIF(item->>'height', ''))::real,
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
  END IF;

  -- 3. Insert new immutable revision snapshot
  v_snapshot := public.build_estimate_snapshot(v_updated, p_items, 1);

  INSERT INTO public.estimate_revisions (
    company_id, estimate_id, revision_number, revision_note,
    source_revision_number, created_by, created_by_name, created_at,
    snapshot_schema_version, subtotal, tax_amount, total_amount,
    items_count, store_count, snapshot
  )
  VALUES (
    v_est.company_id,
    p_estimate_id,
    v_next_rev,
    p_revision_note,
    NULL,
    v_user_id,
    v_user_name,
    now(),
    1,
    v_updated.subtotal,
    v_updated.tax_amount,
    v_updated.total_amount,
    v_new_items_count,
    CASE WHEN jsonb_typeof(v_updated.store_grouping) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v_updated.store_grouping)) ELSE 1 END,
    v_snapshot
  );

  RETURN to_jsonb(v_updated);
END;
$function$;

-- Update resolve_customer_rate to return material code info
CREATE OR REPLACE FUNCTION public.resolve_customer_rate(
  p_client_id integer,
  p_brand_id integer DEFAULT NULL::integer,
  p_product_id integer DEFAULT NULL::integer,
  p_project_type text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_client_id IS NULL OR p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'rate', cri.rate,
    'uom', cri.uom,
    'gst_percent', cri.gst_percent,
    'rate_card_id', rc.id,
    'rate_card_name', rc.name,
    'calculation_type', cri.calculation_type,
    'item_name', cri.item_name,
    'material_code_id', cri.material_code_id,
    'material_code', mc.code,
    'material_description', mc.description
  ) INTO v_result
  FROM public.customer_rate_items cri
  JOIN public.customer_rate_cards rc ON rc.id = cri.rate_card_id
  LEFT JOIN public.material_codes mc ON mc.id = cri.material_code_id
  WHERE rc.client_id = p_client_id
    AND rc.is_active = true
    AND (rc.effective_from IS NULL OR rc.effective_from <= now())
    AND (rc.effective_to IS NULL OR rc.effective_to >= now())
    AND public.user_has_company_access(rc.company_id)
    AND cri.product_id = p_product_id
    AND cri.is_active = true
    AND cri.rate > 0
    AND (
      (p_brand_id IS NOT NULL AND rc.brand_id = p_brand_id)
      OR (rc.brand_id IS NULL)
    )
    AND (
      (p_project_type IS NOT NULL AND rc.project_type = p_project_type)
      OR (rc.project_type IS NULL)
    )
  ORDER BY
    (CASE WHEN rc.brand_id IS NOT NULL AND rc.brand_id = p_brand_id THEN 2 ELSE 0 END
     + CASE WHEN rc.project_type IS NOT NULL AND rc.project_type = p_project_type THEN 1 ELSE 0 END) DESC,
    rc.id DESC
  LIMIT 1;

  RETURN v_result;
END;
$function$;
