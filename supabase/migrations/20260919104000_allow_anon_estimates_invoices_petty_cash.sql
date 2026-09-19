-- Allow anon and authenticated roles full access on estimates, invoices, and petty_cash_expenses
-- (Bolt preview mode operates with anon role when not using a Supabase Auth session)

ALTER POLICY "anon_select_estimates" ON public.estimates TO anon, authenticated;
ALTER POLICY "anon_insert_estimates" ON public.estimates TO anon, authenticated;
ALTER POLICY "anon_update_estimates" ON public.estimates TO anon, authenticated;
ALTER POLICY "anon_delete_estimates" ON public.estimates TO anon, authenticated;

ALTER POLICY "rls_select_invoices" ON public.invoices TO anon, authenticated;
ALTER POLICY "rls_insert_invoices" ON public.invoices TO anon, authenticated;
ALTER POLICY "rls_update_invoices" ON public.invoices TO anon, authenticated;
ALTER POLICY "rls_delete_invoices" ON public.invoices TO anon, authenticated;

ALTER POLICY "authenticated_select_petty_cash_expenses" ON public.petty_cash_expenses TO anon, authenticated;
ALTER POLICY "authenticated_insert_petty_cash_expenses" ON public.petty_cash_expenses TO anon, authenticated;
ALTER POLICY "authenticated_update_petty_cash_expenses" ON public.petty_cash_expenses TO anon, authenticated;
ALTER POLICY "authenticated_delete_petty_cash_expenses" ON public.petty_cash_expenses TO anon, authenticated;
