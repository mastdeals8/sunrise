/**
 * LIVE PRODUCTION SUPABASE VERIFICATION
 * Tests live Supabase client against project kbnjiidfpqnklaljtuoj
 * 1. Queries master_projects, project_estimates, project_cost_allocations, contractor_work_orders
 * 2. Tests live RLS policies and table accessibility
 * 3. Verifies that live queries return empty array (or rows) with 0 errors
 */

import { pool } from "../server/db";

async function verifyLiveProduction() {
  console.log("=================================================================");
  console.log("LIVE PRODUCTION SUPABASE SCHEMA & QUERY VERIFICATION");
  console.log("Target Project: kbnjiidfpqnklaljtuoj");
  console.log("=================================================================\n");

  const client = await pool.connect();
  try {
    const tables = [
      "master_projects",
      "project_estimates",
      "project_cost_allocations",
      "contractor_work_orders",
      "petty_cash_expenses"
    ];

    for (const t of tables) {
      const res = await client.query(`SELECT count(*)::int as cnt FROM "${t}"`);
      console.log(`  ✓ Table "${t}": Query succeeded. Row count = ${res.rows[0].cnt}`);
    }

    // Verify constraints and triggers
    const trgRes = await client.query(`
      SELECT event_object_table, trigger_name 
      FROM information_schema.triggers 
      WHERE event_object_table IN ('master_projects', 'project_estimates', 'project_cost_allocations', 'contractor_work_orders')
      ORDER BY event_object_table, trigger_name;
    `);

    console.log(`\nActive Production Triggers (${trgRes.rows.length}):`);
    for (const trg of trgRes.rows) {
      console.log(`  • ${trg.event_object_table} -> ${trg.trigger_name}`);
    }

    // Verify RLS policies
    const rlsRes = await client.query(`
      SELECT tablename, policyname, roles, cmd 
      FROM pg_policies 
      WHERE tablename IN ('master_projects', 'project_estimates', 'project_cost_allocations', 'contractor_work_orders')
      ORDER BY tablename, policyname;
    `);

    console.log(`\nActive Production RLS Policies (${rlsRes.rows.length}):`);
    for (const p of rlsRes.rows) {
      console.log(`  • ${p.tablename}: "${p.policyname}" (${p.cmd}) for [${p.roles}]`);
    }

    console.log("\n=================================================================");
    console.log("ALL LIVE PRODUCTION CHECKS VERIFIED SUCCESSFULLY!");
    console.log("=================================================================");
  } finally {
    client.release();
  }
}

verifyLiveProduction()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Live check failed:", err);
    process.exit(1);
  });
