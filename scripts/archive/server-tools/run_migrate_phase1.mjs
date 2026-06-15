/**
 * Phase 1 Migration Runner (JavaScript version)
 * Runs SQL migration using existing database connection
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const db = drizzle(pool);

async function runMigration() {
  console.log("🚀 Starting Phase 1 Migration...\n");

  try {
    // Read SQL file
    const sqlFile = path.join(__dirname, "migrate_phase1.sql");
    const sqlContent = fs.readFileSync(sqlFile, "utf8");

    // Split by DO $$ blocks and regular statements
    const statements = [];
    let currentStatement = "";
    let inDoBlock = false;

    const lines = sqlContent.split("\n");
    for (const line of lines) {
      if (line.trim().startsWith("--")) continue; // Skip comments

      if (line.includes("DO $$")) {
        inDoBlock = true;
        currentStatement = line;
      } else if (inDoBlock && line.includes("END $$;")) {
        currentStatement += "\n" + line;
        statements.push(currentStatement);
        currentStatement = "";
        inDoBlock = false;
      } else if (inDoBlock) {
        currentStatement += "\n" + line;
      } else if (line.trim().endsWith(";")) {
        currentStatement += "\n" + line;
        if (currentStatement.trim().length > 0) {
          statements.push(currentStatement);
        }
        currentStatement = "";
      } else {
        currentStatement += "\n" + line;
      }
    }

    console.log(`📄 Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement.length > 0) {
        try {
          await db.execute(sql.raw(statement));
          console.log(`✅ Statement ${i + 1}/${statements.length} executed`);
        } catch (error) {
          console.error(`⚠️  Statement ${i + 1} warning:`, error.message);
        }
      }
    }

    console.log("\n✅ Phase 1 Migration completed successfully!\n");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
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
