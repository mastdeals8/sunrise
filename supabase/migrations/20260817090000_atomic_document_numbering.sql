-- Serialize Sunrise document-number allocation without introducing another
-- numbering table. The function reads the established app_settings convention
-- and the existing document tables under an advisory transaction lock.
CREATE OR REPLACE FUNCTION public.next_sunrise_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy text;
  v_prefix text;
  v_start_at integer;
  v_fy_aware boolean;
  v_cfg jsonb;
  v_pattern text;
  v_max integer;
BEGIN
  IF p_kind NOT IN ('invoice', 'estimate', 'dc') THEN
    RAISE EXCEPTION 'Unsupported document kind: %', p_kind;
  END IF;

  v_fy := to_char(CASE WHEN extract(month FROM current_date) < 4
    THEN current_date - interval '1 year' ELSE current_date END, 'YY')
    || '-' || to_char(CASE WHEN extract(month FROM current_date) < 4
    THEN current_date ELSE current_date + interval '1 year' END, 'YY');
  PERFORM pg_advisory_xact_lock(hashtext('sunrise-document-number:' || p_kind || ':' || v_fy));

  SELECT value INTO v_cfg FROM app_settings WHERE key = 'numbering.' || p_kind;
  v_prefix := COALESCE(NULLIF(v_cfg->>'prefix', ''), CASE p_kind WHEN 'invoice' THEN 'SM/INV' WHEN 'estimate' THEN 'SM/E' ELSE 'SM/DC' END);
  v_start_at := COALESCE(NULLIF(v_cfg->>'startAt', '')::integer, 101);
  IF p_kind = 'estimate' AND v_fy = '26-27' THEN v_start_at := 201; END IF;
  v_fy_aware := COALESCE((v_cfg->>'fyAware')::boolean, true);
  v_pattern := '^' || regexp_replace(v_prefix, '([\\.\[\]{}()*+?^$|])', '\\\1', 'g') || CASE WHEN v_fy_aware THEN '/' || v_fy || '/([0-9]+)$' ELSE '/([0-9]+)$' END;

  IF p_kind = 'invoice' THEN
    SELECT COALESCE(max((regexp_match(invoice_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max FROM invoices WHERE invoice_number ~ v_pattern;
  ELSIF p_kind = 'estimate' THEN
    SELECT COALESCE(max((regexp_match(estimate_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max FROM estimates WHERE estimate_number ~ v_pattern;
  ELSE
    SELECT COALESCE(max((regexp_match(dc_number, v_pattern))[1]::integer), v_start_at - 1) INTO v_max FROM delivery_challans WHERE dc_number ~ v_pattern;
  END IF;

  RETURN CASE WHEN v_fy_aware THEN v_prefix || '/' || v_fy || '/' || (v_max + 1)::text ELSE v_prefix || '/' || (v_max + 1)::text END;
END;
$$;

REVOKE ALL ON FUNCTION public.next_sunrise_document_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sunrise_document_number(text) TO service_role;
