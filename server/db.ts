import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err: Error) => {
  console.error("✗ Supabase database connection error:", err.message);
});

export const db = drizzle(pool, { schema });
