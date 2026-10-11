-- ==============================================================================
-- SUNRISE MEDIA ERP — REPAIR SUPABASE AUTHENTICATION, LOGIN & WORKSPACE ISOLATION
-- Migration: 20261011130000_fix_auth_login_and_workspace_isolation.sql
-- ==============================================================================

-- 1. Ensure user 1 (Kunal / admin) is linked to the primary active admin Auth account
UPDATE public.users
SET auth_user_id = '374a43ce-8db5-4347-8d3c-87ae5e42204d'
WHERE id = 1;

-- 2. Repair any NULL token fields in auth.users that cause Supabase GoTrue to return HTTP 500
UPDATE auth.users
SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change = COALESCE(email_change, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  is_super_admin = COALESCE(is_super_admin, false)
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change_token_new IS NULL
   OR email_change IS NULL
   OR reauthentication_token IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR email_change_token_current IS NULL
   OR is_super_admin IS NULL;

-- 3. Update admin_create_user to ensure all created users have complete GoTrue fields
CREATE OR REPLACE FUNCTION public.admin_create_user(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
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
  -- 1. Identify caller
  v_caller_id := public.get_current_user_id();
  v_is_super := public.is_super_admin();

  -- Extract and sanitize inputs
  v_username := LOWER(TRIM(payload->>'username'));
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
  WHERE LOWER(username) = v_username;
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
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      reauthentication_token = COALESCE(reauthentication_token, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      is_super_admin = COALESCE(is_super_admin, false),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
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
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      reauthentication_token,
      phone_change,
      phone_change_token,
      email_change_token_current,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_auth_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), -- Pre-confirmed: zero emails triggered!
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'username', v_username, 'role', v_role),
      false,
      now(),
      now()
    );

    -- Insert into auth.identities
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
      jsonb_build_object(
        'sub', v_auth_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false,
        'name', v_name,
        'username', v_username
      ),
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
  DO UPDATE SET
    role = EXCLUDED.role,
    is_default = EXCLUDED.is_default;

  -- 8. Return created user payload
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


-- ------------------------------------------------------------------------------
-- 4. SECURE VERIFY & RESOLVE LOGIN RPC
-- Resolves username or email to auth email ONLY IF the password matches!
-- Never leaks email or account details on invalid credentials.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_and_resolve_login(
  p_identifier text,
  p_password text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  v_norm_ident text;
  v_auth_record record;
  v_user_record record;
BEGIN
  IF p_identifier IS NULL OR TRIM(p_identifier) = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN NULL;
  END IF;

  v_norm_ident := LOWER(TRIM(p_identifier));

  -- 1. Locate application user by username or email
  SELECT u.id, u.auth_user_id, u.email, u.is_active
  INTO v_user_record
  FROM public.users u
  WHERE LOWER(TRIM(u.username)) = v_norm_ident
     OR LOWER(TRIM(u.email)) = v_norm_ident
  ORDER BY (CASE WHEN LOWER(TRIM(u.username)) = v_norm_ident THEN 1 ELSE 2 END)
  LIMIT 1;

  IF v_user_record.id IS NOT NULL THEN
    -- Inactive application users cannot log in
    IF v_user_record.is_active IS FALSE THEN
      RETURN NULL;
    END IF;

    -- Retrieve linked auth record
    SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
    INTO v_auth_record
    FROM auth.users au
    WHERE au.id = v_user_record.auth_user_id
    LIMIT 1;

    -- Fallback by email if auth_user_id was not yet matched
    IF v_auth_record.id IS NULL AND v_user_record.email IS NOT NULL THEN
      SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
      INTO v_auth_record
      FROM auth.users au
      WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(v_user_record.email))
      LIMIT 1;
    END IF;
  ELSE
    -- Direct match by auth email if user profile does not exist
    SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
    INTO v_auth_record
    FROM auth.users au
    WHERE LOWER(TRIM(au.email)) = v_norm_ident
    LIMIT 1;
  END IF;

  -- If no auth record exists, return NULL (do not leak user existence)
  IF v_auth_record.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Disallow banned or deleted accounts
  IF v_auth_record.banned_until IS NOT NULL AND v_auth_record.banned_until > now() THEN
    RETURN NULL;
  END IF;
  IF v_auth_record.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Verify password cryptographically
  IF v_auth_record.encrypted_password IS NULL THEN
    RETURN NULL;
  END IF;

  IF extensions.crypt(p_password, v_auth_record.encrypted_password) <> v_auth_record.encrypted_password THEN
    RETURN NULL;
  END IF;

  -- 3. Password verified! Return the verified auth email for official Supabase session creation
  RETURN v_auth_record.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_and_resolve_login(text, text) TO anon, authenticated;


-- ------------------------------------------------------------------------------
-- 5. ATOMIC USER PROFILE & MEMBERSHIPS RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_current_user_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_uid integer;
  v_user record;
  v_memberships jsonb;
  v_is_super boolean;
  v_default_company_id integer;
BEGIN
  v_uid := public.get_current_user_id();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, username, name, email, role, phone, department, designation, employee_id, is_active
  INTO v_user
  FROM public.users
  WHERE id = v_uid;

  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_super := public.is_super_admin();

  -- Get authorized memberships
  SELECT jsonb_agg(
    jsonb_build_object(
      'companyId', cu.company_id,
      'companyName', c.name,
      'role', cu.role,
      'isDefault', cu.is_default
    ) ORDER BY cu.is_default DESC, cu.id ASC
  ) INTO v_memberships
  FROM public.company_users cu
  JOIN public.companies c ON c.id = cu.company_id
  WHERE cu.user_id = v_uid;

  -- Default company ID
  SELECT cu.company_id INTO v_default_company_id
  FROM public.company_users cu
  WHERE cu.user_id = v_uid
  ORDER BY cu.is_default DESC, cu.id ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'username', v_user.username,
    'name', v_user.name,
    'email', v_user.email,
    'role', v_user.role,
    'phone', v_user.phone,
    'department', v_user.department,
    'designation', v_user.designation,
    'employeeId', v_user.employee_id,
    'isActive', v_user.is_active,
    'isSuperAdmin', v_is_super,
    'activeCompanyId', COALESCE(v_default_company_id, 1),
    'memberships', COALESCE(v_memberships, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. REPAIR is_super_admin TO DISTINGUISH PostgREST AUTHENTICATED USERS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_uid integer;
  v_jwt_role text;
BEGIN
  -- If invoked with service_role JWT
  v_jwt_role := auth.jwt() ->> 'role';
  IF v_jwt_role = 'service_role' THEN
    RETURN true;
  END IF;

  -- If invoked in direct database connection outside PostgREST (no JWT present)
  IF auth.jwt() IS NULL AND auth.uid() IS NULL THEN
    RETURN true;
  END IF;

  v_uid := public.get_current_user_id();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- User 1 is always super_admin
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

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';

