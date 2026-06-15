// Additive migration: link invoices to their delivery challan (WCC or DC).
// The Bolt-style workflow is Estimate → DC/WCC → Invoice → Payment, so each
// invoice now points at the DC that drove it. Idempotent — uses IF NOT EXISTS.
//
// Run:  node scripts/migrate-invoice-dc-link.mjs

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

const SQL = `
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS delivery_challan_id integer REFERENCES delivery_challans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_delivery_challan_id ON invoices(delivery_challan_id);

-- Seed FY-aware numbering settings if absent. The numbering endpoint reads
-- these and produces e.g. "SM/INV/26-27/101". Change here or via the
-- Settings page to retarget the prefix or starting counter.
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
    console.log("✅ migration applied: invoices.delivery_challan_id + numbering settings");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
