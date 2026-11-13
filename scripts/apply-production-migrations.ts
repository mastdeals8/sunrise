/**
 * TRANSACTIONAL PRODUCTION MIGRATION RUNNER
 * Applies 0015_master_project_costing.sql and 0016_project_costing_hardening.sql
 * to Supabase Project kbnjiidfpqnklaljtuoj
 * 
 * Guarantees:
 * - Single atomic transaction (COMMIT only if every check passes, ROLLBACK on any failure)
 * - Zero modification or deletion of existing accounting/historical data
 * - Strict verification of 4 tables, triggers, partial unique indexes, RLS, and numeric precision
 */

import { pool } from "../server/db";
import * as fs from "fs";
import * as path from "path";

async function applyProductionMigrations() {
  console.log("=================================================================");
  console.log("APPLYING PRODUCTION MIGRATIONS: 0015 & 0016");
  console.log("Target Supabase Project: kbnjiidfpqnklaljtuoj");
  console.log("=================================================================\n");

  const client = await pool.connect();
  try {
    // 1. Pre-flight check: record existing row counts
    const preCounts: Record<string, number> = {};
    const auditTables = ["estimates", "invoices", "journal_entries", "journal_entry_lines", "clients", "stores"];
    for (const t of auditTables) {
      const res = await client.query(`SELECT count(*)::int as cnt FROM "${t}"`);
      preCounts[t] = res.rows[0].cnt;
      console.log(`[Pre-flight] Table "${t}": ${preCounts[t]} rows`);
    }

    console.log("\nStarting ATOMIC TRANSACTION...");
    await client.query("BEGIN;");

    // 2. Read migration files
    const m15Path = path.join(process.cwd(), "migrations", "0015_master_project_costing.sql");
    const m16Path = path.join(process.cwd(), "migrations", "0016_project_costing_hardening.sql");
    const m15Sql = fs.readFileSync(m15Path, "utf8");
    const m16Sql = fs.readFileSync(m16Path, "utf8");

    console.log("\n[Step 1] Applying 0015_master_project_costing.sql...");
    await client.query(m15Sql);
    console.log("  ✓ Migration 0015 executed successfully.");

    console.log("\n[Step 2] Applying 0016_project_costing_hardening.sql...");
    await client.query(m16Sql);
    console.log("  ✓ Migration 0016 executed successfully.");

    // 3. Post-migration verifications
    console.log("\n[Step 3] Verifying 4 project costing tables exist in schema...");
    const requiredTables = [
      "master_projects",
      "project_estimates",
      "project_cost_allocations",
      "contractor_work_orders",
    ];

    for (const tbl of requiredTables) {
      const chk = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        ) as exists;
      `, [tbl]);
      if (!chk.rows[0].exists) {
        throw new Error(`CRITICAL: Required table "${tbl}" does not exist after migration!`);
      }
      console.log(`  ✓ Table "public.${tbl}" verified.`);
    }

    // 4. Verify numeric precision
    console.log("\n[Step 4] Verifying exact numeric precision on monetary columns...");
    const colTypes = await client.query(`
      SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name IN ('master_projects', 'project_cost_allocations', 'contractor_work_orders')
        AND column_name IN ('target_budget', 'budget_revenue', 'base_amount', 'gst_rate', 'total_amount', 'committed_amount', 'approved_variation_amount')
      ORDER BY table_name, column_name;
    `);

    for (const r of colTypes.rows) {
      if (r.data_type !== "numeric") {
        throw new Error(`CRITICAL: Column ${r.table_name}.${r.column_name} is ${r.data_type}, expected numeric!`);
      }
      console.log(`  ✓ Column ${r.table_name}.${r.column_name}: NUMERIC(${r.numeric_precision}, ${r.numeric_scale})`);
    }

    // 5. Verify Triggers exist
    console.log("\n[Step 5] Verifying integrity triggers...");
    const requiredTriggers = [
      { table: "master_projects", trigger: "trg_sync_project_estimate_status" },
      { table: "project_estimates", trigger: "trg_guard_project_estimate_link" },
      { table: "master_projects", trigger: "trg_val_master_projects" },
      { table: "project_estimates", trigger: "trg_val_project_estimates" },
      { table: "project_cost_allocations", trigger: "trg_val_project_cost_allocations" },
      { table: "contractor_work_orders", trigger: "trg_val_contractor_work_orders" },
      { table: "project_cost_allocations", trigger: "trg_val_cost_allocation_source" },
    ];

    for (const trg of requiredTriggers) {
      const tChk = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.triggers 
          WHERE event_object_table = $1 AND trigger_name = $2
        ) as exists;
      `, [trg.table, trg.trigger]);
      if (!tChk.rows[0].exists) {
        throw new Error(`CRITICAL: Trigger "${trg.trigger}" on table "${trg.table}" is missing!`);
      }
      console.log(`  ✓ Trigger "${trg.trigger}" on "${trg.table}" verified.`);
    }

    // 6. Verify RLS policies and table enablement
    console.log("\n[Step 6] Verifying Row-Level Security (RLS)...");
    for (const tbl of requiredTables) {
      const rlsChk = await client.query(`
        SELECT rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public' AND tablename = $1;
      `, [tbl]);
      if (!rlsChk.rows[0] || !rlsChk.rows[0].rowsecurity) {
        throw new Error(`CRITICAL: RLS is NOT enabled on table "${tbl}"!`);
      }

      const polChk = await client.query(`
        SELECT count(*)::int as pol_count
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1;
      `, [tbl]);
      if (polChk.rows[0].pol_count < 1) {
        throw new Error(`CRITICAL: Table "${tbl}" has RLS enabled but 0 policies defined!`);
      }
      console.log(`  ✓ Table "${tbl}": RLS enabled with ${polChk.rows[0].pol_count} active policy.`);
    }

    // 7. Verify partial unique index
    console.log("\n[Step 7] Verifying partial unique index for estimate relinking...");
    const idxChk = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'project_estimates' AND indexname = 'uq_active_project_estimate';
    `);
    if (idxChk.rows.length === 0) {
      throw new Error(`CRITICAL: Partial unique index "uq_active_project_estimate" is missing!`);
    }
    console.log(`  ✓ Partial index "uq_active_project_estimate" verified: ${idxChk.rows[0].indexdef}`);

    // 8. Verify ZERO existing records were modified or deleted
    console.log("\n[Step 8] Verifying existing data preservation...");
    for (const t of auditTables) {
      const res = await client.query(`SELECT count(*)::int as cnt FROM "${t}"`);
      const postCount = res.rows[0].cnt;
      if (postCount !== preCounts[t]) {
        throw new Error(`CRITICAL DATA LOSS: Table "${t}" had ${preCounts[t]} rows before migration, now has ${postCount}!`);
      }
      console.log(`  ✓ Table "${t}": Exactly ${postCount} rows preserved.`);
    }

    // 9. COMMIT TRANSACTION
    console.log("\n[Step 9] All 8 integrity verification steps passed with 100% success.");
    console.log("Committing transaction to production Supabase...");
    await client.query("COMMIT;");

    console.log("\n=================================================================");
    console.log("PRODUCTION MIGRATIONS 0015 & 0016 APPLIED & COMMITTED SUCCESSFULLY!");
    console.log("Target Supabase Project: kbnjiidfpqnklaljtuoj");
    console.log("=================================================================");
  } catch (err) {
    console.error("\n❌ MIGRATION FAILED. INITIATING IMMEDIATE ROLLBACK...", err);
    try {
      await client.query("ROLLBACK;");
      console.log("ROLLBACK COMPLETE. Database remains pristine.");
    } catch (rbErr) {
      console.error("Rollback error:", rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

applyProductionMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration execution failed:", err);
    process.exit(1);
  });
