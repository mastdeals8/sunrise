#!/usr/bin/env node
/**
 * Additive ALTERs for the final ERP pass. Idempotent (IF NOT EXISTS / IF NOT
 * EXISTS-equivalent for PostgreSQL ALTER COLUMN). Safe to run repeatedly.
 *
 * Adds:
 *   customer_rate_cards.name             -- friendly card name (e.g. "Peter England CAPEX 2026")
 *   customer_rate_items.item_name        -- display name on estimate row
 *   customer_rate_items.hsn              -- HSN/SAC
 *   customer_rate_items.calculation_type -- sqft / running_inch / fixed / percentage / manual
 *   customer_rate_items.is_standard      -- standard vs non_standard
 *
 *   invoices.tally_export_status         -- not_exported / exported_xml / pushed_to_tally / failed
 *   invoices.tally_exported_at
 *
 *   stores.mall_name, store_type
 *
 *   estimates.signed_off (used by job tracker per-store override)
 *
 *   delivery_challans.store_code   -- so per-store DC tracking works without item drilldown
 *
 * Run:  node scripts/migrate-final-erp-pass.mjs
 */
import pg from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL missing");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

const queries = [
  // Rate card naming + richer item fields
  `ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS name TEXT;`,
  `ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS item_name TEXT;`,
  `ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS hsn TEXT;`,
  `ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS calculation_type TEXT DEFAULT 'fixed';`,
  `ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT TRUE;`,

  // Invoice Tally export tracking
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_export_status TEXT DEFAULT 'not_exported';`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_exported_at TIMESTAMP;`,

  // Store details surfaced in master template
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS mall_name TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type TEXT;`,

  // Project tracker store status overrides
  `CREATE TABLE IF NOT EXISTS project_store_status (
    id SERIAL PRIMARY KEY,
    estimate_id INTEGER REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
    store_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    remarks TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(estimate_id, store_code)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_project_store_status_est ON project_store_status(estimate_id);`,

  // Delivery challan per-store code (optional, additive)
  `ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS store_code TEXT;`,
];

(async () => {
  let ok = 0;
  for (const q of queries) {
    try {
      await pool.query(q);
      console.log(`✓ ${q.slice(0, 90).replace(/\s+/g, " ")}…`);
      ok++;
    } catch (e) {
      console.error(`✗ ${q.slice(0, 90).replace(/\s+/g, " ")} :: ${e.message}`);
    }
  }
  console.log(`\n${ok}/${queries.length} additive statements applied.`);
  await pool.end();
})();
