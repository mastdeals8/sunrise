// One-off import: Peter England store list →
// reference-docs/PE Storelist.xlsx (sheet: "Active stores")
//
// Behavior:
// - Ensures client "Aditya Birla Lifestyle Brands Limited" exists
// - Ensures brand "Peter England" exists, linked to that client
// - Upserts each store by (store_code + client + brand)
// - Reports imported / updated / skipped (within-file dupes) / errors
//
// Run:  node scripts/import-pe-stores.mjs

import pg from "pg";
import path from "node:path";
import "dotenv/config";
import XLSX from "xlsx";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const SOURCE_FILE = "/Users/Kunal/Documents/sunrise/reference-docs/PE Storelist.xlsx";
const SHEET_NAME = "Active stores";
const CLIENT_NAME = "Aditya Birla Lifestyle Brands Limited";
const BRAND_NAME = "Peter England";

const cleanUrl = process.env.DATABASE_URL.split("?")[0];
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

// Mirror of shared/textFormat.ts nameMatchKey (lowered, alphanumerics only)
const nameMatchKey = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
const cleanString = (v) => String(v ?? "").trim();
const compactSpaces = (v) => cleanString(v).replace(/\s+/g, " ");

async function ensureClient(client) {
  const existing = await client.query(
    `SELECT id, name FROM clients WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = $1 LIMIT 1`,
    [nameMatchKey(CLIENT_NAME)]
  );
  if (existing.rows[0]) {
    console.log(`✓ Client exists: "${existing.rows[0].name}" (id=${existing.rows[0].id})`);
    return existing.rows[0].id;
  }
  const inserted = await client.query(
    `INSERT INTO clients (name, format, client_type, is_active)
     VALUES ($1, 'ABLBL', 'corporate', true) RETURNING id, name`,
    [CLIENT_NAME]
  );
  console.log(`+ Client created: "${inserted.rows[0].name}" (id=${inserted.rows[0].id})`);
  return inserted.rows[0].id;
}

async function ensureBrand(client, clientId) {
  const key = nameMatchKey(BRAND_NAME);
  // Match by name only first — brand names are globally unique
  const existing = await client.query(
    `SELECT id, name, parent_client_id FROM brands
     WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = $1 LIMIT 1`,
    [key]
  );
  if (existing.rows[0]) {
    const b = existing.rows[0];
    if (b.parent_client_id !== clientId) {
      await client.query(
        `UPDATE brands SET parent_client_id = $1, parent_brand = $2 WHERE id = $3`,
        [clientId, CLIENT_NAME, b.id]
      );
      console.log(`✓ Brand exists: "${b.name}" (id=${b.id}) — relinked to client ${clientId}`);
    } else {
      console.log(`✓ Brand exists: "${b.name}" (id=${b.id}) — already linked`);
    }
    return b.id;
  }
  const inserted = await client.query(
    `INSERT INTO brands (name, parent_client_id, parent_brand, is_active)
     VALUES ($1, $2, $3, true) RETURNING id, name`,
    [BRAND_NAME, clientId, CLIENT_NAME]
  );
  console.log(`+ Brand created: "${inserted.rows[0].name}" (id=${inserted.rows[0].id}) → client ${clientId}`);
  return inserted.rows[0].id;
}

function parseRows() {
  const wb = XLSX.readFile(SOURCE_FILE);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(", ")}`);
  }
  const ws = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  return rows.map((r, idx) => ({
    excelRow: idx + 2,
    storeCode: cleanString(r["Store Code"]),
    name: compactSpaces(r["Store Name"]),
    city: compactSpaces(r["CITY"]),
    state: compactSpaces(r["STATE"]),
    regionZone: compactSpaces(r["REGION"]),
    location: compactSpaces(r["LOCATION"]),
    contactPerson: compactSpaces(r["Store Manger Name"]),
    contactPhone: cleanString(r["Store Manger No"]),
    address: compactSpaces(r["Store Address With Pin Code"]),
    pincode: cleanString(r["Pincode"]),
  }));
}

async function importStores(client, clientId, brandId, rows) {
  let imported = 0, updated = 0, skipped = 0;
  const errors = [];
  const seen = new Map();

  for (const row of rows) {
    if (!row.storeCode && !row.name) {
      skipped++;
      errors.push({ row: row.excelRow, message: "Blank row (no store code or name)" });
      continue;
    }
    if (!row.storeCode) {
      skipped++;
      errors.push({ row: row.excelRow, message: `Missing Store Code for "${row.name}"` });
      continue;
    }

    // Within-file dedupe by store code
    const dKey = row.storeCode.toLowerCase();
    if (seen.has(dKey)) {
      skipped++;
      errors.push({ row: row.excelRow, message: `Duplicate Store Code "${row.storeCode}" with row ${seen.get(dKey)}; skipped` });
      continue;
    }
    seen.set(dKey, row.excelRow);

    try {
      // Match by store_code + client + brand
      const existing = await client.query(
        `SELECT id FROM stores
         WHERE LOWER(store_code) = LOWER($1)
           AND client_id = $2
           AND brand_id = $3
         LIMIT 1`,
        [row.storeCode, clientId, brandId]
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE stores SET
             name = COALESCE(NULLIF($1, ''), name),
             location = COALESCE(NULLIF($2, ''), location),
             address = COALESCE(NULLIF($3, ''), address),
             contact_person = COALESCE(NULLIF($4, ''), contact_person),
             contact_phone = COALESCE(NULLIF($5, ''), contact_phone),
             city = COALESCE(NULLIF($6, ''), city),
             state = COALESCE(NULLIF($7, ''), state),
             region_zone = COALESCE(NULLIF($8, ''), region_zone),
             is_active = true
           WHERE id = $9`,
          [row.name, row.location, row.address, row.contactPerson, row.contactPhone, row.city, row.state, row.regionZone, existing.rows[0].id]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO stores
             (name, store_code, client_id, brand_id, location, address, contact_person, contact_phone, city, state, region_zone, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
          [row.name || row.storeCode, row.storeCode, clientId, brandId, row.location || null, row.address || null, row.contactPerson || null, row.contactPhone || null, row.city || null, row.state || null, row.regionZone || null]
        );
        imported++;
      }
    } catch (e) {
      errors.push({ row: row.excelRow, message: `${row.storeCode}: ${e.message}` });
    }
  }

  return { imported, updated, skipped, errors, total: rows.length };
}

async function main() {
  console.log(`\nImporting stores from: ${path.basename(SOURCE_FILE)} → sheet "${SHEET_NAME}"`);
  const rows = parseRows();
  console.log(`Parsed ${rows.length} data rows.\n`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const clientId = await ensureClient(client);
    const brandId = await ensureBrand(client, clientId);
    console.log("");
    const stats = await importStores(client, clientId, brandId, rows);
    await client.query("COMMIT");

    console.log("\n========================================");
    console.log("Import result");
    console.log("========================================");
    console.log(`Total rows : ${stats.total}`);
    console.log(`Imported   : ${stats.imported}`);
    console.log(`Updated    : ${stats.updated}`);
    console.log(`Skipped    : ${stats.skipped}`);
    console.log(`Errors     : ${stats.errors.length}`);
    if (stats.errors.length) {
      console.log("\nFirst 20 issues:");
      stats.errors.slice(0, 20).forEach(e => console.log(`  Row ${e.row}: ${e.message}`));
      if (stats.errors.length > 20) console.log(`  …and ${stats.errors.length - 20} more`);
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("FAILED, rolled back:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
