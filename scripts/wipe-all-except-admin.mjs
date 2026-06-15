// =========================================================================
// One-off wipe — clears ALL tables except the admin user.
//
// User explicitly requested a clean slate before uploading real data.
// Override of the usual "never truncate" rule (memory note).
//
// Behavior:
//   1. TRUNCATE every non-user table with RESTART IDENTITY CASCADE.
//   2. From `users`, delete every row except `username = 'admin'`.
//   3. Reset the users id sequence to MAX(id) so the next signup gets id 2.
//   4. Single transaction — either it all succeeds or nothing changes.
//
// Run with:  node scripts/wipe-all-except-admin.mjs
// =========================================================================

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

// Every table from shared/schema.ts EXCEPT `users` (which gets a filtered DELETE).
const TABLES_TO_TRUNCATE = [
  "attendance",
  "tasks",
  "petty_cash_expenses",
  "uploads",
  "chart_of_accounts",
  "invoices",
  "journal_entries",
  "journal_entry_lines",
  "payments",
  "clients",
  "client_billing_profiles",
  "brands",
  "stores",
  "products",
  "estimates",
  "estimate_items",
  "delivery_challans",
  "material_codes",
  "app_settings",
  "customer_rate_cards",
  "customer_rate_items",
  "project_store_status",
  "staff_advances",
  "payroll",
  "bot_settings",
  "bot_upload_inbox",
  "webhook_logs",
];

const client = await pool.connect();
try {
  await client.query("BEGIN");

  console.log("Pre-wipe row counts:");
  for (const t of [...TABLES_TO_TRUNCATE, "users"]) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(28)} ${r.rows[0].n}`);
  }

  // TRUNCATE all non-user tables in one statement so CASCADE handles any
  // FKs between them. RESTART IDENTITY resets serial sequences to 1.
  const tableList = TABLES_TO_TRUNCATE.join(", ");
  console.log("\nTruncating non-user tables ...");
  await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  // Keep only admin
  const del = await client.query("DELETE FROM users WHERE username <> 'admin'");
  console.log(`Deleted ${del.rowCount} non-admin user(s).`);

  // Re-align users sequence to current MAX(id) so a future INSERT picks the
  // next free id (admin keeps id=1; next signup gets id=2).
  await client.query(`SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users), 1))`);

  await client.query("COMMIT");

  console.log("\nPost-wipe row counts:");
  for (const t of [...TABLES_TO_TRUNCATE, "users"]) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(28)} ${r.rows[0].n}`);
  }

  const u = await pool.query("SELECT id, username, role FROM users");
  console.log("\nSurviving users:");
  for (const row of u.rows) console.log(" ", row);

  console.log("\nDone.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Wipe failed, rolled back:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
