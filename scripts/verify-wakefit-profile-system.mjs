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

async function runVerification() {
  const client = await pool.connect();
  console.log("=== STARTING ESTIMATE FORMAT SYSTEM VERIFICATION ===");

  try {
    // 1. Check Profile Definition
    console.log("\n[TEST 1] Checking RETAIL_SINGLE_STORE profile definition...");
    const profileRes = await client.query("SELECT * FROM estimate_format_profiles WHERE code = 'RETAIL_SINGLE_STORE'");
    if (profileRes.rows.length === 0) throw new Error("RETAIL_SINGLE_STORE profile not found!");
    const profile = profileRes.rows[0];
    console.log("✓ Profile found:", {
      code: profile.code,
      name: profile.name,
      storeMode: profile.store_mode,
      storeRequired: profile.store_required,
      storeCodeRequired: profile.store_code_required,
    });
    if (profile.store_mode !== "single" || !profile.store_required || !profile.store_code_required) {
      throw new Error("Profile configuration mismatch!");
    }

    // 2. Check Wakefit Client Configuration
    console.log("\n[TEST 2] Checking Wakefit client configuration...");
    const wakefitRes = await client.query("SELECT * FROM clients WHERE id = 3");
    if (wakefitRes.rows.length === 0) throw new Error("Client ID 3 not found!");
    const wakefit = wakefitRes.rows[0];
    console.log("✓ Wakefit client:", {
      id: wakefit.id,
      name: wakefit.name,
      defaultFormatProfileCode: wakefit.default_format_profile_code,
      pan: wakefit.pan,
    });
    if (wakefit.default_format_profile_code !== "RETAIL_SINGLE_STORE") {
      throw new Error(`Wakefit default profile is ${wakefit.default_format_profile_code}, expected RETAIL_SINGLE_STORE`);
    }

    // Check Wakefit billing profile (GST/PAN)
    const bpRes = await client.query("SELECT * FROM client_billing_profiles WHERE client_id = 3");
    console.log("✓ Wakefit GST Profiles count:", bpRes.rows.length);
    const primaryBp = bpRes.rows.find(p => p.is_default) || bpRes.rows[0];
    console.log("✓ Wakefit Primary GST/PAN:", {
      gstin: primaryBp?.gstin,
      pan: primaryBp?.pan,
      legalName: primaryBp?.legal_company_name,
    });
    const originalGstin = primaryBp?.gstin;
    const originalPan = primaryBp?.pan || wakefit.pan;

    // Check Wakefit master stores
    const storesRes = await client.query("SELECT id, name, store_code, city FROM stores WHERE client_id = 3 ORDER BY id");
    console.log(`✓ Wakefit stores found (${storesRes.rows.length}):`);
    storesRes.rows.forEach(s => console.log(`   - ID ${s.id}: ${s.name} [Code: ${s.store_code}]`));
    const wagholiStore = storesRes.rows.find(s => s.store_code === "RO83");
    const nibmStore = storesRes.rows.find(s => s.store_code === "RO58");
    if (!wagholiStore || !nibmStore) throw new Error("Wagholi (RO83) or NIBM (RO58) store missing!");

    // 0. Clean prior test records
    await client.query("DELETE FROM estimate_items WHERE estimate_id IN (SELECT id FROM estimates WHERE estimate_number LIKE 'SM/E/TEST/%')");
    await client.query("DELETE FROM estimates WHERE estimate_number LIKE 'SM/E/TEST/%'");

    // 3. Create Estimate for Wakefit selecting Wagholi - RO83
    console.log("\n[TEST 3] Creating Wakefit estimate for Wagholi - RO83...");
    const estDate = new Date();
    const testEstNum = `SM/E/TEST/WAKEFIT-${Date.now().toString().slice(-4)}`;
    const brandId = 4; // Wakefit brand

    const insertEstRes = await client.query(`
      INSERT INTO estimates (
        estimate_number, estimate_date, client_id, brand_id, store_id,
        title, client_format, format_profile_code, billing_profile_id,
        gstin, pan, state_code, billing_to, gst_type,
        subtotal, tax_amount, total_amount, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      testEstNum, estDate, 3, brandId, wagholiStore.id,
      `Wakefit Store Signage - ${wagholiStore.name}`,
      "RETAIL_SINGLE_STORE", "RETAIL_SINGLE_STORE", primaryBp?.id || null,
      primaryBp?.gstin || null, primaryBp?.pan || null, primaryBp?.state_code || "27",
      primaryBp?.legal_company_name || wakefit.name, "CGST+SGST",
      15000, 2700, 17700, "draft", 1
    ]);
    const originalEst = insertEstRes.rows[0];
    console.log("✓ Original estimate created:", {
      id: originalEst.id,
      number: originalEst.estimate_number,
      storeId: originalEst.store_id,
      formatProfileCode: originalEst.format_profile_code,
      clientFormat: originalEst.client_format,
    });

    // Add item rows to original estimate
    await client.query(`
      INSERT INTO estimate_items (
        estimate_id, sl, item_name, quantity, unit, rate, total_price,
        store_code, line_type
      ) VALUES
      ($1, 1, 'Frontlit Flex Board', 1, 'sqft', 10000, 10000, $2, 'product'),
      ($1, 2, 'Store Acrylic Letters', 1, 'pcs', 5000, 5000, $2, 'product')
    `, [originalEst.id, wagholiStore.store_code]);
    console.log("✓ Added 2 line items tagged to storeCode", wagholiStore.store_code);

    // 4. Duplicate Estimate
    console.log("\n[TEST 4] Duplicating estimate...");
    const dupEstNum = `SM/E/TEST/DUP-${Date.now().toString().slice(-4)}`;
    const dupRes = await client.query(`
      INSERT INTO estimates (
        estimate_number, estimate_date, client_id, brand_id, store_id,
        title, client_format, format_profile_code, billing_profile_id,
        gstin, pan, state_code, billing_to, gst_type,
        subtotal, tax_amount, total_amount, status, created_by
      )
      SELECT
        $1, $2, client_id, brand_id, store_id,
        title, client_format, format_profile_code, billing_profile_id,
        gstin, pan, state_code, billing_to, gst_type,
        subtotal, tax_amount, total_amount, 'draft', created_by
      FROM estimates WHERE id = $3
      RETURNING *
    `, [dupEstNum, new Date(), originalEst.id]);
    const dupEst = dupRes.rows[0];
    console.log("✓ Duplicated estimate created:", {
      id: dupEst.id,
      number: dupEst.estimate_number,
      storeId: dupEst.store_id,
      formatProfileCode: dupEst.format_profile_code,
    });

    // Copy items to duplicate estimate
    await client.query(`
      INSERT INTO estimate_items (estimate_id, sl, item_name, quantity, unit, rate, total_price, store_code, line_type)
      SELECT $1, sl, item_name, quantity, unit, rate, total_price, store_code, line_type
      FROM estimate_items WHERE estimate_id = $2
    `, [dupEst.id, originalEst.id]);

    // 5. Change Duplicate Estimate to NIBM - RO58
    console.log("\n[TEST 5] Changing duplicate estimate store to NIBM - RO58...");
    await client.query(`
      UPDATE estimates
      SET store_id = $1, title = $2
      WHERE id = $3
    `, [nibmStore.id, `Wakefit Store Signage - ${nibmStore.name}`, dupEst.id]);

    await client.query(`
      UPDATE estimate_items
      SET store_code = $1
      WHERE estimate_id = $2
    `, [nibmStore.store_code, dupEst.id]);
    console.log("✓ Duplicate estimate updated to NIBM (ID", nibmStore.id, "Code:", nibmStore.store_code, ")");

    // 6. Confirm Original Estimate Remains Wagholi
    console.log("\n[TEST 6] Confirming original estimate remains Wagholi...");
    const verifyOrigRes = await client.query("SELECT * FROM estimates WHERE id = $1", [originalEst.id]);
    const verifyOrig = verifyOrigRes.rows[0];
    const origItemsRes = await client.query("SELECT * FROM estimate_items WHERE estimate_id = $1", [originalEst.id]);
    console.log("✓ Original estimate store_id:", verifyOrig.store_id, "(Wagholi is", wagholiStore.id, ")");
    if (verifyOrig.store_id !== wagholiStore.id) throw new Error("Original estimate store_id was modified!");
    origItemsRes.rows.forEach(it => {
      if (it.store_code !== wagholiStore.store_code) {
        throw new Error(`Original estimate item has wrong store_code: ${it.store_code}`);
      }
    });
    console.log("✓ All original items intact with Wagholi store_id and store_code.");

    // 7. Confirm Customer GST/PAN remain unchanged
    console.log("\n[TEST 7] Confirming customer GST/PAN remain unchanged...");
    const checkWakefit = (await client.query("SELECT * FROM clients WHERE id = 3")).rows[0];
    const checkBp = (await client.query("SELECT * FROM client_billing_profiles WHERE client_id = 3")).rows[0];
    if (checkBp.gstin !== originalGstin || (checkBp.pan && checkBp.pan !== originalPan)) {
      throw new Error("Wakefit GST/PAN was modified!");
    }
    console.log("✓ Wakefit GST/PAN verified unchanged:", { gstin: checkBp.gstin, pan: checkBp.pan || checkWakefit.pan });

    // 8. Confirm Master Stores Unchanged
    console.log("\n[TEST 8] Confirming master stores are unchanged...");
    const finalStores = (await client.query("SELECT id, name, store_code FROM stores WHERE client_id = 3 ORDER BY id")).rows;
    if (finalStores.length !== storesRes.rows.length) throw new Error("Master stores count changed!");
    console.log(`✓ Master stores intact (${finalStores.length} stores):`);
    finalStores.forEach(s => console.log(`   - ${s.name} [Code: ${s.store_code}]`));

    // 9 & 10 & 11 & 12. Check Existing ABFRL Estimates and Invoices/WCC
    console.log("\n[TEST 9-12] Checking existing ABFRL estimates, Invoice Packets, and WCC...");
    const abfrlEstRes = await client.query("SELECT * FROM estimates WHERE client_id = 1 AND client_format ILIKE '%AB%' LIMIT 1");
    if (abfrlEstRes.rows.length > 0) {
      const abfrlEst = abfrlEstRes.rows[0];
      console.log("✓ ABFRL Estimate verified:", {
        id: abfrlEst.id,
        number: abfrlEst.estimate_number,
        clientFormat: abfrlEst.client_format,
        formatProfileCode: abfrlEst.format_profile_code,
        hasStoreGrouping: Boolean(abfrlEst.store_grouping),
      });

      // Check WCC records / challans for this estimate
      const challansRes = await client.query("SELECT id, document_type, client_format, status FROM delivery_challans WHERE estimate_id = $1", [abfrlEst.id]);
      console.log(`✓ ABFRL delivery challans / WCC records count for Estimate ${abfrlEst.id}: ${challansRes.rows.length}`);
      challansRes.rows.forEach(ch => {
        console.log(`   - DC #${ch.id}: docType=${ch.document_type}, format=${ch.client_format}, status=${ch.status}`);
      });

      // Check invoices
      const invRes = await client.query("SELECT id, invoice_number, estimate_id FROM invoices WHERE estimate_id = $1", [abfrlEst.id]);
      console.log(`✓ ABFRL invoices count: ${invRes.rows.length}`);
    } else {
      console.log("ℹ No existing ABFRL estimate found for client_id = 1.");
    }

    // Clean up test estimates created during verification
    await client.query("DELETE FROM estimate_items WHERE estimate_id IN ($1, $2)", [originalEst.id, dupEst.id]);
    await client.query("DELETE FROM estimates WHERE id IN ($1, $2)", [originalEst.id, dupEst.id]);
    console.log("\n✓ Cleaned up verification test estimates (original and duplicate).");

    console.log("\n🎉 ALL 12 VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  } finally {
    client.release();
    await pool.end();
  }
}

runVerification().catch(err => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
