import pg from 'pg';
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];

const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

const queries = [
  // 1. Add material_code to products
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS material_code TEXT;`,

  // 2. Add material_code to estimate_items
  `ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_code TEXT;`
];

async function migrate() {
  console.log("🚀 Starting additive schema migration for Material Codes...");
  const client = await pool.connect();
  try {
    for (const q of queries) {
      console.log(`Executing: ${q.trim().split('\n')[0]}...`);
      await client.query(q);
    }
    console.log("✅ Material Codes additive schema migration complete!");
  } catch (err) {
    console.error("🚨 Migration failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
