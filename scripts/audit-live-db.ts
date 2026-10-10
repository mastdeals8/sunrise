import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function audit() {
  const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  try {
    console.log("=== LIVE SUPABASE DATABASE AUDIT ===\n");

    // 1. Check auth.users table
    console.log("[1] Checking auth.users...");
    try {
      const authUsersRes = await client.query(
        "SELECT id, email, created_at, last_sign_in_at FROM auth.users ORDER BY created_at LIMIT 10"
      );
      console.log(`  ✓ auth.users exists! Found ${authUsersRes.rows.length} users:`);
      for (const u of authUsersRes.rows) {
        console.log(`    - ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}`);
      }
    } catch (e: any) {
      console.log(`  ✗ auth.users check error: ${e.message}`);
    }

    // 2. Check public.users table schema and content
    console.log("\n[2] Checking public.users schema and records...");
    const usersCols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `);
    console.log("  Columns in public.users:");
    for (const c of usersCols.rows) {
      console.log(`    - ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable})`);
    }

    const usersRows = await client.query("SELECT * FROM public.users ORDER BY id");
    console.log(`  ✓ public.users has ${usersRows.rows.length} rows:`);
    for (const r of usersRows.rows) {
      console.log(`    - ID: ${r.id}, Username: ${r.username}, Email: ${r.email}, Role: ${r.role}, AuthUID: ${r.auth_user_id || 'NULL'}, CompanyID: ${r.company_id}`);
    }

    // 3. Check public.companies and public.company_users
    console.log("\n[3] Checking companies and company_users...");
    const compRows = await client.query("SELECT * FROM public.companies ORDER BY id");
    console.log(`  ✓ public.companies has ${compRows.rows.length} companies:`);
    for (const c of compRows.rows) {
      console.log(`    - ID: ${c.id}, Name: ${c.name}, Code: ${c.code}, Active: ${c.is_active}`);
    }

    const compUsersCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'company_users'
      ORDER BY ordinal_position
    `);
    console.log("  Columns in public.company_users:");
    for (const c of compUsersCols.rows) {
      console.log(`    - ${c.column_name}: ${c.data_type}`);
    }

    const compUsersRows = await client.query("SELECT * FROM public.company_users ORDER BY id");
    console.log(`  ✓ public.company_users has ${compUsersRows.rows.length} memberships:`);
    for (const cu of compUsersRows.rows) {
      console.log(`    - ID: ${cu.id}, UserID: ${cu.user_id}, CompanyID: ${cu.company_id}, Role: ${cu.role}`);
    }

    // 4. Check permissions and RLS on public.users, company_users, customer_rate_cards, customer_rate_items
    console.log("\n[4] Checking RLS status and policies...");
    const tables = ['users', 'companies', 'company_users', 'customer_rate_cards', 'customer_rate_items'];
    for (const tbl of tables) {
      const rlsRes = await client.query(`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname = $1 AND relnamespace = 'public'::regnamespace
      `, [tbl]);
      const isRls = rlsRes.rows[0]?.relrowsecurity;
      console.log(`  Table public.${tbl}: RLS=${isRls ? 'ENABLED' : 'DISABLED'}`);

      const polRes = await client.query(`
        SELECT policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1
      `, [tbl]);
      for (const p of polRes.rows) {
        console.log(`    Policy: ${p.policyname} (${p.cmd}) roles=${p.roles} qual=${p.qual}`);
      }

      // Check grants
      const grantsRes = await client.query(`
        SELECT grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY grantee, privilege_type
      `, [tbl]);
      console.log(`    Grants on public.${tbl}:`, grantsRes.rows.map(g => `${g.grantee}:${g.privilege_type}`).join(", "));
    }

    // 5. Check customer_rate_cards and customer_rate_items schema and data
    console.log("\n[5] Checking customer_rate_cards and customer_rate_items...");
    const rcCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_rate_cards'
      ORDER BY ordinal_position
    `);
    console.log("  Columns in public.customer_rate_cards:");
    for (const c of rcCols.rows) {
      console.log(`    - ${c.column_name}: ${c.data_type}`);
    }

    const riCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_rate_items'
      ORDER BY ordinal_position
    `);
    console.log("  Columns in public.customer_rate_items:");
    for (const c of riCols.rows) {
      console.log(`    - ${c.column_name}: ${c.data_type}`);
    }

    const rcCount = await client.query("SELECT COUNT(*) FROM public.customer_rate_cards");
    const riCount = await client.query("SELECT COUNT(*) FROM public.customer_rate_items");
    console.log(`  ✓ customer_rate_cards count: ${rcCount.rows[0].count}`);
    console.log(`  ✓ customer_rate_items count: ${riCount.rows[0].count}`);

  } finally {
    client.release();
    await pool.end();
  }
}

audit().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
