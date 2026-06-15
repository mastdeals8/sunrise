// Additive migration for the deployment-ready CRUD + invoice-workflow pass.
// Adds line-item snapshot, cancel metadata, and DC linkage columns to invoices.
// Idempotent — uses IF NOT EXISTS / ON CONFLICT throughout.
//
// Run:  node scripts/migrate-deployment-ready.mjs

import pg from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS line_items jsonb,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp,
  ADD COLUMN IF NOT EXISTS cancelled_by integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS po_reference text;

-- Seed FY-aware numbering settings if they don't already exist. (Migrate
-- script invoice-dc-link already inserts these; this block stays for fresh
-- installs.)
INSERT INTO app_settings (key, value)
VALUES
  ('numbering.invoice', '{"prefix":"SM/INV","startAt":101,"fyAware":true}'::jsonb),
  ('numbering.estimate', '{"prefix":"SM/E","startAt":101,"fyAware":true}'::jsonb),
  ('numbering.dc', '{"prefix":"SM/DC","startAt":101,"fyAware":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SQL);
    await client.query("COMMIT");
    console.log("migration applied: invoices line_items, cancel_*, po_* + numbering settings");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
