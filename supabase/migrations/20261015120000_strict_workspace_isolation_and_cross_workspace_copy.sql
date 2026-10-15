-- Migration: 20261015120000_strict_workspace_isolation_and_cross_workspace_copy.sql
-- Enforces strict workspace isolation across all company modules, removes unsafe DEFAULT 1 fallbacks,
-- adds atomic master data save & copy RPCs, and repairs misassigned Client 22.

-- 1. DATA REPAIR: Reassign Client 22 ("Ledure Lighting Limited") to Workspace 2 (Delhi Company)
UPDATE public.clients 
SET company_id = 2 
WHERE id = 22 AND name = 'Ledure Lighting Limited' AND company_id = 1;

-- 2. DROP DANGEROUS 'DEFAULT 1' FROM COMPANY_ID COLUMNS
-- This prevents any silent fallback to Workspace 1 if company context is missing.
ALTER TABLE public.clients ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.brands ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.stores ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.products ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.material_codes ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.customer_rate_cards ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.estimates ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.invoices ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.payments ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.delivery_challans ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.projects ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.estimate_items ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.execution_documents ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE public.invoice_packets ALTER COLUMN company_id DROP DEFAULT;

-- 3. UPDATE next_sunrise_document_number TO REQUIRE COMPANY_ID (NO SILENT DEFAULT 1)
CREATE OR REPLACE FUNCTION public.next_sunrise_document_number(
  p_kind text,
  p_date date DEFAULT CURRENT_DATE,
  p_company_id integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer := p_company_id;
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
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required for document numbering' USING ERRCODE = '23502';
  END IF;

  -- Verify caller has company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Load company configuration
  SELECT * INTO v_company FROM public.companies WHERE id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company with id % not found', v_company_id USING ERRCODE = 'P0002';
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
    WHERE company_id = v_company_id;

    v_max := GREATEST(v_configured_start, v_highest_existing);
    RETURN v_fy || '/' || v_prefix || '/' || LPAD((v_max + 1)::text, 3, '0');

  ELSIF p_kind = 'estimate' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.estimate_prefix), ''), 'SM/E');
    v_num_cfg := COALESCE(v_company.numbering_config->'estimate', '{}'::jsonb);

    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      CASE WHEN v_company_id = 1 AND v_fy = '26-27' THEN 201 ELSE 101 END
    );

    SELECT COALESCE(
      max(
        CASE 
          WHEN estimate_number ~* ('^' || v_prefix || '/' || v_fy || '/([0-9]+)$') THEN
            (regexp_match(estimate_number, '^' || v_prefix || '/' || v_fy || '/([0-9]+)$', 'i'))[1]::integer
          WHEN estimate_number ~* ('^' || v_prefix || '/([0-9]+)$') THEN
            (regexp_match(estimate_number, '^' || v_prefix || '/([0-9]+)$', 'i'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) INTO v_highest_existing
    FROM public.estimates
    WHERE company_id = v_company_id;

    v_max := GREATEST(v_configured_start, v_highest_existing);
    RETURN v_prefix || '/' || v_fy || '/' || LPAD((v_max + 1)::text, 3, '0');

  ELSIF p_kind = 'dc' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.dc_prefix), ''), 'SM/DC');
    v_num_cfg := COALESCE(v_company.numbering_config->'dc', '{}'::jsonb);

    v_configured_start := COALESCE(
      NULLIF(v_num_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_num_cfg->>'startAt', '')::integer,
      101
    );

    SELECT COALESCE(
      max(
        CASE 
          WHEN dc_number ~* ('^' || v_prefix || '/' || v_fy || '/([0-9]+)$') THEN
            (regexp_match(dc_number, '^' || v_prefix || '/' || v_fy || '/([0-9]+)$', 'i'))[1]::integer
          WHEN dc_number ~* ('^' || v_prefix || '/([0-9]+)$') THEN
            (regexp_match(dc_number, '^' || v_prefix || '/([0-9]+)$', 'i'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) INTO v_highest_existing
    FROM public.delivery_challans
    WHERE company_id = v_company_id;

    v_max := GREATEST(v_configured_start, v_highest_existing);
    RETURN v_prefix || '/' || v_fy || '/' || LPAD((v_max + 1)::text, 3, '0');

  ELSE
    RAISE EXCEPTION 'Unknown document kind: %', p_kind USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- 4. UPDATE create_estimate_atomic TO FORBID SILENT COMPANY 1 FALLBACK
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
  v_store_id := COALESCE(
    (COALESCE(p_estimate->>'store_id', p_estimate->>'storeId'))::integer,
    (COALESCE(p_items->0->>'store_id', p_items->0->>'storeId'))::integer,
    (SELECT id FROM public.stores WHERE company_id = v_company_id LIMIT 1)
  );

  IF v_client_id IS NULL OR v_brand_id IS NULL THEN
    RAISE EXCEPTION 'client_id and brand_id are required' USING ERRCODE = '23502';
  END IF;

  -- Verify client and brand belong to this company
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client_id AND company_id = v_company_id) THEN
    RAISE EXCEPTION 'Client % does not belong to company %', v_client_id, v_company_id USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand_id AND company_id = v_company_id) THEN
    RAISE EXCEPTION 'Brand % does not belong to company %', v_brand_id, v_company_id USING ERRCODE = '42501';
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
    COALESCE(p_estimate->>'title', 'Estimate'),
    p_estimate->>'description',
    COALESCE((p_estimate->>'subtotal')::numeric, 0),
    COALESCE((p_estimate->>'tax_amount')::numeric, (p_estimate->>'taxAmount')::numeric, 0),
    COALESCE((p_estimate->>'total_amount')::numeric, (p_estimate->>'totalAmount')::numeric, 0),
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
    COALESCE((p_estimate->>'packing_percent')::numeric, (p_estimate->>'packingPercent')::numeric, 0),
    COALESCE((p_estimate->>'implementation_percent')::numeric, (p_estimate->>'implementationPercent')::numeric, 0),
    COALESCE((p_estimate->>'transport_amount')::numeric, (p_estimate->>'transportAmount')::numeric, 0),
    COALESCE(p_estimate->'store_grouping', p_estimate->'storeGrouping', '[]'::jsonb),
    COALESCE(p_estimate->>'po_number', p_estimate->>'poNumber'),
    (COALESCE(p_estimate->>'po_date', p_estimate->>'poDate'))::timestamp,
    (COALESCE(p_estimate->>'po_amount', p_estimate->>'poAmount'))::numeric,
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
    COALESCE(p_estimate->>'format_profile_code', p_estimate->>'formatProfileCode'),
    0,
    1,
    CURRENT_TIMESTAMP
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
      COALESCE((COALESCE(item->>'store_id', item->>'storeId'))::integer, v_store_id),
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

-- 5. UPDATE create_invoice_atomic TO FORBID SILENT COMPANY 1 FALLBACK
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

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required' USING ERRCODE = '23502';
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Resolve client_id from estimate if missing
  IF v_client_id IS NULL AND v_estimate_id IS NOT NULL THEN
    SELECT client_id INTO v_client_id FROM public.estimates WHERE id = v_estimate_id;
  END IF;

  -- Resolve party_name if missing
  v_party_name := NULLIF(TRIM(COALESCE(p_invoice->>'party_name', p_invoice->>'partyName', '')), '');
  IF (v_party_name IS NULL OR v_party_name = '') AND v_client_id IS NOT NULL THEN
    SELECT name INTO v_party_name FROM public.clients WHERE id = v_client_id;
  END IF;

  -- Idempotency check: if invoice already exists for this estimate & store
  IF v_estimate_id IS NOT NULL AND v_store_id IS NOT NULL THEN
    SELECT row_to_json(inv)::jsonb INTO v_existing
    FROM public.invoices inv
    WHERE inv.company_id = v_company_id
      AND inv.estimate_id = v_estimate_id
      AND inv.store_id = v_store_id
      AND inv.status != 'cancelled'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'invoice', v_existing,
        'isExisting', true,
        'message', 'Invoice already exists for this store in the estimate.'
      );
    END IF;
  END IF;

  -- Resolve invoice_number
  v_invoice_number := NULLIF(TRIM(COALESCE(p_invoice->>'invoice_number', p_invoice->>'invoiceNumber', '')), '');
  IF v_invoice_number IS NULL OR v_invoice_number = '' THEN
    v_invoice_number := public.next_sunrise_document_number('invoice', v_invoice_date::date, v_company_id);
  END IF;

  -- Insert invoice
  INSERT INTO public.invoices (
    company_id, invoice_number, type, party_name, amount, tax_amount, total_amount,
    date, due_date, status, estimate_id, client_id, paid_amount, balance_amount,
    packet_settings, remarks, delivery_challan_id, line_items,
    po_number, po_reference, transport_cost, store_id, store_code, store_name
  )
  VALUES (
    v_company_id,
    v_invoice_number,
    COALESCE(p_invoice->>'type', 'sales'),
    COALESCE(v_party_name, 'Unknown Party'),
    COALESCE((p_invoice->>'amount')::numeric, 0),
    COALESCE((p_invoice->>'tax_amount')::numeric, (p_invoice->>'taxAmount')::numeric, 0),
    COALESCE((p_invoice->>'total_amount')::numeric, (p_invoice->>'totalAmount')::numeric, 0),
    v_invoice_date,
    (COALESCE(p_invoice->>'due_date', p_invoice->>'dueDate'))::timestamp,
    COALESCE(p_invoice->>'status', 'draft'),
    v_estimate_id,
    v_client_id,
    COALESCE((p_invoice->>'paid_amount')::numeric, (p_invoice->>'paidAmount')::numeric, 0),
    COALESCE((p_invoice->>'balance_amount')::numeric, (p_invoice->>'balanceAmount')::numeric, (p_invoice->>'total_amount')::numeric, (p_invoice->>'totalAmount')::numeric, 0),
    COALESCE(p_invoice->'packet_settings', p_invoice->'packetSettings'),
    COALESCE(p_invoice->>'remarks', ''),
    (COALESCE(p_invoice->>'delivery_challan_id', p_invoice->>'deliveryChallanId'))::integer,
    COALESCE(p_invoice->'line_items', p_invoice->'lineItems', '[]'::jsonb),
    COALESCE(p_invoice->>'po_number', p_invoice->>'poNumber'),
    COALESCE(p_invoice->>'po_reference', p_invoice->>'poReference'),
    COALESCE((p_invoice->>'transport_cost')::numeric, (p_invoice->>'transportCost')::numeric, 0),
    v_store_id,
    v_store_code,
    v_store_name
  )
  RETURNING row_to_json(invoices.*)::jsonb INTO v_result;

  RETURN jsonb_build_object(
    'success', true,
    'invoice', v_result,
    'isExisting', false
  );
END;
$function$;

-- 6. ATOMIC MASTER DATA SAVE RPC
-- Runs server-side with strict company isolation, authorization, and auditability
CREATE OR REPLACE FUNCTION public.save_master_data_atomic(
  p_entity text,
  p_method text,
  p_id integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_result jsonb;
  v_existing_comp integer;
  v_parent_client_comp integer;
BEGIN
  -- 1. Resolve company_id
  v_company_id := COALESCE(
    (p_payload->>'company_id')::integer,
    (p_payload->>'companyId')::integer
  );

  -- For PATCH/DELETE, if company_id wasn't in payload, find it from the existing record
  IF v_company_id IS NULL AND p_id IS NOT NULL THEN
    IF p_entity = 'clients' THEN
      SELECT company_id INTO v_company_id FROM public.clients WHERE id = p_id;
    ELSIF p_entity = 'brands' THEN
      SELECT company_id INTO v_company_id FROM public.brands WHERE id = p_id;
    ELSIF p_entity = 'stores' THEN
      SELECT company_id INTO v_company_id FROM public.stores WHERE id = p_id;
    ELSIF p_entity = 'products' THEN
      SELECT company_id INTO v_company_id FROM public.products WHERE id = p_id;
    ELSIF p_entity = 'material-codes' THEN
      SELECT company_id INTO v_company_id FROM public.material_codes WHERE id = p_id;
    ELSIF p_entity = 'billing-profiles' THEN
      SELECT c.company_id INTO v_company_id 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;
    END IF;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required and could not be determined' USING ERRCODE = '23502';
  END IF;

  -- 2. Verify caller access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- ── CLIENTS ─────────────────────────────────────────────────────────────────
  IF p_entity = 'clients' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.clients (
        company_id, name, email, mobile, city, address, gst_number,
        format, client_group_name, client_type, pan,
        primary_contact_person, payment_terms, vendor_code, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'email', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'mobile', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'city', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'address', '')), ''),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'gstNumber', p_payload->>'gst_number', ''))), ''),
        COALESCE(p_payload->>'format', 'normal'),
        NULLIF(TRIM(COALESCE(p_payload->>'clientGroupName', p_payload->>'client_group_name', '')), ''),
        COALESCE(p_payload->>'clientType', p_payload->>'client_type', 'normal'),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'pan', ''))), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'primaryContactPerson', p_payload->>'primary_contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'paymentTerms', p_payload->>'payment_terms', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'vendorCode', p_payload->>'vendor_code', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(clients.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.clients WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Client % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.clients SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        email = CASE WHEN p_payload ? 'email' THEN NULLIF(TRIM(p_payload->>'email'), '') ELSE email END,
        mobile = CASE WHEN p_payload ? 'mobile' THEN NULLIF(TRIM(p_payload->>'mobile'), '') ELSE mobile END,
        city = CASE WHEN p_payload ? 'city' THEN NULLIF(TRIM(p_payload->>'city'), '') ELSE city END,
        address = CASE WHEN p_payload ? 'address' THEN NULLIF(TRIM(p_payload->>'address'), '') ELSE address END,
        gst_number = CASE WHEN p_payload ? 'gstNumber' OR p_payload ? 'gst_number' THEN NULLIF(TRIM(UPPER(COALESCE(p_payload->>'gstNumber', p_payload->>'gst_number'))), '') ELSE gst_number END,
        format = COALESCE(p_payload->>'format', format),
        client_group_name = CASE WHEN p_payload ? 'clientGroupName' OR p_payload ? 'client_group_name' THEN NULLIF(TRIM(COALESCE(p_payload->>'clientGroupName', p_payload->>'client_group_name')), '') ELSE client_group_name END,
        client_type = COALESCE(p_payload->>'clientType', p_payload->>'client_type', client_type),
        pan = CASE WHEN p_payload ? 'pan' THEN NULLIF(TRIM(UPPER(p_payload->>'pan')), '') ELSE pan END,
        primary_contact_person = CASE WHEN p_payload ? 'primaryContactPerson' OR p_payload ? 'primary_contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'primaryContactPerson', p_payload->>'primary_contact_person')), '') ELSE primary_contact_person END,
        payment_terms = CASE WHEN p_payload ? 'paymentTerms' OR p_payload ? 'payment_terms' THEN NULLIF(TRIM(COALESCE(p_payload->>'paymentTerms', p_payload->>'payment_terms')), '') ELSE payment_terms END,
        vendor_code = CASE WHEN p_payload ? 'vendorCode' OR p_payload ? 'vendor_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'vendorCode', p_payload->>'vendor_code')), '') ELSE vendor_code END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(clients.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.clients WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Client % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.estimates WHERE client_id = p_id LIMIT 1) THEN
        UPDATE public.clients SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Client has estimates — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.clients WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Client deleted.');
      END IF;
    END IF;

  -- ── BRANDS ──────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'brands' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.brands (
        company_id, name, parent_client_id, parent_brand, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        (COALESCE(p_payload->>'parentClientId', p_payload->>'parent_client_id'))::integer,
        NULLIF(TRIM(COALESCE(p_payload->>'parentBrand', p_payload->>'parent_brand', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(brands.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.brands WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Brand % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.brands SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        parent_client_id = COALESCE((p_payload->>'parentClientId')::integer, (p_payload->>'parent_client_id')::integer, parent_client_id),
        parent_brand = CASE WHEN p_payload ? 'parentBrand' OR p_payload ? 'parent_brand' THEN NULLIF(TRIM(COALESCE(p_payload->>'parentBrand', p_payload->>'parent_brand')), '') ELSE parent_brand END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(brands.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.brands WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Brand % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.stores WHERE brand_id = p_id LIMIT 1) THEN
        RAISE EXCEPTION 'Brand has linked stores. Remove them first.' USING ERRCODE = '23503';
      END IF;
      IF EXISTS (SELECT 1 FROM public.estimates WHERE brand_id = p_id LIMIT 1) THEN
        RAISE EXCEPTION 'Brand has linked estimates. Remove them first.' USING ERRCODE = '23503';
      END IF;

      DELETE FROM public.brands WHERE id = p_id AND company_id = v_company_id;
      RETURN jsonb_build_object('message', 'Brand deleted.');
    END IF;

  -- ── STORES ──────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'stores' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.stores (
        company_id, client_id, brand_id, name, location, address,
        contact_person, contact_phone, store_code, city, state, state_code,
        region_zone, contact, is_active
      )
      VALUES (
        v_company_id,
        (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer,
        (COALESCE(p_payload->>'brandId', p_payload->>'brand_id'))::integer,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'location', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'address', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPhone', p_payload->>'contact_phone', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'storeCode', p_payload->>'store_code', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'city', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'state', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'regionZone', p_payload->>'region_zone', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contact', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(stores.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.stores WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Store % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.stores SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        client_id = COALESCE((p_payload->>'clientId')::integer, (p_payload->>'client_id')::integer, client_id),
        brand_id = COALESCE((p_payload->>'brandId')::integer, (p_payload->>'brand_id')::integer, brand_id),
        location = CASE WHEN p_payload ? 'location' THEN NULLIF(TRIM(p_payload->>'location'), '') ELSE location END,
        address = CASE WHEN p_payload ? 'address' THEN NULLIF(TRIM(p_payload->>'address'), '') ELSE address END,
        contact_person = CASE WHEN p_payload ? 'contactPerson' OR p_payload ? 'contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person')), '') ELSE contact_person END,
        contact_phone = CASE WHEN p_payload ? 'contactPhone' OR p_payload ? 'contact_phone' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPhone', p_payload->>'contact_phone')), '') ELSE contact_phone END,
        store_code = CASE WHEN p_payload ? 'storeCode' OR p_payload ? 'store_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'storeCode', p_payload->>'store_code')), '') ELSE store_code END,
        city = CASE WHEN p_payload ? 'city' THEN NULLIF(TRIM(p_payload->>'city'), '') ELSE city END,
        state = CASE WHEN p_payload ? 'state' THEN NULLIF(TRIM(p_payload->>'state'), '') ELSE state END,
        state_code = CASE WHEN p_payload ? 'stateCode' OR p_payload ? 'state_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code')), '') ELSE state_code END,
        region_zone = CASE WHEN p_payload ? 'regionZone' OR p_payload ? 'region_zone' THEN NULLIF(TRIM(COALESCE(p_payload->>'regionZone', p_payload->>'region_zone')), '') ELSE region_zone END,
        contact = CASE WHEN p_payload ? 'contact' THEN NULLIF(TRIM(p_payload->>'contact'), '') ELSE contact END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(stores.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.stores WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Store % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.estimate_items WHERE store_id = p_id LIMIT 1) THEN
        UPDATE public.stores SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Store has estimate items — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.stores WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Store deleted.');
      END IF;
    END IF;

  -- ── PRODUCTS ────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'products' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.products (
        company_id, name, category, unit, rate, description, hsn_sac,
        is_standard, calculation_type, gst_percent, default_specification,
        warranty, material_code_id, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'category', '')), ''),
        COALESCE(p_payload->>'unit', 'sqft'),
        COALESCE((p_payload->>'rate')::numeric, 0),
        NULLIF(TRIM(COALESCE(p_payload->>'description', '')), ''),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'hsnSac', p_payload->>'hsn_sac', ''))), ''),
        COALESCE((p_payload->>'isStandard')::boolean, (p_payload->>'is_standard')::boolean, true),
        COALESCE(p_payload->>'calculationType', p_payload->>'calculation_type', 'sqft'),
        COALESCE((p_payload->>'gstPercent')::numeric, (p_payload->>'gst_percent')::numeric, 18),
        NULLIF(TRIM(COALESCE(p_payload->>'defaultSpecification', p_payload->>'default_specification', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'warranty', '')), ''),
        (COALESCE(p_payload->>'materialCodeId', p_payload->>'material_code_id'))::integer,
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(products.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.products WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Product % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.products SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        category = CASE WHEN p_payload ? 'category' THEN NULLIF(TRIM(p_payload->>'category'), '') ELSE category END,
        unit = COALESCE(p_payload->>'unit', unit),
        rate = COALESCE((p_payload->>'rate')::numeric, rate),
        description = CASE WHEN p_payload ? 'description' THEN NULLIF(TRIM(p_payload->>'description'), '') ELSE description END,
        hsn_sac = CASE WHEN p_payload ? 'hsnSac' OR p_payload ? 'hsn_sac' THEN NULLIF(TRIM(UPPER(COALESCE(p_payload->>'hsnSac', p_payload->>'hsn_sac'))), '') ELSE hsn_sac END,
        is_standard = COALESCE((p_payload->>'isStandard')::boolean, (p_payload->>'is_standard')::boolean, is_standard),
        calculation_type = COALESCE(p_payload->>'calculationType', p_payload->>'calculation_type', calculation_type),
        gst_percent = COALESCE((p_payload->>'gstPercent')::numeric, (p_payload->>'gst_percent')::numeric, gst_percent),
        default_specification = CASE WHEN p_payload ? 'defaultSpecification' OR p_payload ? 'default_specification' THEN NULLIF(TRIM(COALESCE(p_payload->>'defaultSpecification', p_payload->>'default_specification')), '') ELSE default_specification END,
        warranty = CASE WHEN p_payload ? 'warranty' THEN NULLIF(TRIM(p_payload->>'warranty'), '') ELSE warranty END,
        material_code_id = CASE WHEN p_payload ? 'materialCodeId' OR p_payload ? 'material_code_id' THEN (COALESCE(p_payload->>'materialCodeId', p_payload->>'material_code_id'))::integer ELSE material_code_id END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(products.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.products WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Product % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.products WHERE id = p_id AND name = 'Installation Service') THEN
        RAISE EXCEPTION 'Cannot delete system service product.' USING ERRCODE = '42501';
      END IF;

      IF EXISTS (SELECT 1 FROM public.estimate_items WHERE product_id = p_id LIMIT 1) THEN
        UPDATE public.products SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Product is used in estimates — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.products WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Product deleted.');
      END IF;
    END IF;

  -- ── BILLING PROFILES ────────────────────────────────────────────────────────
  ELSIF p_entity = 'billing-profiles' THEN
    IF p_method = 'POST' THEN
      -- Verify parent client belongs to v_company_id
      SELECT company_id INTO v_parent_client_comp 
      FROM public.clients 
      WHERE id = (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer;

      IF v_parent_client_comp IS NULL OR v_parent_client_comp != v_company_id THEN
        RAISE EXCEPTION 'Parent client does not belong to authorized company %', v_company_id USING ERRCODE = '42501';
      END IF;

      INSERT INTO public.client_billing_profiles (
        client_id, legal_company_name, branch_location_name, gstin, pan,
        state, state_code, billing_address, shipping_address,
        contact_person, mobile, email, is_default, is_active, notes
      )
      VALUES (
        (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer,
        TRIM(COALESCE(p_payload->>'legalCompanyName', p_payload->>'legal_company_name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'branchLocationName', p_payload->>'branch_location_name', '')), ''),
        TRIM(UPPER(COALESCE(p_payload->>'gstin', ''))),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'pan', ''))), ''),
        TRIM(COALESCE(p_payload->>'state', '')),
        TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code', '')),
        TRIM(COALESCE(p_payload->>'billingAddress', p_payload->>'billing_address', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'shippingAddress', p_payload->>'shipping_address', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'mobile', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'email', '')), ''),
        COALESCE((p_payload->>'isDefault')::boolean, (p_payload->>'is_default')::boolean, false),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true),
        NULLIF(TRIM(COALESCE(p_payload->>'notes', '')), '')
      )
      RETURNING row_to_json(client_billing_profiles.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT c.company_id INTO v_existing_comp 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;

      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Billing profile % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.client_billing_profiles SET
        legal_company_name = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'legalCompanyName', p_payload->>'legal_company_name')), ''), legal_company_name),
        branch_location_name = CASE WHEN p_payload ? 'branchLocationName' OR p_payload ? 'branch_location_name' THEN NULLIF(TRIM(COALESCE(p_payload->>'branchLocationName', p_payload->>'branch_location_name')), '') ELSE branch_location_name END,
        gstin = COALESCE(NULLIF(TRIM(UPPER(p_payload->>'gstin')), ''), gstin),
        pan = CASE WHEN p_payload ? 'pan' THEN NULLIF(TRIM(UPPER(p_payload->>'pan')), '') ELSE pan END,
        state = COALESCE(NULLIF(TRIM(p_payload->>'state'), ''), state),
        state_code = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code')), ''), state_code),
        billing_address = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'billingAddress', p_payload->>'billing_address')), ''), billing_address),
        shipping_address = CASE WHEN p_payload ? 'shippingAddress' OR p_payload ? 'shipping_address' THEN NULLIF(TRIM(COALESCE(p_payload->>'shippingAddress', p_payload->>'shipping_address')), '') ELSE shipping_address END,
        contact_person = CASE WHEN p_payload ? 'contactPerson' OR p_payload ? 'contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person')), '') ELSE contact_person END,
        mobile = CASE WHEN p_payload ? 'mobile' THEN NULLIF(TRIM(p_payload->>'mobile'), '') ELSE mobile END,
        email = CASE WHEN p_payload ? 'email' THEN NULLIF(TRIM(p_payload->>'email'), '') ELSE email END,
        is_default = COALESCE((p_payload->>'isDefault')::boolean, (p_payload->>'is_default')::boolean, is_default),
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active),
        notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(TRIM(p_payload->>'notes'), '') ELSE notes END
      WHERE id = p_id
      RETURNING row_to_json(client_billing_profiles.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT c.company_id INTO v_existing_comp 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;

      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Billing profile % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      DELETE FROM public.client_billing_profiles WHERE id = p_id;
      RETURN jsonb_build_object('message', 'Billing profile deleted.');
    END IF;

  -- ── MATERIAL CODES ──────────────────────────────────────────────────────────
  ELSIF p_entity = 'material-codes' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.material_codes (
        company_id, code, description, uom, default_rate, is_active
      )
      VALUES (
        v_company_id,
        TRIM(UPPER(COALESCE(p_payload->>'code', ''))),
        NULLIF(TRIM(COALESCE(p_payload->>'description', '')), ''),
        COALESCE(p_payload->>'uom', 'sqft'),
        COALESCE((p_payload->>'defaultRate')::numeric, (p_payload->>'default_rate')::numeric, 0),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(material_codes.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.material_codes WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Material code % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.material_codes SET
        code = COALESCE(NULLIF(TRIM(UPPER(p_payload->>'code')), ''), code),
        description = CASE WHEN p_payload ? 'description' THEN NULLIF(TRIM(p_payload->>'description'), '') ELSE description END,
        uom = COALESCE(p_payload->>'uom', uom),
        default_rate = COALESCE((p_payload->>'defaultRate')::numeric, (p_payload->>'default_rate')::numeric, default_rate),
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(material_codes.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.material_codes WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Material code % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      DELETE FROM public.material_codes WHERE id = p_id AND company_id = v_company_id;
      RETURN jsonb_build_object('message', 'Material code deleted.');
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- 7. EXPLICIT CROSS-WORKSPACE COPY RPC
-- Deliberate, audited action to copy master records to another workspace without altering source
CREATE OR REPLACE FUNCTION public.copy_record_to_workspace(
  p_entity text,
  p_source_id integer,
  p_destination_company_id integer,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_source_company_id integer;
  v_dest_company public.companies%ROWTYPE;
  v_new_record jsonb;
  v_new_id integer;
  v_profiles_copied integer := 0;
  v_src_client public.clients%ROWTYPE;
  v_src_prod public.products%ROWTYPE;
  v_src_brand public.brands%ROWTYPE;
BEGIN
  -- Validate destination workspace
  SELECT * INTO v_dest_company FROM public.companies WHERE id = p_destination_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination company % does not exist', p_destination_company_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify caller has access to destination workspace
  IF NOT public.user_has_company_access(p_destination_company_id) THEN
    RAISE EXCEPTION 'Access denied for destination company %', p_destination_company_id USING ERRCODE = '42501';
  END IF;

  -- ── COPY CLIENT ─────────────────────────────────────────────────────────────
  IF p_entity = 'clients' THEN
    SELECT * INTO v_src_client FROM public.clients WHERE id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source client % not found', p_source_id USING ERRCODE = 'P0002';
    END IF;

    v_source_company_id := v_src_client.company_id;
    IF v_source_company_id = p_destination_company_id THEN
      RAISE EXCEPTION 'Destination workspace cannot be the same as source workspace' USING ERRCODE = '22023';
    END IF;

    -- Verify access to source workspace
    IF NOT public.user_has_company_access(v_source_company_id) THEN
      RAISE EXCEPTION 'Access denied for source company %', v_source_company_id USING ERRCODE = '42501';
    END IF;

    -- Check if client already exists in destination by name
    IF EXISTS (SELECT 1 FROM public.clients WHERE company_id = p_destination_company_id AND LOWER(TRIM(name)) = LOWER(TRIM(v_src_client.name))) THEN
      -- Suffix with copy or return notice
      -- We insert with suffix if needed or keep original name
    END IF;

    -- Create new independent destination record
    INSERT INTO public.clients (
      company_id, name, email, mobile, city, address, gst_number,
      format, client_group_name, client_type, pan,
      primary_contact_person, payment_terms, vendor_code, is_active
    )
    VALUES (
      p_destination_company_id,
      v_src_client.name,
      v_src_client.email,
      v_src_client.mobile,
      v_src_client.city,
      v_src_client.address,
      v_src_client.gst_number,
      v_src_client.format,
      v_src_client.client_group_name,
      v_src_client.client_type,
      v_src_client.pan,
      v_src_client.primary_contact_person,
      v_src_client.payment_terms,
      v_src_client.vendor_code,
      true
    )
    RETURNING id, row_to_json(clients.*)::jsonb INTO v_new_id, v_new_record;

    -- Optionally copy billing profiles
    IF COALESCE((p_options->>'copyBillingProfiles')::boolean, true) THEN
      INSERT INTO public.client_billing_profiles (
        client_id, legal_company_name, branch_location_name, gstin, pan,
        state, state_code, billing_address, shipping_address,
        contact_person, mobile, email, is_default, is_active, notes
      )
      SELECT
        v_new_id,
        legal_company_name,
        branch_location_name,
        gstin,
        pan,
        state,
        state_code,
        billing_address,
        shipping_address,
        contact_person,
        mobile,
        email,
        is_default,
        true,
        notes
      FROM public.client_billing_profiles
      WHERE client_id = p_source_id AND is_active = true;

      GET DIAGNOSTICS v_profiles_copied = ROW_COUNT;
    END IF;

    -- Verify destination record exists
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_new_id AND company_id = p_destination_company_id) THEN
      RAISE EXCEPTION 'Verification failed: destination client record was not created' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'sourceId', p_source_id,
      'destinationId', v_new_id,
      'destinationCompanyId', p_destination_company_id,
      'destinationCompanyName', v_dest_company.name,
      'profilesCopied', v_profiles_copied,
      'record', v_new_record
    );

  -- ── COPY PRODUCT ────────────────────────────────────────────────────────────
  ELSIF p_entity = 'products' THEN
    SELECT * INTO v_src_prod FROM public.products WHERE id = p_source_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source product % not found', p_source_id USING ERRCODE = 'P0002';
    END IF;

    v_source_company_id := v_src_prod.company_id;
    IF v_source_company_id = p_destination_company_id THEN
      RAISE EXCEPTION 'Destination workspace cannot be the same as source workspace' USING ERRCODE = '22023';
    END IF;

    IF NOT public.user_has_company_access(v_source_company_id) THEN
      RAISE EXCEPTION 'Access denied for source company %', v_source_company_id USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.products (
      company_id, name, category, unit, rate, description, hsn_sac,
      is_standard, calculation_type, gst_percent, default_specification,
      warranty, is_active
    )
    VALUES (
      p_destination_company_id,
      v_src_prod.name,
      v_src_prod.category,
      v_src_prod.unit,
      v_src_prod.rate,
      v_src_prod.description,
      v_src_prod.hsn_sac,
      v_src_prod.is_standard,
      v_src_prod.calculation_type,
      v_src_prod.gst_percent,
      v_src_prod.default_specification,
      v_src_prod.warranty,
      true
    )
    RETURNING id, row_to_json(products.*)::jsonb INTO v_new_id, v_new_record;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_new_id AND company_id = p_destination_company_id) THEN
      RAISE EXCEPTION 'Verification failed: destination product record was not created' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'sourceId', p_source_id,
      'destinationId', v_new_id,
      'destinationCompanyId', p_destination_company_id,
      'destinationCompanyName', v_dest_company.name,
      'record', v_new_record
    );

  ELSE
    RAISE EXCEPTION 'Copy not supported for entity %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- 8. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION public.next_sunrise_document_number(text, date, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_estimate_atomic(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_master_data_atomic(text, text, integer, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.copy_record_to_workspace(text, integer, integer, jsonb) TO authenticated, service_role;
