-- Migration: Fix invoice party_name mapping and backfill existing store-wise invoices
-- Ensures invoices created with missing party_name or 'Customer' resolve legal customer name from estimate / client

-- 1. Safely update existing invoices where party_name is 'Customer' or blank
UPDATE invoices i
SET party_name = COALESCE(
  NULLIF(TRIM(e.billing_legal_name_snapshot), ''),
  NULLIF(TRIM(c.name), '')
)
FROM estimates e
LEFT JOIN clients c ON e.client_id = c.id
WHERE i.estimate_id = e.id
  AND (i.party_name = 'Customer' OR i.party_name IS NULL OR i.party_name = '')
  AND COALESCE(NULLIF(TRIM(e.billing_legal_name_snapshot), ''), NULLIF(TRIM(c.name), '')) IS NOT NULL;

-- 2. Also update any remaining 'Customer' invoices by client_id if estimate was not linked
UPDATE invoices i
SET party_name = c.name
FROM clients c
WHERE i.client_id = c.id
  AND (i.party_name = 'Customer' OR i.party_name IS NULL OR i.party_name = '')
  AND c.name IS NOT NULL;

-- 3. Update create_invoice_atomic RPC so future invoices automatically resolve party_name
CREATE OR REPLACE FUNCTION public.create_invoice_atomic(p_invoice jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
