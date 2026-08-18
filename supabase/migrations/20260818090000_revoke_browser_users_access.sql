-- Keep the legacy public.users table out of browser/PostgREST access.
-- Authentication is Supabase Auth; no Bolt business workflow needs to select
-- the legacy password column. This deliberately does not alter any user data.
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon, authenticated;
