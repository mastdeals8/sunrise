// Additive migration: add `vendor_code` to `clients`.
// Idempotent — uses IF NOT EXISTS. Safe to run repeatedly.
//
// Vendor Code is now stored on the Client (one per client). When the user
// picks the client on a new estimate, the form auto-fills the Vendor Code
// so they don't have to retype it every time.
//
// Run with:  node scripts/migrate-add-vendor-code.mjs

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

const queries = [
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS vendor_code TEXT;`,
];

(async () => {
  let okCount = 0;
  for (const q of queries) {
    try {
      await pool.query(q);
      console.log("OK:", q);
      okCount++;
    } catch (err) {
      console.error("FAIL:", q, err.message);
    }
  }
  await pool.end();
  console.log(`\nDone. ${okCount}/${queries.length} statements applied.`);
})();
