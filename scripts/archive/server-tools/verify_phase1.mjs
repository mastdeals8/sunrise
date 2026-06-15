/**
 * Verify Phase 1 Migration
 * Check that all schema changes were applied successfully
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { sql } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = drizzle(pool);

async function verifyMigration() {
  console.log("🔍 Verifying Phase 1 Migration...\n");

  try {
    // Check material_codes table columns
    console.log("📋 Checking material_codes table...");
    const mcColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'material_codes'
      AND column_name IN ('product_name', 'category', 'is_standard', 'client_id', 'brand_id')
      ORDER BY column_name;
    `);

    console.log("   Found columns:", mcColumns.rows.map(r => `${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`).join(", "));

    // Check estimate_items table columns
    console.log("\n📋 Checking estimate_items table...");
    const eiColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'estimate_items'
      AND column_name IN ('manual_store_name', 'line_type', 'calculation_type', 'material_code_snapshot', 'product_snapshot')
      ORDER BY column_name;
    `);

    console.log("   Found columns:", eiColumns.rows.map(r => `${r.column_name} (${r.data_type})`).join(", "));

    // Check operational material codes
    console.log("\n📦 Checking operational material codes...");
    const opCodes = await db.execute(sql`
      SELECT code, COUNT(*) as count
      FROM material_codes
      WHERE code IN ('OT_PACKING000N', 'OT_INSTALLATION00N', 'OT_TRANSPORT001N')
      GROUP BY code
      ORDER BY code;
    `);

    if (opCodes.rows.length > 0) {
      console.log("   Found operational codes:");
      opCodes.rows.forEach(r => console.log(`      ${r.code}: ${r.count} record(s)`));
    } else {
      console.log("   ⚠️  No operational codes found (may not have ABLBL clients)");
    }

    // Check ABLBL clients
    console.log("\n👥 Checking ABLBL clients...");
    const ablblClients = await db.execute(sql`
      SELECT id, name, format
      FROM clients
      WHERE format = 'ABLBL';
    `);

    console.log(`   Found ${ablblClients.rows.length} ABLBL client(s)`);
    if (ablblClients.rows.length > 0) {
      ablblClients.rows.forEach(c => console.log(`      - ${c.name} (ID: ${c.id})`));
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("✅ Verification Summary:");
    console.log("=".repeat(50));
    console.log(`✅ material_codes new columns: ${mcColumns.rows.length}/5`);
    console.log(`✅ estimate_items new columns: ${eiColumns.rows.length}/5`);
    console.log(`✅ Operational material codes: ${opCodes.rows.length}/3`);
    console.log(`✅ ABLBL clients: ${ablblClients.rows.length}`);
    console.log("=".repeat(50));

    if (mcColumns.rows.length === 5 && eiColumns.rows.length === 5) {
      console.log("\n🎉 Phase 1 Migration verified successfully!\n");
    } else {
      console.log("\n⚠️  Some columns may be missing. Check the output above.\n");
    }

  } catch (error) {
    console.error("❌ Verification failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

verifyMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
