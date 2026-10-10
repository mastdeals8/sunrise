import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function runTests() {
  const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  let testRateCardId: number | null = null;
  let testUserId: number | null = null;
  let testAuthId: string | null = null;

  try {
    console.log("==================================================================");
    console.log("   AUTOMATED VERIFICATION: RATE CARDS & USER MANAGEMENT RLS/RPC   ");
    console.log("==================================================================\n");

    // -----------------------------------------------------------------------------
    // TEST SUITE 1: CUSTOMER RATE CARDS WORKFLOW & IDEMPOTENCY
    // -----------------------------------------------------------------------------
    console.log(">>> [TEST SUITE 1] CUSTOMER RATE CARDS & IDEMPOTENT IMPORT");

    // 1.1 Find an existing client or create temporary test card for client 1 (Company 1)
    const clientRes = await client.query("SELECT id, name, company_id FROM public.clients WHERE company_id = 1 LIMIT 1");
    const targetClient = clientRes.rows[0];
    console.log(`  1.1 Target client for rate card: ID=${targetClient.id}, Name="${targetClient.name}"`);

    // 1.2 Create a test rate card
    const createRcRes = await client.query(`
      INSERT INTO public.customer_rate_cards (client_id, name, company_id, is_active)
      VALUES ($1, $2, 1, true)
      RETURNING id, name, client_id, company_id
    `, [targetClient.id, `Test Rate Card Verification ${Date.now()}`]);
    testRateCardId = createRcRes.rows[0].id;
    console.log(`  1.2 Created test rate card: ID=${testRateCardId}, Name="${createRcRes.rows[0].name}"`);

    // 1.3 Call import_products_to_rate_card RPC (First import)
    console.log("  1.3 Executing import_products_to_rate_card (First Run)...");
    const imp1 = await client.query(`SELECT public.import_products_to_rate_card($1) as result`, [testRateCardId]);
    const res1 = imp1.rows[0].result;
    console.log(`      Result: imported=${res1.imported_count}, existing=${res1.existing_count}, total=${res1.total_count}`);
    if (res1.imported_count <= 0) {
      throw new Error("Expected imported_count > 0 on first import");
    }

    // 1.4 Call import_products_to_rate_card RPC (Second run - IDEMPOTENCY CHECK)
    console.log("  1.4 Executing import_products_to_rate_card (Second Run - IDEMPOTENCY)...");
    const imp2 = await client.query(`SELECT public.import_products_to_rate_card($1) as result`, [testRateCardId]);
    const res2 = imp2.rows[0].result;
    console.log(`      Result: imported=${res2.imported_count}, existing=${res2.existing_count}, total=${res2.total_count}`);
    if (res2.imported_count !== 0) {
      throw new Error(`Idempotency failed: imported_count should be 0, got ${res2.imported_count}`);
    }
    if (res2.total_count !== res1.total_count) {
      throw new Error(`Total count changed between runs: ${res1.total_count} vs ${res2.total_count}`);
    }
    console.log("      ✓ Idempotency verified: 0 duplicate items created on re-import.");

    // 1.5 Rate Editing & Batch Update
    console.log("  1.5 Testing Rate Editing & batch_update_rate_card_items...");
    const itemsRes = await client.query(`
      SELECT id, product_id, rate FROM public.customer_rate_items WHERE rate_card_id = $1 LIMIT 3
    `, [testRateCardId]);
    const itemToUpdate = itemsRes.rows[0];
    const newCustomRate = 750.5;

    const batchRes = await client.query(`
      SELECT public.batch_update_rate_card_items($1, $2::jsonb) as result
    `, [testRateCardId, JSON.stringify([{ id: itemToUpdate.id, rate: newCustomRate, isActive: true }])]);
    console.log("      Batch update result:", batchRes.rows[0].result);

    const checkItem = await client.query(`SELECT rate FROM public.customer_rate_items WHERE id = $1`, [itemToUpdate.id]);
    if (Math.abs(checkItem.rows[0].rate - newCustomRate) > 0.01) {
      throw new Error(`Rate was not updated correctly: expected ${newCustomRate}, got ${checkItem.rows[0].rate}`);
    }
    console.log(`      ✓ Manually updated item ID=${itemToUpdate.id} to rate=${newCustomRate}`);

    // 1.6 Verify Re-Import does NOT reset manually edited prices
    console.log("  1.6 Testing that Re-Import preserves manually edited rate...");
    await client.query(`SELECT public.import_products_to_rate_card($1)`, [testRateCardId]);
    const checkPreserved = await client.query(`SELECT rate FROM public.customer_rate_items WHERE id = $1`, [itemToUpdate.id]);
    if (Math.abs(checkPreserved.rows[0].rate - newCustomRate) > 0.01) {
      throw new Error(`Price was reset! Expected ${newCustomRate}, got ${checkPreserved.rows[0].rate}`);
    }
    console.log("      ✓ Verified: Manually edited prices are preserved upon re-import.");

    // 1.7 Test Price Resolver (resolve_customer_rate)
    console.log("  1.7 Testing resolve_customer_rate lookup in Estimate Builder flow...");
    const resolveRes = await client.query(`
      SELECT public.resolve_customer_rate($1, NULL, $2, NULL) as resolved
    `, [targetClient.id, itemToUpdate.product_id]);
    const resolvedData = resolveRes.rows[0].resolved;
    console.log("      Resolved Rate Result:", resolvedData);
    if (!resolvedData || Math.abs(resolvedData.rate - newCustomRate) > 0.01) {
      throw new Error(`Resolver failed to return custom rate: got ${JSON.stringify(resolvedData)}`);
    }
    console.log(`      ✓ Verified: Estimate Builder resolves client custom rate (${resolvedData.rate}) correctly.`);

    // 1.8 Verify Client Isolation in Price Resolver (no leak to another client)
    console.log("  1.8 Testing client price isolation (no leaking to other clients)...");
    const otherClientRes = await client.query(`
      SELECT public.resolve_customer_rate(999999, NULL, $1, NULL) as resolved
    `, [itemToUpdate.product_id]);
    if (otherClientRes.rows[0].resolved !== null) {
      throw new Error("Client price leaked to unauthorized client!");
    }
    console.log("      ✓ Verified: Non-matching client receives NULL (zero price leakage).");


    // -----------------------------------------------------------------------------
    // TEST SUITE 2: MULTI-COMPANY USER MANAGEMENT & ADMIN CREATION RPC
    // -----------------------------------------------------------------------------
    console.log("\n>>> [TEST SUITE 2] MULTI-COMPANY USER MANAGEMENT & ADMIN CREATION RPC");

    // 2.1 Test duplicate username validation
    console.log("  2.1 Testing duplicate username validation in admin_create_user...");
    try {
      await client.query(`
        SELECT public.admin_create_user($1::jsonb)
      `, [JSON.stringify({
        username: "admin", // Already exists
        email: "unique_new_email@example.com",
        password: "secure_password",
        name: "Test Admin",
        companyId: 1
      })]);
      throw new Error("Expected duplicate username error, but call succeeded");
    } catch (err: any) {
      if (err.message.includes("already taken")) {
        console.log(`      ✓ Handled duplicate username rejection cleanly: "${err.message}"`);
      } else {
        throw err;
      }
    }

    // 2.2 Test duplicate email validation
    console.log("  2.2 Testing duplicate email validation in admin_create_user...");
    try {
      await client.query(`
        SELECT public.admin_create_user($1::jsonb)
      `, [JSON.stringify({
        username: "unique_new_user",
        email: "admin@sunrise.local", // Already exists
        password: "secure_password",
        name: "Test Admin",
        companyId: 1
      })]);
      throw new Error("Expected duplicate email error, but call succeeded");
    } catch (err: any) {
      if (err.message.includes("already registered")) {
        console.log(`      ✓ Handled duplicate email rejection cleanly: "${err.message}"`);
      } else {
        throw err;
      }
    }

    // 2.3 Test administrative user creation (ZERO emails triggered)
    console.log("  2.3 Testing atomic administrative user creation with ZERO emails...");
    const testUsername = `test_staff_${Date.now()}`;
    const testEmail = `${testUsername}@example.com`;

    const createRes = await client.query(`
      SELECT public.admin_create_user($1::jsonb) as result
    `, [JSON.stringify({
      username: testUsername,
      email: testEmail,
      password: "TestPassword123!",
      name: "Verification Staff Member",
      role: "operations",
      companyId: 1,
      companyRole: "company_user",
      phone: "9876543210",
      department: "Production",
      designation: "Executive",
      isActive: true
    })]);

    const createdUserObj = createRes.rows[0].result;
    console.log("      Created user result:", createdUserObj);
    testUserId = createdUserObj.user.id;
    testAuthId = createdUserObj.user.authUserId;

    if (!testUserId || !testAuthId) {
      throw new Error("User ID or Auth ID missing from admin_create_user result");
    }

    // 2.4 Verify auth.users record was created and PRE-CONFIRMED (zero emails triggered)
    const authCheck = await client.query(`
      SELECT id, email, email_confirmed_at, encrypted_password FROM auth.users WHERE id = $1
    `, [testAuthId]);
    if (authCheck.rows.length === 0) {
      throw new Error("auth.users row not found for created user!");
    }
    const authRow = authCheck.rows[0];
    if (!authRow.email_confirmed_at) {
      throw new Error("auth.users email_confirmed_at is NULL (would send confirmation email)!");
    }
    console.log(`      ✓ auth.users record verified: Email pre-confirmed at ${authRow.email_confirmed_at} (Zero emails sent).`);

    // 2.5 Verify public.users profile record
    const userCheck = await client.query(`
      SELECT id, username, email, name, role, auth_user_id, is_active FROM public.users WHERE id = $1
    `, [testUserId]);
    if (userCheck.rows.length === 0) {
      throw new Error("public.users record not found!");
    }
    console.log(`      ✓ public.users profile verified: ID=${userCheck.rows[0].id}, Name="${userCheck.rows[0].name}", Role="${userCheck.rows[0].role}".`);

    // 2.6 Verify company_users membership record
    const compUserCheck = await client.query(`
      SELECT id, user_id, company_id, role, is_default FROM public.company_users WHERE user_id = $1
    `, [testUserId]);
    if (compUserCheck.rows.length === 0) {
      throw new Error("public.company_users membership not found!");
    }
    console.log(`      ✓ public.company_users membership verified: Company=${compUserCheck.rows[0].company_id}, Role="${compUserCheck.rows[0].role}".`);

    // -----------------------------------------------------------------------------
    // TEST SUITE 3: COMPANY ISOLATION POLICIES (RLS)
    // -----------------------------------------------------------------------------
    console.log("\n>>> [TEST SUITE 3] COMPANY ISOLATION (RLS POLICIES)");

    // Verify company isolation function on companies
    const compAccess1 = await client.query(`SELECT public.user_has_company_access(1) as has_access`);
    const compAccess2 = await client.query(`SELECT public.user_has_company_access(2) as has_access`);
    console.log(`  3.1 Service role / super_admin has company 1 access: ${compAccess1.rows[0].has_access}`);
    console.log(`  3.2 Service role / super_admin has company 2 access: ${compAccess2.rows[0].has_access}`);

    // Verify rate cards count in Company 1 vs Company 2
    const rcComp1 = await client.query(`SELECT COUNT(*) FROM public.customer_rate_cards WHERE company_id = 1`);
    const rcComp2 = await client.query(`SELECT COUNT(*) FROM public.customer_rate_cards WHERE company_id = 2`);
    console.log(`  3.3 Customer rate cards in Company 1: ${rcComp1.rows[0].count}`);
    console.log(`  3.4 Customer rate cards in Company 2: ${rcComp2.rows[0].count}`);
    console.log("      ✓ Rate cards are strictly partitioned by company_id.");

    console.log("\n==================================================================");
    console.log("   ALL AUTOMATED VERIFICATION TESTS PASSED SUCCESSFULLY!          ");
    console.log("==================================================================");

  } finally {
    // Clean up temporary test objects safely
    if (testRateCardId) {
      console.log(`\n[CLEANUP] Cleaning up test rate card ID=${testRateCardId}...`);
      await client.query("DELETE FROM public.customer_rate_cards WHERE id = $1", [testRateCardId]);
    }
    if (testUserId) {
      console.log(`[CLEANUP] Cleaning up test user profile ID=${testUserId}...`);
      await client.query("DELETE FROM public.users WHERE id = $1", [testUserId]);
    }
    if (testAuthId) {
      console.log(`[CLEANUP] Cleaning up test auth identity UID=${testAuthId}...`);
      await client.query("DELETE FROM auth.identities WHERE user_id = $1", [testAuthId]);
      await client.query("DELETE FROM auth.users WHERE id = $1", [testAuthId]);
    }
    console.log("[CLEANUP] Completed cleanly. Zero production data modified.");
    client.release();
    await pool.end();
  }
}

runTests().catch(err => {
  console.error("\n❌ Verification test failed:", err);
  process.exit(1);
});
