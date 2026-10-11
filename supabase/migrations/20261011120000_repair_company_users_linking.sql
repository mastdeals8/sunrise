-- ==============================================================================
-- SUNRISE MEDIA ERP — REPAIR COMPANY WORKSPACE USER LINKING & RPC
-- Migration: 20261011120000_repair_company_users_linking.sql
-- ==============================================================================

-- 1. Sync auth_user_id for admin user kunal@sunrisemedia.in
UPDATE public.users
SET auth_user_id = '68caa5ab-a1ac-4f98-8e5e-05a21267eaef'
WHERE id = 1 AND email = 'kunal@sunrisemedia.in'
  AND (auth_user_id IS NULL OR auth_user_id = '374a43ce-8db5-4347-8d3c-87ae5e42204d');

-- 2. Clean and repair RLS policies on public.company_users
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'company_users') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.company_users', p.policyname);
  END LOOP;
END $$;

-- SELECT policy: Super admin, the user themselves, or members of the company
CREATE POLICY rls_select_company_users ON public.company_users
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR user_id = public.get_current_user_id()
    OR public.user_has_company_access(company_id)
  );

-- INSERT policy: Super admin, or company_admin for the target company (cannot grant super_admin)
CREATE POLICY rls_insert_company_users ON public.company_users
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.company_users admin_cu
        WHERE admin_cu.user_id = public.get_current_user_id()
          AND admin_cu.company_id = company_users.company_id
          AND admin_cu.role IN ('super_admin', 'company_admin')
      )
      AND (company_users.role <> 'super_admin' OR public.is_super_admin())
    )
  );

-- UPDATE policy: Super admin, or company_admin for the target company
CREATE POLICY rls_update_company_users ON public.company_users
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.company_users admin_cu
        WHERE admin_cu.user_id = public.get_current_user_id()
          AND admin_cu.company_id = company_users.company_id
          AND admin_cu.role IN ('super_admin', 'company_admin')
      )
      AND (company_users.role <> 'super_admin' OR public.is_super_admin())
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.company_users admin_cu
        WHERE admin_cu.user_id = public.get_current_user_id()
          AND admin_cu.company_id = company_users.company_id
          AND admin_cu.role IN ('super_admin', 'company_admin')
      )
      AND (company_users.role <> 'super_admin' OR public.is_super_admin())
    )
  );

-- DELETE policy: Super admin, or company_admin for the target company (protecting primary super admin on company 1)
CREATE POLICY rls_delete_company_users ON public.company_users
  FOR DELETE TO authenticated
  USING (
    (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.company_users admin_cu
        WHERE admin_cu.user_id = public.get_current_user_id()
          AND admin_cu.company_id = company_users.company_id
          AND admin_cu.role IN ('super_admin', 'company_admin')
      )
    )
    AND NOT (company_users.user_id = 1 AND company_users.company_id = 1)
  );

-- Ensure full table grants on company_users
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_users TO authenticated;


-- ------------------------------------------------------------------------------
-- 3. ATOMIC ASSIGN COMPANY USER RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_company_user(
  p_company_id integer,
  p_user_id integer,
  p_role text,
  p_is_default boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id integer;
  v_is_super boolean;
  v_target_user record;
  v_membership_id integer;
  v_role text;
BEGIN
  -- 1. Identify caller
  v_caller_id := public.get_current_user_id();
  v_is_super := public.is_super_admin();

  -- Normalize role
  v_role := COALESCE(NULLIF(TRIM(p_role), ''), 'company_user');
  IF v_role NOT IN ('super_admin', 'company_admin', 'company_user') THEN
    RAISE EXCEPTION 'Invalid role "%". Allowed: super_admin, company_admin, company_user', v_role;
  END IF;

  -- 2. Verify permissions
  IF NOT v_is_super THEN
    -- Must be company_admin for this company
    IF NOT EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = v_caller_id
        AND company_id = p_company_id
        AND role IN ('super_admin', 'company_admin')
    ) THEN
      RAISE EXCEPTION 'Access denied: You must be an administrator of company % to assign members', p_company_id
        USING ERRCODE = '42501';
    END IF;

    -- Non-super admins cannot grant super_admin
    IF v_role = 'super_admin' THEN
      v_role := 'company_user';
    END IF;
  END IF;

  -- 3. Verify target user exists
  SELECT id, username, email, name, role INTO v_target_user
  FROM public.users
  WHERE id = p_user_id;

  IF v_target_user.id IS NULL THEN
    RAISE EXCEPTION 'User with ID % does not exist', p_user_id;
  END IF;

  -- 4. Verify company exists
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company with ID % does not exist', p_company_id;
  END IF;

  -- 5. Upsert membership
  INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
  VALUES (p_user_id, p_company_id, v_role, COALESCE(p_is_default, false), now())
  ON CONFLICT (user_id, company_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    is_default = CASE WHEN p_is_default IS TRUE THEN true ELSE public.company_users.is_default END
  RETURNING id INTO v_membership_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_membership_id,
    'userId', p_user_id,
    'companyId', p_company_id,
    'role', v_role,
    'isDefault', COALESCE(p_is_default, false),
    'user', jsonb_build_object(
      'id', v_target_user.id,
      'username', v_target_user.username,
      'email', v_target_user.email,
      'name', v_target_user.name,
      'role', v_target_user.role
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_company_user(integer, integer, text, boolean) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. ATOMIC REMOVE COMPANY USER RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_company_user(
  p_company_id integer,
  p_user_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id integer;
  v_is_super boolean;
BEGIN
  -- 1. Identify caller
  v_caller_id := public.get_current_user_id();
  v_is_super := public.is_super_admin();

  -- Prevent removing Kunal/admin from company 1
  IF p_user_id = 1 AND p_company_id = 1 THEN
    RAISE EXCEPTION 'Cannot remove primary Super Admin from default workspace';
  END IF;

  -- 2. Verify permissions
  IF NOT v_is_super THEN
    -- Must be company_admin for this company
    IF NOT EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = v_caller_id
        AND company_id = p_company_id
        AND role IN ('super_admin', 'company_admin')
    ) THEN
      RAISE EXCEPTION 'Access denied: You must be an administrator of company % to remove members', p_company_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Delete membership
  DELETE FROM public.company_users
  WHERE company_id = p_company_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'companyId', p_company_id,
    'userId', p_user_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.remove_company_user(integer, integer) TO authenticated;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
