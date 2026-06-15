#!/usr/bin/env node
/**
 * Migration: Project Workspace v2
 * - execution_stores: add billing_ready, notes
 * - invoices: add transport_cost
 * All additive, idempotent (IF NOT EXISTS).
 */
import pg from "pg";
import { readFileSync } from "fs";

const { Client } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  (() => {
    try {
      const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
      const m = env.match(/DATABASE_URL=(.+)/);
      return m ? m[1].trim() : null;
    } catch {
      return null;
    }
  })();

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });

async function run() {
  await client.connect();
  console.log("Connected. Running Project Workspace v2 migration...");

  await client.query(`
    ALTER TABLE execution_stores
      ADD COLUMN IF NOT EXISTS billing_ready BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS notes TEXT;
  `);
  console.log("✓ execution_stores: billing_ready, notes added");

  await client.query(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
  `);
  console.log("✓ invoices: transport_cost added");

  await client.end();
  console.log("Migration complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
