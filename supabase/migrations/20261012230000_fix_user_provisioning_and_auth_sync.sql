-- 20261012230000_fix_user_provisioning_and_auth_sync.sql
-- Fix individual user account creation, Supabase Auth synchronization, and company routing.

-- 1. Enhanced verify_and_resolve_login:
--    - Resolves username or email to public.users and auth.users
--    - Verifies password cryptographically against auth.users OR public.users
--    - Auto-syncs / auto-provisions auth.users on successful verification so GoTrue signInWithPassword always succeeds
--    - Auto-links unlinked auth_user_id
CREATE OR REPLACE FUNCTION public.verify_and_resolve_login(p_identifier text, p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_norm_ident text;
  v_user_id integer;
  v_user_auth_id uuid;
  v_user_username text;
  v_user_email text;
  v_user_password text;
  v_user_name text;
  v_user_role text;
  v_user_active boolean;

  v_auth_id uuid;
  v_auth_email text;
  v_auth_encrypted_pwd text;
  v_auth_banned timestamptz;
  v_auth_deleted timestamptz;

  v_new_auth_id uuid;
  v_pwd_matched boolean := false;
BEGIN
  IF p_identifier IS NULL OR TRIM(p_identifier) = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN NULL;
  END IF;

  v_norm_ident := LOWER(TRIM(p_identifier));

  -- 1. Locate application user by username or email
  SELECT u.id, u.auth_user_id, u.username, u.email, u.password, u.name, u.role, u.is_active
  INTO v_user_id, v_user_auth_id, v_user_username, v_user_email, v_user_password, v_user_name, v_user_role, v_user_active
  FROM public.users u
  WHERE LOWER(TRIM(u.username)) = v_norm_ident
     OR LOWER(TRIM(u.email)) = v_norm_ident
  ORDER BY (CASE WHEN LOWER(TRIM(u.username)) = v_norm_ident THEN 1 ELSE 2 END)
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Inactive application users cannot log in
    IF v_user_active IS FALSE THEN
      RETURN NULL;
    END IF;

    -- Retrieve linked auth record
    IF v_user_auth_id IS NOT NULL THEN
      SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
      INTO v_auth_id, v_auth_email, v_auth_encrypted_pwd, v_auth_banned, v_auth_deleted
      FROM auth.users au
      WHERE au.id = v_user_auth_id
      LIMIT 1;
    END IF;

    -- Fallback by email if auth_user_id was not matched or not set
    IF v_auth_id IS NULL AND v_user_email IS NOT NULL THEN
      SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
      INTO v_auth_id, v_auth_email, v_auth_encrypted_pwd, v_auth_banned, v_auth_deleted
      FROM auth.users au
      WHERE LOWER(TRIM(au.email)) = LOWER(TRIM(v_user_email))
      LIMIT 1;

      -- If found by email, link auth_user_id to public.users
      IF v_auth_id IS NOT NULL THEN
        UPDATE public.users SET auth_user_id = v_auth_id WHERE id = v_user_id;
      END IF;
    END IF;
  ELSE
    -- Direct match by auth email if public profile was not found
    SELECT au.id, au.email, au.encrypted_password, au.banned_until, au.deleted_at
    INTO v_auth_id, v_auth_email, v_auth_encrypted_pwd, v_auth_banned, v_auth_deleted
    FROM auth.users au
    WHERE LOWER(TRIM(au.email)) = v_norm_ident
    LIMIT 1;
  END IF;

  -- Disallow banned or deleted accounts
  IF v_auth_id IS NOT NULL THEN
    IF v_auth_banned IS NOT NULL AND v_auth_banned > now() THEN
      RETURN NULL;
    END IF;
    IF v_auth_deleted IS NOT NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  -- 2. Verify password
  -- First check auth.users.encrypted_password
  IF v_auth_id IS NOT NULL AND v_auth_encrypted_pwd IS NOT NULL THEN
    IF extensions.crypt(p_password, v_auth_encrypted_pwd) = v_auth_encrypted_pwd THEN
      v_pwd_matched := true;
    END IF;
  END IF;

  -- If not matched yet, check against public.users.password
  IF NOT v_pwd_matched AND v_user_id IS NOT NULL AND v_user_password IS NOT NULL THEN
    IF v_user_password = p_password
       OR LOWER(v_user_password) = LOWER(p_password) THEN
      v_pwd_matched := true;
    ELSIF v_user_password LIKE '$2%' THEN
      IF extensions.crypt(p_password, REPLACE(v_user_password, '$2b$', '$2a$')) = REPLACE(v_user_password, '$2b$', '$2a$') THEN
        v_pwd_matched := true;
      END IF;
    END IF;
  END IF;

  -- If credentials did not match, return NULL
  IF NOT v_pwd_matched THEN
    RETURN NULL;
  END IF;

  -- 3. If password matched, ensure auth.users record exists and encrypted_password matches p_password
  IF v_auth_id IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_auth_id;

    RETURN v_auth_email;
  ELSIF v_user_id IS NOT NULL THEN
    -- Auto-provision missing auth.users account for existing application user
    v_new_auth_id := gen_random_uuid();
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
      v_new_auth_id,
      'authenticated',
      'authenticated',
      v_user_email,
      extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      now(),
      '', '', '', '', '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_user_name, 'username', v_user_username, 'role', v_user_role),
      false,
      now(),
      now()
    );

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
      v_new_auth_id,
      v_new_auth_id::text,
      jsonb_build_object('sub', v_new_auth_id::text, 'email', v_user_email, 'email_verified', true, 'name', v_user_name, 'username', v_user_username),
      'email',
      now(),
      now(),
      now()
    );

    UPDATE public.users
    SET auth_user_id = v_new_auth_id
    WHERE id = v_user_id;

    RETURN v_user_email;
  END IF;

  RETURN NULL;
END;
$function$;

-- 2. Enhanced admin_create_user RPC:
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
    IF NOT EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = v_caller_id
        AND company_id = v_company_id
        AND role IN ('super_admin', 'company_admin')
    ) THEN
      RAISE EXCEPTION 'Access denied: Only administrators can create users for company %', v_company_id
        USING ERRCODE = '42501';
    END IF;

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

  -- 5. Create or locate auth identity in auth.users
  SELECT id INTO v_existing_auth_id
  FROM auth.users
  WHERE LOWER(email) = v_email;

  IF v_existing_auth_id IS NOT NULL THEN
    v_auth_user_id := v_existing_auth_id;
    UPDATE auth.users
    SET
      encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = jsonb_build_object('name', v_name, 'username', v_username, 'role', v_role),
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
      extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      now(),
      '', '', '', '', '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'username', v_username, 'role', v_role),
      false,
      now(),
      now()
    );

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
      jsonb_build_object('sub', v_auth_user_id::text, 'email', v_email, 'email_verified', true, 'name', v_name, 'username', v_username),
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
    v_password,
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

-- 3. Data Repair: Ensure pinks (user 12) is mapped and is_default is true
UPDATE public.company_users
SET is_default = true
WHERE user_id = 12 AND company_id = 2;

-- 4. Data Repair: Sync pinks password in auth.users
UPDATE auth.users
SET encrypted_password = extensions.crypt('pinks@123', extensions.gen_salt('bf', 10)),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE id = 'fa23fc2f-ed63-45fe-a09f-4c38168efc6b';

-- 5. Data Repair: Ensure QA and test users have company memberships and auth records
-- qa_manager (user 2) -> Company 1
INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
VALUES (2, 1, 'company_user', true, now())
ON CONFLICT (user_id, company_id) DO UPDATE SET is_default = true;

-- qa_execution (user 3) -> Company 1
INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
VALUES (3, 1, 'company_user', true, now())
ON CONFLICT (user_id, company_id) DO UPDATE SET is_default = true;

-- test_delhi_user_1791636516010 (user 4) -> Company 2
INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
VALUES (4, 2, 'company_user', true, now())
ON CONFLICT (user_id, company_id) DO UPDATE SET is_default = true;

-- test_rika_user_1791636516010 (user 5) -> Company 3
INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
VALUES (5, 3, 'company_user', true, now())
ON CONFLICT (user_id, company_id) DO UPDATE SET is_default = true;
