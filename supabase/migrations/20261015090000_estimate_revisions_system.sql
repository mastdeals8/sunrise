-- Migration: 20261015090000_estimate_revisions_system.sql
-- Description: Complete Estimate Revision & Version History System
-- Durable, company-isolated revision snapshots, optimistic concurrency control,
-- atomic revision saving, restoring, and backfill of existing baseline estimates.

-- 1. Alter estimates table to track current revision number and count
ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS current_revision_number integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

-- 2. Create estimate_revisions table
CREATE TABLE IF NOT EXISTS public.estimate_revisions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  estimate_id integer NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  revision_note text,
  source_revision_number integer,
  created_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  snapshot_schema_version integer NOT NULL DEFAULT 1,
  subtotal real NOT NULL DEFAULT 0,
  tax_amount real NOT NULL DEFAULT 0,
  total_amount real NOT NULL DEFAULT 0,
  items_count integer NOT NULL DEFAULT 0,
  store_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL,
  CONSTRAINT uk_estimate_revisions_est_rev UNIQUE(estimate_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_estimate_revisions_est_rev ON public.estimate_revisions(estimate_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_estimate_revisions_company ON public.estimate_revisions(company_id);

-- 3. Row Level Security for estimate_revisions
ALTER TABLE public.estimate_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_estimate_revisions ON public.estimate_revisions;
DROP POLICY IF EXISTS rls_insert_estimate_revisions ON public.estimate_revisions;
DROP POLICY IF EXISTS rls_update_estimate_revisions ON public.estimate_revisions;
DROP POLICY IF EXISTS rls_delete_estimate_revisions ON public.estimate_revisions;

CREATE POLICY rls_select_estimate_revisions ON public.estimate_revisions
  FOR SELECT TO authenticated
  USING (public.user_has_company_access(company_id));

CREATE POLICY rls_insert_estimate_revisions ON public.estimate_revisions
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_company_access(company_id));

-- Revisions are immutable: regular users cannot alter historical revisions
CREATE POLICY rls_update_estimate_revisions ON public.estimate_revisions
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY rls_delete_estimate_revisions ON public.estimate_revisions
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- 4. Helper function to construct full snapshot JSON for an estimate and its items
CREATE OR REPLACE FUNCTION public.build_estimate_snapshot(
  p_est public.estimates,
  p_items jsonb,
  p_schema_version integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_client jsonb;
  v_brand jsonb;
  v_stores jsonb;
  v_snapshot jsonb;
BEGIN
  -- Snapshot client info
  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'gstNumber', c.gst_number,
    'city', c.city,
    'address', c.address,
    'vendorCode', c.vendor_code
  ) INTO v_client
  FROM public.clients c
  WHERE c.id = p_est.client_id;

  -- Snapshot brand info
  SELECT jsonb_build_object(
    'id', b.id,
    'name', b.name
  ) INTO v_brand
  FROM public.brands b
  WHERE b.id = p_est.brand_id;

  -- Snapshot store(s) involved
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'storeCode', s.store_code,
    'location', s.location,
    'city', s.city,
    'state', s.state,
    'stateCode', s.state_code,
    'address', s.address
  )), '[]'::jsonb) INTO v_stores
  FROM public.stores s
  WHERE s.id = p_est.store_id
     OR (jsonb_typeof(p_est.store_grouping) = 'object' AND s.id::text IN (SELECT jsonb_object_keys(p_est.store_grouping)));

  v_snapshot := jsonb_build_object(
    'schemaVersion', p_schema_version,
    'createdAt', now(),
    'estimate', jsonb_build_object(
      'id', p_est.id,
      'companyId', p_est.company_id,
      'estimateNumber', p_est.estimate_number,
      'estimateDate', p_est.estimate_date,
      'clientId', p_est.client_id,
      'brandId', p_est.brand_id,
      'storeId', p_est.store_id,
      'title', p_est.title,
      'description', p_est.description,
      'subtotal', p_est.subtotal,
      'taxAmount', p_est.tax_amount,
      'totalAmount', p_est.total_amount,
      'status', p_est.status,
      'clientFormat', p_est.client_format,
      'formatProfileCode', p_est.format_profile_code,
      'subject', p_est.subject,
      'billingTo', p_est.billing_to,
      'shippingTo', p_est.shipping_to,
      'gstin', p_est.gstin,
      'pan', p_est.pan,
      'stateCode', p_est.state_code,
      'vendorCode', p_est.vendor_code,
      'gstType', p_est.gst_type,
      'storeGrouping', p_est.store_grouping,
      'packingPercent', p_est.packing_percent,
      'implementationPercent', p_est.implementation_percent,
      'transportAmount', p_est.transport_amount,
      'poNumber', p_est.po_number,
      'poDate', p_est.po_date,
      'poAmount', p_est.po_amount,
      'poFilePath', p_est.po_file_path,
      'poRemarks', p_est.po_remarks,
      'billingProfileId', p_est.billing_profile_id,
      'billingLegalNameSnapshot', p_est.billing_legal_name_snapshot,
      'billingGstinSnapshot', p_est.billing_gstin_snapshot,
      'billingStateSnapshot', p_est.billing_state_snapshot,
      'billingStateCodeSnapshot', p_est.billing_state_code_snapshot,
      'billingAddressSnapshot', p_est.billing_address_snapshot,
      'shippingAddressSnapshot', p_est.shipping_address_snapshot,
      'abfrlProjectType', p_est.abfrl_project_type,
      'currentRevisionNumber', p_est.current_revision_number
    ),
    'items', p_items,
    'client', v_client,
    'brand', v_brand,
    'stores', v_stores
  );

  RETURN v_snapshot;
END;
$function$;

-- 5. Atomic Estimate Creation with Revision 0 Snapshot
CREATE OR REPLACE FUNCTION public.create_estimate_atomic(p_estimate jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer := 1;
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
  -- Extract company_id
  v_company_id := COALESCE(
    (p_estimate->>'company_id')::integer,
    (p_estimate->>'companyId')::integer,
    1
  );

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  v_client_id := (COALESCE(p_estimate->>'client_id', p_estimate->>'clientId'))::integer;
  v_brand_id := (COALESCE(p_estimate->>'brand_id', p_estimate->>'brandId'))::integer;
  v_store_id := COALESCE(
    (COALESCE(p_estimate->>'store_id', p_estimate->>'storeId'))::integer,
    (COALESCE(p_items->0->>'store_id', p_items->0->>'storeId'))::integer,
    (SELECT id FROM public.stores WHERE company_id = v_company_id LIMIT 1),
    1
  );

  IF v_client_id IS NULL OR v_brand_id IS NULL THEN
    RAISE EXCEPTION 'client_id and brand_id are required' USING ERRCODE = '23502';
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
    billing_profile_id, billing_legal_name_snapshot, billing_gstin_snapshot,
    billing_state_snapshot, billing_state_code_snapshot,
    billing_address_snapshot, shipping_address_snapshot, created_by,
    abfrl_project_type, estimate_date, format_profile_code,
    current_revision_number, revision_count, updated_at
  )
  VALUES (
    v_company_id,
    v_estimate_number,
    v_client_id,
    v_brand_id,
    v_store_id,
    COALESCE(p_estimate->>'title', 'New Estimate'),
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
    COALESCE(p_estimate->>'gst_type', p_estimate->>'gstType', 'standard'),
    COALESCE((COALESCE(p_estimate->>'packing_percent', p_estimate->>'packingPercent'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'implementation_percent', p_estimate->>'implementationPercent'))::real, 0),
    COALESCE((COALESCE(p_estimate->>'transport_amount', p_estimate->>'transportAmount'))::real, 0),
    COALESCE(p_estimate->'store_grouping', p_estimate->'storeGrouping'),
    COALESCE(p_estimate->>'po_number', p_estimate->>'poNumber'),
    (COALESCE(p_estimate->>'po_date', p_estimate->>'poDate'))::timestamp,
    (COALESCE(p_estimate->>'po_amount', p_estimate->>'poAmount'))::real,
    COALESCE(p_estimate->>'po_file_path', p_estimate->>'poFilePath'),
    COALESCE(p_estimate->>'po_remarks', p_estimate->>'poRemarks'),
    (COALESCE(p_estimate->>'billing_profile_id', p_estimate->>'billingProfileId'))::integer,
    COALESCE(p_estimate->>'billing_legal_name_snapshot', p_estimate->>'billingLegalNameSnapshot'),
    COALESCE(p_estimate->>'billing_gstin_snapshot', p_estimate->>'billingGstinSnapshot'),
    COALESCE(p_estimate->>'billing_state_snapshot', p_estimate->>'billingStateSnapshot'),
    COALESCE(p_estimate->>'billing_state_code_snapshot', p_estimate->>'billingStateCodeSnapshot'),
    COALESCE(p_estimate->>'billing_address_snapshot', p_estimate->>'billingAddressSnapshot'),
    COALESCE(p_estimate->>'shipping_address_snapshot', p_estimate->>'shippingAddressSnapshot'),
    v_user_id,
    COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType'),
    v_estimate_date,
    COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode', 'normal'),
    0, -- current_revision_number
    1, -- revision_count
    now()
  )
  RETURNING * INTO v_created;

  v_estimate_id := v_created.id;

  -- 2. Insert items into estimate_items
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
  END IF;

  -- 3. Create Revision 0 Snapshot
  v_snapshot := public.build_estimate_snapshot(v_created, p_items, 1);

  INSERT INTO public.estimate_revisions (
    company_id, estimate_id, revision_number, revision_note,
    source_revision_number, created_by, created_by_name, created_at,
    snapshot_schema_version, subtotal, tax_amount, total_amount,
    items_count, store_count, snapshot
  )
  VALUES (
    v_company_id,
    v_estimate_id,
    0, -- Revision 0
    COALESCE(p_estimate->>'revision_note', p_estimate->>'revisionNote', 'Initial estimate'),
    NULL,
    v_user_id,
    v_user_name,
    now(),
    1,
    v_created.subtotal,
    v_created.tax_amount,
    v_created.total_amount,
    COALESCE(jsonb_array_length(p_items), 0),
    CASE WHEN jsonb_typeof(v_created.store_grouping) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v_created.store_grouping)) ELSE 1 END,
    v_snapshot
  );

  RETURN to_jsonb(v_created);
END;
$function$;

-- 6. Atomic Save Estimate Revision (with Optimistic Concurrency Control)
CREATE OR REPLACE FUNCTION public.save_estimate_revision_atomic(
  p_estimate_id integer,
  p_estimate jsonb,
  p_items jsonb,
  p_revision_note text DEFAULT NULL,
  p_expected_revision_number integer DEFAULT NULL,
  p_user_id integer DEFAULT NULL
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

  v_new_subtotal := COALESCE((COALESCE(p_estimate->>'subtotal', p_estimate->>'subTotal'))::real, v_est.subtotal);
  v_new_tax := COALESCE((COALESCE(p_estimate->>'tax_amount', p_estimate->>'taxAmount'))::real, v_est.tax_amount);
  v_new_total := COALESCE((COALESCE(p_estimate->>'total_amount', p_estimate->>'totalAmount'))::real, v_est.total_amount);

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
    abfrl_project_type = COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType', abfrl_project_type),
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

-- 7. Atomic Restore Estimate Revision (Restores historical snapshot as a NEW revision)
CREATE OR REPLACE FUNCTION public.restore_estimate_revision_atomic(
  p_estimate_id integer,
  p_restore_revision_number integer,
  p_revision_note text DEFAULT NULL,
  p_user_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_est public.estimates%ROWTYPE;
  v_target_rev public.estimate_revisions%ROWTYPE;
  v_updated public.estimates%ROWTYPE;
  v_next_rev integer;
  v_snap_est jsonb;
  v_snap_items jsonb;
  v_new_snapshot jsonb;
  v_user_id integer;
  v_user_name text;
BEGIN
  -- Row-level lock on current estimate
  SELECT * INTO v_est FROM public.estimates WHERE id = p_estimate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate % not found', p_estimate_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_est.company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_est.company_id USING ERRCODE = '42501';
  END IF;

  -- Fetch the target revision to restore
  SELECT * INTO v_target_rev
  FROM public.estimate_revisions
  WHERE estimate_id = p_estimate_id AND revision_number = p_restore_revision_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision % for estimate % not found', p_restore_revision_number, p_estimate_id USING ERRCODE = 'P0002';
  END IF;

  -- Ensure strict company matching
  IF v_target_rev.company_id != v_est.company_id THEN
    RAISE EXCEPTION 'Company mismatch on revision restore' USING ERRCODE = '42501';
  END IF;

  v_user_id := COALESCE(p_user_id, public.get_current_user_id());
  SELECT COALESCE(name, username) INTO v_user_name FROM public.users WHERE id = v_user_id;

  v_snap_est := v_target_rev.snapshot->'estimate';
  v_snap_items := v_target_rev.snapshot->'items';

  v_next_rev := v_est.current_revision_number + 1;

  -- 1. Restore estimate working row fields from snapshot
  UPDATE public.estimates
  SET
    title = COALESCE(v_snap_est->>'title', title),
    description = v_snap_est->>'description',
    subtotal = COALESCE((v_snap_est->>'subtotal')::real, v_target_rev.subtotal),
    tax_amount = COALESCE((v_snap_est->>'taxAmount')::real, (v_snap_est->>'tax_amount')::real, v_target_rev.tax_amount),
    total_amount = COALESCE((v_snap_est->>'totalAmount')::real, (v_snap_est->>'total_amount')::real, v_target_rev.total_amount),
    client_format = COALESCE(v_snap_est->>'clientFormat', v_snap_est->>'client_format', client_format),
    format_profile_code = COALESCE(v_snap_est->>'formatProfileCode', v_snap_est->>'format_profile_code', format_profile_code),
    subject = v_snap_est->>'subject',
    billing_to = v_snap_est->>'billingTo',
    shipping_to = v_snap_est->>'shippingTo',
    gstin = v_snap_est->>'gstin',
    pan = v_snap_est->>'pan',
    state_code = COALESCE(v_snap_est->>'stateCode', v_snap_est->>'state_code'),
    vendor_code = COALESCE(v_snap_est->>'vendorCode', v_snap_est->>'vendor_code'),
    gst_type = COALESCE(v_snap_est->>'gstType', v_snap_est->>'gst_type', gst_type),
    store_grouping = v_snap_est->'storeGrouping',
    billing_profile_id = (v_snap_est->>'billingProfileId')::integer,
    billing_legal_name_snapshot = v_snap_est->>'billingLegalNameSnapshot',
    billing_gstin_snapshot = v_snap_est->>'billingGstinSnapshot',
    billing_state_snapshot = v_snap_est->>'billingStateSnapshot',
    billing_state_code_snapshot = v_snap_est->>'billingStateCodeSnapshot',
    billing_address_snapshot = v_snap_est->>'billingAddressSnapshot',
    shipping_address_snapshot = v_snap_est->>'shippingAddressSnapshot',
    abfrl_project_type = v_snap_est->>'abfrlProjectType',
    po_number = v_snap_est->>'poNumber',
    po_date = (v_snap_est->>'poDate')::timestamp,
    po_amount = (v_snap_est->>'poAmount')::real,
    po_file_path = v_snap_est->>'poFilePath',
    po_remarks = v_snap_est->>'poRemarks',
    current_revision_number = v_next_rev,
    revision_count = v_est.revision_count + 1,
    updated_at = now()
  WHERE id = p_estimate_id
  RETURNING * INTO v_updated;

  -- 2. Restore items in estimate_items
  DELETE FROM public.estimate_items WHERE estimate_id = p_estimate_id;

  IF v_snap_items IS NOT NULL AND jsonb_array_length(v_snap_items) > 0 THEN
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
    FROM jsonb_array_elements(v_snap_items) AS item;
  END IF;

  -- 3. Record the restored state as a NEW revision
  v_new_snapshot := public.build_estimate_snapshot(v_updated, v_snap_items, 1);

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
    COALESCE(p_revision_note, 'Restored from Revision ' || p_restore_revision_number),
    p_restore_revision_number,
    v_user_id,
    v_user_name,
    now(),
    1,
    v_updated.subtotal,
    v_updated.tax_amount,
    v_updated.total_amount,
    COALESCE(jsonb_array_length(v_snap_items), 0),
    CASE WHEN jsonb_typeof(v_updated.store_grouping) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v_updated.store_grouping)) ELSE 1 END,
    v_new_snapshot
  );

  RETURN to_jsonb(v_updated);
END;
$function$;

-- 8. Update replace_estimate_items to route through save_estimate_revision_atomic
-- This ensures any direct callers of replace_estimate_items automatically maintain revisions
CREATE OR REPLACE FUNCTION public.replace_estimate_items(p_estimate_id integer, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
  v_inserted integer := 0;
BEGIN
  -- Call revision-safe atomic save with no header changes
  v_res := public.save_estimate_revision_atomic(
    p_estimate_id => p_estimate_id,
    p_estimate => '{}'::jsonb,
    p_items => p_items,
    p_revision_note => 'Updated line items',
    p_expected_revision_number => NULL,
    p_user_id => public.get_current_user_id()
  );

  SELECT count(*)::integer INTO v_inserted
  FROM public.estimate_items
  WHERE estimate_id = p_estimate_id;

  RETURN v_inserted;
END;
$function$;

-- 9. Revoke permissions from public/anon and grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.build_estimate_snapshot(public.estimates, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_estimate_snapshot(public.estimates, jsonb, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_estimate_revision_atomic(integer, jsonb, jsonb, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_revision_atomic(integer, jsonb, jsonb, text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.restore_estimate_revision_atomic(integer, integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_estimate_revision_atomic(integer, integer, text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.replace_estimate_items(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_estimate_items(integer, jsonb) TO authenticated, service_role;

-- 10. BACKFILL BASELINE REVISION 0 FOR ALL EXISTING ESTIMATES
DO $$
DECLARE
  r public.estimates%ROWTYPE;
  v_items jsonb;
  v_snap jsonb;
  v_author_name text;
  v_backfilled integer := 0;
BEGIN
  FOR r IN SELECT * FROM public.estimates ORDER BY id LOOP
    -- Only create Revision 0 if no revision exists yet
    IF NOT EXISTS (SELECT 1 FROM public.estimate_revisions WHERE estimate_id = r.id AND revision_number = 0) THEN
      -- Fetch current items as jsonb array
      SELECT COALESCE(jsonb_agg(to_jsonb(ei) ORDER BY ei.sl, ei.id), '[]'::jsonb)
      INTO v_items
      FROM public.estimate_items ei
      WHERE ei.estimate_id = r.id;

      SELECT COALESCE(name, username) INTO v_author_name
      FROM public.users WHERE id = r.created_by;

      v_snap := public.build_estimate_snapshot(r, v_items, 1);

      INSERT INTO public.estimate_revisions (
        company_id, estimate_id, revision_number, revision_note,
        source_revision_number, created_by, created_by_name, created_at,
        snapshot_schema_version, subtotal, tax_amount, total_amount,
        items_count, store_count, snapshot
      )
      VALUES (
        r.company_id,
        r.id,
        0,
        'Baseline revision (system backfill)',
        NULL,
        r.created_by,
        v_author_name,
        COALESCE(r.estimate_date, r.created_at, now()),
        1,
        r.subtotal,
        r.tax_amount,
        r.total_amount,
        COALESCE(jsonb_array_length(v_items), 0),
        CASE WHEN jsonb_typeof(r.store_grouping) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(r.store_grouping)) ELSE 1 END,
        v_snap
      );

      UPDATE public.estimates
      SET current_revision_number = 0, revision_count = 1
      WHERE id = r.id;

      v_backfilled := v_backfilled + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfilled % existing estimates with Revision 0 baseline snapshots.', v_backfilled;
END $$;
