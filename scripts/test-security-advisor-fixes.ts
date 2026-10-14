import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://kbnjiidfpqnklaljtuoj.supabase.co";
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const cleanConnectionString = (process.env.DATABASE_URL || "").replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");

const pureAnonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const pool = new Pool({
  connectionString: cleanConnectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

async function runSecurityAdvisorVerification() {
  console.log("==================================================================");
  console.log("   AUTOMATED VERIFICATION: SUPABASE SECURITY ADVISOR FIXES");
  console.log("==================================================================\n");

  const pgClient = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: UNRESTRICTED RPC BLOCKED FOR ANON
    // -------------------------------------------------------------------------
    console.log(">>> [TEST 1] VERIFYING PRIVILEGED RPCs ARE BLOCKED FOR ANON CLIENT");
    const testRpcs = [
      { name: "admin_create_user", params: { payload: {} } },
      { name: "assign_company_user", params: { p_company_id: 1, p_user_id: 1, p_role: "company_user", p_is_default: false } },
      { name: "batch_update_rate_card_items", params: { p_rate_card_id: 1, p_items: [] } },
      { name: "create_estimate_atomic", params: { p_estimate: { company_id: 1 }, p_items: [] } },
      { name: "create_invoice_atomic", params: { p_invoice: { company_id: 1 } } },
      { name: "get_current_user_id", params: {} },
      { name: "get_current_user_profile", params: {} },
      { name: "import_products_to_rate_card", params: { p_rate_card_id: 1 } },
      { name: "is_super_admin", params: {} },
      { name: "next_sunrise_document_number", params: { p_kind: "estimate", p_date: "2026-10-14" } },
      { name: "remove_company_user", params: { p_company_id: 1, p_user_id: 1 } },
      { name: "replace_estimate_items", params: { p_estimate_id: 1, p_items: [] } },
      { name: "resolve_customer_rate", params: { p_client_id: 1, p_product_id: 1 } },
      { name: "resolve_login_email", params: { login_username: "admin" } },
      { name: "set_tally_invoice_sequence", params: { p_fy: "26-27", p_current_number: 100 } },
      { name: "user_has_company_access", params: { check_company_id: 1 } }
    ];

    for (const rpc of testRpcs) {
      const { data, error } = await anonClient.rpc(rpc.name, rpc.params);
      if (error) {
        console.log(`  ✓ Blocked anon from calling ${rpc.name}: ${error.code || "Permission denied"} (${error.message})`);
      } else {
        throw new Error(`SECURITY FAILURE: Anon was able to execute privileged RPC ${rpc.name}! Result: ${JSON.stringify(data)}`);
      }
    }

    // verify_and_resolve_login MUST remain callable by anon
    const { data: loginRes, error: loginErr } = await anonClient.rpc("verify_and_resolve_login", {
      p_identifier: "admin",
      p_password: "wrong-password"
    });
    if (loginErr) {
      throw new Error(`verify_and_resolve_login failed unexpectedly: ${loginErr.message}`);
    }
    if (loginRes !== null) {
      throw new Error(`verify_and_resolve_login leaked email on wrong password!`);
    }
    console.log(`  ✓ verify_and_resolve_login is callable by anon and safely returns null on wrong password.`);

    // -------------------------------------------------------------------------
    // TEST 2: AUTHENTICATE ADMIN & RESTRICTED USERS FOR SCOPED TESTS
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 2] LOGGING IN FOR AUTHENTICATED POLICY CHECKS");
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
    console.log(`  ✓ Admin signed in successfully.`);

    // Create a temporary Delhi Company 2 user to test cross-company boundaries
    const delhiUsername = `delhi_audit_${Date.now()}`;
    const delhiEmail = `${delhiUsername}@example.com`;
    const delhiPass = "DelhiPass@123";

    const { data: createDelhiRes, error: createDelhiErr } = await adminClient.rpc("admin_create_user", {
      payload: {
        username: delhiUsername,
        email: delhiEmail,
        password: delhiPass,
        name: "Delhi Audit User",
        companyId: 2,
        companyRole: "company_user"
      }
    });
    if (createDelhiErr || !createDelhiRes?.success) {
      throw new Error(`Failed to create Delhi user: ${createDelhiErr?.message}`);
    }
    const delhiUserId = createDelhiRes.user.id;
    console.log(`  ✓ Created temporary Delhi user ID: ${delhiUserId}`);

    const { data: delhiSession } = await anonClient.auth.signInWithPassword({
      email: delhiEmail,
      password: delhiPass
    });
    const delhiClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${delhiSession.session!.access_token}` } }
    });
    console.log(`  ✓ Delhi user authenticated.`);

    // -------------------------------------------------------------------------
    // TEST 3: estimate_format_profiles RLS AND WRITE RESTRICTIONS
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 3] ESTIMATE FORMAT PROFILES RLS & PERMISSIONS");
    // Pure anon cannot read
    const { data: anonProfiles, error: anonEfpErr } = await pureAnonClient
      .from("estimate_format_profiles")
      .select("id, code, name");
    console.log(`  - Anon read result count: ${anonProfiles?.length || 0} (Err: ${anonEfpErr?.message || "none"})`);
    if (anonProfiles && anonProfiles.length > 0) {
      throw new Error("SECURITY FAILURE: Anon was able to read estimate_format_profiles!");
    }
    console.log(`  ✓ Anon cannot read estimate_format_profiles (0 rows returned by RLS).`);

    // Authenticated user CAN read format profiles
    const { data: delhiProfiles, error: delhiEfpErr } = await delhiClient
      .from("estimate_format_profiles")
      .select("id, code, name");
    if (delhiEfpErr || !delhiProfiles || delhiProfiles.length === 0) {
      throw new Error(`Authenticated user could not read estimate_format_profiles: ${delhiEfpErr?.message}`);
    }
    console.log(`  ✓ Authenticated user can read format profiles (${delhiProfiles.length} profiles found).`);

    // Non-super-admin user CANNOT insert format profiles
    const { error: delhiInsertEfpErr } = await delhiClient
      .from("estimate_format_profiles")
      .insert({
        code: "HACKED_PROFILE",
        name: "Hacked Profile",
        store_mode: "none"
      });
    if (!delhiInsertEfpErr) {
      throw new Error("SECURITY FAILURE: Non-admin was able to insert an estimate_format_profile!");
    }
    console.log(`  ✓ Non-admin insert into estimate_format_profiles rejected by RLS: "${delhiInsertEfpErr.message}"`);

    // -------------------------------------------------------------------------
    // TEST 4: app_settings UNRESTRICTED WRITE FIX
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 4] APP_SETTINGS RLS & WRITE RESTRICTIONS");
    // Non-super-admin user CANNOT modify app_settings
    const { error: delhiInsertSettingErr } = await delhiClient
      .from("app_settings")
      .insert({ key: "hacked.key", value: { evil: true } });
    if (!delhiInsertSettingErr) {
      throw new Error("SECURITY FAILURE: Non-admin was able to insert into app_settings!");
    }
    console.log(`  ✓ Non-admin insert into app_settings rejected by RLS: "${delhiInsertSettingErr.message}"`);

    const { error: delhiUpdateSettingErr } = await delhiClient
      .from("app_settings")
      .update({ value: { hacked: true } })
      .eq("key", "company.name");
    // Update either throws an error or updates 0 rows
    const checkSettingRes = await pgClient.query("SELECT value FROM app_settings WHERE key = 'company.name'");
    if (checkSettingRes.rows[0].value?.hacked === true) {
      throw new Error("SECURITY FAILURE: Non-admin was able to update app_settings company.name!");
    }
    console.log(`  ✓ Non-admin update of app_settings blocked by RLS.`);

    // -------------------------------------------------------------------------
    // TEST 5: CROSS-COMPANY ISOLATION ON INVOICE_PACKET_PAGES & PROJECT_FILES
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 5] INVOICE_PACKET_PAGES & PROJECT_FILES CROSS-COMPANY ISOLATION");
    // Create test project in Company 1
    const testProjRes = await pgClient.query(`
      INSERT INTO projects (company_id, project_code, name, client_id, brand_id, store_id, budget, status)
      VALUES (1, 'PRJ-TEST-AUDIT', 'Audit Project C1', 1, 1, 1, 1000, 'active')
      RETURNING id
    `);
    const comp1ProjectId = testProjRes.rows[0].id;

    // Super admin creates a project file in Company 1
    const testFileRes = await pgClient.query(`
      INSERT INTO project_files (project_id, file_name, file_path)
      VALUES ($1, 'c1-secret.pdf', 'c1-secret.pdf')
      RETURNING id
    `, [comp1ProjectId]);
    const comp1FileId = testFileRes.rows[0].id;

    // Delhi user attempts to read Company 1 project files via Supabase RLS
    const { data: comp1Files } = await delhiClient
      .from("project_files")
      .select("*")
      .eq("project_id", comp1ProjectId);
    if (comp1Files && comp1Files.length > 0) {
      throw new Error(`SECURITY FAILURE: Delhi user could read Company 1 project files!`);
    }
    console.log(`  ✓ Delhi user received 0 rows for Company 1 project files (isolated).`);

    // Delhi user attempts to insert file into Company 1 project
    const { error: insertFileErr } = await delhiClient
      .from("project_files")
      .insert({
        project_id: comp1ProjectId,
        file_name: "delhi-tampered.pdf",
        file_path: "delhi-tampered.pdf"
      });
    if (!insertFileErr) {
      throw new Error("SECURITY FAILURE: Delhi user inserted file into Company 1 project!");
    }
    console.log(`  ✓ Delhi user insert into Company 1 project files rejected by RLS: "${insertFileErr.message}"`);

    // Create test invoice packet in Company 1
    const testPacketRes = await pgClient.query(`
      INSERT INTO invoice_packets (company_id, packet_number, project_id, client_id, store_id, status)
      VALUES (1, 'PKT-TEST-AUDIT', $1, 1, 1, 'draft')
      RETURNING id
    `, [comp1ProjectId]);
    const comp1PacketId = testPacketRes.rows[0].id;

    // Super admin creates an invoice packet page in Company 1
    const testPageRes = await pgClient.query(`
      INSERT INTO invoice_packet_pages (packet_id, page_number, file_name, file_path)
      VALUES ($1, 1, 'challan-c1.pdf', 'challan-c1.pdf')
      RETURNING id
    `, [comp1PacketId]);
    const comp1PageId = testPageRes.rows[0].id;

    // Delhi user attempts to read Company 1 packet pages via Supabase RLS
    const { data: comp1Pages } = await delhiClient
      .from("invoice_packet_pages")
      .select("*")
      .eq("packet_id", comp1PacketId);
    if (comp1Pages && comp1Pages.length > 0) {
      throw new Error(`SECURITY FAILURE: Delhi user could read Company 1 invoice packet pages!`);
    }
    console.log(`  ✓ Delhi user received 0 rows for Company 1 invoice packet pages (isolated).`);

    // Delhi user attempts to insert page into Company 1 packet
    const { error: insertPageErr } = await delhiClient
      .from("invoice_packet_pages")
      .insert({
        packet_id: comp1PacketId,
        page_number: 999,
        file_name: "delhi-tampered.pdf",
        file_path: "delhi-tampered.pdf"
      });
    if (!insertPageErr) {
      throw new Error("SECURITY FAILURE: Delhi user inserted page into Company 1 invoice packet!");
    }
    console.log(`  ✓ Delhi user insert into Company 1 invoice packet rejected by RLS: "${insertPageErr.message}"`);

    // Clean up temporary test project & packet records
    await pgClient.query("DELETE FROM invoice_packet_pages WHERE id = $1", [comp1PageId]);
    await pgClient.query("DELETE FROM invoice_packets WHERE id = $1", [comp1PacketId]);
    await pgClient.query("DELETE FROM project_files WHERE id = $1", [comp1FileId]);
    await pgClient.query("DELETE FROM projects WHERE id = $1", [comp1ProjectId]);
    console.log(`  ✓ Cleaned up test project & packet verification fixtures cleanly.`);

    // -------------------------------------------------------------------------
    // TEST 6: IN-FUNCTION CROSS-COMPANY RPC ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 6] ATOMIC RPC IN-FUNCTION CROSS-COMPANY ISOLATION");
    // Delhi user tries to create estimate in Company 1 via create_estimate_atomic
    const { data: comp1EstData, error: comp1EstErr } = await delhiClient.rpc("create_estimate_atomic", {
      p_estimate: {
        company_id: 1,
        title: "Malicious Estimate"
      },
      p_items: []
    });
    if (!comp1EstErr) {
      throw new Error(`SECURITY FAILURE: Delhi user created estimate in Company 1 via create_estimate_atomic!`);
    }
    console.log(`  ✓ create_estimate_atomic rejected cross-company creation: "${comp1EstErr.message}"`);

    // Delhi user tries to create invoice in Company 1 via create_invoice_atomic
    const { data: comp1InvData, error: comp1InvErr } = await delhiClient.rpc("create_invoice_atomic", {
      p_invoice: {
        company_id: 1,
        party_name: "Malicious Invoice"
      }
    });
    if (!comp1InvErr) {
      throw new Error(`SECURITY FAILURE: Delhi user created invoice in Company 1 via create_invoice_atomic!`);
    }
    console.log(`  ✓ create_invoice_atomic rejected cross-company creation: "${comp1InvErr.message}"`);

    // Delhi user tries to replace estimate items on Company 1 estimate
    const comp1EstLookup = await pgClient.query("SELECT id FROM estimates WHERE company_id = 1 LIMIT 1");
    if (comp1EstLookup.rows.length > 0) {
      const comp1EstId = comp1EstLookup.rows[0].id;
      const { data: comp1ItemsData, error: comp1ItemsErr } = await delhiClient.rpc("replace_estimate_items", {
        p_estimate_id: comp1EstId,
        p_items: []
      });
      if (!comp1ItemsErr) {
        throw new Error(`SECURITY FAILURE: Delhi user replaced items on Company 1 estimate!`);
      }
      console.log(`  ✓ replace_estimate_items rejected cross-company modification: "${comp1ItemsErr.message}"`);
    }

    // Delhi user tries to generate document number for Company 1
    const { error: comp1DocErr } = await delhiClient.rpc("next_sunrise_document_number", {
      p_kind: "estimate",
      p_date: "2026-10-14",
      p_company_id: 1
    });
    if (!comp1DocErr) {
      throw new Error(`SECURITY FAILURE: Delhi user generated document number for Company 1!`);
    }
    console.log(`  ✓ next_sunrise_document_number rejected unauthorized company query: "${comp1DocErr.message}"`);

    // -------------------------------------------------------------------------
    // TEST 7: STORAGE BUCKET LISTING RESTRICTION
    // -------------------------------------------------------------------------
    console.log("\n>>> [TEST 7] STORAGE OBJECTS LISTING RESTRICTION ON company-assets");
    const { data: anonObjects, error: anonStorageErr } = await pureAnonClient
      .storage
      .from("company-assets")
      .list();
    console.log(`  - Anon storage list result count: ${anonObjects?.length ?? "null"} (Err: ${anonStorageErr?.message || "none"})`);
    if (anonObjects && anonObjects.length > 0) {
      throw new Error("SECURITY FAILURE: Anon was able to list files in company-assets bucket!");
    }
    console.log(`  ✓ Anon cannot list objects in company-assets bucket.`);

    // Authenticated user CAN list files in company-assets
    const { data: authObjects, error: authStorageErr } = await adminClient
      .storage
      .from("company-assets")
      .list();
    if (authStorageErr) {
      console.log(`  Notice on authenticated list: ${authStorageErr.message}`);
    } else {
      console.log(`  ✓ Authenticated user can list files in company-assets (${authObjects?.length || 0} objects).`);
    }

    // Direct asset retrieval via public URL remains accessible
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/company-assets/test.png`;
    const pingRes = await fetch(publicUrl);
    console.log(`  - Public CDN asset ping returned status: ${pingRes.status} (404 expected if file does not exist, 401/403 would indicate broken public bucket).`);
    if (pingRes.status === 401 || pingRes.status === 403) {
      throw new Error(`Public bucket direct access broken: got ${pingRes.status}`);
    }
    console.log(`  ✓ Public bucket direct retrieval preserved (status ${pingRes.status}).`);

    // -------------------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------------------
    console.log("\n>>> [CLEANUP] REMOVING TEST USERS");
    await pgClient.query("DELETE FROM public.company_users WHERE user_id = $1", [delhiUserId]);
    await pgClient.query("DELETE FROM public.users WHERE id = $1", [delhiUserId]);
    await pgClient.query("DELETE FROM auth.users WHERE email = $1", [delhiEmail]);
    console.log(`  ✓ Cleaned up test user ${delhiEmail}.`);

    console.log("\n==================================================================");
    console.log("   ALL SECURITY ADVISOR AUDIT & ISOLATION VERIFICATIONS PASSED!");
    console.log("==================================================================");

  } finally {
    pgClient.release();
    await pool.end();
  }
}

runSecurityAdvisorVerification().catch(err => {
  console.error("\n❌ VERIFICATION TEST FAILED:", err);
  process.exit(1);
});
