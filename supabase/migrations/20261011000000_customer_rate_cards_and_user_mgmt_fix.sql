-- ==============================================================================
-- SUNRISE MEDIA ERP — CUSTOMER RATE CARDS & MULTI-COMPANY USER MANAGEMENT FIX
-- Migration: 20261011000000_customer_rate_cards_and_user_mgmt_fix.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FIX CUSTOMER RATE ITEMS RLS POLICIES & CONSTRAINTS
-- ------------------------------------------------------------------------------

-- Ensure RLS is enabled on customer_rate_cards and customer_rate_items
ALTER TABLE public.customer_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_rate_items ENABLE ROW LEVEL SECURITY;

-- Clean existing policies on customer_rate_items
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_rate_items') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.customer_rate_items', p.policyname);
  END LOOP;
END $$;

-- Policies for customer_rate_items scoped via parent customer_rate_cards.company_id
CREATE POLICY rls_select_customer_rate_items ON public.customer_rate_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_rate_cards rc
      WHERE rc.id = customer_rate_items.rate_card_id
        AND public.user_has_company_access(rc.company_id)
    )
  );

CREATE POLICY rls_insert_customer_rate_items ON public.customer_rate_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_rate_cards rc
      WHERE rc.id = customer_rate_items.rate_card_id
        AND public.user_has_company_access(rc.company_id)
    )
  );

CREATE POLICY rls_update_customer_rate_items ON public.customer_rate_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_rate_cards rc
      WHERE rc.id = customer_rate_items.rate_card_id
        AND public.user_has_company_access(rc.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_rate_cards rc
      WHERE rc.id = customer_rate_items.rate_card_id
        AND public.user_has_company_access(rc.company_id)
    )
  );

CREATE POLICY rls_delete_customer_rate_items ON public.customer_rate_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_rate_cards rc
      WHERE rc.id = customer_rate_items.rate_card_id
        AND public.user_has_company_access(rc.company_id)
    )
  );

-- Table grants on customer_rate_items and customer_rate_cards
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_rate_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_rate_items TO authenticated;

-- Ensure unique index on (rate_card_id, product_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_rate_items_card_product 
  ON public.customer_rate_items (rate_card_id, product_id) 
  WHERE product_id IS NOT NULL;


-- ------------------------------------------------------------------------------
-- 2. ATOMIC IDEMPOTENT PRODUCT IMPORT RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_products_to_rate_card(p_rate_card_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_existing_count integer := 0;
  v_imported_count integer := 0;
  v_total_count integer := 0;
BEGIN
  -- Verify rate card exists
  SELECT company_id INTO v_company_id
  FROM public.customer_rate_cards
  WHERE id = p_rate_card_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Rate card with ID % not found', p_rate_card_id;
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Count existing items
  SELECT COUNT(*) INTO v_existing_count
  FROM public.customer_rate_items
  WHERE rate_card_id = p_rate_card_id;

  -- Insert active products belonging to the company not yet present in the rate card
  INSERT INTO public.customer_rate_items (
    rate_card_id,
    product_id,
    material_code_id,
    item_name,
    description,
    hsn,
    uom,
    calculation_type,
    rate,
    gst_percent,
    is_standard,
    is_active
  )
  SELECT
    p_rate_card_id,
    p.id,
    p.material_code_id,
    p.name,
    p.description,
    p.hsn_sac,
    COALESCE(p.unit, 'pcs'),
    COALESCE(p.calculation_type, 'fixed'),
    0, -- Unpriced by default for imported products
    COALESCE(p.gst_percent, 18),
    COALESCE(p.is_standard, true),
    true
  FROM public.products p
  WHERE (p.company_id = v_company_id OR p.company_id IS NULL)
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.customer_rate_items cri
      WHERE cri.rate_card_id = p_rate_card_id
        AND cri.product_id = p.id
    )
  ORDER BY p.name;

  GET DIAGNOSTICS v_imported_count = ROW_COUNT;

  v_total_count := v_existing_count + v_imported_count;

  RETURN jsonb_build_object(
    'success', true,
    'imported_count', v_imported_count,
    'existing_count', v_existing_count,
    'total_count', v_total_count,
    'message', format('Imported %s new products (%s already present).', v_imported_count, v_existing_count)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.import_products_to_rate_card(integer) TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. BATCH UPDATE RATE CARD ITEMS RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.batch_update_rate_card_items(
  p_rate_card_id integer,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_item jsonb;
  v_item_id integer;
  v_rate real;
  v_is_active boolean;
  v_updated integer := 0;
BEGIN
  -- Verify rate card exists
  SELECT company_id INTO v_company_id
  FROM public.customer_rate_cards
  WHERE id = p_rate_card_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Rate card with ID % not found', p_rate_card_id;
  END IF;

  -- Verify caller company access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- Iterate through items and update
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_id := (v_item->>'id')::integer;
    v_rate := CASE WHEN v_item ? 'rate' AND (v_item->>'rate') IS NOT NULL AND (v_item->>'rate') <> '' 
                   THEN (v_item->>'rate')::real ELSE NULL END;
    v_is_active := CASE WHEN v_item ? 'isActive' AND (v_item->>'isActive') IS NOT NULL 
                        THEN (v_item->>'isActive')::boolean ELSE NULL END;

    IF v_item_id IS NOT NULL THEN
      UPDATE public.customer_rate_items
      SET
        rate = COALESCE(v_rate, rate),
        is_active = COALESCE(v_is_active, is_active)
      WHERE id = v_item_id
        AND rate_card_id = p_rate_card_id;

      IF FOUND THEN
        v_updated := v_updated + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated,
    'message', format('Successfully updated %s rate card items.', v_updated)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.batch_update_rate_card_items(integer, jsonb) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. RESOLVE CUSTOMER RATE RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_customer_rate(
  p_client_id integer,
  p_brand_id integer DEFAULT NULL,
  p_product_id integer DEFAULT NULL,
  p_project_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_client_id IS NULL OR p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up the most specific active rate item for this client
  -- Specificity ranking:
  -- 1. (client, brand, projectType) all match -> score 3
  -- 2. (client, brand) match -> score 2
  -- 3. (client, projectType) match -> score 1
  -- 4. client matches -> score 0
  SELECT jsonb_build_object(
    'rate', cri.rate,
    'uom', cri.uom,
    'gst_percent', cri.gst_percent,
    'rate_card_id', rc.id,
    'rate_card_name', rc.name,
    'calculation_type', cri.calculation_type,
    'item_name', cri.item_name
  ) INTO v_result
  FROM public.customer_rate_items cri
  JOIN public.customer_rate_cards rc ON rc.id = cri.rate_card_id
  WHERE rc.client_id = p_client_id
    AND rc.is_active = true
    AND (rc.effective_from IS NULL OR rc.effective_from <= now())
    AND (rc.effective_to IS NULL OR rc.effective_to >= now())
    AND public.user_has_company_access(rc.company_id)
    AND cri.product_id = p_product_id
    AND cri.is_active = true
    AND cri.rate > 0
    AND (
      (p_brand_id IS NOT NULL AND rc.brand_id = p_brand_id)
      OR (rc.brand_id IS NULL)
    )
    AND (
      (p_project_type IS NOT NULL AND rc.project_type = p_project_type)
      OR (rc.project_type IS NULL)
    )
  ORDER BY
    (CASE WHEN rc.brand_id IS NOT NULL AND rc.brand_id = p_brand_id THEN 2 ELSE 0 END
     + CASE WHEN rc.project_type IS NOT NULL AND rc.project_type = p_project_type THEN 1 ELSE 0 END) DESC,
    rc.id DESC
  LIMIT 1;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_customer_rate(integer, integer, integer, text) TO authenticated;


-- ------------------------------------------------------------------------------
-- 5. FIX PUBLIC.USERS GRANTS AND RLS POLICIES (COMPANY ISOLATION)
-- ------------------------------------------------------------------------------

-- Grant SELECT, UPDATE on public.users to authenticated
GRANT SELECT, UPDATE ON TABLE public.users TO authenticated;

-- Ensure RLS is enabled on public.users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Clean existing policies on public.users
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', p.policyname);
  END LOOP;
END $$;

-- RLS: Authenticated users can select users who share at least one company membership with them,
-- or their own user record, or if they are super admin.
CREATE POLICY rls_select_users ON public.users
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR id = public.get_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.company_users my_cu
      JOIN public.company_users their_cu ON my_cu.company_id = their_cu.company_id
      WHERE my_cu.user_id = public.get_current_user_id()
        AND their_cu.user_id = public.users.id
    )
  );

-- RLS: Authenticated users can update their own record,
-- or super_admin / company_admin can update users in their company.
CREATE POLICY rls_update_users ON public.users
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR id = public.get_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.company_users admin_cu
      JOIN public.company_users target_cu ON admin_cu.company_id = target_cu.company_id
      WHERE admin_cu.user_id = public.get_current_user_id()
        AND admin_cu.role IN ('super_admin', 'company_admin')
        AND target_cu.user_id = public.users.id
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR id = public.get_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.company_users admin_cu
      JOIN public.company_users target_cu ON admin_cu.company_id = target_cu.company_id
      WHERE admin_cu.user_id = public.get_current_user_id()
        AND admin_cu.role IN ('super_admin', 'company_admin')
        AND target_cu.user_id = public.users.id
    )
  );

-- Super admin may delete
CREATE POLICY rls_delete_users ON public.users
  FOR DELETE TO authenticated
  USING (public.is_super_admin());


-- ------------------------------------------------------------------------------
-- 6. SECURE ADMINISTRATIVE USER CREATION RPC (ZERO EMAILS, ATOMIC)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_user(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id integer;
  v_is_super boolean;
  v_username text;
  v_email text;
  v_password text;
  v_name text;
  v_role text;
  v_phone text;
  v_department text;
  v_designation text;
  v_employee_id text;
  v_is_active boolean;
  v_company_id integer;
  v_company_role text;
  v_auth_user_id uuid;
  v_new_user_id integer;
  v_existing_user_id integer;
  v_existing_auth_id uuid;
BEGIN
  -- 1. Identify and verify caller
  v_caller_id := public.get_current_user_id();
  v_is_super := public.is_super_admin();

  -- Extract payload fields
  v_username := TRIM(payload->>'username');
  v_email := LOWER(TRIM(payload->>'email'));
  v_password := payload->>'password';
  v_name := TRIM(payload->>'name');
  v_role := COALESCE(NULLIF(TRIM(payload->>'role'), ''), 'staff');
  v_phone := NULLIF(TRIM(payload->>'phone'), '');
  v_department := NULLIF(TRIM(payload->>'department'), '');
  v_designation := NULLIF(TRIM(payload->>'designation'), '');
  v_employee_id := NULLIF(TRIM(payload->>'employeeId'), '');
  v_is_active := COALESCE((payload->>'isActive')::boolean, true);
  v_company_id := (payload->>'companyId')::integer;
  v_company_role := COALESCE(NULLIF(TRIM(payload->>'companyRole'), ''), 'company_user');

  -- Fallback companyId to caller's default company or 1
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

  -- 2. Authorization check
  IF NOT v_is_super THEN
    -- If not super admin, caller must be company_admin for the target company
    IF NOT EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = v_caller_id
        AND company_id = v_company_id
        AND role IN ('super_admin', 'company_admin')
    ) THEN
      RAISE EXCEPTION 'Access denied: Only administrators can create users for company %', v_company_id
        USING ERRCODE = '42501';
    END IF;

    -- Non-super-admins cannot create super_admins
    IF v_company_role = 'super_admin' THEN
      v_company_role := 'company_user';
    END IF;
  END IF;

  -- 3. Input validation
  IF v_username IS NULL OR v_username = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF v_password IS NULL OR LENGTH(v_password) < 4 THEN
    RAISE EXCEPTION 'Password must be at least 4 characters long';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  -- 4. Check for duplicates in public.users
  SELECT id INTO v_existing_user_id
  FROM public.users
  WHERE LOWER(username) = LOWER(v_username);
  IF v_existing_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Username "%" is already taken', v_username;
  END IF;

  SELECT id INTO v_existing_user_id
  FROM public.users
  WHERE LOWER(email) = v_email;
  IF v_existing_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Email "%" is already registered', v_email;
  END IF;

  IF v_employee_id IS NOT NULL THEN
    SELECT id INTO v_existing_user_id
    FROM public.users
    WHERE employee_id = v_employee_id;
    IF v_existing_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Employee ID "%" is already in use', v_employee_id;
    END IF;
  END IF;

  -- 5. Create or locate auth identity in auth.users (ZERO emails triggered)
  SELECT id INTO v_existing_auth_id
  FROM auth.users
  WHERE LOWER(email) = v_email;

  IF v_existing_auth_id IS NOT NULL THEN
    v_auth_user_id := v_existing_auth_id;
    -- Update password in auth.users
    UPDATE auth.users
    SET
      encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
      updated_at = now()
    WHERE id = v_auth_user_id;
  ELSE
    v_auth_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_auth_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), -- Pre-confirmed: absolutely zero confirmation emails sent!
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'username', v_username, 'role', v_role),
      now(),
      now()
    );

    -- Insert into auth.identities (note: email is a generated column from identity_data)
    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_auth_user_id,
      v_auth_user_id::text,
      jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email, 'name', v_name, 'username', v_username),
      'email',
      now(),
      now(),
      now()
    );
  END IF;

  -- 6. Insert profile into public.users
  INSERT INTO public.users (
    username,
    email,
    password,
    name,
    role,
    phone,
    department,
    designation,
    employee_id,
    is_active,
    auth_user_id,
    created_at
  ) VALUES (
    v_username,
    v_email,
    'SUPABASE_MANAGED',
    v_name,
    v_role,
    v_phone,
    v_department,
    v_designation,
    v_employee_id,
    v_is_active,
    v_auth_user_id,
    now()
  ) RETURNING id INTO v_new_user_id;

  -- 7. Insert membership in public.company_users
  INSERT INTO public.company_users (
    user_id,
    company_id,
    role,
    is_default,
    created_at
  ) VALUES (
    v_new_user_id,
    v_company_id,
    v_company_role,
    true,
    now()
  )
  ON CONFLICT (user_id, company_id) 
  DO UPDATE SET role = EXCLUDED.role;

  -- Return complete created user and membership details
  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_new_user_id,
      'username', v_username,
      'email', v_email,
      'name', v_name,
      'role', v_role,
      'phone', v_phone,
      'department', v_department,
      'designation', v_designation,
      'employeeId', v_employee_id,
      'isActive', v_is_active,
      'authUserId', v_auth_user_id
    ),
    'membership', jsonb_build_object(
      'companyId', v_company_id,
      'role', v_company_role
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(jsonb) TO authenticated;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
