-- ==============================================================================
-- SUNRISE MEDIA ERP — ASSIGN PRIYANKA (MANAGER) TO WORKSPACE 2 (DELHI COMPANY)
-- Migration: 20261015130000_assign_priyanka_workspace_2.sql
-- ==============================================================================

-- Assign Priyanka (user_id = 12, email = pinks@sunrisemedia.in) to Workspace 2 (Delhi Company)
-- Role in company_users is 'company_user' to preserve strict company scoping without grant of super_admin.
-- Her global role in public.users remains 'manager'.
INSERT INTO public.company_users (user_id, company_id, role, is_default, created_at)
SELECT id, 2, 'company_user', true, now()
FROM public.users
WHERE email = 'pinks@sunrisemedia.in'
ON CONFLICT (user_id, company_id) DO UPDATE SET
  role = 'company_user',
  is_default = true;

-- Ensure any other company assignments for Priyanka are absent to preserve strict isolation
DELETE FROM public.company_users
WHERE user_id = (SELECT id FROM public.users WHERE email = 'pinks@sunrisemedia.in')
  AND company_id != 2;
