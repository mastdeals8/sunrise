-- Drop the authenticated-only write policies and replace with anon+authenticated
DROP POLICY IF EXISTS "Authenticated update estimates" ON estimates;
DROP POLICY IF EXISTS "Authenticated insert estimates" ON estimates;
DROP POLICY IF EXISTS "Authenticated delete estimates" ON estimates;
DROP POLICY IF EXISTS "Authenticated insert estimate_items" ON estimate_items;
DROP POLICY IF EXISTS "Authenticated update estimate_items" ON estimate_items;
DROP POLICY IF EXISTS "Authenticated delete estimate_items" ON estimate_items;
DROP POLICY IF EXISTS "Authenticated read estimates" ON estimates;
DROP POLICY IF EXISTS "Authenticated read estimate_items" ON estimate_items;

-- Estimates: full access for anon + authenticated (internal ERP, auth handled by app layer)
CREATE POLICY "anon_select_estimates" ON estimates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_estimates" ON estimates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_estimates" ON estimates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_estimates" ON estimates FOR DELETE TO anon, authenticated USING (true);

-- Estimate items: full access for anon + authenticated
CREATE POLICY "anon_select_estimate_items" ON estimate_items FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_estimate_items" ON estimate_items FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_estimate_items" ON estimate_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_estimate_items" ON estimate_items FOR DELETE TO anon, authenticated USING (true);
