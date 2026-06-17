import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

import "dotenv/config";

const { Pool } = pg;

// Lazy initialization: Pool and drizzle are created on first property access,
// not at import time. This prevents pg from opening TCP connections during
// module load — critical for Bolt/WebContainer where the pg TCP→MessagePort
// bridge throws DataCloneError if the pool is created before the server is ready.

type PoolInstance = InstanceType<typeof Pool>;
type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

let _pool: PoolInstance | null = null;
let _db: DbInstance | null = null;

function getPoolInstance(): PoolInstance {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
      process.exit(1);
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    _pool.on("error", (err: Error) => {
      console.error("✗ Supabase database connection error:", err.message);
    });
  }
  return _pool;
}

function getDbInstance(): DbInstance {
  if (!_db) _db = drizzle(getPoolInstance(), { schema });
  return _db;
}

export const pool = new Proxy({} as PoolInstance, {
  get: (_t, p) => (getPoolInstance() as any)[p],
});

export const db = new Proxy({} as DbInstance, {
  get: (_t, p) => (getDbInstance() as any)[p],
});
