/**
 * Phase 1 Migration Script
 *
 * Purpose: Seed operational material codes for ABLBL clients
 *
 * Changes:
 * 1. Seed OT_PACKING000N, OT_INSTALLATION00N, OT_TRANSPORT001N for all ABLBL clients
 * 2. These are client-level common codes (brandId = NULL)
 * 3. Idempotent: Can run multiple times safely
 *
 * Safety:
 * - No data deletion
 * - No column drops
 * - Uses INSERT with conflict handling
 * - Preserves all existing data
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { clients, materialCodes } from "../shared/schema.ts";
import { eq } from "drizzle-orm";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function migratePhase1() {
  console.log("🚀 Starting Phase 1 Migration...\n");

  try {
    // Step 1: Get all ABLBL clients
    console.log("📋 Step 1: Fetching ABLBL clients...");
    const ablblClients = await db
      .select()
      .from(clients)
      .where(eq(clients.format, "ABLBL"));

    console.log(`   Found ${ablblClients.length} ABLBL client(s)\n`);

    if (ablblClients.length === 0) {
      console.log("⚠️  No ABLBL clients found. Skipping material code seeding.\n");
      return;
    }

    // Step 2: Define operational material codes
    const operationalCodes = [
      {
        code: "OT_PACKING000N",
        productName: "Packing Charges",
        description: "Packing and handling charges",
        hsn: "996511",
        uom: "job",
        gstPercent: 18,
        defaultRate: 0,
        category: "Operational",
        isStandard: true,
      },
      {
        code: "OT_INSTALLATION00N",
        productName: "Installation Charges",
        description: "Installation and setup charges",
        hsn: "995415",
        uom: "job",
        gstPercent: 18,
        defaultRate: 0,
        category: "Operational",
        isStandard: true,
      },
      {
        code: "OT_TRANSPORT001N",
        productName: "Transport Charges",
        description: "Transportation and logistics charges",
        hsn: "996511",
        uom: "job",
        gstPercent: 18,
        defaultRate: 0,
        category: "Operational",
        isStandard: true,
      },
    ];

    // Step 3: Seed operational material codes for each ABLBL client
    console.log("📦 Step 2: Seeding operational material codes...\n");

    let totalSeeded = 0;
    let totalSkipped = 0;

    for (const client of ablblClients) {
      console.log(`   Processing client: ${client.name} (ID: ${client.id})`);

      for (const opCode of operationalCodes) {
        // Check if material code already exists for this client
        const existing = await db
          .select()
          .from(materialCodes)
          .where(eq(materialCodes.clientId, client.id))
          .where(eq(materialCodes.code, opCode.code));

        if (existing.length > 0) {
          console.log(`      ⏭️  ${opCode.code} already exists, skipping`);
          totalSkipped++;
          continue;
        }

        // Insert new material code
        await db.insert(materialCodes).values({
          clientId: client.id,
          brandId: null, // Client-level common code (not brand-specific)
          code: opCode.code,
          productName: opCode.productName,
          description: opCode.description,
          hsn: opCode.hsn,
          uom: opCode.uom,
          gstPercent: opCode.gstPercent,
          defaultRate: opCode.defaultRate,
          category: opCode.category,
          isStandard: opCode.isStandard,
          isActive: true,
        });

        console.log(`      ✅ ${opCode.code} seeded successfully`);
        totalSeeded++;
      }

      console.log("");
    }

    // Step 4: Summary
    console.log("📊 Migration Summary:");
    console.log(`   ✅ Material codes seeded: ${totalSeeded}`);
    console.log(`   ⏭️  Material codes skipped (already exist): ${totalSkipped}`);
    console.log(`   📦 Total ABLBL clients processed: ${ablblClients.length}\n`);

    console.log("✅ Phase 1 Migration completed successfully!\n");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration
migratePhase1()
  .then(() => {
    console.log("🎉 All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
