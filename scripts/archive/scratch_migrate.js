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
  // 1. Clients additive columns
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_group_name TEXT;`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type TEXT DEFAULT 'normal';`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan TEXT;`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_person TEXT;`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms TEXT;`,

  // 2. Client Billing Profiles Table
  `CREATE TABLE IF NOT EXISTS client_billing_profiles (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    legal_company_name TEXT NOT NULL,
    branch_location_name TEXT,
    gstin TEXT NOT NULL,
    pan TEXT,
    state TEXT NOT NULL,
    state_code TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    shipping_address TEXT,
    contact_person TEXT,
    mobile TEXT,
    email TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT client_gstin_unique UNIQUE (client_id, gstin)
  );`,

  // 3. Stores additive columns
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_code TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS city TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS state TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS state_code TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS region_zone TEXT;`,
  `ALTER TABLE stores ADD COLUMN IF NOT EXISTS contact TEXT;`,

  // 4. Estimates additive columns
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_profile_id INTEGER REFERENCES client_billing_profiles(id) ON DELETE SET NULL;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_legal_name_snapshot TEXT;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_gstin_snapshot TEXT;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_state_snapshot TEXT;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_state_code_snapshot TEXT;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_address_snapshot TEXT;`,
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS shipping_address_snapshot TEXT;`
];

async function migrate() {
  console.log("🚀 Starting additive schema migration for Multi-GST...");
  const client = await pool.connect();
  try {
    for (const q of queries) {
      console.log(`Executing: ${q.trim().split('\n')[0]}...`);
      await client.query(q);
    }
    console.log("✅ Multi-GST additive schema migration complete!");
  } catch (err) {
    console.error("🚨 Migration failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
