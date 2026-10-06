// Additive migration: create estimate_format_profiles, add format profile fields
// to clients & estimates, seed built-in profiles, and configure Wakefit stores.
// Idempotent — safe to run repeatedly.
//
// Run with: node scripts/migrate-estimate-format-profiles.mjs

import pg from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL missing");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

const queries = [
  // 1. Create estimate_format_profiles table
  `CREATE TABLE IF NOT EXISTS estimate_format_profiles (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    store_mode TEXT NOT NULL DEFAULT 'single',
    store_required BOOLEAN NOT NULL DEFAULT true,
    store_code_required BOOLEAN NOT NULL DEFAULT false,
    material_code_mode TEXT NOT NULL DEFAULT 'hidden',
    default_project_type TEXT,
    dc_document_type TEXT NOT NULL DEFAULT 'dc',
    print_layout TEXT NOT NULL DEFAULT 'retail_single_store',
    numbering_prefix TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 2. Additive columns on clients
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_format_profile_code TEXT;`,
  `ALTER TABLE clients ADD COLUMN IF NOT EXISTS allowed_format_profile_codes JSONB;`,

  // 3. Additive column on estimates
  `ALTER TABLE estimates ADD COLUMN IF NOT EXISTS format_profile_code TEXT;`,

  // 4. Seed format profiles
  `INSERT INTO estimate_format_profiles (code, name, description, store_mode, store_required, store_code_required, material_code_mode, default_project_type, dc_document_type, print_layout, is_active)
   VALUES
     ('RETAIL_SINGLE_STORE', 'Retail Store (Single Store)', 'One store per estimate. Store selection and store code required. Clean single-site presentation.', 'single', true, true, 'hidden', NULL, 'dc', 'retail_single_store', true),
     ('ABLBL', 'ABFRL Project (Multi-Store Grouping)', 'ABFRL multi-store execution rollout with store grouping, CAPEX/SELEX validation, and WCC certificates.', 'multi', true, true, 'optional', 'SELEX', 'wcc', 'abfrl_grouped', true),
     ('normal', 'Standard / Corporate Estimate', 'Standard estimate format without mandatory store scoping.', 'none', false, false, 'hidden', NULL, 'dc', 'standard', true)
   ON CONFLICT (code) DO UPDATE SET
     name = EXCLUDED.name,
     description = EXCLUDED.description,
     store_mode = EXCLUDED.store_mode,
     store_required = EXCLUDED.store_required,
     store_code_required = EXCLUDED.store_code_required,
     material_code_mode = EXCLUDED.material_code_mode,
     dc_document_type = EXCLUDED.dc_document_type,
     print_layout = EXCLUDED.print_layout;`,

  // 5. Backfill existing estimates format_profile_code
  `UPDATE estimates SET format_profile_code = 'ABLBL'
   WHERE (client_format = 'ABLBL' OR client_format = 'abfrl' OR client_format = 'ablbl')
     AND (format_profile_code IS NULL OR format_profile_code = '');`,

  `UPDATE estimates SET format_profile_code = 'normal'
   WHERE (format_profile_code IS NULL OR format_profile_code = '');`,

  // 6. Configure client 1 (ABFRL)
  `UPDATE clients SET
     default_format_profile_code = 'ABLBL',
     allowed_format_profile_codes = '["ABLBL"]'::jsonb
   WHERE id = 1 AND (default_format_profile_code IS NULL OR default_format_profile_code = '');`,

  // 7. Configure client 3 (Wakefit)
  `UPDATE clients SET
     name = 'Wakefit Innovations Pvt Ltd',
     client_group_name = 'Wakefit',
     default_format_profile_code = 'RETAIL_SINGLE_STORE',
     allowed_format_profile_codes = '["RETAIL_SINGLE_STORE"]'::jsonb
   WHERE id = 3;`,
];

(async () => {
  let okCount = 0;
  for (const q of queries) {
    try {
      await pool.query(q);
      console.log(`✓ ${q.replace(/\s+/g, " ").slice(0, 80)}…`);
      okCount++;
    } catch (e) {
      console.error(`✗ Query error: ${e.message}`);
    }
  }

  // Ensure Wakefit GST Billing Profile exists
  try {
    const existingBp = await pool.query(`SELECT id FROM client_billing_profiles WHERE client_id = 3 LIMIT 1`);
    if (existingBp.rows.length === 0) {
      await pool.query(`
        INSERT INTO client_billing_profiles (
          client_id, legal_company_name, branch_location_name, gstin, pan, state, state_code, billing_address, is_default, is_active
        ) VALUES (
          3, 'Wakefit Innovations Pvt Ltd', 'Pune', '27AABCW7791A1Z7', 'AABCW7791A', 'Maharashtra', '27', 'Wakefit Innovations Pvt Ltd, Pune, Maharashtra', true, true
        )
      `);
      console.log("✓ Created default GST Billing Profile for Wakefit Innovations Pvt Ltd");
    } else {
      console.log("✓ Wakefit GST Billing Profile already exists");
    }
  } catch (e) {
    console.error("✗ Failed to seed Wakefit billing profile:", e.message);
  }

  // Ensure Wakefit master brand exists
  let wakefitBrandId = 4;
  try {
    const brandRes = await pool.query(`SELECT id FROM brands WHERE parent_client_id = 3 OR name ILIKE 'wakefit' LIMIT 1`);
    if (brandRes.rows.length > 0) {
      wakefitBrandId = brandRes.rows[0].id;
      console.log(`✓ Using Wakefit Brand ID: ${wakefitBrandId}`);
    } else {
      const insBrand = await pool.query(`
        INSERT INTO brands (name, parent_client_id, parent_brand, is_active)
        VALUES ('Wakefit', 3, 'Wakefit', true) RETURNING id
      `);
      wakefitBrandId = insBrand.rows[0].id;
      console.log(`✓ Created Wakefit Brand ID: ${wakefitBrandId}`);
    }
  } catch (e) {
    console.error("✗ Brand check failed:", e.message);
  }

  // Seed Wakefit Stores
  const wakefitStores = [
    { name: "Baner - RO56", code: "RO56", location: "Baner", city: "Pune" },
    { name: "Hinjewadi - RO57", code: "RO57", location: "Hinjewadi", city: "Pune" },
    { name: "NIBM - RO58", code: "RO58", location: "NIBM", city: "Pune" },
    { name: "Creaticity - RO48", code: "RO48", location: "Creaticity", city: "Pune" },
    { name: "Wagholi - RO83", code: "RO83", location: "Wagholi", city: "Pune" },
  ];

  for (const st of wakefitStores) {
    try {
      const existing = await pool.query(
        `SELECT id FROM stores WHERE client_id = 3 AND (store_code = $1 OR name = $2)`,
        [st.code, st.name]
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO stores (name, client_id, brand_id, location, store_code, city, state, state_code, is_active)
           VALUES ($1, 3, $2, $3, $4, $5, 'Maharashtra', '27', true)`,
          [st.name, wakefitBrandId, st.location, st.code, st.city]
        );
        console.log(`✓ Seeded Wakefit store: ${st.name}`);
      } else {
        console.log(`✓ Wakefit store already exists: ${st.name} (ID: ${existing.rows[0].id})`);
      }
    } catch (e) {
      console.error(`✗ Store seed failed for ${st.name}:`, e.message);
    }
  }

  console.log(`\nMigration completed. Applied ${okCount} schema statements.`);
  await pool.end();
})();
