import { Client } from "pg";
import {
  getEstimateScopedStores,
  getInvoiceScopedStores,
  isStoreWiseInvoice,
} from "../shared/storeScoping.js";

const pg = new Client({
  connectionString: process.env.DATABASE_URL.split("?")[0],
  ssl: { rejectUnauthorized: false },
});

async function runTests() {
  await pg.connect();
  console.log("Connected to PostgreSQL DB.");

  const allStoresRes = await pg.query("SELECT id, name, store_code FROM stores");
  const allStores = allStoresRes.rows.map(s => ({
    id: s.id,
    name: s.name,
    storeCode: s.store_code,
  }));

  // =========================================================================
  // TEST 1: Estimate SM/E/26-27/205 — Complete Invoice (Invoice ID 10)
  // =========================================================================
  console.log("\n=======================================================");
  console.log("TEST 1: Estimate SM/E/26-27/205 — COMPLETE INVOICE PACKET");
  console.log("=======================================================");

  const estRes = await pg.query(
    "SELECT * FROM estimates WHERE estimate_number = 'SM/E/26-27/205'"
  );
  const est205 = estRes.rows[0];
  if (!est205) throw new Error("Estimate SM/E/26-27/205 not found in DB");

  const estItemsRes = await pg.query(
    "SELECT * FROM estimate_items WHERE estimate_id = $1",
    [est205.id]
  );
  const challansRes = await pg.query(
    "SELECT * FROM delivery_challans WHERE estimate_id = $1",
    [est205.id]
  );
  const docsRes = await pg.query(
    "SELECT * FROM execution_documents WHERE estimate_id = $1",
    [est205.id]
  );
  const execStoresRes = await pg.query(
    "SELECT * FROM execution_stores WHERE estimate_id = $1",
    [est205.id]
  );
  const invRes = await pg.query(
    "SELECT * FROM invoices WHERE estimate_id = $1 AND (store_id IS NULL OR store_id = 0)",
    [est205.id]
  );
  const completeInvoice = invRes.rows[0];

  console.log(`Estimate ID: ${est205.id}, Number: ${est205.estimate_number}`);
  console.log(`Execution stores in DB for this estimate: ${execStoresRes.rows.length} (contains 5 legacy phantom stores)`);

  const estScopedStores = getEstimateScopedStores(
    est205,
    estItemsRes.rows,
    allStores,
    challansRes.rows
  );
  const completePacketStores = getInvoiceScopedStores(
    estScopedStores,
    completeInvoice,
    allStores
  );

  console.log("Stores resolved for Complete Invoice packet:");
  completePacketStores.forEach(s => {
    console.log(`  - ${s.storeName} (${s.storeCode}) [ID: ${s.storeId}]`);
  });

  const expectedStores = [
    { name: "Kharadi", code: "6253" },
    { name: "Bhosari", code: "4467" },
    { name: "Dahisar", code: "4496" },
    { name: "Kalamboli", code: "7231" },
    { name: "Paud Road", code: "7215" },
  ];

  const forbiddenStores = [
    "Solapur Highway",
    "Solhapur Highway",
    "Rankala",
    "Rajkot",
    "Nikol",
    "Bhiwandi, Kalyan Phata",
    "Bhiwandi",
  ];

  // Verify exactly 5 stores
  if (completePacketStores.length !== 5) {
    throw new Error(`Expected exactly 5 stores, got ${completePacketStores.length}`);
  }

  // Verify all expected stores are present
  for (const exp of expectedStores) {
    const found = completePacketStores.find(
      s => s.storeCode === exp.code || s.storeName.toLowerCase().includes(exp.name.toLowerCase())
    );
    if (!found) {
      throw new Error(`Expected store ${exp.name} (${exp.code}) NOT found in packet stores!`);
    }
  }

  // Verify forbidden stores are NOT present
  for (const forbidden of forbiddenStores) {
    const found = completePacketStores.find(s =>
      s.storeName.toLowerCase().includes(forbidden.toLowerCase())
    );
    if (found) {
      throw new Error(`FORBIDDEN store "${forbidden}" appeared in Complete packet: ${JSON.stringify(found)}`);
    }
  }
  console.log("✓ Complete Invoice Packet contains ONLY the 5 legitimate stores of Estimate 205.");
  console.log("✓ Zero forbidden phantom stores appear.");

  // Missing Documents simulation
  // Each of the 5 stores in Estimate 205 has signed WCC and installation photo in execution_documents
  const scopedCodes = new Set(completePacketStores.map(s => s.storeCode.toLowerCase()));
  const missingByStore = [];
  for (const store of completePacketStores) {
    const sc = store.storeCode.toLowerCase();
    const hasWcc = docsRes.rows.some(
      d =>
        d.document_type === "signed_wcc" &&
        d.status === "active" &&
        String(d.store_code || "").toLowerCase() === sc
    );
    const hasPhoto = docsRes.rows.some(
      d =>
        d.document_type === "photo" &&
        d.status === "active" &&
        String(d.store_code || "").toLowerCase() === sc
    );
    const missing = [];
    if (!hasWcc) missing.push("Signed WCC");
    if (!hasPhoto) missing.push("Installation Photos");
    if (missing.length) missingByStore.push({ store: store.storeName, missing });
  }

  console.log("Missing Documents count for Estimate 205:", missingByStore.length);
  if (missingByStore.length > 0) {
    console.log("Missing items:", missingByStore);
  }
  for (const forbidden of forbiddenStores) {
    if (missingByStore.some(m => m.store.toLowerCase().includes(forbidden.toLowerCase()))) {
      throw new Error(`Forbidden store "${forbidden}" appeared in Missing Documents!`);
    }
  }
  console.log("✓ Zero phantom stores in Missing Documents warnings.");

  // =========================================================================
  // TEST 2: Store-wise Invoice for Kharadi (6253)
  // =========================================================================
  console.log("\n=======================================================");
  console.log("TEST 2: Estimate SM/E/26-27/205 — STORE-WISE INVOICE PACKET (Kharadi 6253)");
  console.log("=======================================================");

  const kharadiStore = completePacketStores.find(s => s.storeCode === "6253");
  const storeWiseInvoiceKharadi = {
    invoiceNumber: "26-27/SM/145",
    estimateId: est205.id,
    storeId: kharadiStore.storeId,
    storeCode: "6253",
    storeName: "Kharadi",
  };

  const kharadiPacketStores = getInvoiceScopedStores(
    estScopedStores,
    storeWiseInvoiceKharadi,
    allStores
  );

  console.log("Stores resolved for Kharadi Store-wise invoice packet:");
  kharadiPacketStores.forEach(s => {
    console.log(`  - ${s.storeName} (${s.storeCode}) [ID: ${s.storeId}]`);
  });

  if (kharadiPacketStores.length !== 1) {
    throw new Error(`Expected exactly 1 store for Kharadi packet, got ${kharadiPacketStores.length}`);
  }
  if (kharadiPacketStores[0].storeCode !== "6253") {
    throw new Error(`Expected storeCode 6253, got ${kharadiPacketStores[0].storeCode}`);
  }

  // Confirm Bhosari, Dahisar, Kalamboli, Paud Road DO NOT appear
  const otherEstStores = ["4467", "4496", "7231", "7215"];
  for (const code of otherEstStores) {
    if (kharadiPacketStores.some(s => s.storeCode === code)) {
      throw new Error(`Other store ${code} appeared in Kharadi-only packet!`);
    }
  }
  console.log("✓ Kharadi Store-wise Invoice Packet contains ONLY Kharadi 6253.");
  console.log("✓ Bhosari, Dahisar, Kalamboli, Paud Road and phantom stores DO NOT appear.");

  // =========================================================================
  // TEST 3: ABFRL Regression Test
  // =========================================================================
  console.log("\n=======================================================");
  console.log("TEST 3: ABFRL REGRESSION TEST (Existing ABFRL Invoices)");
  console.log("=======================================================");

  // Test ABFRL Store-wise invoice (Invoice ID 25, store_id 553, Estimate 30)
  const inv25Res = await pg.query("SELECT * FROM invoices WHERE id = 25");
  const inv25 = inv25Res.rows[0];
  const est30Res = await pg.query("SELECT * FROM estimates WHERE id = $1", [inv25.estimate_id]);
  const est30 = est30Res.rows[0];
  const est30ItemsRes = await pg.query("SELECT * FROM estimate_items WHERE estimate_id = $1", [est30.id]);
  const est30ChallansRes = await pg.query("SELECT * FROM delivery_challans WHERE estimate_id = $1", [est30.id]);

  const est30Stores = getEstimateScopedStores(est30, est30ItemsRes.rows, allStores, est30ChallansRes.rows);
  const inv25ScopedStores = getInvoiceScopedStores(est30Stores, inv25, allStores);

  console.log(`Invoice 25 (Store-wise ABFRL, store_id: ${inv25.store_id}):`);
  console.log(`Estimate ${est30.estimate_number} has ${est30Stores.length} stores.`);
  console.log(`Invoice 25 packet stores: ${inv25ScopedStores.map(s => `${s.storeName} (${s.storeId})`).join(", ")}`);

  if (inv25ScopedStores.length !== 1 || inv25ScopedStores[0].storeId !== 553) {
    throw new Error(`Expected Invoice 25 to scope to exactly store 553, got ${JSON.stringify(inv25ScopedStores)}`);
  }
  console.log("✓ ABFRL Store-wise Invoice 25 correctly scoped to store 553.");

  // Test ABFRL Complete invoice (Invoice ID 20, Estimate 22)
  const inv20Res = await pg.query("SELECT * FROM invoices WHERE id = 20");
  const inv20 = inv20Res.rows[0];
  const est22Res = await pg.query("SELECT * FROM estimates WHERE id = $1", [inv20.estimate_id]);
  const est22 = est22Res.rows[0];
  const est22ItemsRes = await pg.query("SELECT * FROM estimate_items WHERE estimate_id = $1", [est22.id]);
  const est22ChallansRes = await pg.query("SELECT * FROM delivery_challans WHERE estimate_id = $1", [est22.id]);

  const est22Stores = getEstimateScopedStores(est22, est22ItemsRes.rows, allStores, est22ChallansRes.rows);
  const inv20ScopedStores = getInvoiceScopedStores(est22Stores, inv20, allStores);

  console.log(`Invoice 20 (Complete ABFRL, estimate: ${est22.estimate_number}):`);
  console.log(`Invoice 20 packet stores: ${inv20ScopedStores.map(s => `${s.storeName} (${s.storeCode || s.storeId})`).join(", ")}`);
  if (inv20ScopedStores.length !== est22Stores.length) {
    throw new Error(`Expected Complete Invoice 20 to have all ${est22Stores.length} stores of Estimate 22.`);
  }
  console.log("✓ ABFRL Complete Invoice 20 correctly preserves all estimate stores.");

  await pg.end();
  console.log("\n=======================================================");
  console.log("ALL INVOICE PACKET SCOPING TESTS PASSED SUCCESSFULLY! ✓");
  console.log("=======================================================");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
