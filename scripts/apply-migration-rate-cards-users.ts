import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;

async function runMigration() {
  const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  try {
    console.log("=== APPLYING MIGRATION: 20261011000000_customer_rate_cards_and_user_mgmt_fix.sql ===");
    const migrationFile = path.resolve("supabase/migrations/20261011000000_customer_rate_cards_and_user_mgmt_fix.sql");
    const sql = fs.readFileSync(migrationFile, "utf-8");

    console.log("Executing SQL...");
    await client.query(sql);
    console.log("✓ Migration executed successfully!");

    // Verify policies on customer_rate_items
    const criPolicies = await client.query(`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'customer_rate_items'
    `);
    console.log(`\n✓ customer_rate_items has ${criPolicies.rows.length} policies:`);
    for (const p of criPolicies.rows) {
      console.log(`  - ${p.policyname} (${p.cmd})`);
    }

    // Verify policies on users
    const usersPolicies = await client.query(`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'users'
    `);
    console.log(`\n✓ users has ${usersPolicies.rows.length} policies:`);
    for (const p of usersPolicies.rows) {
      console.log(`  - ${p.policyname} (${p.cmd})`);
    }

    // Verify grants on users
    const usersGrants = await client.query(`
      SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY grantee, privilege_type
    `);
    console.log(`\n✓ Grants on public.users:`);
    const authGrants = usersGrants.rows.filter(r => r.grantee === 'authenticated');
    console.log(`  - authenticated grants: ${authGrants.map(r => r.privilege_type).join(", ")}`);

    // Verify RPC functions exist
    const funcs = ['import_products_to_rate_card', 'batch_update_rate_card_items', 'resolve_customer_rate', 'admin_create_user'];
    console.log("\n✓ Checking RPC functions:");
    for (const f of funcs) {
      const fnRes = await client.query(`SELECT proname FROM pg_proc WHERE proname = $1`, [f]);
      console.log(`  - ${f}: ${fnRes.rows.length > 0 ? 'PRESENT' : 'MISSING'}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
