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
  let tempUserId: number | null = null;
  let tempAuthId: string | null = null;

  try {
    console.log("==================================================================");
    console.log("   AUTOMATED VERIFICATION: WORKSPACE USER LINKING & RPC TESTS     ");
    console.log("==================================================================\n");

    // 1. Audit live database relationship
    console.log(">>> [TEST 1] AUDIT RELATIONSHIPS (auth.users <-> public.users <-> public.company_users)");
    const auditRes = await client.query(`
      SELECT 
        cu.id AS membership_id,
        cu.company_id,
        c.name AS company_name,
        cu.role AS company_role,
        u.id AS user_id,
        u.username,
        u.email,
        u.name,
        u.auth_user_id,
        au.email AS auth_email
      FROM public.company_users cu
      JOIN public.companies c ON c.id = cu.company_id
      JOIN public.users u ON u.id = cu.user_id
      LEFT JOIN auth.users au ON au.id = u.auth_user_id
      ORDER BY cu.company_id, cu.id
    `);

    console.log(`Found ${auditRes.rows.length} company memberships in live DB:`);
    for (const r of auditRes.rows) {
      console.log(`  - Company #${r.company_id} (${r.company_name}): User #${r.user_id} "${r.name}" (${r.email || 'NO_EMAIL'}) | Role: ${r.company_role} | Auth: ${r.auth_user_id ? 'LINKED (' + r.auth_email + ')' : 'UNLINKED'}`);
      if (!r.name || r.name.trim() === "") {
        throw new Error(`User #${r.user_id} has empty name!`);
      }
      if (!r.email || r.email.trim() === "") {
        throw new Error(`User #${r.user_id} has empty email!`);
      }
    }
    console.log("  ✓ All company members have valid names and emails in database.\n");

    // 2. Test assign_company_user RPC (assigning existing user to Company 2)
    console.log(">>> [TEST 2] ASSIGN EXISTING USER TO COMPANY (assign_company_user RPC)");
    // User 12 (Priyanka) is in Company 1. Let us assign her to Company 2 as 'company_admin'
    const assignRes = await client.query(`
      SELECT public.assign_company_user(2, 12, 'company_admin', false) AS result
    `);
    const assignData = assignRes.rows[0].result;
    console.log("  RPC Result:", assignData);
    if (!assignData.success || assignData.role !== 'company_admin') {
      throw new Error("Failed to assign user to company 2");
    }
    console.log(`  ✓ Successfully assigned User #${assignData.userId} (${assignData.user.name}) to Company #${assignData.companyId} as ${assignData.role}`);

    // Verify membership row exists in company_users
    const checkCu = await client.query(`
      SELECT * FROM public.company_users WHERE company_id = 2 AND user_id = 12
    `);
    if (checkCu.rows.length === 0 || checkCu.rows[0].role !== 'company_admin') {
      throw new Error("Verification query did not find updated company_users row!");
    }
    console.log("  ✓ Persisted membership confirmed in public.company_users.");

    // 3. Test remove_company_user RPC
    console.log("\n>>> [TEST 3] REMOVE USER FROM COMPANY (remove_company_user RPC)");
    // 3.1 Test protection of user 1 on company 1
    try {
      await client.query(`SELECT public.remove_company_user(1, 1)`);
      throw new Error("Expected protection error when removing user 1 from company 1!");
    } catch (err: any) {
      if (err.message.includes("Cannot remove primary Super Admin")) {
        console.log(`  3.1 ✓ Primary admin protection verified: "${err.message}"`);
      } else {
        throw err;
      }
    }

    // 3.2 Remove User 12 from Company 2
    const removeRes = await client.query(`
      SELECT public.remove_company_user(2, 12) AS result
    `);
    console.log("  3.2 Remove RPC Result:", removeRes.rows[0].result);
    const checkRemoved = await client.query(`
      SELECT * FROM public.company_users WHERE company_id = 2 AND user_id = 12
    `);
    if (checkRemoved.rows.length !== 0) {
      throw new Error("User 12 was not removed from Company 2!");
    }
    console.log("  ✓ Successfully removed user from company 2.");

    // 4. Test User Creation Workflow (Auth account + profile + company membership)
    console.log("\n>>> [TEST 4] CREATE USER FLOW WITH AUTH & WORKSPACE LINKING");
    const testUsername = `linking_test_${Date.now()}`;
    const testEmail = `${testUsername}@example.com`;

    const createRes = await client.query(`
      SELECT public.admin_create_user($1::jsonb) AS result
    `, [JSON.stringify({
      username: testUsername,
      email: testEmail,
      password: "SecurePassword123!",
      name: "Workspace Linking Tester",
      role: "operations",
      companyId: 2,
      companyRole: "company_user",
      phone: "9988776655",
      department: "Logistics",
      designation: "Associate",
      isActive: true
    })]);

    const createdData = createRes.rows[0].result;
    console.log("  Created User RPC Result:", createdData);
    tempUserId = createdData.user.id;
    tempAuthId = createdData.user.authUserId;

    // Verify auth.users
    const auCheck = await client.query("SELECT id, email, email_confirmed_at FROM auth.users WHERE id = $1", [tempAuthId]);
    if (auCheck.rows.length === 0 || !auCheck.rows[0].email_confirmed_at) {
      throw new Error("auth.users entry missing or unconfirmed!");
    }
    console.log("  ✓ auth.users record verified (email pre-confirmed).");

    // Verify public.users
    const puCheck = await client.query("SELECT id, username, email, name, auth_user_id FROM public.users WHERE id = $1", [tempUserId]);
    if (puCheck.rows.length === 0 || puCheck.rows[0].auth_user_id !== tempAuthId) {
      throw new Error("public.users profile missing or auth_user_id mismatch!");
    }
    console.log(`  ✓ public.users record verified: Name="${puCheck.rows[0].name}", Email="${puCheck.rows[0].email}".`);

    // Verify company_users
    const cuCheck = await client.query("SELECT id, user_id, company_id, role FROM public.company_users WHERE user_id = $1 AND company_id = 2", [tempUserId]);
    if (cuCheck.rows.length === 0 || cuCheck.rows[0].role !== "company_user") {
      throw new Error("public.company_users membership missing!");
    }
    console.log(`  ✓ public.company_users membership verified for Company #2.`);

    // 5. Test Company Isolation & Switching
    console.log("\n>>> [TEST 5] COMPANY ISOLATION & QUERY NORMALIZATION");
    // Query company 1 members
    const c1Members = await client.query(`
      SELECT cu.id, cu.user_id, u.name, u.email, cu.role
      FROM public.company_users cu
      JOIN public.users u ON u.id = cu.user_id
      WHERE cu.company_id = 1
    `);
    console.log(`  Company 1 has ${c1Members.rows.length} members:`, c1Members.rows.map(m => m.name).join(", "));

    // Query company 2 members
    const c2Members = await client.query(`
      SELECT cu.id, cu.user_id, u.name, u.email, cu.role
      FROM public.company_users cu
      JOIN public.users u ON u.id = cu.user_id
      WHERE cu.company_id = 2
    `);
    console.log(`  Company 2 has ${c2Members.rows.length} members:`, c2Members.rows.map(m => m.name).join(", "));

    // Confirm test user is ONLY in Company 2
    const inC1 = c1Members.rows.some(m => m.user_id === tempUserId);
    const inC2 = c2Members.rows.some(m => m.user_id === tempUserId);
    if (inC1 || !inC2) {
      throw new Error(`Company isolation failure! inC1=${inC1}, inC2=${inC2}`);
    }
    console.log("  ✓ Company isolation verified: test user exists strictly in Company #2.");

    console.log("\n==================================================================");
    console.log("   ALL WORKSPACE LINKING & RPC TESTS PASSED SUCCESSFULLY!         ");
    console.log("==================================================================");

  } finally {
    if (tempUserId) {
      console.log(`\n[CLEANUP] Removing test user ID=${tempUserId}...`);
      await client.query("DELETE FROM public.company_users WHERE user_id = $1", [tempUserId]);
      await client.query("DELETE FROM public.users WHERE id = $1", [tempUserId]);
    }
    if (tempAuthId) {
      console.log(`[CLEANUP] Removing test auth UID=${tempAuthId}...`);
      await client.query("DELETE FROM auth.identities WHERE user_id = $1", [tempAuthId]);
      await client.query("DELETE FROM auth.users WHERE id = $1", [tempAuthId]);
    }
    console.log("[CLEANUP] Completed cleanly.");
    client.release();
    await pool.end();
  }
}

runTests().catch(err => {
  console.error("\n❌ Verification test failed:", err);
  process.exit(1);
});
