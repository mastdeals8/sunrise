// Additive migration: customer-specific rate cards.
// Tables only — no UI/integration yet. Adds:
//   customer_rate_cards          (one card per client/brand/project-type/effective-date)
//   customer_rate_items          (rate per product/material code within a card)
// All columns/tables use IF NOT EXISTS. Safe to run repeatedly.
//
// Run:  node scripts/migrate-customer-rate-cards.mjs

import pg from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL missing");
  process.exit(1);
}

const cleanUrl = process.env.DATABASE_URL.split("?")[0];
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

const queries = [
  `CREATE TABLE IF NOT EXISTS customer_rate_cards (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
    project_type TEXT,            -- e.g. "SELEX", "CAPEX", "rollout", "service"
    effective_from TIMESTAMP,     -- inclusive; null = always-effective
    effective_to TIMESTAMP,       -- inclusive; null = no expiry
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );`,
  `CREATE TABLE IF NOT EXISTS customer_rate_items (
    id SERIAL PRIMARY KEY,
    rate_card_id INTEGER REFERENCES customer_rate_cards(id) ON DELETE CASCADE NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    material_code_id INTEGER REFERENCES material_codes(id) ON DELETE SET NULL,
    description TEXT,
    uom TEXT NOT NULL DEFAULT 'pcs',
    rate REAL NOT NULL DEFAULT 0,
    gst_percent REAL NOT NULL DEFAULT 18,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  );`,
  // Helpful indexes (cheap, safe). Use IF NOT EXISTS form.
  `CREATE INDEX IF NOT EXISTS idx_rate_cards_client ON customer_rate_cards(client_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rate_cards_brand ON customer_rate_cards(brand_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rate_items_card ON customer_rate_items(rate_card_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rate_items_product ON customer_rate_items(product_id);`,
  `CREATE INDEX IF NOT EXISTS idx_rate_items_mc ON customer_rate_items(material_code_id);`,
];

(async () => {
  let okCount = 0;
  for (const q of queries) {
    try {
      await pool.query(q);
      const head = q.replace(/\s+/g, " ").slice(0, 90);
      console.log(`✓ ${head}${q.length > 90 ? "…" : ""}`);
      okCount++;
    } catch (e) {
      console.error(`✗ ${q.slice(0, 90)} :: ${e.message}`);
    }
  }
  console.log(`\nApplied ${okCount}/${queries.length} additive statements.`);
  await pool.end();
})();
