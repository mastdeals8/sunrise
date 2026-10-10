-- ==============================================================================
-- SUNRISE MEDIA ERP — MULTI-COMPANY, MULTI-USER ARCHITECTURE MIGRATION
-- Migration: 20261010180000_multi_company_architecture.sql
-- ==============================================================================

-- 1. Helper function: get_current_user_id()
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_user_id integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_user_id FROM public.users WHERE auth_user_id = v_uid LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN v_user_id;
    END IF;
  END IF;

  -- Fallback by email from jwt
  v_email := NULLIF(TRIM(auth.jwt() ->> 'email'), '');
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_user_id FROM public.users WHERE LOWER(TRIM(email)) = LOWER(TRIM(v_email)) LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN v_user_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- 2. Helper function: is_super_admin()
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid integer;
BEGIN
  -- If called by postgres superuser / service role without jwt, permit
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN true;
  END IF;

  v_uid := public.get_current_user_id();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Kunal (user 1) is always super_admin
  IF v_uid = 1 THEN
    RETURN true;
  END IF;

  -- Check company_users or users table
  IF EXISTS (
    SELECT 1 FROM public.company_users WHERE user_id = v_uid AND role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.users WHERE id = v_uid AND role = 'admin'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- 3. Helper function: user_has_company_access(check_company_id)
CREATE OR REPLACE FUNCTION public.user_has_company_access(check_company_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid integer;
BEGIN
  IF check_company_id IS NULL THEN
    RETURN true;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  v_uid := public.get_current_user_id();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.company_users
    WHERE user_id = v_uid AND company_id = check_company_id
  );
END;
$$;

-- 4. Document Numbering: next_sunrise_document_number (Company-Aware)
CREATE OR REPLACE FUNCTION public.next_sunrise_document_number(
  p_kind text,
  p_date date DEFAULT CURRENT_DATE,
  p_company_id integer DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
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
    
    -- Check configured start for this FY
    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'tallyCurrentNumber', '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      CASE WHEN v_company_id = 1 AND v_fy = '26-27' THEN 170 ELSE 1 END
    );

    -- Find the highest existing invoice sequence for this company and financial year
    SELECT COALESCE(
      max(
        CASE 
          -- Match standard format: YY-YY/<PREFIX>/<NUM>
          WHEN invoice_number ~* ('^' || v_fy || '/' || v_prefix || '/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_fy || '/' || v_prefix || '/([0-9]+)$', 'i'))[1]::integer
          -- Match legacy format: <PREFIX>/INV/YY-YY/<NUM>
          WHEN invoice_number ~* ('^' || v_prefix || '/INV/' || v_fy || '/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_prefix || '/INV/' || v_fy || '/([0-9]+)$', 'i'))[1]::integer
          -- Generic format: YY-YY/[A-Za-z0-9_-]+/([0-9]+)$
          WHEN invoice_number ~* ('^' || v_fy || '/[A-Za-z0-9_-]+/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_fy || '/[A-Za-z0-9_-]+/([0-9]+)$', 'i'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) INTO v_highest_existing
    FROM invoices
    WHERE company_id = v_company_id
      AND status != 'cancelled';

    v_max := GREATEST(v_highest_existing, v_configured_start);
    RETURN v_fy || '/' || v_prefix || '/' || (v_max + 1)::text;

  ELSIF p_kind = 'estimate' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.estimate_prefix), ''), 'SM/E');
    v_num_cfg := COALESCE(v_company.numbering_config->'estimate', '{}'::jsonb);
    v_start_at := COALESCE(NULLIF(v_num_cfg->>'startAt', '')::integer, 101);
    IF v_company_id = 1 AND v_fy = '26-27' THEN 
      v_start_at := 201; 
    END IF;
    v_fy_aware := COALESCE((v_num_cfg->>'fyAware')::boolean, true);
    v_pattern := '^' || regexp_replace(v_prefix, '([\.\[\]{}()*+?^$|])', '\\\1', 'g') || CASE WHEN v_fy_aware THEN '/' || v_fy || '/([0-9]+)$' ELSE '/([0-9]+)$' END;

    SELECT COALESCE(max((regexp_match(estimate_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max 
    FROM estimates 
    WHERE company_id = v_company_id
      AND estimate_number ~ v_pattern;

    RETURN CASE WHEN v_fy_aware THEN v_prefix || '/' || v_fy || '/' || (v_max + 1)::text ELSE v_prefix || '/' || (v_max + 1)::text END;

  ELSE -- 'dc'
    v_prefix := COALESCE(NULLIF(TRIM(v_company.dc_prefix), ''), 'SM/DC');
    v_num_cfg := COALESCE(v_company.numbering_config->'dc', '{}'::jsonb);
    v_start_at := COALESCE(NULLIF(v_num_cfg->>'startAt', '')::integer, 101);
    v_fy_aware := COALESCE((v_num_cfg->>'fyAware')::boolean, true);
    v_pattern := '^' || regexp_replace(v_prefix, '([\.\[\]{}()*+?^$|])', '\\\1', 'g') || CASE WHEN v_fy_aware THEN '/' || v_fy || '/([0-9]+)$' ELSE '/([0-9]+)$' END;

    SELECT COALESCE(max((regexp_match(dc_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max 
    FROM delivery_challans 
    WHERE company_id = v_company_id
      AND dc_number ~ v_pattern;

    RETURN CASE WHEN v_fy_aware THEN v_prefix || '/' || v_fy || '/' || (v_max + 1)::text ELSE v_prefix || '/' || (v_max + 1)::text END;
  END IF;
END;
$$;

-- 5. Updated Atomic Invoice Creator (Company-Aware)
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(p_invoice jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id integer;
  v_invoice_id integer;
  v_invoice_number text;
  v_party_name text;
  v_estimate_id integer;
  v_client_id integer;
  v_store_id integer;
  v_store_code text;
  v_store_name text;
  v_invoice_date timestamp;
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_estimate_id := COALESCE((p_invoice->>'estimate_id')::integer, (p_invoice->>'estimateId')::integer);
  v_client_id := COALESCE((p_invoice->>'client_id')::integer, (p_invoice->>'clientId')::integer);
  v_store_id := COALESCE((p_invoice->>'store_id')::integer, (p_invoice->>'storeId')::integer);
  v_store_code := NULLIF(TRIM(COALESCE(p_invoice->>'store_code', p_invoice->>'storeCode', '')), '');
  v_store_name := NULLIF(TRIM(COALESCE(p_invoice->>'store_name', p_invoice->>'storeName', '')), '');
  v_invoice_date := COALESCE((p_invoice->>'date')::timestamp, NOW());

  -- Resolve company_id from invoice payload, or estimate, or default 1
  v_company_id := COALESCE((p_invoice->>'company_id')::integer, (p_invoice->>'companyId')::integer);
  IF v_company_id IS NULL AND v_estimate_id IS NOT NULL THEN
    SELECT company_id INTO v_company_id FROM estimates WHERE id = v_estimate_id;
  END IF;
  v_company_id := COALESCE(v_company_id, 1);

  -- Resolve client_id from estimate if missing
  IF v_client_id IS NULL AND v_estimate_id IS NOT NULL THEN
    SELECT client_id INTO v_client_id FROM estimates WHERE id = v_estimate_id;
  END IF;

  -- Resolve party_name: if not provided or provided as 'Customer', resolve from estimate snapshot or client master
  v_party_name := NULLIF(TRIM(COALESCE(p_invoice->>'party_name', p_invoice->>'partyName', '')), '');
  IF v_party_name IS NULL OR v_party_name = 'Customer' THEN
    IF v_estimate_id IS NOT NULL THEN
      SELECT COALESCE(NULLIF(TRIM(billing_legal_name_snapshot), ''), NULLIF(TRIM(client_name), ''))
      INTO v_party_name
      FROM estimates WHERE id = v_estimate_id;
    END IF;
    IF (v_party_name IS NULL OR v_party_name = 'Customer') AND v_client_id IS NOT NULL THEN
      SELECT name INTO v_party_name FROM clients WHERE id = v_client_id;
    END IF;
    v_party_name := COALESCE(v_party_name, 'Customer');
  END IF;

  -- 1. Duplicate check: if an active invoice already exists for this estimate + store within this company, return it idempotently
  IF v_estimate_id IS NOT NULL THEN
    IF v_store_id IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
      WHERE i.company_id = v_company_id
        AND i.estimate_id = v_estimate_id
        AND i.store_id = v_store_id
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSIF v_store_code IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
      WHERE i.company_id = v_company_id
        AND i.estimate_id = v_estimate_id
        AND i.store_code = v_store_code
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSE
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
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
    SELECT 1 FROM invoices
    WHERE company_id = v_company_id
      AND LOWER(TRIM(invoice_number)) = LOWER(TRIM(v_invoice_number))
  ) THEN
    RAISE EXCEPTION 'Invoice number "%" is already in use for this company. Please enter a unique invoice number.', v_invoice_number;
  END IF;

  -- 4. Insert invoice with company_id
  INSERT INTO invoices (
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
$$;

-- 6. Updated Atomic Estimate Creator (Company-Aware)
CREATE OR REPLACE FUNCTION public.create_estimate_atomic(p_estimate jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  v_estimate_number := NULLIF(TRIM(COALESCE(p_estimate->>'estimate_number', p_estimate->>'estimateNumber', '')), '');
  IF v_estimate_number IS NULL OR v_estimate_number = '' THEN
    v_estimate_number := public.next_sunrise_document_number('estimate', v_estimate_date::date, v_company_id);
  END IF;

  -- 1. Insert estimate with company_id
  INSERT INTO estimates (
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
    INSERT INTO estimate_items (
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
  END IF;

  -- 3. Return full estimate row as jsonb
  SELECT to_jsonb(e.*) INTO v_result FROM estimates e WHERE e.id = v_estimate_id;
  RETURN v_result;
END;
$$;

-- 7. Updated replace_estimate_items (Company-Aware)
CREATE OR REPLACE FUNCTION public.replace_estimate_items(p_estimate_id integer, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id integer := 1;
  v_inserted integer := 0;
BEGIN
  SELECT company_id INTO v_company_id FROM estimates WHERE id = p_estimate_id;
  v_company_id := COALESCE(v_company_id, 1);

  -- Insert new items with company_id
  INSERT INTO estimate_items (
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

-- 8. Updated set_tally_invoice_sequence (Company-Aware)
CREATE OR REPLACE FUNCTION public.set_tally_invoice_sequence(
  p_fy text,
  p_current_number integer,
  p_company_id integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id integer := COALESCE(p_company_id, 1);
  v_cfg jsonb;
  v_val jsonb;
BEGIN
  SELECT numbering_config->'invoice' INTO v_cfg FROM companies WHERE id = v_company_id;
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

  UPDATE companies
  SET numbering_config = jsonb_set(COALESCE(numbering_config, '{}'::jsonb), '{invoice}', v_val),
      updated_at = NOW()
  WHERE id = v_company_id;

  -- If company 1, also update app_settings for backwards compatibility
  IF v_company_id = 1 THEN
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('numbering.invoice', v_val, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW();
  END IF;

  RETURN v_val;
END;
$$;
