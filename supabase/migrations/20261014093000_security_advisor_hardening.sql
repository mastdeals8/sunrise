-- ==============================================================================
-- SUNRISE MEDIA ERP — SECURITY ADVISOR AUDIT HARDENING MIGRATION
-- Migration: 20261014093000_security_advisor_hardening.sql
-- Date: 14 October 2026
--
-- Fixes:
-- 1. Enable RLS and add authorized policies on public.estimate_format_profiles.
-- 2. Replace unrestricted USING(true)/WITH CHECK(true) write policies on
--    public.app_settings, public.invoice_packet_pages, and public.project_files
--    with strict role- and company-scoped authorization.
-- 3. Revoke public/anon EXECUTE from all privileged SECURITY DEFINER RPCs.
--    Add strict in-function company authorization checks.
-- 4. Restrict storage.objects public listing on company-assets bucket.
-- 5. Add scoped policies for public.project_store_status and public.telegram_deliveries.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RLS ON public.estimate_format_profiles
-- ------------------------------------------------------------------------------
ALTER TABLE public.estimate_format_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_estimate_format_profiles ON public.estimate_format_profiles;
DROP POLICY IF EXISTS rls_insert_estimate_format_profiles ON public.estimate_format_profiles;
DROP POLICY IF EXISTS rls_update_estimate_format_profiles ON public.estimate_format_profiles;
DROP POLICY IF EXISTS rls_delete_estimate_format_profiles ON public.estimate_format_profiles;

-- Global format profiles: all authenticated ERP users can read formats
CREATE POLICY rls_select_estimate_format_profiles ON public.estimate_format_profiles
  FOR SELECT TO authenticated
  USING (true);

-- Modifications restricted to Super Admin
CREATE POLICY rls_insert_estimate_format_profiles ON public.estimate_format_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_update_estimate_format_profiles ON public.estimate_format_profiles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_delete_estimate_format_profiles ON public.estimate_format_profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- ------------------------------------------------------------------------------
-- 2. UNRESTRICTED WRITE POLICIES REPLACEMENT
-- ------------------------------------------------------------------------------

-- (a) public.app_settings: Restrict mutations to super_admin; authenticated can read.
DROP POLICY IF EXISTS rls_select_app_settings ON public.app_settings;
DROP POLICY IF EXISTS rls_insert_app_settings ON public.app_settings;
DROP POLICY IF EXISTS rls_update_app_settings ON public.app_settings;
DROP POLICY IF EXISTS rls_delete_app_settings ON public.app_settings;

CREATE POLICY rls_select_app_settings ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY rls_insert_app_settings ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_update_app_settings ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_delete_app_settings ON public.app_settings
  FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- (b) public.invoice_packet_pages: Scope through parent invoice_packets.company_id
DROP POLICY IF EXISTS authenticated_select_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS authenticated_insert_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS authenticated_update_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS authenticated_delete_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS rls_select_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS rls_insert_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS rls_update_invoice_packet_pages ON public.invoice_packet_pages;
DROP POLICY IF EXISTS rls_delete_invoice_packet_pages ON public.invoice_packet_pages;

CREATE POLICY rls_select_invoice_packet_pages ON public.invoice_packet_pages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice_packets p
    WHERE p.id = invoice_packet_pages.packet_id
      AND public.user_has_company_access(p.company_id)
  ));

CREATE POLICY rls_insert_invoice_packet_pages ON public.invoice_packet_pages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoice_packets p
    WHERE p.id = invoice_packet_pages.packet_id
      AND public.user_has_company_access(p.company_id)
  ));

CREATE POLICY rls_update_invoice_packet_pages ON public.invoice_packet_pages
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice_packets p
    WHERE p.id = invoice_packet_pages.packet_id
      AND public.user_has_company_access(p.company_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoice_packets p
    WHERE p.id = invoice_packet_pages.packet_id
      AND public.user_has_company_access(p.company_id)
  ));

CREATE POLICY rls_delete_invoice_packet_pages ON public.invoice_packet_pages
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoice_packets p
    WHERE p.id = invoice_packet_pages.packet_id
      AND public.user_has_company_access(p.company_id)
  ));


-- (c) public.project_files: Scope through parent projects.company_id
DROP POLICY IF EXISTS authenticated_select_project_files ON public.project_files;
DROP POLICY IF EXISTS authenticated_insert_project_files ON public.project_files;
DROP POLICY IF EXISTS authenticated_update_project_files ON public.project_files;
DROP POLICY IF EXISTS authenticated_delete_project_files ON public.project_files;
DROP POLICY IF EXISTS rls_select_project_files ON public.project_files;
DROP POLICY IF EXISTS rls_insert_project_files ON public.project_files;
DROP POLICY IF EXISTS rls_update_project_files ON public.project_files;
DROP POLICY IF EXISTS rls_delete_project_files ON public.project_files;

CREATE POLICY rls_select_project_files ON public.project_files
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = project_files.project_id
      AND public.user_has_company_access(pr.company_id)
  ));

CREATE POLICY rls_insert_project_files ON public.project_files
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = project_files.project_id
      AND public.user_has_company_access(pr.company_id)
  ));

CREATE POLICY rls_update_project_files ON public.project_files
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = project_files.project_id
      AND public.user_has_company_access(pr.company_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = project_files.project_id
      AND public.user_has_company_access(pr.company_id)
  ));

CREATE POLICY rls_delete_project_files ON public.project_files
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = project_files.project_id
      AND public.user_has_company_access(pr.company_id)
  ));


-- ------------------------------------------------------------------------------
-- 3. SCOPED POLICIES FOR TABLES WITH RLS ENABLED BUT NO POLICIES
-- ------------------------------------------------------------------------------

-- (a) public.project_store_status (child of estimates)
ALTER TABLE public.project_store_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_project_store_status ON public.project_store_status;
DROP POLICY IF EXISTS rls_insert_project_store_status ON public.project_store_status;
DROP POLICY IF EXISTS rls_update_project_store_status ON public.project_store_status;
DROP POLICY IF EXISTS rls_delete_project_store_status ON public.project_store_status;

CREATE POLICY rls_select_project_store_status ON public.project_store_status
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = project_store_status.estimate_id
      AND public.user_has_company_access(e.company_id)
  ));

CREATE POLICY rls_insert_project_store_status ON public.project_store_status
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = project_store_status.estimate_id
      AND public.user_has_company_access(e.company_id)
  ));

CREATE POLICY rls_update_project_store_status ON public.project_store_status
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = project_store_status.estimate_id
      AND public.user_has_company_access(e.company_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = project_store_status.estimate_id
      AND public.user_has_company_access(e.company_id)
  ));

CREATE POLICY rls_delete_project_store_status ON public.project_store_status
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.estimates e
    WHERE e.id = project_store_status.estimate_id
      AND public.user_has_company_access(e.company_id)
  ));


-- (b) public.telegram_deliveries
ALTER TABLE public.telegram_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_select_telegram_deliveries ON public.telegram_deliveries;
DROP POLICY IF EXISTS rls_insert_telegram_deliveries ON public.telegram_deliveries;
DROP POLICY IF EXISTS rls_update_telegram_deliveries ON public.telegram_deliveries;
DROP POLICY IF EXISTS rls_delete_telegram_deliveries ON public.telegram_deliveries;

CREATE POLICY rls_select_telegram_deliveries ON public.telegram_deliveries
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      estimate_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = telegram_deliveries.estimate_id
          AND public.user_has_company_access(e.company_id)
      )
    )
    OR recipient_user_id = public.get_current_user_id()
    OR created_by = public.get_current_user_id()
  );

CREATE POLICY rls_insert_telegram_deliveries ON public.telegram_deliveries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      estimate_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.estimates e
        WHERE e.id = telegram_deliveries.estimate_id
          AND public.user_has_company_access(e.company_id)
      )
    )
    OR created_by = public.get_current_user_id()
  );

CREATE POLICY rls_update_telegram_deliveries ON public.telegram_deliveries
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_delete_telegram_deliveries ON public.telegram_deliveries
  FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- ------------------------------------------------------------------------------
-- 4. STORAGE: RESTRICT PUBLIC LISTING ON company-assets BUCKET
-- ------------------------------------------------------------------------------
-- Drop public listing policy that exposed storage.objects to anon
DROP POLICY IF EXISTS "Public read company-assets" ON storage.objects;
DROP POLICY IF EXISTS "Auth read company-assets" ON storage.objects;

-- Listing files via storage.objects requires authentication.
-- Direct asset retrieval via public URLs (/storage/v1/object/public/company-assets/...)
-- is served directly by Supabase Storage CDN and remains fully operational.
CREATE POLICY "Auth read company-assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'company-assets');


-- ------------------------------------------------------------------------------
-- 5. RPC PRIVILEGES & IN-FUNCTION AUTHORIZATION HARDENING
-- ------------------------------------------------------------------------------

-- Prevent automatic public EXECUTE on newly created functions in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Update create_estimate_atomic with strict company access check
CREATE OR REPLACE FUNCTION public.create_estimate_atomic(p_estimate jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_estimate_id integer;
  v_estimate_number text;
  v_client_id integer;
  v_brand_id integer;
  v_store_id integer;
  v_estimate_date timestamp;
  v_result jsonb;
BEGIN
  v_company_id := COALESCE((p_estimate->>'company_id')::integer, (p_estimate->>'companyId')::integer, 1);
  v_client_id := COALESCE((p_estimate->>'client_id')::integer, (p_estimate->>'clientId')::integer);
  v_brand_id := COALESCE((p_estimate->>'brand_id')::integer, (p_estimate->>'brandId')::integer);
  v_store_id := COALESCE((p_estimate->>'store_id')::integer, (p_estimate->>'storeId')::integer, 1);
  v_estimate_date := COALESCE((p_estimate->>'estimate_date')::timestamp, (p_estimate->>'estimateDate')::timestamp, NOW());

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  v_estimate_number := NULLIF(TRIM(COALESCE(p_estimate->>'estimate_number', p_estimate->>'estimateNumber', '')), '');
  IF v_estimate_number IS NULL OR v_estimate_number = '' THEN
    v_estimate_number := public.next_sunrise_document_number('estimate', v_estimate_date::date, v_company_id);
  END IF;

  -- 1. Insert estimate with company_id
  INSERT INTO public.estimates (
    company_id, estimate_number, client_id, brand_id, store_id, title, description,
    subtotal, tax_amount, total_amount, status, client_format, subject,
    billing_to, shipping_to, gstin, pan, state_code, vendor_code, gst_type,
    packing_percent, implementation_percent, transport_amount,
    store_grouping, po_number, po_date, po_amount, po_file_path, po_remarks,
    billing_profile_id, billing_legal_name_snapshot, billing_gstin_snapshot,
    billing_state_snapshot, billing_state_code_snapshot,
    billing_address_snapshot, shipping_address_snapshot, created_by,
    abfrl_project_type, estimate_date, format_profile_code
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
    (COALESCE(p_estimate->>'packing_percent', p_estimate->>'packingPercent'))::real,
    (COALESCE(p_estimate->>'implementation_percent', p_estimate->>'implementationPercent'))::real,
    (COALESCE(p_estimate->>'transport_amount', p_estimate->>'transportAmount'))::real,
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
    COALESCE((p_estimate->>'created_by')::integer, (p_estimate->>'createdBy')::integer),
    COALESCE(p_estimate->>'abfrl_project_type', p_estimate->>'abfrlProjectType'),
    v_estimate_date,
    COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode', 'normal')
  )
  RETURNING id INTO v_estimate_id;

  -- 2. Insert into estimate_items with company_id
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
      COALESCE((item->>'sl')::integer, (item->>'sort_order')::integer, idx::integer),
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
      item->'material_code_snapshot',
      item->'product_snapshot'
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS arr(item, idx);
  END IF;

  SELECT to_jsonb(e.*) INTO v_result
  FROM public.estimates e
  WHERE e.id = v_estimate_id;

  RETURN v_result;
END;
$function$;

-- Update create_invoice_atomic with strict company access check
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(p_invoice jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_estimate_id integer;
  v_store_id integer;
  v_store_code text;
  v_store_name text;
  v_client_id integer;
  v_party_name text;
  v_invoice_number text;
  v_invoice_date timestamp;
  v_existing jsonb;
  v_result jsonb;
BEGIN
  -- Extract core fields
  v_company_id := COALESCE((p_invoice->>'company_id')::integer, (p_invoice->>'companyId')::integer);
  v_estimate_id := (COALESCE(p_invoice->>'estimate_id', p_invoice->>'estimateId'))::integer;
  v_store_id := (COALESCE(p_invoice->>'store_id', p_invoice->>'storeId'))::integer;
  v_store_code := NULLIF(TRIM(COALESCE(p_invoice->>'store_code', p_invoice->>'storeCode', '')), '');
  v_store_name := NULLIF(TRIM(COALESCE(p_invoice->>'store_name', p_invoice->>'storeName', '')), '');
  v_client_id := (COALESCE(p_invoice->>'client_id', p_invoice->>'clientId'))::integer;
  v_invoice_date := COALESCE((p_invoice->>'date')::timestamp, now());

  -- If company_id not explicitly provided, derive from parent estimate
  IF v_company_id IS NULL AND v_estimate_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id FROM public.estimates WHERE id = v_estimate_id;
  END IF;
  v_company_id := COALESCE(v_company_id, 1);

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Resolve client_id from estimate if missing
  IF v_client_id IS NULL AND v_estimate_id IS NOT NULL THEN
    SELECT client_id INTO v_client_id FROM public.estimates WHERE id = v_estimate_id;
  END IF;

  -- Resolve party_name: if not provided or provided as 'Customer', resolve from estimate snapshot or client master
  v_party_name := NULLIF(TRIM(COALESCE(p_invoice->>'party_name', p_invoice->>'partyName', '')), '');
  IF v_party_name IS NULL OR v_party_name = 'Customer' THEN
    IF v_estimate_id IS NOT NULL THEN
      SELECT COALESCE(NULLIF(TRIM(billing_legal_name_snapshot), ''), NULLIF(TRIM(client_name), ''))
      INTO v_party_name
      FROM public.estimates WHERE id = v_estimate_id;
    END IF;
    IF (v_party_name IS NULL OR v_party_name = 'Customer') AND v_client_id IS NOT NULL THEN
      SELECT name INTO v_party_name FROM public.clients WHERE id = v_client_id;
    END IF;
    v_party_name := COALESCE(v_party_name, 'Customer');
  END IF;

  -- 1. Duplicate check: if an active invoice already exists for this estimate + store within this company, return it idempotently
  IF v_estimate_id IS NOT NULL THEN
    IF v_store_id IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM public.invoices i
      WHERE i.company_id = v_company_id
        AND i.estimate_id = v_estimate_id
        AND i.store_id = v_store_id
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSIF v_store_code IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM public.invoices i
      WHERE i.company_id = v_company_id
        AND i.estimate_id = v_estimate_id
        AND i.store_code = v_store_code
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSE
      SELECT to_jsonb(i.*) INTO v_existing
      FROM public.invoices i
      WHERE i.company_id = v_company_id
        AND i.estimate_id = v_estimate_id
        AND i.store_id IS NULL
        AND (i.store_code IS NULL OR i.store_code = '')
        AND i.status != 'cancelled'
      LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 2. Resolve invoice number
  v_invoice_number := NULLIF(TRIM(COALESCE(
    p_invoice->>'invoice_number',
    p_invoice->>'invoiceNumber',
    ''
  )), '');

  IF v_invoice_number IS NULL OR v_invoice_number LIKE 'INV-%' OR v_invoice_number = '' THEN
    v_invoice_number := public.next_sunrise_document_number('invoice', v_invoice_date::date, v_company_id);
  END IF;

  -- 3. Duplicate protection: Ensure this complete invoice number is not already used in this company
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE company_id = v_company_id
      AND LOWER(TRIM(invoice_number)) = LOWER(TRIM(v_invoice_number))
  ) THEN
    RAISE EXCEPTION 'Invoice number "%" is already in use for this company. Please enter a unique invoice number.', v_invoice_number;
  END IF;

  -- 4. Insert invoice with company_id
  INSERT INTO public.invoices (
    company_id, invoice_number, type, party_name, amount, tax_amount, total_amount,
    date, due_date, status, estimate_id, client_id,
    paid_amount, balance_amount, packet_settings, remarks,
    delivery_challan_id, line_items, po_number, po_reference,
    transport_cost, store_id, store_code, store_name
  )
  VALUES (
    v_company_id,
    v_invoice_number,
    COALESCE(p_invoice->>'type', 'sales'),
    v_party_name,
    COALESCE((COALESCE(p_invoice->>'amount', p_invoice->>'subtotal', p_invoice->>'subTotal'))::real, 0),
    COALESCE((COALESCE(p_invoice->>'tax_amount', p_invoice->>'taxAmount'))::real, 0),
    COALESCE((COALESCE(p_invoice->>'total_amount', p_invoice->>'totalAmount'))::real, 0),
    v_invoice_date,
    COALESCE((p_invoice->>'due_date')::timestamp, (p_invoice->>'dueDate')::timestamp, v_invoice_date + interval '30 days'),
    COALESCE(p_invoice->>'status', 'submitted'),
    v_estimate_id,
    v_client_id,
    COALESCE((COALESCE(p_invoice->>'paid_amount', p_invoice->>'paidAmount'))::real, 0),
    COALESCE((COALESCE(p_invoice->>'balance_amount', p_invoice->>'balanceAmount', p_invoice->>'total_amount', p_invoice->>'totalAmount'))::real, 0),
    COALESCE(p_invoice->'packet_settings', p_invoice->'packetSettings'),
    COALESCE(p_invoice->>'remarks', p_invoice->>'notes'),
    (COALESCE(p_invoice->>'delivery_challan_id', p_invoice->>'deliveryChallanId'))::integer,
    COALESCE(p_invoice->'line_items', p_invoice->'lineItems', '[]'::jsonb),
    COALESCE(p_invoice->>'po_number', p_invoice->>'poNumber'),
    COALESCE(p_invoice->>'po_reference', p_invoice->>'poReference'),
    COALESCE((COALESCE(p_invoice->>'transport_cost', p_invoice->>'transportCost'))::numeric, 0),
    v_store_id,
    v_store_code,
    v_store_name
  )
  RETURNING to_jsonb(invoices.*) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Update replace_estimate_items with strict company access check
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
  v_company_id := COALESCE(v_company_id, 1);

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Insert new items with company_id
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
    COALESCE(item->>'item_name', item->>'itemName'),
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
    item->'material_code_snapshot',
    item->'product_snapshot'
  FROM jsonb_array_elements(p_items) AS item;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

-- Update next_sunrise_document_number (3-arg overload) with company access verification
CREATE OR REPLACE FUNCTION public.next_sunrise_document_number(p_kind text, p_date date DEFAULT CURRENT_DATE, p_company_id integer DEFAULT 1)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer := COALESCE(p_company_id, 1);
  v_company public.companies%ROWTYPE;
  v_year integer;
  v_fy text;
  v_prefix text;
  v_start_at integer;
  v_max integer;
  v_highest_existing integer := 0;
  v_configured_start integer := 0;
  v_pattern text;
  v_fy_aware boolean := true;
  v_num_cfg jsonb;
  v_seq_str text;
BEGIN
  -- Verify caller has company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Load company configuration
  SELECT * INTO v_company FROM public.companies WHERE id = v_company_id;
  IF NOT FOUND THEN
    SELECT * INTO v_company FROM public.companies WHERE id = 1;
    v_company_id := 1;
  END IF;

  -- Calculate financial year label: e.g. "26-27"
  IF EXTRACT(MONTH FROM p_date) < 4 THEN
    v_year := EXTRACT(YEAR FROM p_date)::integer - 1;
  ELSE
    v_year := EXTRACT(YEAR FROM p_date)::integer;
  END IF;
  v_fy := LPAD((v_year % 100)::text, 2, '0') || '-' || LPAD(((v_year + 1) % 100)::text, 2, '0');

  IF p_kind = 'invoice' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.invoice_prefix), ''), 'SM');
    v_num_cfg := COALESCE(v_company.numbering_config->'invoice', '{}'::jsonb);

    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'tallyCurrentNumber', '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      CASE WHEN v_company_id = 1 AND v_fy = '26-27' THEN 170 ELSE 0 END
    );

    SELECT COALESCE(
      max(
        CASE 
          WHEN invoice_number ~* ('^' || v_fy || '/' || v_prefix || '/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_fy || '/' || v_prefix || '/([0-9]+)$', 'i'))[1]::integer
          WHEN invoice_number ~* ('^' || v_prefix || '/INV/' || v_fy || '/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_prefix || '/INV/' || v_fy || '/([0-9]+)$', 'i'))[1]::integer
          WHEN invoice_number ~* ('^' || v_fy || '/[A-Za-z0-9_-]+/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_fy || '/[A-Za-z0-9_-]+/([0-9]+)$', 'i'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) INTO v_highest_existing
    FROM public.invoices
    WHERE company_id = v_company_id
      AND status != 'cancelled';

    IF v_highest_existing > 0 THEN
      v_max := GREATEST(v_highest_existing, v_configured_start);
      v_seq_str := LPAD((v_max + 1)::text, 3, '0');
    ELSIF v_configured_start > 0 AND v_company_id = 1 THEN
      v_seq_str := LPAD((v_configured_start + 1)::text, 3, '0');
    ELSIF v_configured_start > 1 THEN
      v_seq_str := LPAD(v_configured_start::text, 3, '0');
    ELSE
      v_seq_str := '001';
    END IF;

    RETURN v_fy || '/' || v_prefix || '/' || v_seq_str;

  ELSIF p_kind = 'estimate' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.estimate_prefix), ''), 'SM/E');
    v_num_cfg := COALESCE(v_company.numbering_config->'estimate', '{}'::jsonb);
    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      CASE WHEN v_company_id = 1 AND v_fy = '26-27' THEN 201 ELSE 1 END
    );

    v_pattern := '^' || regexp_replace(v_prefix, '([\\.\[\]{}()*+?^$|])', '\\\1', 'g') || '/' || v_fy || '/([0-9]+)$';

    SELECT COALESCE(max((regexp_match(estimate_number, v_pattern))[1]::integer), 0)
    INTO v_highest_existing
    FROM public.estimates
    WHERE company_id = v_company_id
      AND estimate_number ~ v_pattern;

    IF v_highest_existing > 0 THEN
      v_max := GREATEST(v_highest_existing, v_configured_start - 1);
      v_seq_str := LPAD((v_max + 1)::text, 3, '0');
    ELSIF v_configured_start > 1 THEN
      v_seq_str := LPAD(v_configured_start::text, 3, '0');
    ELSE
      v_seq_str := '001';
    END IF;

    RETURN v_prefix || '/' || v_fy || '/' || v_seq_str;

  ELSE -- 'dc'
    v_prefix := COALESCE(NULLIF(TRIM(v_company.dc_prefix), ''), 'SM/DC');
    v_num_cfg := COALESCE(v_company.numbering_config->'dc', '{}'::jsonb);
    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      CASE WHEN v_company_id = 1 AND v_fy = '26-27' THEN 101 ELSE 1 END
    );

    v_pattern := '^' || regexp_replace(v_prefix, '([\\.\[\]{}()*+?^$|])', '\\\1', 'g') || '/' || v_fy || '/([0-9]+)$';

    SELECT COALESCE(max((regexp_match(dc_number, v_pattern))[1]::integer), 0)
    INTO v_highest_existing
    FROM public.delivery_challans
    WHERE company_id = v_company_id
      AND dc_number ~ v_pattern;

    IF v_highest_existing > 0 THEN
      v_max := GREATEST(v_highest_existing, v_configured_start - 1);
      v_seq_str := LPAD((v_max + 1)::text, 3, '0');
    ELSIF v_configured_start > 1 THEN
      v_seq_str := LPAD(v_configured_start::text, 3, '0');
    ELSE
      v_seq_str := '001';
    END IF;

    RETURN v_prefix || '/' || v_fy || '/' || v_seq_str;
  END IF;
END;
$function$;

-- Update set_tally_invoice_sequence (both overloads) with administrative authorization
CREATE OR REPLACE FUNCTION public.set_tally_invoice_sequence(p_fy text, p_current_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg jsonb;
  v_val jsonb;
BEGIN
  -- Restrict legacy global setting modification to Super Admin
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: Super Admin permissions required' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg FROM public.app_settings WHERE key = 'numbering.invoice';
  IF v_cfg IS NULL THEN
    v_cfg := '{"format": "FY/SM/NUM", "prefix": "SM", "fyAware": true}'::jsonb;
  END IF;

  v_val := jsonb_set(
    v_cfg,
    '{fySequences}',
    COALESCE(v_cfg->'fySequences', '{}'::jsonb) || jsonb_build_object(p_fy, p_current_number)
  );
  v_val := jsonb_set(v_val, '{tallyCurrentNumber}', to_jsonb(p_current_number));
  v_val := jsonb_set(v_val, '{startAt}', to_jsonb(p_current_number));

  INSERT INTO public.app_settings (key, value, updated_at)
  VALUES ('numbering.invoice', v_val, NOW())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();

  RETURN v_val;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tally_invoice_sequence(p_fy text, p_current_number integer, p_company_id integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer := COALESCE(p_company_id, 1);
  v_cfg jsonb;
  v_val jsonb;
BEGIN
  -- Caller must be super_admin or company_admin for this company
  IF NOT (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = v_company_id
        AND role IN ('super_admin', 'company_admin')
    )
  ) THEN
    RAISE EXCEPTION 'Access denied: Company administrator permissions required for company %', v_company_id
      USING ERRCODE = '42501';
  END IF;

  SELECT numbering_config->'invoice' INTO v_cfg FROM public.companies WHERE id = v_company_id;
  IF v_cfg IS NULL THEN
    v_cfg := '{"format": "FY/SM/NUM", "prefix": "SM", "fyAware": true}'::jsonb;
  END IF;

  v_val := jsonb_set(
    v_cfg,
    '{fySequences}',
    COALESCE(v_cfg->'fySequences', '{}'::jsonb) || jsonb_build_object(p_fy, p_current_number)
  );
  v_val := jsonb_set(v_val, '{tallyCurrentNumber}', to_jsonb(p_current_number));
  v_val := jsonb_set(v_val, '{startAt}', to_jsonb(p_current_number));

  UPDATE public.companies
  SET numbering_config = jsonb_set(COALESCE(numbering_config, '{}'::jsonb), '{invoice}', v_val),
      updated_at = NOW()
  WHERE id = v_company_id;

  IF v_company_id = 1 THEN
    INSERT INTO public.app_settings (key, value, updated_at)
    VALUES ('numbering.invoice', v_val, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
  END IF;

  RETURN v_val;
END;
$function$;


-- ------------------------------------------------------------------------------
-- 6. PRECISE FUNCTION PRIVILEGE GRANTS & REVOCATIONS
-- ------------------------------------------------------------------------------

-- (a) Functions requiring unauthenticated access (Login resolution only)
REVOKE ALL ON FUNCTION public.verify_and_resolve_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_and_resolve_login(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_resolve_login(text, text) TO anon, authenticated;

-- (b) Deprecated resolve_login_email: REVOKE ALL from anon and authenticated (service_role only)
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO service_role;

-- (c) All other business RPCs: REVOKE from PUBLIC and anon, GRANT to authenticated
DO $$
DECLARE
  f record;
  target_fns text[] := ARRAY[
    'admin_create_user(jsonb)',
    'assign_company_user(integer, integer, text, boolean)',
    'batch_update_rate_card_items(integer, jsonb)',
    'create_estimate_atomic(jsonb, jsonb)',
    'create_invoice_atomic(jsonb)',
    'get_current_user_id()',
    'get_current_user_profile()',
    'import_products_to_rate_card(integer)',
    'is_super_admin()',
    'next_sunrise_document_number(text, date)',
    'next_sunrise_document_number(text, date, integer)',
    'remove_company_user(integer, integer)',
    'replace_estimate_items(integer, jsonb)',
    'resolve_customer_rate(integer, integer, integer, text)',
    'set_tally_invoice_sequence(text, integer)',
    'set_tally_invoice_sequence(text, integer, integer)',
    'user_has_company_access(integer)'
  ];
  sig text;
BEGIN
  FOREACH sig IN ARRAY target_fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', sig);
  END LOOP;
END $$;

-- Reload schema cache in PostgREST
NOTIFY pgrst, 'reload schema';
