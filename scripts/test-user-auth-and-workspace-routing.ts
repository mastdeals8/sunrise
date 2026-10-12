import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { pool } from "../server/db";

async function runTests() {
  console.log("==================================================================");
  console.log("   USER AUTHENTICATION, PROVISIONING & COMPANY ROUTING TESTS      ");
  console.log("==================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(desc: string, cond: boolean) {
    if (cond) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  const anonClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: ADMIN LOGIN
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 1] ADMIN LOGIN USING USERNAME 'admin'");
    const adminResolve = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "admin",
      p_password: "admin123",
    });
    assert("Admin username resolves to auth email", !!adminResolve.data);

    const adminAuth = await anonClient.auth.signInWithPassword({
      email: adminResolve.data,
      password: "admin123",
    });
    assert("Admin sign in succeeds", !adminAuth.error && !!adminAuth.data.session);

    const adminClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${adminAuth.data.session?.access_token}` } },
    });
    const adminProfile = await adminClient.rpc("get_current_user_profile");
    assert("Admin isSuperAdmin is true", adminProfile.data?.isSuperAdmin === true);
    assert("Admin has access to multiple company workspaces", (adminProfile.data?.memberships?.length || 0) >= 3);


    // -------------------------------------------------------------------------
    // TEST 2: PINKS LOGIN & STRICT DELHI COMPANY ISOLATION
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 2] PINKS LOGIN USING USERNAME 'pinks' AND 'pinks@123'");
    const pinksResolve = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "pinks",
      p_password: "pinks@123",
    });
    assert("Pinks username resolves to pinks@sunrisemedia.in", pinksResolve.data === "pinks@sunrisemedia.in");

    const pinksAuth = await anonClient.auth.signInWithPassword({
      email: pinksResolve.data,
      password: "pinks@123",
    });
    assert("Pinks sign in succeeds", !pinksAuth.error && !!pinksAuth.data.session);

    const pinksClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${pinksAuth.data.session?.access_token}` } },
    });
    const pinksProfile = await pinksClient.rpc("get_current_user_profile");
    assert("Pinks profile username matches", pinksProfile.data?.username === "pinks");
    assert("Pinks isSuperAdmin is false", pinksProfile.data?.isSuperAdmin === false);
    assert("Pinks activeCompanyId is Company 2 (Delhi Company)", pinksProfile.data?.activeCompanyId === 2);

    // Verify workspace isolation for pinks
    const pinksComps = await pinksClient.from("companies").select("id, name");
    assert("Pinks sees ONLY Delhi Company (ID 2)", pinksComps.data?.length === 1 && pinksComps.data[0].id === 2);

    const pinksPuneInvoices = await pinksClient.from("invoices").select("id").eq("company_id", 1);
    assert("Pinks CANNOT see Company 1 (Pune) invoices", (pinksPuneInvoices.data?.length || 0) === 0);


    // -------------------------------------------------------------------------
    // TEST 3: EXISTING USER QA_MANAGER LOGIN
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 3] QA_MANAGER LOGIN USING USERNAME 'qa_manager'");
    const qaResolve = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "qa_manager",
      p_password: "QAmanager123!",
    });
    assert("QA Manager username resolves to auth email", !!qaResolve.data);

    const qaAuth = await anonClient.auth.signInWithPassword({
      email: qaResolve.data,
      password: "QAmanager123!",
    });
    assert("QA Manager sign in succeeds", !qaAuth.error && !!qaAuth.data.session);

    const qaClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${qaAuth.data.session?.access_token}` } },
    });
    const qaProfile = await qaClient.rpc("get_current_user_profile");
    assert("QA Manager activeCompanyId is Company 1", qaProfile.data?.activeCompanyId === 1);
    assert("QA Manager isSuperAdmin is false", qaProfile.data?.isSuperAdmin === false);


    // -------------------------------------------------------------------------
    // TEST 4: CREATE BRAND NEW USER IN DELHI COMPANY AND VERIFY COMPLETE ISOLATION
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 4] CREATE NEW USER ASSIGNED TO DELHI COMPANY & VERIFY ISOLATION");
    const newUsername = `delhi_test_${Date.now()}`;
    const newEmail = `${newUsername}@sunrisemedia.in`;
    const newPassword = "DelhiTest123!";
    const newName = "Delhi Field Representative";

    const createRes = await adminClient.rpc("admin_create_user", {
      payload: {
        username: newUsername,
        email: newEmail,
        password: newPassword,
        name: newName,
        role: "operations",
        companyId: 2,
        companyRole: "company_user",
      },
    });

    assert("admin_create_user RPC returns success", createRes.data?.success === true);
    assert("Created user has valid ID", !!createRes.data?.user?.id);
    assert("Created user has linked authUserId", !!createRes.data?.user?.authUserId);

    // Verify database record has auth_user_id linked
    const dbCheck = await pool.query("SELECT id, username, email, auth_user_id FROM public.users WHERE username = $1", [newUsername]);
    assert("public.users record created with matching auth_user_id", dbCheck.rows[0]?.auth_user_id === createRes.data?.user?.authUserId);

    // Log in as the new user
    const newResolve = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: newUsername,
      p_password: newPassword,
    });
    assert("New user resolves to their auth email", newResolve.data === newEmail);

    const newAuth = await anonClient.auth.signInWithPassword({
      email: newResolve.data,
      password: newPassword,
    });
    assert("New user sign in succeeds", !newAuth.error && !!newAuth.data.session);

    const newClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${newAuth.data.session?.access_token}` } },
    });

    const newProfile = await newClient.rpc("get_current_user_profile");
    assert("New user profile activeCompanyId is Company 2 (Delhi)", newProfile.data?.activeCompanyId === 2);
    assert("New user isSuperAdmin is false", newProfile.data?.isSuperAdmin === false);
    assert("New user memberships count is strictly 1", newProfile.data?.memberships?.length === 1);
    assert("New user membership companyId is 2", newProfile.data?.memberships[0]?.companyId === 2);

    // Strict Data Isolation Check: Pune data must be completely invisible
    const newVisibleCompanies = await newClient.from("companies").select("id, name");
    assert("New user sees ONLY Company 2 in companies table", newVisibleCompanies.data?.length === 1 && newVisibleCompanies.data[0].id === 2);

    const newPuneInvoices = await newClient.from("invoices").select("id").eq("company_id", 1);
    assert("New user CANNOT see Company 1 invoices (0 returned)", (newPuneInvoices.data?.length || 0) === 0);

    const newPuneEstimates = await newClient.from("estimates").select("id").eq("company_id", 1);
    assert("New user CANNOT see Company 1 estimates (0 returned)", (newPuneEstimates.data?.length || 0) === 0);


    // -------------------------------------------------------------------------
    // TEST 5: INVALID CREDENTIALS RETURN CLEAN REJECTION (ZERO 500 ERRORS)
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 5] INVALID PASSWORD ERROR HANDLING");
    const wrongPassRes = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: newUsername,
      p_password: "WrongPassword_999!",
    });
    assert("Wrong password returns null from verify_and_resolve_login", wrongPassRes.data === null);

    const wrongLogin = await anonClient.auth.signInWithPassword({
      email: newEmail,
      password: "WrongPassword_999!",
    });
    assert("Direct GoTrue invalid password returns 400 error status", wrongLogin.error?.status === 400);


    console.log("\n==================================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution encountered an error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
