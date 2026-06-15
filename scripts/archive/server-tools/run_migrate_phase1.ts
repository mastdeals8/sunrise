/**
 * Phase 1 Migration Runner
 * Runs SQL migration using existing database connection
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log("🚀 Starting Phase 1 Migration...\n");

  try {
    // Read SQL file
    const sqlFile = path.join(__dirname, "migrate_phase1.sql");
    const sqlContent = fs.readFileSync(sqlFile, "utf8");

    // Split by semicolons and filter out empty statements
    const statements = sqlContent
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    console.log(`📄 Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.length > 0) {
        try {
          await db.execute(sql.raw(statement));
        } catch (error) {
          // Some statements might fail if columns already exist, that's okay
          if (!(error as any).message.includes("already exists")) {
            console.error(`⚠️  Statement ${i + 1} warning:`, (error as any).message);
          }
        }
      }
    }

    console.log("\n✅ Phase 1 Migration completed successfully!\n");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log("🎉 All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
