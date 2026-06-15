import pg from 'pg';
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];

const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false }
});

const queries = [
  // Material Codes master table
  `CREATE TABLE IF NOT EXISTS material_codes (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    description TEXT,
    hsn TEXT,
    uom TEXT DEFAULT 'nos',
    gst_percent REAL DEFAULT 18,
    default_rate REAL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );`,
  `CREATE INDEX IF NOT EXISTS idx_material_codes_client ON material_codes(client_id);`,
  `CREATE INDEX IF NOT EXISTS idx_material_codes_brand ON material_codes(brand_id);`,
  `CREATE INDEX IF NOT EXISTS idx_material_codes_code ON material_codes(code);`,

  // App settings key/value
  `CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
  );`,
];

async function migrate() {
  console.log("🚀 Additive schema migration: material_codes + app_settings");
  const client = await pool.connect();
  try {
    for (const q of queries) {
      const head = q.trim().split('\n')[0];
      console.log(`Executing: ${head}...`);
      await client.query(q);
    }
    console.log("✅ Migration complete.");
  } catch (err) {
    console.error("🚨 Migration failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
