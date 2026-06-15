// Additive migration: add `abfrl_project_type` to `estimates`.
// Idempotent — uses IF NOT EXISTS. Safe to run repeatedly.
//
// SELEX = ABFRL Selex rollout (no material code required)
// CAPEX = ABFRL Capex rollout (material code REQUIRED per row)
//
// Run with:  node scripts/migrate-add-project-type.mjs

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
  // ABFRL Project Type: "SELEX" or "CAPEX". NULL for non-ABFRL estimates.
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS abfrl_project_type TEXT;`,
];

(async () => {
  let okCount = 0;
  for (const q of queries) {
    try {
      await pool.query(q);
      console.log(`✓ ${q.slice(0, 90)}${q.length > 90 ? "…" : ""}`);
      okCount++;
    } catch (e) {
      console.error(`✗ ${q.slice(0, 90)} :: ${e.message}`);
    }
  }
  console.log(`\nApplied ${okCount}/${queries.length} additive statements.`);
  await pool.end();
})();
