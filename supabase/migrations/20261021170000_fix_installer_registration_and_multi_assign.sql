-- ==============================================================================
-- SUNRISE MEDIA ERP — SECURE INSTALLER REGISTRATION & CONTACT MANAGEMENT FIX
-- Migration: 20261021170000_fix_installer_registration_and_multi_assign.sql
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_upsert_installer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_caller_id integer;
  v_is_super boolean;
  v_company_id integer;
  v_id integer;
  v_name text;
  v_phone text;
  v_clean_phone text;
  v_whatsapp_phone text;
  v_clean_wa_phone text;
  v_role text;
  v_notes text;
  v_is_active boolean;
  v_existing_id integer;
  v_new_user_id integer;
  v_username text;
  v_email text;
  v_password text;
BEGIN
  -- 1. Identify caller
  v_caller_id := public.get_current_user_id();
  v_is_super := public.is_super_admin();

  -- Extract parameters
  v_id := (payload->>'id')::integer;
  v_name := TRIM(COALESCE(payload->>'name', ''));
  v_phone := TRIM(COALESCE(payload->>'phone', ''));
  v_whatsapp_phone := TRIM(COALESCE(payload->>'whatsappPhone', payload->>'whatsapp_phone', ''));
  v_role := COALESCE(NULLIF(TRIM(payload->>'role'), ''), 'installer');
  v_notes := NULLIF(TRIM(COALESCE(payload->>'notes', '')), '');
  v_is_active := COALESCE((payload->>'isActive')::boolean, (payload->>'is_active')::boolean, true);
  v_company_id := (payload->>'companyId')::integer;

  IF v_company_id IS NULL THEN
    v_company_id := (payload->>'company_id')::integer;
  END IF;

  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.company_users
    WHERE user_id = v_caller_id
    ORDER BY is_default DESC, id ASC
    LIMIT 1;
    IF v_company_id IS NULL THEN
      v_company_id := 1;
    END IF;
  END IF;

  -- 2. Authorization check: caller must be admin/manager or super_admin
  IF NOT v_is_super THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = v_caller_id
        AND company_id = v_company_id
        AND role IN ('super_admin', 'company_admin', 'admin', 'manager')
    ) AND NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = v_caller_id AND role IN ('admin', 'manager')
    ) THEN
      RAISE EXCEPTION 'Access denied: Only administrators or managers can register contacts for company %', v_company_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Validation
  IF v_name = '' THEN
    RAISE EXCEPTION 'Contact name is required';
  END IF;

  -- Sanitize phone
  v_clean_phone := REGEXP_REPLACE(v_phone, '[^0-9]', '', 'g');
  IF LENGTH(v_clean_phone) < 10 THEN
    RAISE EXCEPTION 'A valid 10-digit mobile number is required';
  END IF;
  v_clean_phone := RIGHT(v_clean_phone, 10);
  v_phone := '+91' || v_clean_phone;

  IF v_whatsapp_phone <> '' THEN
    v_clean_wa_phone := RIGHT(REGEXP_REPLACE(v_whatsapp_phone, '[^0-9]', '', 'g'), 10);
    IF LENGTH(v_clean_wa_phone) = 10 THEN
      v_whatsapp_phone := '+91' || v_clean_wa_phone;
    ELSE
      v_whatsapp_phone := v_phone;
    END IF;
  ELSE
    v_whatsapp_phone := v_phone;
  END IF;

  -- 4. Duplicate phone check within company
  SELECT u.id INTO v_existing_id
  FROM public.users u
  JOIN public.company_users cu ON cu.user_id = u.id
  WHERE cu.company_id = v_company_id
    AND RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 10) = v_clean_phone
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Updating existing contact
    IF v_existing_id IS NOT NULL AND v_existing_id <> v_id THEN
      RAISE EXCEPTION 'Another contact in this company already has phone number %', v_phone;
    END IF;

    UPDATE public.users
    SET
      name = v_name,
      phone = v_phone,
      whatsapp_phone = v_whatsapp_phone,
      role = v_role,
      notes = v_notes,
      is_active = v_is_active,
      updated_at = now()
    WHERE id = v_id;

    v_new_user_id := v_id;
  ELSE
    -- Creating new contact
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'A contact with phone number % already exists in this company', v_phone;
    END IF;

    v_username := 'installer_' || v_clean_phone || '_' || SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6);
    v_email := v_username || '@sunrisemedia.local';
    v_password := 'installer_temp_pass';

    INSERT INTO public.users (
      username,
      email,
      password,
      name,
      phone,
      whatsapp_phone,
      role,
      notes,
      is_active,
      created_at
    ) VALUES (
      v_username,
      v_email,
      v_password,
      v_name,
      v_phone,
      v_whatsapp_phone,
      v_role,
      v_notes,
      v_is_active,
      now()
    ) RETURNING id INTO v_new_user_id;

    INSERT INTO public.company_users (
      user_id,
      company_id,
      role,
      is_default,
      created_at
    ) VALUES (
      v_new_user_id,
      v_company_id,
      'company_user',
      true,
      now()
    )
    ON CONFLICT (user_id, company_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_new_user_id,
      'name', v_name,
      'phone', v_phone,
      'whatsappPhone', v_whatsapp_phone,
      'role', v_role,
      'isActive', v_is_active,
      'notes', v_notes,
      'companyId', v_company_id
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_installer(jsonb) TO authenticated;
