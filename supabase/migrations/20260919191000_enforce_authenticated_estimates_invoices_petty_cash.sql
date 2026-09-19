-- Enforce authenticated-only access on estimates, invoices, and petty_cash_expenses
-- Reverts anonymous access regression and restores strict production security.

ALTER POLICY "anon_select_estimates" ON public.estimates TO authenticated;
ALTER POLICY "anon_insert_estimates" ON public.estimates TO authenticated;
ALTER POLICY "anon_update_estimates" ON public.estimates TO authenticated;
ALTER POLICY "anon_delete_estimates" ON public.estimates TO authenticated;

ALTER POLICY "rls_select_invoices" ON public.invoices TO authenticated;
ALTER POLICY "rls_insert_invoices" ON public.invoices TO authenticated;
ALTER POLICY "rls_update_invoices" ON public.invoices TO authenticated;
ALTER POLICY "rls_delete_invoices" ON public.invoices TO authenticated;

ALTER POLICY "authenticated_select_petty_cash_expenses" ON public.petty_cash_expenses TO authenticated;
ALTER POLICY "authenticated_insert_petty_cash_expenses" ON public.petty_cash_expenses TO authenticated;
ALTER POLICY "authenticated_update_petty_cash_expenses" ON public.petty_cash_expenses TO authenticated;
ALTER POLICY "authenticated_delete_petty_cash_expenses" ON public.petty_cash_expenses TO authenticated;
