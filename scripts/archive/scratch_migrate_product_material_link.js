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
  // Link products to material code master
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS material_code_id INTEGER;`,
  // FK is intentionally NOT enforced here so the column can exist before material_codes is populated,
  // and so deleting a material code doesn't cascade-break products. Add FK later if you want strict.

  // Snapshot fields on estimate items
  `ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_code_id INTEGER;`,
  `ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_description TEXT;`,
];

async function migrate() {
  console.log("🚀 Additive schema migration: product↔material_code linking + estimate item snapshot");
  const client = await pool.connect();
  try {
    for (const q of queries) {
      const head = q.trim().split('\n')[0];
      console.log(`Executing: ${head}`);
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
