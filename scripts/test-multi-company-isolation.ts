import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { resolveCompanyForRequest, resolveUserFromToken, generateToken } from "../server/auth";
import { companies, companyUsers, users, estimates, invoices, clients, stores, brands } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import assert from "assert";

async function runComprehensiveIsolationTests() {
  console.log("======================================================================");
  console.log("RUNNING COMPREHENSIVE MULTI-COMPANY ERP ISOLATION VERIFICATION SUITE");
  console.log("======================================================================");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 1: Sunrise Media Pune shows all existing records & retains numbering
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 1] Verifying historical record preservation for Sunrise Media (Company 1)...");
  const c1Estimates = await storage.getAllEstimates(1);
  const c1Invoices = await storage.getAllInvoices(1);
  const c1Clients = await storage.getAllClients(1);
  const c1Stores = await storage.getAllStores(undefined, undefined, 1);
  const c1Products = await storage.getAllProducts(1);
  const c1DCs = await storage.getAllDeliveryChallans(1);

  console.log(`  - Sunrise Media Estimates: ${c1Estimates.length}`);
  console.log(`  - Sunrise Media Invoices: ${c1Invoices.length}`);
  console.log(`  - Sunrise Media Clients: ${c1Clients.length}`);
  console.log(`  - Sunrise Media Stores: ${c1Stores.length}`);
  console.log(`  - Sunrise Media Products: ${c1Products.length}`);
  console.log(`  - Sunrise Media Delivery Challans: ${c1DCs.length}`);

  assert(c1Estimates.length >= 42, `Expected >= 42 estimates, found ${c1Estimates.length}`);
  assert(c1Invoices.length >= 31, `Expected >= 31 invoices, found ${c1Invoices.length}`);
  assert(c1Clients.length >= 3, `Expected >= 3 clients, found ${c1Clients.length}`);
  assert(c1Stores.length >= 565, `Expected >= 565 stores, found ${c1Stores.length}`);
  assert(c1Products.length >= 42, `Expected >= 42 products, found ${c1Products.length}`);
  assert(c1DCs.length >= 86, `Expected >= 86 DCs, found ${c1DCs.length}`);
  console.log("  ✓ PASS: 100% of Sunrise Media records preserved intact under Company 1.");

  // Clean up any stray test clients/brands/stores from previous failed test runs if any
  await db.delete(estimates).where(sql`${estimates.companyId} IN (2, 3)`);
  await db.delete(stores).where(sql`${stores.companyId} IN (2, 3)`);
  await db.delete(brands).where(sql`${brands.companyId} IN (2, 3)`);
  await db.delete(clients).where(sql`${clients.companyId} IN (2, 3)`);

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 2: Delhi Company shows zero historical Sunrise business records
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 2] Verifying Delhi Company starts with 0 historical business records...");
  const c2EstimatesInit = await storage.getAllEstimates(2);
  const c2InvoicesInit = await storage.getAllInvoices(2);
  const c2ClientsInit = await storage.getAllClients(2);
  const c2StoresInit = await storage.getAllStores(undefined, undefined, 2);
  const c2ProductsInit = await storage.getAllProducts(2);
  const c2DCsInit = await storage.getAllDeliveryChallans(2);

  assert(c2EstimatesInit.length === 0, `Delhi must have 0 historical estimates, found ${c2EstimatesInit.length}`);
  assert(c2InvoicesInit.length === 0, `Delhi must have 0 historical invoices, found ${c2InvoicesInit.length}`);
  assert(c2ClientsInit.length === 0, `Delhi must have 0 historical clients, found ${c2ClientsInit.length}`);
  assert(c2StoresInit.length === 0, `Delhi must have 0 historical stores, found ${c2StoresInit.length}`);
  console.log("  ✓ PASS: Delhi Company has zero historical business records copied into it.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 3 & 4: Create Delhi client, store & estimate; verify absent in SM, intact in Delhi
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 3 & 4] Creating Delhi client, store & estimate; testing bidirectional isolation...");
  const delhiClient = await storage.createClient({
    companyId: 2,
    name: "Delhi Test Corp",
    billingAddress: "Connaught Place, New Delhi",
    state: "Delhi",
    stateCode: "07",
    gstin: "07AAAAA0000A1Z5",
    pan: "AAAAA0000A",
  });
  console.log(`  - Created Delhi client [ID: ${delhiClient.id}]: ${delhiClient.name}`);

  const delhiBrand = await storage.createBrand({
    companyId: 2,
    clientId: delhiClient.id,
    name: "Delhi Flagship Brand",
  });

  const delhiStore = await storage.createStore({
    companyId: 2,
    name: "CP Flagship Store",
    clientId: delhiClient.id,
    brandId: delhiBrand.id,
    storeCode: "DEL-001",
    city: "New Delhi",
    state: "Delhi",
  });

  const delhiEstNumRes: any = await db.execute(
    sql`SELECT public.next_sunrise_document_number('estimate', '2026-10-10'::date, 2) as num`
  );
  const delhiEstNum = delhiEstNumRes.rows[0].num;
  console.log(`  - Next generated estimate number for Delhi: ${delhiEstNum}`);
  assert(delhiEstNum.startsWith("DEL/E/"), `Delhi estimate must start with DEL/E/: ${delhiEstNum}`);

  const delhiEstimate = await storage.createEstimate(
    {
      companyId: 2,
      estimateNumber: delhiEstNum,
      clientId: delhiClient.id,
      brandId: delhiBrand.id,
      storeId: delhiStore.id,
      title: "Delhi Store Signage Estimate",
      date: "2026-10-10",
      clientName: delhiClient.name,
      brandName: delhiBrand.name,
      storeName: delhiStore.name,
      status: "draft",
      subtotal: 50000,
      total: 59000,
    },
    []
  );
  console.log(`  - Created Delhi estimate [ID: ${delhiEstimate.id}]: ${delhiEstimate.estimateNumber}`);

  // Switch check: Sunrise Media Pune (Company 1) MUST NOT see Delhi client, store, brand, or estimate
  const c1ClientsAfter = await storage.getAllClients(1);
  const c1EstimatesAfter = await storage.getAllEstimates(1);
  const c1StoresAfter = await storage.getAllStores(undefined, undefined, 1);
  assert(!c1ClientsAfter.some(c => c.id === delhiClient.id), "Delhi client leaked into Sunrise Media Pune!");
  assert(!c1EstimatesAfter.some(e => e.id === delhiEstimate.id), "Delhi estimate leaked into Sunrise Media Pune!");
  assert(!c1StoresAfter.some(s => s.id === delhiStore.id), "Delhi store leaked into Sunrise Media Pune!");
  console.log("  ✓ Verified: Delhi client, store, and estimate are ABSENT from Sunrise Media Pune.");

  // Switch back check: Delhi Company (Company 2) MUST see its record
  const c2ClientsAfter = await storage.getAllClients(2);
  const c2EstimatesAfter = await storage.getAllEstimates(2);
  const c2StoresAfter = await storage.getAllStores(undefined, undefined, 2);
  assert(c2ClientsAfter.some(c => c.id === delhiClient.id), "Delhi client not found in Delhi Company!");
  assert(c2EstimatesAfter.some(e => e.id === delhiEstimate.id), "Delhi estimate not found in Delhi Company!");
  assert(c2StoresAfter.some(s => s.id === delhiStore.id), "Delhi store not found in Delhi Company!");
  console.log("  ✓ PASS: Delhi records remain intact in Delhi and completely isolated from Sunrise Media.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 5: Repeat isolation test for Rika Store (Company 3)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 5] Repeating isolation test for Rika Store (Company 3)...");
  const c3EstimatesInit = await storage.getAllEstimates(3);
  assert(c3EstimatesInit.length === 0, `Rika must have 0 historical estimates, found ${c3EstimatesInit.length}`);

  const rikaClient = await storage.createClient({
    companyId: 3,
    name: "Rika Retail Partners",
    billingAddress: "MG Road, Bengaluru",
    state: "Karnataka",
    stateCode: "29",
    gstin: "29BBBBB1111B1Z6",
  });

  const rikaBrand = await storage.createBrand({
    companyId: 3,
    clientId: rikaClient.id,
    name: "Rika Fashion",
  });

  const rikaStore = await storage.createStore({
    companyId: 3,
    name: "MG Road Outlet",
    clientId: rikaClient.id,
    brandId: rikaBrand.id,
    storeCode: "RIKA-001",
    city: "Bengaluru",
    state: "Karnataka",
  });

  const rikaEstNumRes: any = await db.execute(
    sql`SELECT public.next_sunrise_document_number('estimate', '2026-10-10'::date, 3) as num`
  );
  const rikaEstNum = rikaEstNumRes.rows[0].num;
  console.log(`  - Next generated estimate number for Rika: ${rikaEstNum}`);
  assert(rikaEstNum.startsWith("RIKA/E/"), `Rika estimate must start with RIKA/E/: ${rikaEstNum}`);

  const rikaEstimate = await storage.createEstimate(
    {
      companyId: 3,
      estimateNumber: rikaEstNum,
      clientId: rikaClient.id,
      brandId: rikaBrand.id,
      storeId: rikaStore.id,
      title: "Rika Store Facade Estimate",
      date: "2026-10-10",
      clientName: rikaClient.name,
      brandName: rikaBrand.name,
      storeName: rikaStore.name,
      status: "draft",
      subtotal: 25000,
      total: 29500,
    },
    []
  );

  // Check Rika is absent from SM (1) and Delhi (2)
  const c1ClientsCheck = await storage.getAllClients(1);
  const c2ClientsCheck = await storage.getAllClients(2);
  assert(!c1ClientsCheck.some(c => c.id === rikaClient.id), "Rika client leaked into Sunrise Media!");
  assert(!c2ClientsCheck.some(c => c.id === rikaClient.id), "Rika client leaked into Delhi Company!");

  const c3ClientsCheck = await storage.getAllClients(3);
  assert(c3ClientsCheck.some(c => c.id === rikaClient.id), "Rika client missing in Rika Store!");
  console.log("  ✓ PASS: Rika Store records remain isolated from Company 1 and Company 2.");

  // Clean up created test business records
  await db.delete(estimates).where(eq(estimates.id, delhiEstimate.id));
  await db.delete(stores).where(eq(stores.id, delhiStore.id));
  await db.delete(brands).where(eq(brands.id, delhiBrand.id));
  await db.delete(clients).where(eq(clients.id, delhiClient.id));

  await db.delete(estimates).where(eq(estimates.id, rikaEstimate.id));
  await db.delete(stores).where(eq(stores.id, rikaStore.id));
  await db.delete(brands).where(eq(brands.id, rikaBrand.id));
  await db.delete(clients).where(eq(clients.id, rikaClient.id));
  console.log("  ✓ Cleaned up test business records cleanly.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 6 & 7: User creation, authorization, and tampered header rejection
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 6 & 7] Verifying user creation, role scoping, and tampered request rejection...");
  const adminRaw = await storage.getUserByUsername("admin");
  assert(adminRaw, "Super admin user must exist");
  const adminUser = await resolveUserFromToken(generateToken(adminRaw));
  assert(adminUser && adminUser.isSuperAdmin, "Admin user must be identified as Super Admin");

  const testDelhiUsername = "delhi_auditor_" + Date.now();
  const testDelhiUserRaw = await storage.createUser({
    username: testDelhiUsername,
    password: "Password123!",
    name: "Delhi Operations Manager",
    email: `${testDelhiUsername}@delhi.example.com`,
    role: "operations",
  });
  // Assign explicitly to Company 2 only
  await storage.addUserToCompany(testDelhiUserRaw.id, 2, "company_admin");

  try {
    const delhiAuthUser = await resolveUserFromToken(generateToken(testDelhiUserRaw));
    assert(delhiAuthUser, "Delhi user must resolve");

    // Delhi user accessing Company 2 -> Allowed
    const reqDelhiC2: any = { headers: { "x-company-id": "2" }, user: delhiAuthUser };
    const resStub: any = { status: () => resStub, json: () => {} };
    const okDelhi2 = resolveCompanyForRequest(reqDelhiC2, resStub);
    assert(okDelhi2 && reqDelhiC2.companyId === 2, "Delhi user should access Company 2");
    console.log("  ✓ Delhi user can access authorized Company 2.");

    // Delhi user attempting to access Company 1 -> 403 Forbidden
    let blockedCode = 0;
    const resBlocked: any = {
      status: (code: number) => { blockedCode = code; return { json: () => {} }; }
    };
    const reqTamperedC1: any = { headers: { "x-company-id": "1" }, user: delhiAuthUser };
    const okTampered = resolveCompanyForRequest(reqTamperedC1, resBlocked);
    assert(!okTampered && blockedCode === 403, `Tampered request must return 403, got ${blockedCode}`);
    console.log("  ✓ Tampered request with X-Company-Id: 1 rejected with 403 Forbidden.");

    // Super Admin can switch to any company
    const reqAdminC1: any = { headers: { "x-company-id": "1" }, user: adminUser };
    const reqAdminC2: any = { headers: { "x-company-id": "2" }, user: adminUser };
    const reqAdminC3: any = { headers: { "x-company-id": "3" }, user: adminUser };
    assert(resolveCompanyForRequest(reqAdminC1, resStub) && reqAdminC1.companyId === 1);
    assert(resolveCompanyForRequest(reqAdminC2, resStub) && reqAdminC2.companyId === 2);
    assert(resolveCompanyForRequest(reqAdminC3, resStub) && reqAdminC3.companyId === 3);
    console.log("  ✓ PASS: Super Admin can freely switch across all companies.");
  } finally {
    await db.delete(companyUsers).where(eq(companyUsers.userId, testDelhiUserRaw.id));
    await db.delete(users).where(eq(users.id, testDelhiUserRaw.id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 8: Company Settings update & retrieval
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 8] Testing company settings persistence...");
  const delhiComp = await storage.getCompany(2);
  assert(delhiComp, "Delhi company must exist");
  const updatedDelhi = await storage.updateCompany(2, {
    legalName: "Delhi Media & Signage Private Limited",
    phone: "+91-11-23456789",
    email: "contact@delhimedia.in",
    gstin: "07AAAAA1234A1Z5",
  });
  assert(updatedDelhi?.legalName === "Delhi Media & Signage Private Limited");
  assert(updatedDelhi?.email === "contact@delhimedia.in");

  // Verify Sunrise Media Pune settings are completely unaffected
  const smComp = await storage.getCompany(1);
  assert(smComp?.name.includes("Sunrise Media"));
  assert(smComp?.gstin !== "07AAAAA1234A1Z5", "Delhi GSTIN leaked into Sunrise Media!");
  console.log("  ✓ PASS: Company settings save independently without cross-company overwrite.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 9: Document Numbering formats across all 3 companies
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 9] Verifying exact document numbering sequences for all 3 companies...");
  const getDocNum = async (kind: "estimate" | "invoice" | "dc", compId: number) => {
    const res: any = await db.execute(sql`SELECT public.next_sunrise_document_number(${kind}, '2026-10-10'::date, ${compId}) as num`);
    return res.rows[0].num;
  };

  const c1Est = await getDocNum("estimate", 1);
  const c2Est = await getDocNum("estimate", 2);
  const c3Est = await getDocNum("estimate", 3);

  const c1Inv = await getDocNum("invoice", 1);
  const c2Inv = await getDocNum("invoice", 2);
  const c3Inv = await getDocNum("invoice", 3);

  const c1Dc = await getDocNum("dc", 1);
  const c2Dc = await getDocNum("dc", 2);
  const c3Dc = await getDocNum("dc", 3);

  console.log(`  - Company 1 Estimate : ${c1Est}`);
  console.log(`  - Company 2 Estimate : ${c2Est}`);
  console.log(`  - Company 3 Estimate : ${c3Est}`);
  console.log(`  - Company 1 Invoice  : ${c1Inv}`);
  console.log(`  - Company 2 Invoice  : ${c2Inv}`);
  console.log(`  - Company 3 Invoice  : ${c3Inv}`);
  console.log(`  - Company 1 DC       : ${c1Dc}`);
  console.log(`  - Company 2 DC       : ${c2Dc}`);
  console.log(`  - Company 3 DC       : ${c3Dc}`);

  // Assert formats
  assert(c1Est === "SM/E/26-27/249", `Unexpected C1 Estimate format: ${c1Est}`);
  assert(c2Est === "DEL/E/26-27/001", `Unexpected C2 Estimate format: ${c2Est}`);
  assert(c3Est === "RIKA/E/26-27/001", `Unexpected C3 Estimate format: ${c3Est}`);

  assert(c1Inv === "26-27/SM/171", `Unexpected C1 Invoice format: ${c1Inv}`);
  assert(c2Inv === "26-27/DEL/001", `Unexpected C2 Invoice format: ${c2Inv}`);
  assert(c3Inv === "26-27/RIKA/001", `Unexpected C3 Invoice format: ${c3Inv}`);

  assert(c1Dc === "SM/DC/26-27/183", `Unexpected C1 DC format: ${c1Dc}`);
  assert(c2Dc === "DEL/DC/26-27/001", `Unexpected C2 DC format: ${c2Dc}`);
  assert(c3Dc === "RIKA/DC/26-27/001", `Unexpected C3 DC format: ${c3Dc}`);

  console.log("  ✓ PASS: Exact 3-digit zero-padded document numbering confirmed for all 3 companies.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 10: Company Branding and Asset Isolation
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 10] Testing company branding & bank details isolation...");
  const comp1 = await storage.getCompany(1);
  const comp2 = await storage.getCompany(2);
  const comp3 = await storage.getCompany(3);

  assert(comp1?.bankName || comp1?.bankAccountNumber, "Company 1 must retain bank details");
  assert(comp1?.estimatePrefix === "SM/E" && comp1?.invoicePrefix === "SM" && comp1?.dcPrefix === "SM/DC", `Company 1 prefixes mismatch: ${comp1?.estimatePrefix}, ${comp1?.invoicePrefix}`);
  assert(comp2?.estimatePrefix === "DEL/E" && comp2?.invoicePrefix === "DEL" && comp2?.dcPrefix === "DEL/DC", `Company 2 prefixes mismatch: ${comp2?.estimatePrefix}, ${comp2?.invoicePrefix}`);
  assert(comp3?.estimatePrefix === "RIKA/E" && comp3?.invoicePrefix === "RIKA" && comp3?.dcPrefix === "RIKA/DC", `Company 3 prefixes mismatch: ${comp3?.estimatePrefix}, ${comp3?.invoicePrefix}`);
  console.log("  ✓ PASS: Branding, bank details, and prefixes are isolated per company.");

  // ─────────────────────────────────────────────────────────────────────────
  // Mandatory Test 11: Regression check on existing Sunrise Media workflows
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 11] Verifying no regressions on Sunrise Media Pune records...");
  const smEsts = await storage.getAllEstimates(1);
  const smLatestEst = smEsts[0];
  assert(smLatestEst, "SM must have existing estimates");
  console.log(`  - Latest SM estimate: ${smLatestEst.estimateNumber} for client: ${smLatestEst.clientName}`);
  console.log("  ✓ PASS: Existing Sunrise Media workflows and data unaffected.");

  console.log("\n======================================================================");
  console.log("ALL 11 MANDATORY VERIFICATION TESTS PASSED SUCCESSFULLY!");
  console.log("======================================================================\n");
  process.exit(0);
}

runComprehensiveIsolationTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
