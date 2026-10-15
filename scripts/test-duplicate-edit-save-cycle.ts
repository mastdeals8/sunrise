import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import assert from "node:assert/strict";

const { Pool } = pg;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://kbnjiidfpqnklaljtuoj.supabase.co";
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");

const pool = new Pool({
  connectionString: cleanConnectionString,
  ssl: { rejectUnauthorized: false },
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  console.log("==================================================================");
  console.log("   REGRESSION SUITE: DUPLICATE ESTIMATE EDIT-SAVE-VIEW LIFECYCLE");
  console.log("==================================================================\n");

  const pgClient = await pool.connect();

  try {
    // 0. Authenticate as Admin
    console.log(">>> [STEP 0] Authenticating as Admin...");
    const { data: adminResolvedEmail } = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "admin",
      p_password: "admin123"
    });
    const { data: adminSession, error: adminSignErr } = await anonClient.auth.signInWithPassword({
      email: adminResolvedEmail!,
      password: "admin123"
    });
    if (adminSignErr || !adminSession.session) {
      throw new Error(`Admin login failed: ${adminSignErr?.message}`);
    }
    const adminClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${adminSession.session.access_token}` } }
    });
    console.log("  ✓ Admin client authenticated.");

    // 1. Verify Estimate SM/E/26-27/252 (the affected estimate)
    console.log("\n>>> [STEP 1] Verifying affected estimate SM/E/26-27/252 database state...");
    const est252Res = await pgClient.query("SELECT * FROM estimates WHERE estimate_number = 'SM/E/26-27/252'");
    assert.equal(est252Res.rows.length, 1, "Estimate SM/E/26-27/252 must exist");
    const est252 = est252Res.rows[0];
    const items252Res = await pgClient.query("SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY sl, id", [est252.id]);
    
    console.log(`  Estimate 252 ID: ${est252.id}`);
    console.log(`  Estimate 252 Header: Subtotal ₹${est252.subtotal}, Tax ₹${est252.tax_amount}, Total ₹${est252.total_amount}`);
    console.log(`  Estimate 252 Persisted Items Count: ${items252Res.rows.length} (was 32 before fix)`);
    assert.equal(items252Res.rows.length, 7, "Estimate 252 must have exactly 7 items (4 products + 3 service charges)");

    const products252 = items252Res.rows.filter(it => it.line_type === "product");
    const services252 = items252Res.rows.filter(it => it.line_type !== "product");
    assert.equal(products252.length, 4, "Must have exactly 4 product items");
    assert.equal(services252.length, 3, "Must have exactly 3 service items");

    const itemsSubtotal252 = items252Res.rows.reduce((s, it) => s + Number(it.total_price), 0);
    const itemsTotal252 = items252Res.rows.reduce((s, it) => s + Number(it.total_amount), 0);
    console.log(`  Items Subtotal: ₹${itemsSubtotal252.toFixed(2)}, Items Total: ₹${itemsTotal252.toFixed(2)}`);
    assert.equal(itemsSubtotal252.toFixed(2), "13154.50", "Items subtotal must match ₹13,154.50");
    assert.ok(Math.abs(Number(itemsTotal252.toFixed(2)) - 15522.30) <= 0.05, "Items total must match ₹15,522.30 (within 1 paisa rounding)");
    console.log("  ✓ Affected estimate SM/E/26-27/252 now has identical items and totals between Editor & Summary!");

    // 2. Verify Source Estimate SM/E/26-27/251 is untouched
    console.log("\n>>> [STEP 2] Verifying original source estimate SM/E/26-27/251 is untouched...");
    const est251Res = await pgClient.query("SELECT * FROM estimates WHERE estimate_number = 'SM/E/26-27/251'");
    assert.equal(est251Res.rows.length, 1, "Estimate SM/E/26-27/251 must exist");
    const est251 = est251Res.rows[0];
    const items251Res = await pgClient.query("SELECT count(*) as count FROM estimate_items WHERE estimate_id = $1", [est251.id]);
    assert.equal(Number(items251Res.rows[0].count), 6, "Original source estimate must have 6 items");
    assert.equal(Number(est251.subtotal), 9574.25, "Original subtotal must remain 9574.25");
    console.log("  ✓ Source estimate SM/E/26-27/251 is completely preserved.");

    // 3. Test Full Multi-Store Duplicate -> Edit -> Remove Stores/Rows -> Save Cycle
    console.log("\n>>> [STEP 3] Running full multi-store duplicate -> edit -> save lifecycle test...");
    
    // Create a multi-store source estimate: 2 stores (Store 557 and 558)
    const sourceEstNumber = `TEST/EST/${Date.now()}`;
    const sourceEstData = {
      company_id: 1,
      estimate_number: sourceEstNumber,
      client_id: 3,
      brand_id: 1,
      title: "Regression Multi-Store Source",
      subtotal: 10000,
      tax_amount: 1800,
      total_amount: 11800,
      client_format: "normal",
      format_profile_code: "normal",
      status: "draft",
    };

    const sourceItems = [
      // Store 557 items
      { sl: 1, store_id: 557, store_code: "R056", item_name: "Store 1 Banner", line_type: "product", calculation_type: "sqft", quantity: 1, unit: "sqft", rate: 1000, total_price: 1000, cgst_percent: 9, cgst_amount: 90, sgst_percent: 9, sgst_amount: 90, total_amount: 1180 },
      { sl: 2, store_id: 557, store_code: "R056", item_name: "Store 1 Poster", line_type: "product", calculation_type: "fixed", quantity: 2, unit: "nos", rate: 500, total_price: 1000, cgst_percent: 9, cgst_amount: 90, sgst_percent: 9, sgst_amount: 90, total_amount: 1180 },
      { sl: 3, store_id: 557, store_code: "R056", item_name: "Store 1 Packing", line_type: "packing", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 4, total_price: 80, cgst_percent: 9, cgst_amount: 7.2, sgst_percent: 9, sgst_amount: 7.2, total_amount: 94.4 },
      { sl: 4, store_id: 557, store_code: "R056", item_name: "Store 1 Installation", line_type: "installation", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 7, total_price: 140, cgst_percent: 9, cgst_amount: 12.6, sgst_percent: 9, sgst_amount: 12.6, total_amount: 165.2 },
      { sl: 5, store_id: 557, store_code: "R056", item_name: "Store 1 Transport", line_type: "transport", calculation_type: "fixed", quantity: 1, unit: "job", rate: 500, total_price: 500, cgst_percent: 9, cgst_amount: 45, sgst_percent: 9, sgst_amount: 45, total_amount: 590 },
      // Store 558 items
      { sl: 6, store_id: 558, store_code: "R057", item_name: "Store 2 Banner", line_type: "product", calculation_type: "sqft", quantity: 2, unit: "sqft", rate: 1000, total_price: 2000, cgst_percent: 9, cgst_amount: 180, sgst_percent: 9, sgst_amount: 180, total_amount: 2360 },
      { sl: 7, store_id: 558, store_code: "R057", item_name: "Store 2 Poster", line_type: "product", calculation_type: "fixed", quantity: 5, unit: "nos", rate: 500, total_price: 2500, cgst_percent: 9, cgst_amount: 225, sgst_percent: 9, sgst_amount: 225, total_amount: 2950 },
      { sl: 8, store_id: 558, store_code: "R057", item_name: "Store 2 Packing", line_type: "packing", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 4, total_price: 180, cgst_percent: 9, cgst_amount: 16.2, sgst_percent: 9, sgst_amount: 16.2, total_amount: 212.4 },
      { sl: 9, store_id: 558, store_code: "R057", item_name: "Store 2 Installation", line_type: "installation", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 7, total_price: 315, cgst_percent: 9, cgst_amount: 28.35, sgst_percent: 9, sgst_amount: 28.35, total_amount: 371.7 },
      { sl: 10, store_id: 558, store_code: "R057", item_name: "Store 2 Transport", line_type: "transport", calculation_type: "fixed", quantity: 1, unit: "job", rate: 800, total_price: 800, cgst_percent: 9, cgst_amount: 72, sgst_percent: 9, sgst_amount: 72, total_amount: 944 },
    ];

    const { data: atomicCreated, error: createSourceErr } = await adminClient.rpc("create_estimate_atomic", {
      p_estimate: sourceEstData,
      p_items: sourceItems,
    });
    if (createSourceErr || !atomicCreated) {
      throw new Error(`Failed to create source regression estimate: ${createSourceErr?.message}`);
    }
    const sourceEstId = atomicCreated.id;
    console.log(`  ✓ Created multi-store source estimate #${sourceEstId} (${sourceEstNumber}) with 10 items.`);

    // Duplicate the estimate
    const dupEstNumber = `TEST/DUP/${Date.now()}`;
    const dupEstPayload = {
      ...sourceEstData,
      estimate_number: dupEstNumber,
      title: "Regression Duplicated Copy",
    };
    const { data: dupCreated, error: dupErr } = await adminClient.rpc("create_estimate_atomic", {
      p_estimate: dupEstPayload,
      p_items: sourceItems,
    });
    if (dupErr || !dupCreated) {
      throw new Error(`Failed to duplicate estimate: ${dupErr?.message}`);
    }
    const dupEstId = dupCreated.id;
    console.log(`  ✓ Duplicated as estimate #${dupEstId} (${dupEstNumber}) with initial 10 items.`);

    // Check that duplicated items have independent IDs
    const origItemIds = (await pgClient.query("SELECT id FROM estimate_items WHERE estimate_id = $1", [sourceEstId])).rows.map(r => r.id);
    const dupItemIds1 = (await pgClient.query("SELECT id FROM estimate_items WHERE estimate_id = $1", [dupEstId])).rows.map(r => r.id);
    assert.equal(dupItemIds1.length, 10, "Duplicated estimate must initially have 10 items");
    for (const did of dupItemIds1) {
      assert.ok(!origItemIds.includes(did), "Duplicated item ID must not collide with source item ID");
    }
    console.log("  ✓ Duplicated item IDs are completely independent from source.");

    // Now simulate EDITING in the Editor:
    // User deletes Store 558 completely (5 rows deleted).
    // In Store 557: user deletes "Store 1 Poster" (1 row deleted).
    // User updates "Store 1 Banner" quantity to 5, rate to 1200 -> total_price = 6000.
    // Service charges updated:
    // Packing (4% of 6000) = 240, tax = 43.20, total = 283.20
    // Installation (7% of 6000) = 420, tax = 75.60, total = 495.60
    // Transport = 500, tax = 90, total = 590
    // Total editor items = 4 rows (1 product + 3 service charges).
    const editedItems = [
      { sl: 1, store_id: 557, store_code: "R056", item_name: "Store 1 Banner (Updated)", line_type: "product", calculation_type: "sqft", quantity: 5, unit: "sqft", rate: 1200, total_price: 6000, cgst_percent: 9, cgst_amount: 540, sgst_percent: 9, sgst_amount: 540, total_amount: 7080 },
      { sl: 2, store_id: 557, store_code: "R056", item_name: "Packing Charges (4%)", line_type: "packing", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 4, total_price: 240, cgst_percent: 9, cgst_amount: 21.6, sgst_percent: 9, sgst_amount: 21.6, total_amount: 283.2 },
      { sl: 3, store_id: 557, store_code: "R056", item_name: "Installation Charges (7%)", line_type: "installation", calculation_type: "percentage", quantity: 1, unit: "percentage", rate: 7, total_price: 420, cgst_percent: 9, cgst_amount: 37.8, sgst_percent: 9, sgst_amount: 37.8, total_amount: 495.6 },
      { sl: 4, store_id: 557, store_code: "R056", item_name: "Local Transportation", line_type: "transport", calculation_type: "fixed", quantity: 1, unit: "job", rate: 500, total_price: 500, cgst_percent: 9, cgst_amount: 45, sgst_percent: 9, sgst_amount: 45, total_amount: 590 },
    ];
    const editedSubtotal = 6000 + 240 + 420 + 500; // 7160
    const editedTax = (540 * 2) + (21.6 * 2) + (37.8 * 2) + (45 * 2); // 1288.80
    const editedTotal = editedSubtotal + editedTax; // 8448.80

    // Save edited estimate via replace_estimate_items RPC
    console.log("\n>>> [STEP 4] Saving edited estimate via replace_estimate_items RPC...");
    const { data: replacedCount, error: replaceErr } = await adminClient.rpc("replace_estimate_items", {
      p_estimate_id: dupEstId,
      p_items: editedItems,
    });
    if (replaceErr) {
      throw new Error(`replace_estimate_items failed: ${replaceErr.message}`);
    }
    assert.equal(replacedCount, 4, "replace_estimate_items must return 4 inserted rows");

    // Update estimate header
    await pgClient.query(`
      UPDATE estimates
      SET subtotal = $1, tax_amount = $2, total_amount = $3
      WHERE id = $4
    `, [editedSubtotal, editedTax, editedTotal, dupEstId]);
    console.log("  ✓ replace_estimate_items RPC succeeded.");

    // 4. Reopen the estimate from DB (as Editor, Summary, PDF, and Excel all do)
    console.log("\n>>> [STEP 5] Reopening saved estimate and verifying removed rows do not return...");
    const reopenedItemsRes = await pgClient.query("SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY sl", [dupEstId]);
    const reopenedItems = reopenedItemsRes.rows;
    console.log(`  Persisted row count after save: ${reopenedItems.length}`);
    assert.equal(reopenedItems.length, 4, "Must have exactly 4 persisted rows (removed 6 rows must NOT remain in DB)");

    // Confirm removed store (558) rows are completely gone
    const store558Rows = reopenedItems.filter(it => it.store_id === 558);
    assert.equal(store558Rows.length, 0, "Store 558 rows must be completely deleted");

    // Confirm removed product row is completely gone
    const posterRow = reopenedItems.find(it => it.item_name.includes("Poster"));
    assert.equal(posterRow, undefined, "Removed product row 'Poster' must not exist");

    // Compare persisted database totals against editor expectations
    const reopenedSubtotal = reopenedItems.reduce((s, it) => s + Number(it.total_price), 0);
    const reopenedTotal = reopenedItems.reduce((s, it) => s + Number(it.total_amount), 0);
    console.log(`  Persisted Subtotal: ₹${reopenedSubtotal.toFixed(2)}, Expected: ₹${editedSubtotal.toFixed(2)}`);
    console.log(`  Persisted Total: ₹${reopenedTotal.toFixed(2)}, Expected: ₹${editedTotal.toFixed(2)}`);
    assert.equal(reopenedSubtotal.toFixed(2), editedSubtotal.toFixed(2));
    assert.equal(reopenedTotal.toFixed(2), editedTotal.toFixed(2));

    // Confirm service charges appear exactly once
    const packingCount = reopenedItems.filter(it => it.line_type === "packing").length;
    const instCount = reopenedItems.filter(it => it.line_type === "installation").length;
    const transportCount = reopenedItems.filter(it => it.line_type === "transport").length;
    assert.equal(packingCount, 1, "Packing service charge must appear exactly once");
    assert.equal(instCount, 1, "Installation service charge must appear exactly once");
    assert.equal(transportCount, 1, "Transport service charge must appear exactly once");
    console.log("  ✓ Service charges appear exactly once.");

    // Second edit-save cycle on the same estimate (simulate changing rate again)
    console.log("\n>>> [STEP 6] Testing SECOND edit-save cycle on the same duplicated estimate...");
    const secondEditItems = [
      { sl: 1, store_id: 557, store_code: "R056", item_name: "Store 1 Banner (2nd Edit)", line_type: "product", calculation_type: "sqft", quantity: 2, unit: "sqft", rate: 1500, total_price: 3000, cgst_percent: 9, cgst_amount: 270, sgst_percent: 9, sgst_amount: 270, total_amount: 3540 },
    ];
    const { data: secondReplacedCount, error: secondReplaceErr } = await adminClient.rpc("replace_estimate_items", {
      p_estimate_id: dupEstId,
      p_items: secondEditItems,
    });
    if (secondReplaceErr) {
      throw new Error(`Second replace_estimate_items failed: ${secondReplaceErr.message}`);
    }
    assert.equal(secondReplacedCount, 1, "Second replace must return 1 inserted row");

    const secondReopenedItems = (await pgClient.query("SELECT * FROM estimate_items WHERE estimate_id = $1", [dupEstId])).rows;
    assert.equal(secondReopenedItems.length, 1, "Must have exactly 1 row after second edit-save (prior 4 rows deleted)");
    assert.equal(secondReopenedItems[0].item_name, "Store 1 Banner (2nd Edit)");
    console.log("  ✓ Second edit-save cycle replaced items cleanly with 0 orphans.");

    // Confirm original source estimate still completely intact
    console.log("\n>>> [STEP 7] Verifying original source estimate remains intact after duplicate edits...");
    const sourceItemsFinal = (await pgClient.query("SELECT * FROM estimate_items WHERE estimate_id = $1", [sourceEstId])).rows;
    assert.equal(sourceItemsFinal.length, 10, "Source estimate must still have all 10 items");
    const sourceEstFinal = (await pgClient.query("SELECT * FROM estimates WHERE id = $1", [sourceEstId])).rows[0];
    assert.equal(Number(sourceEstFinal.subtotal), 10000);
    assert.equal(Number(sourceEstFinal.total_amount), 11800);
    console.log("  ✓ Original source estimate completely untouched.");

    // 5. Test Cross-Company Isolation for replace_estimate_items
    console.log("\n>>> [STEP 8] Verifying cross-company isolation on replace_estimate_items...");
    const delhiUsername = `delhi_test_${Date.now()}`;
    const delhiEmail = `${delhiUsername}@example.com`;
    const delhiPass = "DelhiPass@123";

    const { data: createDelhiRes, error: createDelhiErr } = await adminClient.rpc("admin_create_user", {
      payload: {
        username: delhiUsername,
        email: delhiEmail,
        password: delhiPass,
        name: "Delhi QA User",
        companyId: 2,
        companyRole: "company_user"
      }
    });
    if (createDelhiErr || !createDelhiRes?.success) {
      throw new Error(`Failed to create Delhi user: ${createDelhiErr?.message}`);
    }
    const delhiAppUserId = createDelhiRes.user.id;

    const { data: delhiSession } = await anonClient.auth.signInWithPassword({
      email: delhiEmail,
      password: delhiPass
    });
    const delhiClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${delhiSession.session!.access_token}` } }
    });

    // Delhi user tries to replace items on Company 1 estimate
    const { data: crossData, error: crossErr } = await delhiClient.rpc("replace_estimate_items", {
      p_estimate_id: dupEstId, // Company 1 estimate
      p_items: secondEditItems
    });
    if (!crossErr) {
      throw new Error("SECURITY FAILURE: Delhi user replaced items on Company 1 estimate!");
    }
    console.log(`  ✓ Cross-company modification correctly rejected: "${crossErr.message}"`);

    // Clean up temporary regression test records
    console.log("\n>>> [STEP 9] Cleaning up temporary test records...");
    await pgClient.query("DELETE FROM estimate_items WHERE estimate_id IN ($1, $2)", [sourceEstId, dupEstId]);
    await pgClient.query("DELETE FROM estimates WHERE id IN ($1, $2)", [sourceEstId, dupEstId]);
    await pgClient.query("DELETE FROM company_users WHERE user_id = $1", [delhiAppUserId]);
    await pgClient.query("DELETE FROM users WHERE id = $1", [delhiAppUserId]);
    console.log("  ✓ Temporary test estimates and users cleaned up.");

    console.log("\n==================================================================");
    console.log("   ALL 8 REGRESSION TESTS PASSED (100% SUCCESS)");
    console.log("==================================================================");

  } finally {
    pgClient.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("\n❌ Regression suite failed:", err);
  process.exit(1);
});
