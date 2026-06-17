import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from "../shared/schema";

import "dotenv/config";

// Required for Node.js environments (not needed in browser/WebContainer where native WebSocket exists)
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('connect', () => {
  console.log('✓ Connected to Supabase database successfully');
});

pool.on('error', (err: Error) => {
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
