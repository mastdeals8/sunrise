-- ==============================================================================
-- SUNRISE MEDIA ERP — MULTI-COMPANY RLS POLICIES MIGRATION
-- Migration: 20261010183000_enforce_multi_company_rls.sql
-- ==============================================================================

-- 1. Enable RLS on companies and company_users
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_users ENABLE ROW LEVEL SECURITY;

-- Clean existing policies on companies & company_users
DROP POLICY IF EXISTS rls_select_companies ON public.companies;
DROP POLICY IF EXISTS rls_insert_companies ON public.companies;
DROP POLICY IF EXISTS rls_update_companies ON public.companies;
DROP POLICY IF EXISTS rls_delete_companies ON public.companies;

DROP POLICY IF EXISTS rls_select_company_users ON public.company_users;
DROP POLICY IF EXISTS rls_insert_company_users ON public.company_users;
DROP POLICY IF EXISTS rls_update_company_users ON public.company_users;
DROP POLICY IF EXISTS rls_delete_company_users ON public.company_users;

-- Policies for companies
CREATE POLICY rls_select_companies ON public.companies
  FOR SELECT TO authenticated
  USING (public.user_has_company_access(id));

CREATE POLICY rls_insert_companies ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY rls_update_companies ON public.companies
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = companies.id
        AND role IN ('super_admin', 'company_admin')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = companies.id
        AND role IN ('super_admin', 'company_admin')
    )
  );

CREATE POLICY rls_delete_companies ON public.companies
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- Policies for company_users
CREATE POLICY rls_select_company_users ON public.company_users
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() 
    OR user_id = public.get_current_user_id()
    OR public.user_has_company_access(company_id)
  );

CREATE POLICY rls_insert_company_users ON public.company_users
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = company_users.company_id
        AND role IN ('super_admin', 'company_admin')
    )
  );

CREATE POLICY rls_update_company_users ON public.company_users
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = company_users.company_id
        AND role IN ('super_admin', 'company_admin')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = company_users.company_id
        AND role IN ('super_admin', 'company_admin')
    )
  );

CREATE POLICY rls_delete_company_users ON public.company_users
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.company_users
      WHERE user_id = public.get_current_user_id()
        AND company_id = company_users.company_id
        AND role IN ('super_admin', 'company_admin')
    )
  );

-- Helper procedure to drop all existing policies on a table and set company isolation policies
DO $$
DECLARE
  t text;
  p record;
  company_tables text[] := ARRAY[
    'clients', 'brands', 'stores', 'products', 'material_codes',
    'customer_rate_cards', 'estimates', 'estimate_items', 'invoices',
    'delivery_challans', 'execution_documents', 'invoice_packets',
    'projects', 'purchase_orders', 'chart_of_accounts', 'journal_entries',
    'payments', 'petty_cash_expenses', 'payroll', 'attendance',
    'staff_advances', 'tasks', 'notifications', 'audit_logs',
    'uploads', 'bot_settings', 'bot_upload_inbox', 'webhook_logs'
  ];
BEGIN
  FOREACH t IN ARRAY company_tables LOOP
    -- Drop all existing policies on table
    FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Create unified company-isolated policies
    EXECUTE format('
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (public.user_has_company_access(company_id));
      
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.user_has_company_access(company_id));

      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (public.user_has_company_access(company_id))
        WITH CHECK (public.user_has_company_access(company_id));

      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (public.user_has_company_access(company_id));
    ',
      'rls_select_' || t, t,
      'rls_insert_' || t, t,
      'rls_update_' || t, t,
      'rls_delete_' || t, t
    );
  END LOOP;
END $$;

-- 2. Child tables without direct company_id (scoping via parent relation)

-- client_billing_profiles (via clients)
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_billing_profiles') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.client_billing_profiles', p.policyname);
  END LOOP;
END $$;

CREATE POLICY rls_select_client_billing_profiles ON public.client_billing_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_billing_profiles.client_id AND public.user_has_company_access(c.company_id)));

CREATE POLICY rls_insert_client_billing_profiles ON public.client_billing_profiles
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_billing_profiles.client_id AND public.user_has_company_access(c.company_id)));

CREATE POLICY rls_update_client_billing_profiles ON public.client_billing_profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_billing_profiles.client_id AND public.user_has_company_access(c.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_billing_profiles.client_id AND public.user_has_company_access(c.company_id)));

CREATE POLICY rls_delete_client_billing_profiles ON public.client_billing_profiles
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_billing_profiles.client_id AND public.user_has_company_access(c.company_id)));

-- execution_stores (via estimates)
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'execution_stores') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.execution_stores', p.policyname);
  END LOOP;
END $$;

CREATE POLICY rls_select_execution_stores ON public.execution_stores
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = execution_stores.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_insert_execution_stores ON public.execution_stores
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = execution_stores.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_update_execution_stores ON public.execution_stores
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = execution_stores.estimate_id AND public.user_has_company_access(e.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = execution_stores.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_delete_execution_stores ON public.execution_stores
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = execution_stores.estimate_id AND public.user_has_company_access(e.company_id)));

-- field_access_links (via estimates)
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_access_links') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.field_access_links', p.policyname);
  END LOOP;
END $$;

CREATE POLICY rls_select_field_access_links ON public.field_access_links
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = field_access_links.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_insert_field_access_links ON public.field_access_links
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = field_access_links.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_update_field_access_links ON public.field_access_links
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = field_access_links.estimate_id AND public.user_has_company_access(e.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = field_access_links.estimate_id AND public.user_has_company_access(e.company_id)));

CREATE POLICY rls_delete_field_access_links ON public.field_access_links
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = field_access_links.estimate_id AND public.user_has_company_access(e.company_id)));

-- journal_entry_lines (via journal_entries)
DO $$
DECLARE p record;
BEGIN
  FOR p IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'journal_entry_lines') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.journal_entry_lines', p.policyname);
  END LOOP;
END $$;

CREATE POLICY rls_select_journal_entry_lines ON public.journal_entry_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_entry_lines.journal_entry_id AND public.user_has_company_access(j.company_id)));

CREATE POLICY rls_insert_journal_entry_lines ON public.journal_entry_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_entry_lines.journal_entry_id AND public.user_has_company_access(j.company_id)));

CREATE POLICY rls_update_journal_entry_lines ON public.journal_entry_lines
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_entry_lines.journal_entry_id AND public.user_has_company_access(j.company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_entry_lines.journal_entry_id AND public.user_has_company_access(j.company_id)));

CREATE POLICY rls_delete_journal_entry_lines ON public.journal_entry_lines
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.id = journal_entry_lines.journal_entry_id AND public.user_has_company_access(j.company_id)));

-- Reload schema cache in PostgREST
NOTIFY pgrst, 'reload schema';
