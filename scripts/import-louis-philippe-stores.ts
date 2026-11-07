import fs from "fs";
import { pool } from "../server/db";
import { decodeBufferToString, parseCsvText } from "../client/src/pages/operations/utils/spreadsheetParser";
import { normalizeDisplayName } from "../shared/textFormat";

const CSV_PATH = "/Users/Kunal/Downloads/stores-5.csv";
const TARGET_COMPANY_ID = 1;

async function main() {
  console.log("==================================================================");
  console.log("SUNRISE MEDIA ERP — LOUIS PHILIPPE WEST REGION STORES IMPORT");
  console.log("==================================================================");

  // 1. Database & Workspace Verification
  console.log("\n[1] Verifying Target Database and Master Entities...");
  const compRes = await pool.query("SELECT id, name FROM public.companies WHERE id = $1", [TARGET_COMPANY_ID]);
  if (compRes.rows.length === 0) {
    throw new Error(`Target company ${TARGET_COMPANY_ID} not found!`);
  }
  console.log(`  ✓ Confirmed Target Company: ID = ${compRes.rows[0].id} ("${compRes.rows[0].name}")`);

  const clientRes = await pool.query(
    "SELECT id, name, company_id FROM public.clients WHERE company_id = $1 AND name ILIKE $2",
    [TARGET_COMPANY_ID, "%Aditya Birla Lifestyle Brands Limited%"]
  );
  if (clientRes.rows.length === 0) {
    throw new Error("Client 'Aditya Birla Lifestyle Brands Limited' not found in Company 1!");
  }
  const targetClient = clientRes.rows[0];
  console.log(`  ✓ Resolved Corporate Client: ID = ${targetClient.id} ("${targetClient.name}")`);

  const brandRes = await pool.query(
    "SELECT id, name, parent_client_id, company_id FROM public.brands WHERE company_id = $1 AND name ILIKE $2 AND parent_client_id = $3",
    [TARGET_COMPANY_ID, "Louis Philippe", targetClient.id]
  );
  if (brandRes.rows.length === 0) {
    throw new Error("Brand 'Louis Philippe' under ABLBL not found in Company 1!");
  }
  const targetBrand = brandRes.rows[0];
  console.log(`  ✓ Resolved Brand: ID = ${targetBrand.id} ("${targetBrand.name}")`);

  // 2. Read and Parse CSV File
  console.log("\n[2] Reading and Parsing stores-5.csv...");
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`File not found at: ${CSV_PATH}`);
  }
  const fileBuffer = fs.readFileSync(CSV_PATH);
  const decodedText = decodeBufferToString(fileBuffer);
  const parsed = parseCsvText(decodedText);

  console.log(`  ✓ Raw Lines Decoded: ${decodedText.split(/\r?\n/).length}`);
  console.log(`  ✓ Extracted Headers: ${parsed.headers.join(", ")}`);
  console.log(`  ✓ Populated Data Rows: ${parsed.allRows.length}`);
  console.log(`  ✓ Ignored Completely Blank Rows: ${parsed.blankRowsCount}`);

  if (parsed.allRows.length !== 16) {
    throw new Error(`Expected exactly 16 populated rows, but found ${parsed.allRows.length}`);
  }

  // 3. Import & Database Synchronization
  console.log("\n[3] Executing Database Synchronization...");
  const reconciliation: Array<{
    csvRow: number;
    storeName: string;
    storeCode: string;
    sapCode: string | null;
    client: string;
    brand: string;
    storeId: number;
    action: "Created" | "Updated" | "Skipped";
  }> = [];

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let idx = 0; idx < parsed.allRows.length; idx++) {
    const raw = parsed.allRows[idx];
    const csvRow = idx + 2; // header is row 1, data starts at row 2

    const storeName = normalizeDisplayName(raw["Store Name"]);
    const storeCode = String(raw["Store Code"] || "").trim();
    const rawSap = raw["SAP Code"] ? String(raw["SAP Code"]).trim() : null;
    const sapCode = rawSap && rawSap.toLowerCase() !== "null" ? rawSap : null;
    const city = normalizeDisplayName(raw["City"]) || null;
    const state = normalizeDisplayName(raw["State"]) || null;
    const stateCode = raw["State Code"] ? String(raw["State Code"]).trim() : null;
    const regionZone = raw["Region / Zone"] ? String(raw["Region / Zone"]).trim() : null;
    const contactPerson = normalizeDisplayName(raw["Contact Person"]) || null;
    const contactPhone = raw["Phone"] ? String(raw["Phone"]).trim() : null;
    const address = raw["Address"] ? String(raw["Address"]).trim() : null;

    if (!storeName || !storeCode) {
      console.warn(`  ⚠️ Row ${csvRow} missing store name or store code; skipped`);
      skippedCount++;
      continue;
    }

    // Match priority: 1. store_code under client/brand, 2. sap_code under client/brand, 3. name + city
    let existingQuery = await pool.query(
      `SELECT id, name, store_code, sap_code, client_id, brand_id 
       FROM public.stores 
       WHERE company_id = $1 AND client_id = $2 AND brand_id = $3 AND LOWER(store_code) = LOWER($4)`,
      [TARGET_COMPANY_ID, targetClient.id, targetBrand.id, storeCode]
    );

    let matchedStore = existingQuery.rows[0];

    if (!matchedStore && sapCode) {
      const sapMatch = await pool.query(
        `SELECT id, name, store_code, sap_code, client_id, brand_id 
         FROM public.stores 
         WHERE company_id = $1 AND client_id = $2 AND brand_id = $3 AND LOWER(sap_code) = LOWER($4)`,
        [TARGET_COMPANY_ID, targetClient.id, targetBrand.id, sapCode]
      );
      matchedStore = sapMatch.rows[0];
    }

    if (!matchedStore) {
      const nameMatch = await pool.query(
        `SELECT id, name, store_code, sap_code, client_id, brand_id 
         FROM public.stores 
         WHERE company_id = $1 AND client_id = $2 AND brand_id = $3 AND LOWER(name) = LOWER($4) AND LOWER(city) = LOWER($5)`,
        [TARGET_COMPANY_ID, targetClient.id, targetBrand.id, storeName, city || ""]
      );
      matchedStore = nameMatch.rows[0];
    }

    if (matchedStore) {
      // UPDATE: preserve existing SAP Code if CSV SAP Code is blank
      const finalSapCode = sapCode !== null ? sapCode : matchedStore.sap_code;
      const updateRes = await pool.query(
        `UPDATE public.stores 
         SET name = $1, store_code = $2, sap_code = $3, city = $4, state = $5, state_code = $6, 
             region_zone = $7, contact_person = $8, contact_phone = $9, address = $10, is_active = true
         WHERE id = $11
         RETURNING id, name, store_code, sap_code`,
        [storeName, storeCode, finalSapCode, city, state, stateCode, regionZone, contactPerson, contactPhone, address, matchedStore.id]
      );
      const u = updateRes.rows[0];
      updatedCount++;
      reconciliation.push({
        csvRow,
        storeName: u.name,
        storeCode: u.store_code,
        sapCode: u.sap_code,
        client: targetClient.name,
        brand: targetBrand.name,
        storeId: u.id,
        action: "Updated",
      });
    } else {
      // CREATE: insert new store record
      const insertRes = await pool.query(
        `INSERT INTO public.stores (
           company_id, client_id, brand_id, name, store_code, sap_code, city, state, state_code,
           region_zone, contact_person, contact_phone, address, is_active, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, NOW())
         RETURNING id, name, store_code, sap_code`,
        [TARGET_COMPANY_ID, targetClient.id, targetBrand.id, storeName, storeCode, sapCode, city, state, stateCode, regionZone, contactPerson, contactPhone, address]
      );
      const c = insertRes.rows[0];
      createdCount++;
      reconciliation.push({
        csvRow,
        storeName: c.name,
        storeCode: c.store_code,
        sapCode: c.sap_code,
        client: targetClient.name,
        brand: targetBrand.name,
        storeId: c.id,
        action: "Created",
      });
    }
  }

  // 4. Print Reconciliation Table
  console.log("\n==================================================================");
  console.log("RECONCILIATION SUMMARY");
  console.log("==================================================================");
  console.log(`Total Populated Rows in CSV : 16`);
  console.log(`Total Blank Rows Skipped     : ${parsed.blankRowsCount}`);
  console.log(`Stores Created               : ${createdCount}`);
  console.log(`Stores Updated               : ${updatedCount}`);
  console.log(`Rows Skipped                 : ${skippedCount}`);
  console.log("------------------------------------------------------------------");

  console.table(reconciliation);

  // 5. Verification Query Directly From DB
  console.log("\n[4] Database Direct Verification Check...");
  const dbVerify = await pool.query(
    `SELECT s.id, s.name, s.store_code, s.sap_code, s.city, s.state, s.state_code, s.region_zone,
            c.name as client_name, b.name as brand_name
     FROM public.stores s
     JOIN public.clients c ON c.id = s.client_id
     JOIN public.brands b ON b.id = s.brand_id
     WHERE s.company_id = $1 AND s.brand_id = $2
     ORDER BY s.id ASC`,
    [TARGET_COMPANY_ID, targetBrand.id]
  );

  console.log(`  ✓ Total Louis Philippe Stores in Database: ${dbVerify.rows.length}`);
  if (dbVerify.rows.length !== 16) {
    throw new Error(`Verification failed: Expected 16 stores in DB, found ${dbVerify.rows.length}`);
  }

  console.log("\n🎉 ALL 16 LOUIS PHILIPPE STORES IMPORTED & VERIFIED IN LIVE DATABASE!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Import failed:", err);
  process.exit(1);
});
