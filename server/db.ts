import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema";

import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];

const poolConfig: any = {
  connectionString: cleanUrl,
  ssl: {
    rejectUnauthorized: false
  }
};

export const pool = new Pool(poolConfig);

pool.on('connect', () => {
  console.log('✓ Connected to Supabase database successfully');
});

pool.on('error', (err) => {
  console.error('✗ Supabase database connection error:', err.message);
});

// Test initial connection
(async () => {
  try {
    const client = await pool.connect();
    console.log('✓ Initial Supabase connection test successful');
    client.release();
  } catch (err) {
    const error = err as Error;
    console.error('✗ Initial Supabase connection failed:', error.message);
  }
})();

export const db = drizzle(pool, { schema });
