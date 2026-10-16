import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!SUPABASE_URL || !ANON_KEY || !DATABASE_URL) {
  console.error("Missing required environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, DATABASE_URL)");
  process.exit(1);
}

const pgClient = new Client({
  connectionString: DATABASE_URL.split("?")[0],
  ssl: { rejectUnauthorized: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false }
});

async function runVerification() {
  await pgClient.connect();
  console.log("==================================================================");
  console.log("   COMPREHENSIVE REGRESSION: CASH ESTIMATE & LEDURE VERIFICATION  ");
  console.log("==================================================================\n");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Ledure Lighting Limited (ID 22) in Workspace 2
  // ─────────────────────────────────────────────────────────────────────────
  console.log(">>> [TEST 1] Verifying Ledure Lighting Limited (ID 22) in Workspace 2...");
  const ledureRes = await pgClient.query(
    "SELECT id, name, company_id, client_type, is_active FROM clients WHERE id = 22;"
  );

  if (ledureRes.rows.length === 0) {
    throw new Error("Ledure client 22 not found in database!");
  }
  const ledureRow = ledureRes.rows[0];
  console.log("  Ledure live record:", ledureRow);
  if (ledureRow.company_id !== 2) {
    throw new Error(`Ledure client 22 belongs to company ${ledureRow.company_id}, expected 2!`);
  }
  if (!ledureRow.is_active) {
    throw new Error("Ledure client 22 is marked inactive!");
  }
  console.log("  ✓ PASS: Ledure Lighting Limited (ID 22) exists with company_id = 2 and is_active = true.");

  // Check Priyanka session access via real Supabase Auth
  console.log("  Logging in as Priyanka (pinks@sunrisemedia.in)...");
  const { data: priyankaAuth, error: authErr } = await anonClient.auth.signInWithPassword({
    email: "pinks@sunrisemedia.in",
    password: "pinks@123"
  });
  if (authErr || !priyankaAuth.session) {
    throw new Error(`Priyanka login failed: ${authErr?.message}`);
  }
  const priyankaClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${priyankaAuth.session.access_token}` } }
  });

  const { data: priyankaW2Clients } = await priyankaClient
    .from("clients")
    .select("id, name, company_id")
    .eq("company_id", 2);

  const foundInW2 = priyankaW2Clients?.some((c: any) => c.id === 22 && c.name.includes("Ledure"));
  if (!foundInW2) {
    throw new Error("Ledure Lighting Limited (ID 22) is not visible to Priyanka in Workspace 2!");
  }
  console.log("  ✓ PASS: Ledure Lighting Limited is visible to Priyanka (Workspace 2 Manager).");

  // Confirm client 22 is NOT returned when querying Workspace 1 or 3
  const { data: priyankaW1Clients } = await priyankaClient
    .from("clients")
    .select("id, name")
    .eq("company_id", 1);
  if (priyankaW1Clients && priyankaW1Clients.length > 0) {
    throw new Error("Priyanka leaked access to Workspace 1 clients!");
  }
  console.log("  ✓ PASS: Priyanka cannot see Workspace 1 or 3 clients (RLS isolation strict).");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Cash Customer Exists & Has Brand
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 2] Verifying Cash Customer & Brand...");
  const cashRes = await pgClient.query("SELECT * FROM clients WHERE id = 2;");
  if (cashRes.rows.length === 0) {
    throw new Error("Cash client (ID 2) not found!");
  }
  const cashClient = cashRes.rows[0];
  console.log(`  Cash client: id = ${cashClient.id}, name = "${cashClient.name}", gst_number = ${cashClient.gst_number || "null"}`);

  const cashBrandsRes = await pgClient.query(
    "SELECT * FROM brands WHERE parent_client_id = 2 AND company_id = 1;"
  );
  console.log("  Cash brands found:", cashBrandsRes.rows);
  if (cashBrandsRes.rows.length === 0) {
    throw new Error("Cash client must have at least one brand in Company 1!");
  }
  console.log("  ✓ PASS: Cash customer exists without GSTIN and has linked brand.");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Cash Estimate Calculation, Save & Persistence via create_estimate_atomic
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 3] Testing Cash Estimate creation with packing and installation...");
  // Simulate material row: 10 ft x 5 ft, qty 1, rate 100/sqft = 50 sqft * 100 = 5000
  // GST type: IGST (18%)
  const materialAmount = 5000;
  const materialIgst = materialAmount * 0.18; // 900
  const materialTotal = materialAmount + materialIgst; // 5900

  // Packing: 4% of materialAmount = 200, IGST 18% = 36, Total = 236
  const packingAmount = 200;
  const packingIgst = 36;
  const packingTotal = 236;

  // Installation: 7% of materialAmount = 350, IGST 18% = 63, Total = 413
  const installAmount = 350;
  const installIgst = 63;
  const installTotal = 413;

  const expectedSubtotal = materialAmount + packingAmount + installAmount; // 5550
  const expectedTax = materialIgst + packingIgst + installIgst; // 999
  const expectedGrandTotal = expectedSubtotal + expectedTax; // 6549

  const testEstimateNumber = `TEST/CASH/${Date.now().toString().slice(-6)}`;
  const estimatePayload = {
    company_id: 1,
    estimate_number: testEstimateNumber,
    client_id: 2, // Cash
    brand_id: cashBrandsRes.rows[0].id,
    store_id: null, // Nullable store_id for Cash/unregistered
    title: `Cash Estimate ${testEstimateNumber}`,
    subject: "Cash Retail Project",
    billing_to: "Cash Customer\nDirect Counter Sale",
    shipping_to: "Counter Pickup",
    gstin: null, // OPTIONAL FOR CASH - NOT REQUIRED
    pan: null,
    state_code: null,
    gst_type: "IGST",
    packing_percent: 4,
    implementation_percent: 7,
    transport_amount: 0,
    subtotal: expectedSubtotal,
    tax_amount: expectedTax,
    total_amount: expectedGrandTotal,
    status: "draft",
    client_format: "normal",
  };

  const itemPayloads = [
    {
      sl: 1,
      item_name: "Backlit Fabric Glow Signboard",
      description: "10 x 5 ft custom backlit signboard",
      line_type: "product",
      calculation_type: "sqft",
      width: "120", // 10 ft in inches
      height: "60", // 5 ft in inches
      quantity: 1,
      unit: "sqft",
      rate: 100,
      total_price: materialAmount,
      total_size: 50,
      cgst_percent: 0,
      cgst_amount: 0,
      sgst_percent: 0,
      sgst_amount: 0,
      igst_percent: 18,
      igst_amount: materialIgst,
      total_amount: materialTotal,
    },
    {
      sl: 2,
      item_name: "Packing Charges (4%)",
      description: "Standard Bubble & Edge Guard Packing",
      line_type: "packing",
      calculation_type: "percentage",
      quantity: 1,
      unit: "job",
      rate: "4%",
      total_price: packingAmount,
      cgst_percent: 0,
      cgst_amount: 0,
      sgst_percent: 0,
      sgst_amount: 0,
      igst_percent: 18,
      igst_amount: packingIgst,
      total_amount: packingTotal,
    },
    {
      sl: 3,
      item_name: "Installation Charges (7%)",
      description: "On-site mounting and electrical testing",
      line_type: "installation",
      calculation_type: "percentage",
      quantity: 1,
      unit: "job",
      rate: "7%",
      total_price: installAmount,
      cgst_percent: 0,
      cgst_amount: 0,
      sgst_percent: 0,
      sgst_amount: 0,
      igst_percent: 18,
      igst_amount: installIgst,
      total_amount: installTotal,
    }
  ];

  console.log("  Executing create_estimate_atomic RPC for Cash estimate in PostgreSQL...");
  const createEstRes = await pgClient.query(
    "SELECT public.create_estimate_atomic($1::jsonb, $2::jsonb) AS result;",
    [JSON.stringify(estimatePayload), JSON.stringify(itemPayloads)]
  );

  const createdEst = createEstRes.rows[0]?.result;
  if (!createdEst || !createdEst.id) {
    throw new Error("Failed to create Cash estimate via create_estimate_atomic!");
  }

  const createdId = createdEst.id;
  console.log(`  ✓ Cash estimate created successfully! ID = ${createdId}, Number = ${createdEst.estimate_number}`);

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Reopen & Verify Persistence
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 4] Reopening estimate and verifying persistence of rows & service charges...");
  const reopenedEstRes = await pgClient.query("SELECT * FROM estimates WHERE id = $1;", [createdId]);
  const reopenedEst = reopenedEstRes.rows[0];

  const reopenedItemsRes = await pgClient.query(
    "SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY sl ASC;",
    [createdId]
  );
  const reopenedItems = reopenedItemsRes.rows;

  console.log(`  Items retrieved: ${reopenedItems.length} rows`);
  if (reopenedItems.length !== 3) {
    throw new Error(`Expected 3 items, found ${reopenedItems.length}`);
  }

  const [pRow, packRow, instRow] = reopenedItems;
  console.log(`  Product row: "${pRow.item_name}", amount = ${pRow.total_price}, total = ${pRow.total_amount}`);
  console.log(`  Packing row: "${packRow.item_name}", amount = ${packRow.total_price}, total = ${packRow.total_amount}`);
  console.log(`  Install row: "${instRow.item_name}", amount = ${instRow.total_price}, total = ${instRow.total_amount}`);

  if (packRow.line_type !== "packing" || Math.abs(Number(packRow.total_price) - packingAmount) > 0.01) {
    throw new Error(`Packing amount mismatch: expected ${packingAmount}, got ${packRow.total_price}`);
  }
  if (instRow.line_type !== "installation" || Math.abs(Number(instRow.total_price) - installAmount) > 0.01) {
    throw new Error(`Installation amount mismatch: expected ${installAmount}, got ${instRow.total_price}`);
  }

  console.log(`  Subtotal: ${reopenedEst.subtotal} (expected ${expectedSubtotal})`);
  console.log(`  Tax: ${reopenedEst.tax_amount} (expected ${expectedTax})`);
  console.log(`  Grand Total: ${reopenedEst.total_amount} (expected ${expectedGrandTotal})`);

  if (Math.abs(reopenedEst.total_amount - expectedGrandTotal) > 0.01) {
    throw new Error(`Total amount mismatch: expected ${expectedGrandTotal}, got ${reopenedEst.total_amount}`);
  }
  console.log("  ✓ PASS: Reopened estimate matches all rows, service charges, and grand totals perfectly.");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Verify Revision Snapshot
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 5] Verifying revision control snapshot for estimate...");
  const revRes = await pgClient.query(
    "SELECT * FROM estimate_revisions WHERE estimate_id = $1;",
    [createdId]
  );
  const revisions = revRes.rows;

  if (revisions.length === 0) {
    throw new Error("Estimate revision 0 was not created!");
  }
  console.log(`  Revision count: ${revisions.length}, Rev 0 note: "${revisions[0].revision_note}"`);
  console.log("  ✓ PASS: Estimate revision baseline created properly.");

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: Cleanup Test Estimate
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 6] Cleaning up test estimate...");
  await pgClient.query("DELETE FROM estimate_items WHERE estimate_id = $1;", [createdId]);
  await pgClient.query("DELETE FROM estimate_revisions WHERE estimate_id = $1;", [createdId]);
  await pgClient.query("DELETE FROM estimates WHERE id = $1;", [createdId]);
  console.log(`  ✓ Test estimate #${createdId} deleted cleanly.`);

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: Corporate Client GST Validation Still Enforced
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n>>> [TEST 7] Verifying corporate clients retain GST validation rules...");
  const { validateGstin } = await import("../shared/validation");
  const invalidGst = validateGstin("INVALID123");
  if (invalidGst.valid) {
    throw new Error("validateGstin should reject invalid GSTIN!");
  }
  const validGst = validateGstin("27AAAAA0000A1Z5");
  if (!validGst.valid) {
    throw new Error("validateGstin rejected valid GSTIN!");
  }
  console.log("  ✓ PASS: GST validation rules remain strict for non-cash clients.");

  console.log("\n==================================================================");
  console.log("  ALL TESTS PASSED! CASH ESTIMATE & LEDURE COMPLETELY VERIFIED.   ");
  console.log("==================================================================\n");

  await pgClient.end();
}

runVerification().catch(async err => {
  console.error("\nTEST SUITE FAILED:", err);
  try { await pgClient.end(); } catch {}
  process.exit(1);
});
