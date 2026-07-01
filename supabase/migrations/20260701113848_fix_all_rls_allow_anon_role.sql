-- ============================================================
-- Replace all authenticated-only policies with anon+authenticated
-- (ERP app uses its own JWT, not Supabase auth — all calls are anon role)
-- ============================================================

-- app_settings
DROP POLICY IF EXISTS "Authenticated read app_settings" ON app_settings;
DROP POLICY IF EXISTS "Authenticated update app_settings" ON app_settings;
CREATE POLICY "rls_select_app_settings" ON app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_app_settings" ON app_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_app_settings" ON app_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_app_settings" ON app_settings FOR DELETE TO anon, authenticated USING (true);

-- brands
DROP POLICY IF EXISTS "Authenticated read brands" ON brands;
CREATE POLICY "rls_select_brands" ON brands FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_brands" ON brands FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_brands" ON brands FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_brands" ON brands FOR DELETE TO anon, authenticated USING (true);

-- chart_of_accounts
DROP POLICY IF EXISTS "Authenticated read chart_of_accounts" ON chart_of_accounts;
CREATE POLICY "rls_select_chart_of_accounts" ON chart_of_accounts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_chart_of_accounts" ON chart_of_accounts FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_chart_of_accounts" ON chart_of_accounts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_chart_of_accounts" ON chart_of_accounts FOR DELETE TO anon, authenticated USING (true);

-- client_billing_profiles
DROP POLICY IF EXISTS "Authenticated read client_billing_profiles" ON client_billing_profiles;
CREATE POLICY "rls_select_client_billing_profiles" ON client_billing_profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_client_billing_profiles" ON client_billing_profiles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_client_billing_profiles" ON client_billing_profiles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_client_billing_profiles" ON client_billing_profiles FOR DELETE TO anon, authenticated USING (true);

-- clients
DROP POLICY IF EXISTS "Authenticated read clients" ON clients;
CREATE POLICY "rls_select_clients" ON clients FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_clients" ON clients FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_clients" ON clients FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_clients" ON clients FOR DELETE TO anon, authenticated USING (true);

-- customer_rate_cards
DROP POLICY IF EXISTS "Authenticated read customer_rate_cards" ON customer_rate_cards;
CREATE POLICY "rls_select_customer_rate_cards" ON customer_rate_cards FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_customer_rate_cards" ON customer_rate_cards FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_customer_rate_cards" ON customer_rate_cards FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_customer_rate_cards" ON customer_rate_cards FOR DELETE TO anon, authenticated USING (true);

-- delivery_challans
DROP POLICY IF EXISTS "Authenticated read delivery_challans" ON delivery_challans;
CREATE POLICY "rls_select_delivery_challans" ON delivery_challans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_delivery_challans" ON delivery_challans FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_delivery_challans" ON delivery_challans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_delivery_challans" ON delivery_challans FOR DELETE TO anon, authenticated USING (true);

-- execution_documents
DROP POLICY IF EXISTS "Authenticated read execution_documents" ON execution_documents;
DROP POLICY IF EXISTS "Authenticated insert execution_documents" ON execution_documents;
CREATE POLICY "rls_select_execution_documents" ON execution_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_execution_documents" ON execution_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_execution_documents" ON execution_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_execution_documents" ON execution_documents FOR DELETE TO anon, authenticated USING (true);

-- execution_stores
DROP POLICY IF EXISTS "Authenticated read execution_stores" ON execution_stores;
CREATE POLICY "rls_select_execution_stores" ON execution_stores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_execution_stores" ON execution_stores FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_execution_stores" ON execution_stores FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_execution_stores" ON execution_stores FOR DELETE TO anon, authenticated USING (true);

-- invoices
DROP POLICY IF EXISTS "Authenticated read invoices" ON invoices;
CREATE POLICY "rls_select_invoices" ON invoices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_invoices" ON invoices FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_invoices" ON invoices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_invoices" ON invoices FOR DELETE TO anon, authenticated USING (true);

-- material_codes
DROP POLICY IF EXISTS "Authenticated read material_codes" ON material_codes;
CREATE POLICY "rls_select_material_codes" ON material_codes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_material_codes" ON material_codes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_material_codes" ON material_codes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_material_codes" ON material_codes FOR DELETE TO anon, authenticated USING (true);

-- notifications
DROP POLICY IF EXISTS "Authenticated read notifications" ON notifications;
CREATE POLICY "rls_select_notifications" ON notifications FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_notifications" ON notifications FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_notifications" ON notifications FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_notifications" ON notifications FOR DELETE TO anon, authenticated USING (true);

-- payments
DROP POLICY IF EXISTS "Authenticated read payments" ON payments;
CREATE POLICY "rls_select_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_payments" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_payments" ON payments FOR DELETE TO anon, authenticated USING (true);

-- products
DROP POLICY IF EXISTS "Authenticated read products" ON products;
CREATE POLICY "rls_select_products" ON products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_products" ON products FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_products" ON products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_products" ON products FOR DELETE TO anon, authenticated USING (true);

-- stores
DROP POLICY IF EXISTS "Authenticated read stores" ON stores;
CREATE POLICY "rls_select_stores" ON stores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_stores" ON stores FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_stores" ON stores FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_stores" ON stores FOR DELETE TO anon, authenticated USING (true);

-- users
DROP POLICY IF EXISTS "Authenticated read users" ON users;
CREATE POLICY "rls_select_users" ON users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "rls_insert_users" ON users FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "rls_update_users" ON users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rls_delete_users" ON users FOR DELETE TO anon, authenticated USING (true);
