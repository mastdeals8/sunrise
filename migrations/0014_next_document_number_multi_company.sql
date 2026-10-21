-- ==============================================================================
-- MIGRATION: 0014_next_document_number_multi_company.sql
-- STATUS: UNAPPLIED (Authoring & Review Only - DO NOT RUN IN PRODUCTION TONIGHT)
-- PURPOSE: 
--   1. Drop legacy 2-argument overload next_sunrise_document_number(text, date)
--      which unconditionally hardcodes 'SM' prefix and ignores company scope.
--   2. Enhance 3-argument next_sunrise_document_number(text, date, integer)
--      with company-isolated advisory locks and company prefix resolution:
--      - Company 1 (Sunrise Media Pune): SM (Invoice), SM/E (Estimate), SM/DC (DC)
--      - Company 2 (Delhi Company): DEL (Invoice), DEL/E (Estimate), DEL/DC (DC)
--      - Company 3 (Rika Store): RIKA (Invoice), RIKA/E (Estimate), RIKA/DC (DC)
-- ==============================================================================

-- 1. DROP THE AMBIGUOUS LEGACY 2-ARGUMENT OVERLOAD
-- This prevents any code from omitting company_id and silently defaulting to SM.
DROP FUNCTION IF EXISTS public.next_sunrise_document_number(text, date);

-- 2. HARDEN THE 3-ARGUMENT FUNCTION WITH COMPANY-ISOLATED ADVISORY LOCKING
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
  v_num_cfg jsonb;
BEGIN
  -- Strict requirement: company_id must not be null
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is mandatory for document numbering' USING ERRCODE = '23502';
  END IF;

  -- Verify caller has company access (RLS/membership check)
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Load company record
  SELECT * INTO v_company FROM public.companies WHERE id = v_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company with id % not found', v_company_id USING ERRCODE = 'P0002';
  END IF;

  -- Calculate Indian Financial Year label (e.g., "26-27" for Apr 2026 - Mar 2027)
  IF EXTRACT(MONTH FROM p_date) < 4 THEN
    v_year := EXTRACT(YEAR FROM p_date)::integer - 1;
  ELSE
    v_year := EXTRACT(YEAR FROM p_date)::integer;
  END IF;
  v_fy := LPAD((v_year % 100)::text, 2, '0') || '-' || LPAD(((v_year + 1) % 100)::text, 2, '0');

  -- Concurrency Guard: Company-specific advisory lock serialized per document kind and FY.
  -- This ensures Company 1, 2, and 3 never lock each other, but concurrent inserts within
  -- the same company are strictly serialized.
  PERFORM pg_advisory_xact_lock(hashtext('sunrise-doc:' || p_kind || ':' || v_company_id || ':' || v_fy));

  -- --------------------------------------------------------------------------
  -- INVOICE NUMBERING
  -- Format: <FY>/<PREFIX>/<3-DIGIT-SEQ> (e.g. 26-27/SM/171, 26-27/DEL/001, 26-27/RIKA/001)
  -- --------------------------------------------------------------------------
  IF p_kind = 'invoice' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.invoice_prefix), ''), CASE WHEN v_company_id = 1 THEN 'SM' ELSE 'INV' END);
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

  -- --------------------------------------------------------------------------
  -- ESTIMATE NUMBERING
  -- Format: <PREFIX>/<FY>/<3-DIGIT-SEQ> (e.g. SM/E/26-27/265, DEL/E/26-27/001, RIKA/E/26-27/001)
  -- --------------------------------------------------------------------------
  ELSIF p_kind = 'estimate' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.estimate_prefix), ''), CASE WHEN v_company_id = 1 THEN 'SM/E' ELSE 'EST' END);
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

  -- --------------------------------------------------------------------------
  -- DELIVERY CHALLAN (DC) NUMBERING
  -- Format: <PREFIX>/<FY>/<3-DIGIT-SEQ> (e.g. SM/DC/26-27/102, DEL/DC/26-27/001, RIKA/DC/26-27/001)
  -- --------------------------------------------------------------------------
  ELSIF p_kind = 'dc' THEN
    v_prefix := COALESCE(NULLIF(TRIM(v_company.dc_prefix), ''), CASE WHEN v_company_id = 1 THEN 'SM/DC' ELSE 'DC' END);
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

-- 3. PERMISSIONS
GRANT EXECUTE ON FUNCTION public.next_sunrise_document_number(text, date, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.next_sunrise_document_number(text, date, integer) IS 
  'Generates concurrency-safe, company-scoped document numbers for invoices, estimates, and delivery challans with isolated advisory locks per company and financial year.';
