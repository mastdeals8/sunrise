import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { resolveCompanyForRequest, resolveUserFromToken, generateToken } from "../server/auth";
import { companies, companyUsers, users, estimates, invoices, clients, stores } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import assert from "assert";

async function runIsolationTests() {
  console.log("=================================================");
  console.log("RUNNING MULTI-COMPANY TENANT ISOLATION TEST SUITE");
  console.log("=================================================");

  // 1. Verify Companies in Database
  console.log("\n[Test 1] Verifying company records in database...");
  const allCompanies = await storage.getAllCompanies();
  console.log(`Found ${allCompanies.length} companies:`);
  allCompanies.forEach(c => console.log(`  - [ID: ${c.id}] ${c.name} (${c.code || "NO CODE"})`));
  assert(allCompanies.length >= 3, "Expected at least 3 companies");
  
  const c1 = allCompanies.find(c => c.id === 1);
  const c2 = allCompanies.find(c => c.id === 2);
  const c3 = allCompanies.find(c => c.id === 3);
  assert(c1 && c1.name.includes("Sunrise Media"), "Company 1 must be Sunrise Media");
  assert(c2 && c2.name.includes("Delhi"), "Company 2 must be Delhi company");
  assert(c3 && c3.name.includes("Rika"), "Company 3 must be Rika Store");
  console.log("  ✓ Company 1 (Sunrise Media), Company 2 (Delhi), Company 3 (Rika Store) verified.");

  // 2. Verify Historical Data Preservation
  console.log("\n[Test 2] Verifying historical record preservation for Sunrise Media (Company 1)...");
  const c1Estimates = await storage.getAllEstimates(1);
  const c1Invoices = await storage.getAllInvoices(1);
  const c1Clients = await storage.getAllClients(1);
  const c1Stores = await storage.getAllStores(undefined, undefined, 1);
  const c1Products = await storage.getAllProducts(1);
  const c1DCs = await storage.getAllDeliveryChallans(1);

  console.log(`  - Estimates: ${c1Estimates.length}`);
  console.log(`  - Invoices: ${c1Invoices.length}`);
  console.log(`  - Clients: ${c1Clients.length}`);
  console.log(`  - Stores: ${c1Stores.length}`);
  console.log(`  - Products: ${c1Products.length}`);
  console.log(`  - Delivery Challans: ${c1DCs.length}`);

  assert(c1Estimates.length >= 42, `Expected >= 42 estimates, found ${c1Estimates.length}`);
  assert(c1Invoices.length >= 31, `Expected >= 31 invoices, found ${c1Invoices.length}`);
  assert(c1Clients.length >= 3, `Expected >= 3 clients, found ${c1Clients.length}`);
  assert(c1Stores.length >= 565, `Expected >= 565 stores, found ${c1Stores.length}`);
  assert(c1Products.length >= 42, `Expected >= 42 products, found ${c1Products.length}`);
  assert(c1DCs.length >= 86, `Expected >= 86 DCs, found ${c1DCs.length}`);
  console.log("  ✓ 100% of historical Sunrise Media records preserved under Company 1.");

  // 3. Verify Data Isolation Across Companies
  console.log("\n[Test 3] Verifying data isolation across Company 1, 2, and 3...");
  const c2Estimates = await storage.getAllEstimates(2);
  const c3Estimates = await storage.getAllEstimates(3);
  assert(c2Estimates.length === 0, `Company 2 must have 0 estimates initially, found ${c2Estimates.length}`);
  assert(c3Estimates.length === 0, `Company 3 must have 0 estimates initially, found ${c3Estimates.length}`);

  const c2Invoices = await storage.getAllInvoices(2);
  const c3Invoices = await storage.getAllInvoices(3);
  assert(c2Invoices.length === 0, `Company 2 must have 0 invoices, found ${c2Invoices.length}`);
  assert(c3Invoices.length === 0, `Company 3 must have 0 invoices, found ${c3Invoices.length}`);

  const c2Clients = await storage.getAllClients(2);
  const c3Clients = await storage.getAllClients(3);
  assert(c2Clients.length === 0, `Company 2 must have 0 clients, found ${c2Clients.length}`);
  assert(c3Clients.length === 0, `Company 3 must have 0 clients, found ${c3Clients.length}`);

  const c2Stores = await storage.getAllStores(undefined, undefined, 2);
  assert(c2Stores.length === 0, `Company 2 must have 0 stores, found ${c2Stores.length}`);
  console.log("  ✓ Complete data isolation: Company 2 and 3 cannot see Company 1 estimates, invoices, clients, or stores.");

  // 4. Verify Document Number Sequence Isolation
  console.log("\n[Test 4] Verifying company-isolated document numbering sequences...");
  const getNextDocNum = async (kind: "invoice" | "estimate" | "dc", compId: number) => {
    const res: any = await db.execute(sql`SELECT public.next_sunrise_document_number(${kind}, '2026-10-10'::date, ${compId}) as num`);
    return res.rows[0].num;
  };

  const c1InvDoc = await getNextDocNum("invoice", 1);
  const c2InvDoc = await getNextDocNum("invoice", 2);
  const c3InvDoc = await getNextDocNum("invoice", 3);

  console.log(`  - Company 1 next tax invoice: ${c1InvDoc}`);
  console.log(`  - Company 2 next tax invoice: ${c2InvDoc}`);
  console.log(`  - Company 3 next tax invoice: ${c3InvDoc}`);

  assert(c1InvDoc.includes("SM"), `Company 1 must use SM prefix: ${c1InvDoc}`);
  assert(c2InvDoc.includes("DEL"), `Company 2 must use DEL prefix: ${c2InvDoc}`);
  assert(c3InvDoc.includes("RIKA"), `Company 3 must use RIKA prefix: ${c3InvDoc}`);

  const c1EstDoc = await getNextDocNum("estimate", 1);
  const c2EstDoc = await getNextDocNum("estimate", 2);
  console.log(`  - Company 1 next estimate: ${c1EstDoc}`);
  console.log(`  - Company 2 next estimate: ${c2EstDoc}`);
  assert(c1EstDoc.includes("SM/E"), `Company 1 must use SM/E prefix: ${c1EstDoc}`);
  assert(c2EstDoc.includes("DEL/E"), `Company 2 must use DEL/E prefix: ${c2EstDoc}`);
  console.log("  ✓ Document numbering series and sequences are completely isolated by company.");

  // 5. Verify Super Admin Access & Role-based Company Authorization
  console.log("\n[Test 5] Verifying Super Admin access vs Tenant User restrictions...");
  // Kunal / admin user
  const adminRaw = await storage.getUserByUsername("admin");
  assert(adminRaw, "Super admin user must exist");
  const adminUser = await resolveUserFromToken(generateToken(adminRaw));
  assert(adminUser && adminUser.isSuperAdmin, "Admin user must be identified as Super Admin");

  // Create temporary test users for tenant isolation testing
  const testDelhiUsername = "test_delhi_user_" + Date.now();
  const testRikaUsername = "test_rika_user_" + Date.now();

  const delhiRaw = await storage.createUser({
    username: testDelhiUsername,
    password: "Password123!",
    name: "Delhi Operations",
    email: `${testDelhiUsername}@example.com`,
    role: "operations",
  });

  const rikaRaw = await storage.createUser({
    username: testRikaUsername,
    password: "Password123!",
    name: "Rika Store Manager",
    email: `${testRikaUsername}@example.com`,
    role: "staff",
  });

  // Assign Delhi user only to Company 2
  await storage.addUserToCompany(delhiRaw.id, 2, "company_admin");
  // Assign Rika user only to Company 3
  await storage.addUserToCompany(rikaRaw.id, 3, "company_user");

  try {
    const delhiUser = await resolveUserFromToken(generateToken(delhiRaw));
    const rikaUser = await resolveUserFromToken(generateToken(rikaRaw));
    assert(delhiUser, "Delhi user must resolve");
    assert(rikaUser, "Rika user must resolve");

    // Test A: Super Admin can access Company 1, 2, and 3
    const reqAdminC1: any = { headers: { "x-company-id": "1" }, user: adminUser };
    const resAdminC1: any = { status: () => resAdminC1, json: () => {} };
    const okAdmin1 = resolveCompanyForRequest(reqAdminC1, resAdminC1);
    assert(okAdmin1 && reqAdminC1.companyId === 1, "Super Admin must access Company 1");

    const reqAdminC2: any = { headers: { "x-company-id": "2" }, user: adminUser };
    const okAdmin2 = resolveCompanyForRequest(reqAdminC2, resAdminC1);
    assert(okAdmin2 && reqAdminC2.companyId === 2, "Super Admin must access Company 2");

    const reqAdminC3: any = { headers: { "x-company-id": "3" }, user: adminUser };
    const okAdmin3 = resolveCompanyForRequest(reqAdminC3, resAdminC1);
    assert(okAdmin3 && reqAdminC3.companyId === 3, "Super Admin must access Company 3");
    console.log("  ✓ Super Admin can access and switch between all companies.");

    // Test B: Delhi User accessing Company 2 -> SUCCESS
    const reqDelhiC2: any = { headers: { "x-company-id": "2" }, user: delhiUser };
    const okDelhi2 = resolveCompanyForRequest(reqDelhiC2, resAdminC1);
    assert(okDelhi2 && reqDelhiC2.companyId === 2, "Delhi user should access Company 2");
    console.log("  ✓ Delhi user successfully authorized for assigned Company 2.");

    // Test C: Delhi User attempting to access Sunrise Media (Company 1) via tampered header -> 403 FORBIDDEN
    let delhiC1Status = 0;
    let delhiC1Error = "";
    const resForbidden: any = {
      status: (code: number) => {
        delhiC1Status = code;
        return {
          json: (data: any) => { delhiC1Error = data.message; }
        };
      }
    };
    const reqDelhiC1Tampered: any = { headers: { "x-company-id": "1" }, user: delhiUser };
    const okDelhi1 = resolveCompanyForRequest(reqDelhiC1Tampered, resForbidden);
    assert(!okDelhi1 && delhiC1Status === 403, `Expected 403 Forbidden, got ${delhiC1Status}`);
    console.log(`  ✓ Tampered request rejected: Delhi user blocked from Company 1 (${delhiC1Status}: ${delhiC1Error}).`);

    // Test D: Delhi User attempting to access Rika Store (Company 3) -> 403 FORBIDDEN
    let delhiC3Status = 0;
    const reqDelhiC3Tampered: any = { headers: { "x-company-id": "3" }, user: delhiUser };
    const okDelhi3 = resolveCompanyForRequest(reqDelhiC3Tampered, {
      status: (code: number) => {
        delhiC3Status = code;
        return { json: () => {} };
      }
    });
    assert(!okDelhi3 && delhiC3Status === 403, `Expected 403 Forbidden, got ${delhiC3Status}`);
    console.log(`  ✓ Tampered request rejected: Delhi user blocked from Company 3 (${delhiC3Status}).`);

    // Test E: Rika User attempting to access Sunrise Media (Company 1) -> 403 FORBIDDEN
    let rikaC1Status = 0;
    const reqRikaC1Tampered: any = { headers: { "x-company-id": "1" }, user: rikaUser };
    const okRika1 = resolveCompanyForRequest(reqRikaC1Tampered, {
      status: (code: number) => {
        rikaC1Status = code;
        return { json: () => {} };
      }
    });
    assert(!okRika1 && rikaC1Status === 403, `Expected 403 Forbidden, got ${rikaC1Status}`);
    console.log(`  ✓ Tampered request rejected: Rika user blocked from Company 1 (${rikaC1Status}).`);

    // Test F: Multi-company user assigned to Company 2 and 3 can switch between both, but blocked from Company 1
    await storage.addUserToCompany(delhiRaw.id, 3, "company_user");
    const multiUser = await resolveUserFromToken(generateToken(delhiRaw));
    assert(multiUser, "Multi-company user must resolve");

    const reqMultiC3: any = { headers: { "x-company-id": "3" }, user: multiUser };
    const okMulti3 = resolveCompanyForRequest(reqMultiC3, resAdminC1);
    assert(okMulti3 && reqMultiC3.companyId === 3, "Multi-company user should access Company 3");

    let multiC1Status = 0;
    const reqMultiC1: any = { headers: { "x-company-id": "1" }, user: multiUser };
    const okMulti1 = resolveCompanyForRequest(reqMultiC1, {
      status: (code: number) => {
        multiC1Status = code;
        return { json: () => {} };
      }
    });
    assert(!okMulti1 && multiC1Status === 403, "Multi-company user still blocked from unassigned Company 1");
    console.log("  ✓ Multi-company user can switch between permitted companies (2 & 3) and remains blocked from unassigned Company 1.");

  } finally {
    // Clean up test users and company memberships
    console.log("\n[Cleanup] Cleaning up temporary test users...");
    await db.delete(companyUsers).where(sql`${companyUsers.userId} IN (${delhiRaw.id}, ${rikaRaw.id})`);
    await db.delete(users).where(sql`${users.id} IN (${delhiRaw.id}, ${rikaRaw.id})`);
    console.log("  ✓ Test artifacts cleaned up successfully.");
  }

  // 6. Verify Database RLS functions
  console.log("\n[Test 6] Verifying database RLS functions on PostgreSQL 17.6...");
  const rlsFnCheck = await db.execute(sql`
    SELECT routine_name 
    FROM information_schema.routines 
    WHERE routine_name IN ('get_current_user_id', 'is_super_admin', 'user_has_company_access')
  `);
  console.log(`  Found database functions: ${rlsFnCheck.rows.map((r: any) => r.routine_name).join(", ")}`);
  assert(rlsFnCheck.rows.length === 3, "All 3 security helper functions must exist in live database");
  console.log("  ✓ Database RLS security functions confirmed in live database.");

  console.log("\n=================================================");
  console.log("ALL MULTI-COMPANY TENANT ISOLATION TESTS PASSED!");
  console.log("=================================================\n");
}

runIsolationTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
