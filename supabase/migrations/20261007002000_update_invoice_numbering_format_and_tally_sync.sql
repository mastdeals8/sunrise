-- ==============================================================================
-- Migration: 20261007002000_update_invoice_numbering_format_and_tally_sync.sql
-- Description:
--   1. Updates next_sunrise_document_number('invoice') to use required format:
--      "<FY>/SM/<number>" (e.g. "26-27/SM/171") instead of "SM/INV/<FY>/xxx".
--   2. Supports smart sequence starting floor from Tally / external configuration:
--      MAX(existing Sunrise invoice sequence, configured Tally starting sequence) + 1.
--   3. Adds duplicate invoice number protection to create_invoice_atomic:
--      Prevents duplicate complete invoice numbers from ever being inserted.
--   4. Adds helper function set_tally_invoice_sequence(fy text, current_num integer).
-- ==============================================================================

-- Drop old 1-param signature to avoid Postgres overload ambiguity with defaulted 2nd param
DROP FUNCTION IF EXISTS public.next_sunrise_document_number(text);

CREATE OR REPLACE FUNCTION public.next_sunrise_document_number(
  p_kind text,
  p_date date DEFAULT current_date
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_date date;
  v_fy text;
  v_prefix text;
  v_start_at integer;
  v_fy_aware boolean;
  v_cfg jsonb;
  v_pattern text;
  v_max integer;
  v_configured_start integer;
  v_highest_existing integer;
BEGIN
  IF p_kind NOT IN ('invoice', 'estimate', 'dc') THEN
    RAISE EXCEPTION 'Unsupported document kind: %', p_kind;
  END IF;

  v_doc_date := COALESCE(p_date, current_date);

  -- Determine Indian Financial Year (Apr 1 - Mar 31)
  v_fy := to_char(CASE WHEN extract(month FROM v_doc_date) < 4
    THEN v_doc_date - interval '1 year' ELSE v_doc_date END, 'YY')
    || '-' || to_char(CASE WHEN extract(month FROM v_doc_date) < 4
    THEN v_doc_date ELSE v_doc_date + interval '1 year' END, 'YY');

  PERFORM pg_advisory_xact_lock(hashtext('sunrise-document-number:' || p_kind || ':' || v_fy));

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'numbering.' || p_kind;

  IF p_kind = 'invoice' THEN
    -- Required Sunrise invoice format: <FY>/SM/<number> (e.g. 26-27/SM/171)
    -- Read configured Tally starting number / floor for this financial year
    v_configured_start := COALESCE(
      NULLIF(v_cfg->'fySequences'->>v_fy, '')::integer,
      NULLIF(v_cfg->'tallyStartSeq'->>v_fy, '')::integer,
      NULLIF(v_cfg->>'tallyCurrentNumber', '')::integer,
      NULLIF(v_cfg->>'startAt', '')::integer,
      0
    );

    -- Find the highest existing invoice sequence for this financial year
    SELECT COALESCE(
      max(
        CASE 
          -- Match standard format: YY-YY/SM/140
          WHEN invoice_number ~* ('^' || v_fy || '/SM/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^' || v_fy || '/SM/([0-9]+)$', 'i'))[1]::integer
          -- Also recognize legacy format SM/INV/YY-YY/104 if present
          WHEN invoice_number ~* ('^SM/INV/' || v_fy || '/([0-9]+)$') THEN
            (regexp_match(invoice_number, '^SM/INV/' || v_fy || '/([0-9]+)$', 'i'))[1]::integer
          ELSE 0
        END
      ),
      0
    ) INTO v_highest_existing
    FROM invoices
    WHERE (invoice_number ~* ('^' || v_fy || '/SM/[0-9]+$') OR invoice_number ~* ('^SM/INV/' || v_fy || '/[0-9]+$'));

    -- Next sequence is GREATEST(highest existing, configured start) + 1
    v_max := GREATEST(v_highest_existing, v_configured_start);
    RETURN v_fy || '/SM/' || (v_max + 1)::text;

  ELSIF p_kind = 'estimate' THEN
    v_prefix := COALESCE(NULLIF(v_cfg->>'prefix', ''), 'SM/E');
    v_start_at := COALESCE(NULLIF(v_cfg->>'startAt', '')::integer, 101);
    IF v_fy = '26-27' THEN v_start_at := 201; END IF;
    v_fy_aware := COALESCE((v_cfg->>'fyAware')::boolean, true);
    v_pattern := '^' || regexp_replace(v_prefix, '([\\.\[\]{}()*+?^$|])', '\\\1', 'g') || CASE WHEN v_fy_aware THEN '/' || v_fy || '/([0-9]+)$' ELSE '/([0-9]+)$' END;

    SELECT COALESCE(max((regexp_match(estimate_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max 
    FROM estimates 
    WHERE estimate_number ~ v_pattern;

    RETURN CASE WHEN v_fy_aware THEN v_prefix || '/' || v_fy || '/' || (v_max + 1)::text ELSE v_prefix || '/' || (v_max + 1)::text END;

  ELSE -- 'dc'
    v_prefix := COALESCE(NULLIF(v_cfg->>'prefix', ''), 'SM/DC');
    v_start_at := COALESCE(NULLIF(v_cfg->>'startAt', '')::integer, 101);
    v_fy_aware := COALESCE((v_cfg->>'fyAware')::boolean, true);
    v_pattern := '^' || regexp_replace(v_prefix, '([\\.\[\]{}()*+?^$|])', '\\\1', 'g') || CASE WHEN v_fy_aware THEN '/' || v_fy || '/([0-9]+)$' ELSE '/([0-9]+)$' END;

    SELECT COALESCE(max((regexp_match(dc_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max 
    FROM delivery_challans 
    WHERE dc_number ~ v_pattern;

    RETURN CASE WHEN v_fy_aware THEN v_prefix || '/' || v_fy || '/' || (v_max + 1)::text ELSE v_prefix || '/' || (v_max + 1)::text END;
  END IF;
END;
$function$;

-- Update create_invoice_atomic with duplicate invoice number guard & date support
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(p_invoice jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id integer;
  v_invoice_number text;
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

  -- 1. Duplicate check: if an active invoice already exists for this estimate + store, return it idempotently
  IF v_estimate_id IS NOT NULL THEN
    IF v_store_id IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
      WHERE i.estimate_id = v_estimate_id
        AND i.store_id = v_store_id
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSIF v_store_code IS NOT NULL THEN
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
      WHERE i.estimate_id = v_estimate_id
        AND i.store_code = v_store_code
        AND i.status != 'cancelled'
      LIMIT 1;
    ELSE
      SELECT to_jsonb(i.*) INTO v_existing
      FROM invoices i
      WHERE i.estimate_id = v_estimate_id
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
    v_invoice_number := public.next_sunrise_document_number('invoice', v_invoice_date::date);
  END IF;

  -- 3. Duplicate protection: Ensure this complete invoice number is not already used anywhere in invoices
  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE LOWER(TRIM(invoice_number)) = LOWER(TRIM(v_invoice_number))
  ) THEN
    RAISE EXCEPTION 'Invoice number "%" is already in use. Please enter a unique invoice number.', v_invoice_number;
  END IF;

  -- 4. Insert invoice
  INSERT INTO invoices (
    invoice_number, type, party_name, amount, tax_amount, total_amount,
    date, due_date, status, estimate_id, client_id,
    paid_amount, balance_amount, packet_settings, remarks,
    delivery_challan_id, line_items, po_number, po_reference,
    transport_cost, store_id, store_code, store_name
  )
  VALUES (
    v_invoice_number,
    COALESCE(p_invoice->>'type', 'sales'),
    COALESCE(p_invoice->>'party_name', p_invoice->>'partyName', 'Customer'),
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
  RETURNING id INTO v_invoice_id;

  SELECT to_jsonb(i.*) INTO v_result FROM invoices i WHERE i.id = v_invoice_id;
  RETURN v_result;
END;
$function$;

-- Helper function to configure Tally sequence in app_settings
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
  SELECT value INTO v_cfg FROM app_settings WHERE key = 'numbering.invoice';
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

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('numbering.invoice', v_val, NOW())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = NOW();

  RETURN v_val;
END;
$function$;

-- Update initial configuration in app_settings if needed
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(
    COALESCE(value, '{}'::jsonb),
    '{format}',
    '"FY/SM/NUM"'::jsonb
  ),
  '{prefix}',
  '"SM"'::jsonb
)
WHERE key = 'numbering.invoice';

NOTIFY pgrst, 'reload schema';
