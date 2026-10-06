-- Migration: 20261007001000_create_invoice_atomic_rpc.sql
-- Description: Provide atomic create_invoice_atomic RPC with store-specific duplicate protection.

CREATE OR REPLACE FUNCTION public.create_invoice_atomic(
  p_invoice jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id integer;
  v_invoice_number text;
  v_estimate_id integer;
  v_client_id integer;
  v_store_id integer;
  v_store_code text;
  v_store_name text;
  v_existing jsonb;
  v_result jsonb;
BEGIN
  v_estimate_id := COALESCE((p_invoice->>'estimate_id')::integer, (p_invoice->>'estimateId')::integer);
  v_client_id := COALESCE((p_invoice->>'client_id')::integer, (p_invoice->>'clientId')::integer);
  v_store_id := COALESCE((p_invoice->>'store_id')::integer, (p_invoice->>'storeId')::integer);
  v_store_code := NULLIF(TRIM(COALESCE(p_invoice->>'store_code', p_invoice->>'storeCode', '')), '');
  v_store_name := NULLIF(TRIM(COALESCE(p_invoice->>'store_name', p_invoice->>'storeName', '')), '');

  -- 1. Duplicate check: if an active invoice already exists for this estimate + store, return it
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
  v_invoice_number := COALESCE(
    NULLIF(p_invoice->>'invoice_number', ''),
    NULLIF(p_invoice->>'invoiceNumber', '')
  );
  IF v_invoice_number IS NULL OR v_invoice_number LIKE 'INV-%' OR v_invoice_number = '' THEN
    v_invoice_number := public.next_sunrise_document_number('invoice');
  END IF;

  -- 3. Insert invoice
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
    COALESCE((p_invoice->>'date')::timestamp, NOW()),
    COALESCE((p_invoice->>'due_date')::timestamp, (p_invoice->>'dueDate')::timestamp, NOW() + interval '30 days'),
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
$$;

REVOKE ALL ON FUNCTION public.create_invoice_atomic(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(jsonb) TO authenticated, service_role;
