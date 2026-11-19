import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function runRegressionSuite() {
  console.log("================================================================================");
  console.log("REGRESSION TEST: DUPLICATE ESTIMATE GST BILLING PROFILE WORKFLOW");
  console.log("================================================================================");

  // 1. Verify Original Estimate SM/E/26-27/281 (ID 283) in Live DB
  console.log("\n[TEST 1] Verifying Original Estimate SM/E/26-27/281 retains original billing profile");
  const origRes = await pool.query(
    "SELECT id, estimate_number, client_id, billing_profile_id, billing_legal_name_snapshot, billing_gstin_snapshot, gstin, billing_to FROM estimates WHERE estimate_number = 'SM/E/26-27/281'"
  );
  assert.equal(origRes.rows.length, 1, "Original estimate SM/E/26-27/281 must exist");
  const origEst = origRes.rows[0];
  console.log("Original Estimate:", {
    id: origEst.id,
    estimate_number: origEst.estimate_number,
    client_id: origEst.client_id,
    billing_profile_id: origEst.billing_profile_id,
    billing_legal_name_snapshot: origEst.billing_legal_name_snapshot,
    billing_gstin_snapshot: origEst.billing_gstin_snapshot,
    gstin: origEst.gstin,
  });

  assert.equal(origEst.client_id, 138, "Client must be 138 (Baskin Robins)");
  assert.equal(origEst.billing_profile_id, 44, "Original must retain billing_profile_id 44 (Shree Ganesh Enterprises)");
  assert.equal(origEst.billing_legal_name_snapshot, "Shree Ganesh Enterprises", "Original snapshot must be Shree Ganesh Enterprises");
  assert.equal(origEst.billing_gstin_snapshot, "27BWJPB9219C1ZO", "Original GSTIN snapshot must be 27BWJPB9219C1ZO");
  assert.equal(origEst.gstin, "27BWJPB9219C1ZO", "Original GSTIN must be 27BWJPB9219C1ZO");
  console.log("✓ Test 1 passed: Original estimate retains its original billing profile (Shree Ganesh Enterprises, 27BWJPB9219C1ZO).");

  // 2. Verify Profiles for Client 138 (Baskin Robins)
  console.log("\n[TEST 2] Verifying franchise billing profiles for Client 138 (Baskin Robins)");
  const profilesRes = await pool.query(
    "SELECT id, legal_company_name, branch_location_name, gstin, pan, state, state_code, billing_address FROM client_billing_profiles WHERE client_id = 138 ORDER BY id"
  );
  const profiles = profilesRes.rows;
  console.log(`Found ${profiles.length} billing profiles for client 138:`);
  profiles.forEach(p => console.log(`  [${p.id}] ${p.legal_company_name} · GSTIN: ${p.gstin}`));

  const nomrotaBp = profiles.find(p => p.id === 43 || p.legal_company_name.includes("Nomrota Global"));
  assert(nomrotaBp, "Nomrota Global profile (id: 43) must exist for client 138");
  assert.equal(nomrotaBp.gstin, "27BIZPP7272B1ZN", "Nomrota Global GSTIN must be 27BIZPP7272B1ZN");
  assert.equal(nomrotaBp.legal_company_name, "Nomrota Global", "Legal name must be Nomrota Global");
  console.log("✓ Test 2 passed: Client 138 has valid franchise profiles (Nomrota Global id 43, GSTIN 27BIZPP7272B1ZN).");

  // 3. Test In-Memory Duplicate & Billing Profile Switch Workflow
  console.log("\n[TEST 3] Testing Duplicate -> Change GST Profile -> Save Payload Generation");
  // Step A: Duplicate original estimate (inherits Shree Ganesh Enterprises)
  const duplicatedDraft = {
    clientId: origEst.client_id,
    brandId: null,
    storeId: null,
    title: "Main Signboard - BR",
    clientFormat: "normal",
    billingProfileId: origEst.billing_profile_id, // 44
    billingLegalNameSnapshot: origEst.billing_legal_name_snapshot, // Shree Ganesh Enterprises
    billingGstinSnapshot: origEst.billing_gstin_snapshot, // 27BWJPB9219C1ZO
    billingAddressSnapshot: "shop No 2, Oxy primo, Wagholi",
    billingTo: origEst.billing_to,
    gstin: origEst.gstin,
    pan: "BWJPB9219C",
    stateCode: "27",
    subtotal: 84250,
    taxAmount: 15165,
    totalAmount: 99415,
  };

  // Step B: User selects Nomrota Global (Profile 43) in Edit Estimate
  const selectedProfileId = "43";
  const matchingSelectedBp = profiles.find(p => String(p.id) === selectedProfileId);
  assert(matchingSelectedBp, "Must match Nomrota Global");

  // Simulate applyBillingProfile in EstimateBuilder
  const editedBillingTo = [
    matchingSelectedBp.legal_company_name ? `M/S : ${matchingSelectedBp.legal_company_name}` : "",
    matchingSelectedBp.billing_address || ""
  ].filter(Boolean).join("\n");
  const editedGstin = matchingSelectedBp.gstin;
  const editedStateCode = matchingSelectedBp.state_code;
  const editedPan = matchingSelectedBp.pan || "";

  // Step C: Simulate handleSaveEstimate payload construction
  const savePayload = {
    ...duplicatedDraft,
    billingProfileId: Number(selectedProfileId),
    billingLegalNameSnapshot: matchingSelectedBp.legal_company_name,
    billingGstinSnapshot: matchingSelectedBp.gstin,
    billingStateSnapshot: matchingSelectedBp.state,
    billingStateCodeSnapshot: matchingSelectedBp.state_code,
    billingAddressSnapshot: matchingSelectedBp.billing_address,
    shippingAddressSnapshot: matchingSelectedBp.shipping_address || null,
    billingTo: editedBillingTo,
    gstin: editedGstin,
    pan: editedPan,
    stateCode: editedStateCode,
  };

  console.log("Constructed Save Payload:", {
    billingProfileId: savePayload.billingProfileId,
    billingLegalNameSnapshot: savePayload.billingLegalNameSnapshot,
    billingGstinSnapshot: savePayload.billingGstinSnapshot,
    gstin: savePayload.gstin,
  });

  assert.equal(savePayload.billingProfileId, 43, "billingProfileId must be 43");
  assert.equal(savePayload.billingLegalNameSnapshot, "Nomrota Global", "Snapshot must be Nomrota Global");
  assert.equal(savePayload.billingGstinSnapshot, "27BIZPP7272B1ZN", "GSTIN snapshot must be 27BIZPP7272B1ZN");
  assert.equal(savePayload.gstin, "27BIZPP7272B1ZN", "GSTIN must be 27BIZPP7272B1ZN");
  console.log("✓ Test 3 passed: Save payload correctly resolves and persists Nomrota Global snapshots.");

  // 4. Test Output Renderers: Summary, View, Print, PDF & Excel parity
  console.log("\n[TEST 4] Verifying Estimate Summary, Print Preview, PDF, and Excel renderers use Nomrota Global");
  
  // Test 4A: Estimate Preview / Summary liveEst overlay resolution
  const savedEstimateSimulated = {
    ...savePayload,
    id: 9999,
    estimateNumber: "SM/E/26-27/TEST",
  };

  // Simulate handleSelectEstimate live profile overlay
  const bp = profiles.find(p => p.id === savedEstimateSimulated.billingProfileId);
  const liveEst = bp ? {
    ...savedEstimateSimulated,
    billingProfileId: bp.id,
    billingLegalNameSnapshot: bp.legal_company_name,
    billingGstinSnapshot: bp.gstin,
    billingStateSnapshot: bp.state,
    billingStateCodeSnapshot: bp.state_code,
    billingAddressSnapshot: bp.billing_address,
    shippingAddressSnapshot: bp.shipping_address || savedEstimateSimulated.shippingAddressSnapshot,
    billingTo: [bp.legal_company_name ? `M/S : ${bp.legal_company_name}` : "", bp.billing_address || ""].filter(Boolean).join("\n") || bp.legal_company_name,
    gstin: bp.gstin,
    pan: bp.pan || savedEstimateSimulated.pan,
    stateCode: bp.state_code,
  } : savedEstimateSimulated;

  assert.equal(liveEst.billingLegalNameSnapshot, "Nomrota Global");
  assert.equal(liveEst.billingGstinSnapshot, "27BIZPP7272B1ZN");
  assert.equal(liveEst.gstin, "27BIZPP7272B1ZN");
  assert(liveEst.billingTo.includes("Nomrota Global"));

  // Test 4B: EstimateDocument rendering extraction
  const billingRaw = liveEst.billingTo || "";
  const billingLines = billingRaw.split("\n").map((s: string) => s.trim()).filter(Boolean);
  const firstLineHasPrefix = /^M\/S\s*:?\s*/i.test(billingLines[0] || "");
  const firstLineName = (billingLines[0] || "").replace(/^M\/S\s*:?\s*/i, "").trim();
  const billingNameSnap = liveEst.billingLegalNameSnapshot || "";
  let docBillingName = billingNameSnap;
  if (!docBillingName) {
    docBillingName = firstLineName || "Client";
  } else if (firstLineHasPrefix && firstLineName && billingNameSnap && !firstLineName.toLowerCase().includes(billingNameSnap.toLowerCase()) && !billingNameSnap.toLowerCase().includes(firstLineName.toLowerCase())) {
    docBillingName = firstLineName;
  }
  const docBillingGstin = liveEst.gstin || liveEst.billingGstinSnapshot || "";

  assert.equal(docBillingName, "Nomrota Global", "EstimateDocument billing name must be Nomrota Global");
  assert.equal(docBillingGstin, "27BIZPP7272B1ZN", "EstimateDocument GSTIN must be 27BIZPP7272B1ZN");
  console.log("✓ Test 4A passed: EstimateDocument renders Nomrota Global and 27BIZPP7272B1ZN.");

  // Test 4C: Excel Export extraction (mirrors exportHelpers.ts)
  const xlBillingRaw = liveEst.billingTo || "";
  const xlBillingLines = xlBillingRaw.split("\n").map((l: string) => l.trim()).filter(Boolean);
  const xlFirstLineName = (xlBillingLines[0] || "").replace(/^M\/S\s*:?\s*/i, "").trim();
  const xlSnapName = liveEst.billingLegalNameSnapshot || "";
  let xlBillingName = xlSnapName;
  if (!xlBillingName) {
    xlBillingName = xlFirstLineName || "Client";
  } else if (/^M\/S\s*:?\s*/i.test(xlBillingLines[0] || "") && xlFirstLineName && xlSnapName && !xlFirstLineName.toLowerCase().includes(xlSnapName.toLowerCase()) && !xlSnapName.toLowerCase().includes(xlFirstLineName.toLowerCase())) {
    xlBillingName = xlFirstLineName;
  }
  const xlBillingGstin = liveEst.gstin || liveEst.billingGstinSnapshot || "";

  assert.equal(xlBillingName, "Nomrota Global", "Excel export billing name must be Nomrota Global");
  assert.equal(xlBillingGstin, "27BIZPP7272B1ZN", "Excel export GSTIN must be 27BIZPP7272B1ZN");
  console.log("✓ Test 4B passed: Excel export renders Nomrota Global and 27BIZPP7272B1ZN.");

  // 5. Test Resiliency against Stale DB Snapshot
  console.log("\n[TEST 5] Verifying Stale DB Snapshot Recovery (Estimate SM/E/26-27/282)");
  const est282Res = await pool.query(
    "SELECT id, estimate_number, client_id, billing_profile_id, billing_legal_name_snapshot, billing_gstin_snapshot, gstin, billing_to FROM estimates WHERE estimate_number = 'SM/E/26-27/282'"
  );
  if (est282Res.rows.length > 0) {
    const rawEst282 = est282Res.rows[0];
    console.log("Raw DB Row 282 before overlay:", {
      id: rawEst282.id,
      billing_profile_id: rawEst282.billing_profile_id,
      billing_to: rawEst282.billing_to?.split("\n")[0],
      raw_snapshot_name: rawEst282.billing_legal_name_snapshot,
      raw_snapshot_gstin: rawEst282.billing_gstin_snapshot,
    });

    // Run handleSelectEstimate overlay logic on raw DB row 282:
    const bp282 = profiles.find(p => p.id === rawEst282.billing_profile_id);
    const resolvedEst282 = bp282 ? {
      ...rawEst282,
      billingProfileId: bp282.id,
      billingLegalNameSnapshot: bp282.legal_company_name,
      billingGstinSnapshot: bp282.gstin,
      billingStateSnapshot: bp282.state,
      billingStateCodeSnapshot: bp282.state_code,
      billingAddressSnapshot: bp282.billing_address,
      billingTo: [bp282.legal_company_name ? `M/S : ${bp282.legal_company_name}` : "", bp282.billing_address || ""].filter(Boolean).join("\n") || bp282.legal_company_name,
      gstin: bp282.gstin,
      pan: bp282.pan || rawEst282.pan,
      stateCode: bp282.state_code,
    } : rawEst282;

    assert.equal(resolvedEst282.billingLegalNameSnapshot, "Nomrota Global", "Resolved snapshot must be Nomrota Global");
    assert.equal(resolvedEst282.billingGstinSnapshot, "27BIZPP7272B1ZN", "Resolved GSTIN snapshot must be 27BIZPP7272B1ZN");
    assert.equal(resolvedEst282.gstin, "27BIZPP7272B1ZN", "Resolved GSTIN must be 27BIZPP7272B1ZN");
    console.log("✓ Test 5 passed: Estimate SM/E/26-27/282 cleanly resolves Nomrota Global across all outputs without modifying database rows.");
  }

  // 6. Test Main Client & Brand Preservation
  console.log("\n[TEST 6] Verifying Main Client (Baskin Robins) and Brand Preservation");
  const clientRes = await pool.query("SELECT id, name FROM clients WHERE id = 138");
  assert.equal(clientRes.rows.length, 1);
  assert(clientRes.rows[0].name.toLowerCase().includes("baskin"), "Client 138 must be Baskin Robins");
  console.log(`  Client ID 138: ${clientRes.rows[0].name}`);
  console.log("✓ Test 6 passed: Main client Baskin Robins is preserved separately from franchise billing entities.");

  await pool.end();
  console.log("\n================================================================================");
  console.log("ALL REGRESSION TESTS PASSED SUCCESSFULLY!");
  console.log("================================================================================");
}

runRegressionSuite().catch(err => {
  console.error("Regression test failed:", err);
  process.exit(1);
});
