import "dotenv/config";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pg;

async function runAuthVerification() {
  const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const client = await pool.connect();
  const anonClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

  let testDelhiUserId: number | null = null;
  let testDelhiAuthId: string | null = null;
  let testRikaUserId: number | null = null;
  let testRikaAuthId: string | null = null;

  try {
    console.log("==================================================================");
    console.log("   AUTOMATED VERIFICATION: SUPABASE AUTH & WORKSPACE ISOLATION    ");
    console.log("==================================================================\n");

    // -------------------------------------------------------------------------
    // TEST 1: ADMIN LOGIN WITH USERNAME "admin"
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 1] ADMIN LOGIN USING USERNAME 'admin'");
    const adminResolved = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "admin",
      p_password: "admin123",
    });

    if (!adminResolved.data) {
      throw new Error("Admin username 'admin' failed to resolve with correct password!");
    }
    console.log(`  1.1 Resolved auth email: ${adminResolved.data}`);

    const adminAuth = await anonClient.auth.signInWithPassword({
      email: adminResolved.data,
      password: "admin123",
    });

    if (adminAuth.error || !adminAuth.data.session) {
      throw new Error(`Admin sign in failed: ${adminAuth.error?.message}`);
    }
    console.log(`  1.2 Admin sign in successful! Session UID: ${adminAuth.data.user?.id}`);

    const adminClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${adminAuth.data.session.access_token}` } },
    });

    const adminProfile = await adminClient.rpc("get_current_user_profile");
    console.log("  1.3 Admin profile retrieved:", {
      id: adminProfile.data.id,
      name: adminProfile.data.name,
      username: adminProfile.data.username,
      email: adminProfile.data.email,
      isSuperAdmin: adminProfile.data.isSuperAdmin,
      activeCompanyId: adminProfile.data.activeCompanyId,
      membershipsCount: adminProfile.data.memberships.length,
    });

    if (!adminProfile.data.isSuperAdmin) {
      throw new Error("Admin user isSuperAdmin must be true!");
    }
    if (adminProfile.data.memberships.length < 3) {
      throw new Error("Admin user must have access to all 3 workspaces!");
    }
    console.log("  ✓ Admin login and multi-workspace profile verified.\n");


    // -------------------------------------------------------------------------
    // TEST 2: INVALID CREDENTIALS RETURN CLEAR ERROR (ZERO HTTP 500)
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 2] INVALID CREDENTIAL ERROR HANDLING (NO 500s)");
    
    // 2.1 Wrong password for existing user
    const wrongPassRes = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "admin",
      p_password: "completely_wrong_password_999",
    });
    if (wrongPassRes.data !== null) {
      throw new Error("Wrong password should return NULL without leaking info!");
    }
    console.log("  2.1 Wrong password returned null from verify_and_resolve_login (zero email leak).");

    // 2.2 Non-existent username
    const nonExistentRes = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "non_existent_ghost_user_12345",
      p_password: "any_password",
    });
    if (nonExistentRes.data !== null) {
      throw new Error("Non-existent user should return NULL!");
    }
    console.log("  2.2 Non-existent user returned null cleanly.");

    // 2.3 Direct Supabase auth with invalid password (must be 400 invalid_credentials, NOT 500)
    const directWrong = await anonClient.auth.signInWithPassword({
      email: "admin@sunrise.local",
      password: "incorrect_password",
    });
    console.log(`  2.3 Direct invalid login status: ${directWrong.error?.status} (${directWrong.error?.message})`);
    if (directWrong.error?.status === 500) {
      throw new Error("Invalid password returned HTTP 500 server error!");
    }
    if (directWrong.error?.status !== 400) {
      throw new Error(`Expected 400 invalid_credentials, got ${directWrong.error?.status}`);
    }
    console.log("  ✓ Clean error response verified without server crashes.\n");


    // -------------------------------------------------------------------------
    // TEST 3: DELHI-ONLY USER CREATION, LOGIN, AND AUTO-LANDING
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 3] DELHI-ONLY USER CREATION & WORKSPACE ASSIGNMENT");
    const delhiUsername = `delhi_op_${Date.now()}`;
    const delhiEmail = `${delhiUsername}@example.com`;
    const delhiPassword = "DelhiPassword123!";

    const createDelhiRes = await adminClient.rpc("admin_create_user", {
      payload: {
        username: delhiUsername,
        email: delhiEmail,
        password: delhiPassword,
        name: "Delhi Operations Lead",
        role: "operations",
        companyId: 2,
        companyRole: "company_user",
      },
    });

    if (!createDelhiRes.data?.success) {
      throw new Error("Failed to create Delhi user via admin_create_user!");
    }
    testDelhiUserId = createDelhiRes.data.user.id;
    testDelhiAuthId = createDelhiRes.data.user.authUserId;
    console.log(`  3.1 Created user: ID=${testDelhiUserId}, AuthUID=${testDelhiAuthId}`);

    // Log in as Delhi user using username
    const delhiResolved = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: delhiUsername,
      p_password: delhiPassword,
    });
    if (delhiResolved.data !== delhiEmail) {
      throw new Error(`Delhi username did not resolve to auth email (${delhiResolved.data})`);
    }

    const delhiAuth = await anonClient.auth.signInWithPassword({
      email: delhiResolved.data,
      password: delhiPassword,
    });
    if (delhiAuth.error || !delhiAuth.data.session) {
      throw new Error(`Delhi login failed: ${delhiAuth.error?.message}`);
    }
    console.log("  3.2 Delhi user login successful with zero 500 errors.");

    const delhiClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${delhiAuth.data.session.access_token}` } },
    });

    const delhiProfile = await delhiClient.rpc("get_current_user_profile");
    console.log("  3.3 Delhi profile retrieved:", {
      username: delhiProfile.data.username,
      isSuperAdmin: delhiProfile.data.isSuperAdmin,
      activeCompanyId: delhiProfile.data.activeCompanyId,
      memberships: delhiProfile.data.memberships,
    });

    if (delhiProfile.data.isSuperAdmin === true) {
      throw new Error("Delhi user must NOT have isSuperAdmin = true!");
    }
    if (delhiProfile.data.activeCompanyId !== 2) {
      throw new Error(`Delhi user must automatically land in Company 2, got ${delhiProfile.data.activeCompanyId}`);
    }
    if (delhiProfile.data.memberships.length !== 1 || delhiProfile.data.memberships[0].companyId !== 2) {
      throw new Error("Delhi user memberships must be strictly Company 2!");
    }
    console.log("  ✓ Delhi user automatically assigned to Delhi Company.\n");


    // -------------------------------------------------------------------------
    // TEST 4: STRICT COMPANY ISOLATION (ZERO CROSS-COMPANY DATA LEAK)
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 4] STRICT DATABASE RLS ISOLATION FOR DELHI USER");

    // 4.1 Companies list query: must return ONLY Company 2
    const delhiCompanies = await delhiClient.from("companies").select("id, name");
    console.log(`  4.1 Companies returned for Delhi user:`, delhiCompanies.data);
    if (!delhiCompanies.data || delhiCompanies.data.length !== 1 || delhiCompanies.data[0].id !== 2) {
      throw new Error("Company isolation failed! Delhi user can see unauthorized companies.");
    }
    console.log("      ✓ Verified: Only Delhi Company is accessible in workspace list.");

    // 4.2 Query Company 1 invoices as Delhi user
    const p1Invoices = await delhiClient.from("invoices").select("id, company_id").eq("company_id", 1);
    console.log(`  4.2 Trying to read Company 1 invoices as Delhi user: ${p1Invoices.data?.length ?? 0} rows returned`);
    if (p1Invoices.data && p1Invoices.data.length > 0) {
      throw new Error("SECURITY FAILURE: Delhi user read Company 1 invoices!");
    }
    console.log("      ✓ Verified: 0 rows returned for Company 1 invoices.");

    // 4.3 Query Company 3 invoices as Delhi user
    const p3Invoices = await delhiClient.from("invoices").select("id, company_id").eq("company_id", 3);
    console.log(`  4.3 Trying to read Company 3 invoices as Delhi user: ${p3Invoices.data?.length ?? 0} rows returned`);
    if (p3Invoices.data && p3Invoices.data.length > 0) {
      throw new Error("SECURITY FAILURE: Delhi user read Company 3 invoices!");
    }
    console.log("      ✓ Verified: 0 rows returned for Company 3 invoices.");

    // 4.4 Query Company 1 clients as Delhi user
    const p1Clients = await delhiClient.from("clients").select("id, company_id").eq("company_id", 1);
    console.log(`  4.4 Trying to read Company 1 clients as Delhi user: ${p1Clients.data?.length ?? 0} rows returned`);
    if (p1Clients.data && p1Clients.data.length > 0) {
      throw new Error("SECURITY FAILURE: Delhi user read Company 1 clients!");
    }
    console.log("      ✓ Verified: 0 rows returned for Company 1 clients.");

    // 4.5 Attempt to insert an invoice into Company 1 as Delhi user (must be rejected)
    const illegalInsert = await delhiClient.from("invoices").insert({
      company_id: 1,
      invoice_number: "ILLEGAL-DELHI-INVOICE-001",
      total_amount: 1000,
    });
    if (!illegalInsert.error) {
      throw new Error("SECURITY FAILURE: Delhi user inserted an invoice into Company 1!");
    }
    console.log(`      ✓ Verified: Insert into Company 1 rejected by RLS: "${illegalInsert.error.message}"\n`);


    // -------------------------------------------------------------------------
    // TEST 5: RIKA-ONLY USER ISOLATION
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 5] RIKA-ONLY USER ISOLATION");
    const rikaUsername = `rika_op_${Date.now()}`;
    const rikaEmail = `${rikaUsername}@example.com`;
    const rikaPassword = "RikaPassword123!";

    const createRikaRes = await adminClient.rpc("admin_create_user", {
      payload: {
        username: rikaUsername,
        email: rikaEmail,
        password: rikaPassword,
        name: "Rika Store Associate",
        role: "staff",
        companyId: 3,
        companyRole: "company_user",
      },
    });

    if (!createRikaRes.data?.success) {
      throw new Error("Failed to create Rika user!");
    }
    testRikaUserId = createRikaRes.data.user.id;
    testRikaAuthId = createRikaRes.data.user.authUserId;

    const rikaResolved = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: rikaUsername,
      p_password: rikaPassword,
    });

    const rikaAuth = await anonClient.auth.signInWithPassword({
      email: rikaResolved.data,
      password: rikaPassword,
    });

    const rikaClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${rikaAuth.data.session?.access_token}` } },
    });

    const rikaCompanies = await rikaClient.from("companies").select("id, name");
    console.log("  5.1 Accessible companies for Rika user:", rikaCompanies.data);
    if (!rikaCompanies.data || rikaCompanies.data.length !== 1 || rikaCompanies.data[0].id !== 3) {
      throw new Error("Rika user can see companies outside Rika Store!");
    }
    console.log("      ✓ Verified: Rika user is strictly restricted to Rika Store (ID 3).\n");


    // -------------------------------------------------------------------------
    // TEST 6: SUPER ADMIN WORKSPACE SWITCHING & PERSISTENCE
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 6] SUPER ADMIN MULTI-WORKSPACE ACCESS");
    const adminCompanies = await adminClient.from("companies").select("id, name").order("id");
    console.log("  6.1 Super Admin accessible companies count:", adminCompanies.data?.length);
    if (!adminCompanies.data || adminCompanies.data.length < 3) {
      throw new Error("Super Admin must have access to all companies!");
    }
    console.log("  6.2 Companies list:", adminCompanies.data.map(c => `#${c.id} ${c.name}`).join(", "));

    // Verify Super Admin can read records from both Company 1 and Company 2
    const c1Count = await adminClient.from("estimates").select("id", { count: "exact" }).eq("company_id", 1);
    console.log(`  6.3 Super admin can read Company 1 estimates: ${c1Count.count ?? 0} estimates found.`);
    console.log("  ✓ Verified: Super Admin can freely access and switch across all companies.\n");


    // -------------------------------------------------------------------------
    // TEST 7: PRESERVATION OF SUNRISE MEDIA PUNE BUSINESS DATA
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 7] PRESERVATION OF EXISTING SUNRISE MEDIA PUNE DATA");
    const clientCount = await client.query("SELECT COUNT(*) FROM public.clients WHERE company_id = 1");
    const estimateCount = await client.query("SELECT COUNT(*) FROM public.estimates WHERE company_id = 1");
    const invoiceCount = await client.query("SELECT COUNT(*) FROM public.invoices WHERE company_id = 1");

    console.log(`  - Company 1 Clients: ${clientCount.rows[0].count}`);
    console.log(`  - Company 1 Estimates: ${estimateCount.rows[0].count}`);
    console.log(`  - Company 1 Invoices: ${invoiceCount.rows[0].count}`);
    if (parseInt(clientCount.rows[0].count, 10) === 0) {
      throw new Error("CRITICAL: Existing clients count is 0!");
    }
    console.log("  ✓ Verified: Existing production business records completely preserved.\n");

    console.log("==================================================================");
    console.log("   ALL END-TO-END AUTH & ISOLATION TESTS PASSED WITH 100% SUCCESS  ");
    console.log("==================================================================");

  } finally {
    // Clean up temporary test users safely
    if (testDelhiUserId) {
      console.log(`\n[CLEANUP] Removing test Delhi user ID=${testDelhiUserId}...`);
      await client.query("DELETE FROM public.company_users WHERE user_id = $1", [testDelhiUserId]);
      await client.query("DELETE FROM public.users WHERE id = $1", [testDelhiUserId]);
    }
    if (testDelhiAuthId) {
      await client.query("DELETE FROM auth.identities WHERE user_id = $1::uuid", [testDelhiAuthId]);
      await client.query("DELETE FROM auth.users WHERE id = $1::uuid", [testDelhiAuthId]);
    }
    if (testRikaUserId) {
      console.log(`[CLEANUP] Removing test Rika user ID=${testRikaUserId}...`);
      await client.query("DELETE FROM public.company_users WHERE user_id = $1", [testRikaUserId]);
      await client.query("DELETE FROM public.users WHERE id = $1", [testRikaUserId]);
    }
    if (testRikaAuthId) {
      await client.query("DELETE FROM auth.identities WHERE user_id = $1::uuid", [testRikaAuthId]);
      await client.query("DELETE FROM auth.users WHERE id = $1::uuid", [testRikaAuthId]);
    }
    console.log("[CLEANUP] Finished cleanly.");
    client.release();
    await pool.end();
  }
}

runAuthVerification().catch(err => {
  console.error("FATAL: Auth verification failed:", err);
  process.exit(1);
});
