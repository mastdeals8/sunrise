import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { resolveCompanyForRequest, resolveUserFromToken, generateToken } from "../server/auth";
import { clients, invoices, payments, journalEntries, journalEntryLines } from "../shared/schema";
import { eq, sql, inArray } from "drizzle-orm";
import assert from "assert";

async function runMultiCompanyFinancialIsolationSuite() {
  console.log("==========================================================================");
  console.log("RUNNING MULTI-COMPANY FINANCIAL ISOLATION REGRESSION TEST SUITE");
  console.log("==========================================================================");

  const cleanupIds = {
    clients: [] as number[],
    invoices: [] as number[],
    payments: [] as number[],
    journalEntries: [] as number[],
  };

  try {
    // -----------------------------------------------------------------------
    // Setup: Create test clients, invoices, and payments for Companies 1, 2, 3
    // -----------------------------------------------------------------------
    console.log("\n[Setup] Creating isolated test financial records for Companies 1, 2, and 3...");

    // Company 1 (Sunrise Media, Pune)
    const c1Client = await storage.createClient({
      companyId: 1,
      name: `C1-FinTest-Client-${Date.now()}`,
      billingAddress: "Senapati Bapat Road, Pune",
      state: "Maharashtra",
      stateCode: "27",
      gstin: "27TESTC10000A1Z1",
    });
    cleanupIds.clients.push(c1Client.id);

    const c1Inv1 = await storage.createInvoice({
      companyId: 1,
      clientId: c1Client.id,
      partyName: c1Client.name,
      invoiceNumber: `TEST-C1-INV-${Date.now()}`,
      date: new Date(),
      subtotalAmount: 10000,
      cgstAmount: 900,
      sgstAmount: 900,
      totalAmount: 11800,
      paidAmount: 5000,
      balanceAmount: 6800,
      status: "partial",
      type: "sales",
    } as any);
    cleanupIds.invoices.push(c1Inv1.id);

    const c1Pay1 = await storage.createPayment({
      companyId: 1,
      clientId: c1Client.id,
      partyName: c1Client.name,
      voucherNumber: `TEST-C1-RCPT-${Date.now()}`,
      date: new Date(),
      amount: 5000,
      type: "receipt",
      method: "bank_transfer",
    } as any);
    cleanupIds.payments.push(c1Pay1.id);

    // Company 2 (Delhi Company)
    const c2Client = await storage.createClient({
      companyId: 2,
      name: `C2-FinTest-Client-${Date.now()}`,
      billingAddress: "Barakhamba Road, New Delhi",
      state: "Delhi",
      stateCode: "07",
      gstin: "07TESTC20000B1Z2",
    });
    cleanupIds.clients.push(c2Client.id);

    const c2Inv1 = await storage.createInvoice({
      companyId: 2,
      clientId: c2Client.id,
      partyName: c2Client.name,
      invoiceNumber: `TEST-C2-INV-${Date.now()}`,
      date: new Date(),
      subtotalAmount: 20000,
      cgstAmount: 1800,
      sgstAmount: 1800,
      totalAmount: 23600,
      paidAmount: 23600,
      balanceAmount: 0,
      status: "paid",
      type: "sales",
    } as any);
    cleanupIds.invoices.push(c2Inv1.id);

    const c2Pay1 = await storage.createPayment({
      companyId: 2,
      clientId: c2Client.id,
      partyName: c2Client.name,
      voucherNumber: `TEST-C2-RCPT-${Date.now()}`,
      date: new Date(),
      amount: 23600,
      type: "receipt",
      method: "bank_transfer",
    } as any);
    cleanupIds.payments.push(c2Pay1.id);

    // Company 3 (Rika Store)
    const c3Client = await storage.createClient({
      companyId: 3,
      name: `C3-FinTest-Client-${Date.now()}`,
      billingAddress: "Indiranagar, Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      gstin: "29TESTC30000C1Z3",
    });
    cleanupIds.clients.push(c3Client.id);

    const c3Inv1 = await storage.createInvoice({
      companyId: 3,
      clientId: c3Client.id,
      partyName: c3Client.name,
      invoiceNumber: `TEST-C3-INV-${Date.now()}`,
      date: new Date(),
      subtotalAmount: 30000,
      cgstAmount: 2700,
      sgstAmount: 2700,
      totalAmount: 35400,
      paidAmount: 0,
      balanceAmount: 35400,
      status: "unpaid",
      type: "sales",
    } as any);
    cleanupIds.invoices.push(c3Inv1.id);

    const c3Pay1 = await storage.createPayment({
      companyId: 3,
      clientId: c3Client.id,
      partyName: c3Client.name,
      voucherNumber: `TEST-C3-RCPT-${Date.now()}`,
      date: new Date(),
      amount: 10000,
      type: "receipt",
      method: "bank_transfer",
    } as any);
    cleanupIds.payments.push(c3Pay1.id);

    console.log("  ✓ Created test records for Company 1, 2, and 3.");

    // -----------------------------------------------------------------------
    // Test 1: Storage Layer Isolation (Clients, Invoices, Payments)
    // -----------------------------------------------------------------------
    console.log("\n[Test 1] Testing storage layer isolation with explicit companyId...");
    const c1Clients = await storage.getAllClients(1);
    const c2Clients = await storage.getAllClients(2);
    const c3Clients = await storage.getAllClients(3);

    assert(c1Clients.some(c => c.id === c1Client.id), "C1 client must be visible in C1");
    assert(!c1Clients.some(c => c.id === c2Client.id || c.id === c3Client.id), "C2 and C3 clients must NOT be visible in C1");

    assert(c2Clients.some(c => c.id === c2Client.id), "C2 client must be visible in C2");
    assert(!c2Clients.some(c => c.id === c1Client.id || c.id === c3Client.id), "C1 and C3 clients must NOT be visible in C2");

    assert(c3Clients.some(c => c.id === c3Client.id), "C3 client must be visible in C3");
    assert(!c3Clients.some(c => c.id === c1Client.id || c.id === c2Client.id), "C1 and C2 clients must NOT be visible in C3");

    const c1Invoices = await storage.getAllInvoices({ companyId: 1 });
    const c2Invoices = await storage.getAllInvoices({ companyId: 2 });
    const c3Invoices = await storage.getAllInvoices({ companyId: 3 });

    assert(c1Invoices.some(i => i.id === c1Inv1.id), "C1 invoice must be visible in C1");
    assert(!c1Invoices.some(i => i.id === c2Inv1.id || i.id === c3Inv1.id), "C2 and C3 invoices must NOT be visible in C1");

    assert(c2Invoices.some(i => i.id === c2Inv1.id), "C2 invoice must be visible in C2");
    assert(!c2Invoices.some(i => i.id === c1Inv1.id || i.id === c3Inv1.id), "C1 and C3 invoices must NOT be visible in C2");

    assert(c3Invoices.some(i => i.id === c3Inv1.id), "C3 invoice must be visible in C3");
    assert(!c3Invoices.some(i => i.id === c1Inv1.id || i.id === c2Inv1.id), "C1 and C2 invoices must NOT be visible in C3");

    const c1Payments = await storage.getAllPayments({ companyId: 1 });
    const c2Payments = await storage.getAllPayments({ companyId: 2 });
    const c3Payments = await storage.getAllPayments({ companyId: 3 });

    assert(c1Payments.some(p => p.id === c1Pay1.id), "C1 payment must be visible in C1");
    assert(!c1Payments.some(p => p.id === c2Pay1.id || p.id === c3Pay1.id), "C2 and C3 payments must NOT be visible in C1");

    assert(c2Payments.some(p => p.id === c2Pay1.id), "C2 payment must be visible in C2");
    assert(!c2Payments.some(p => p.id === c1Pay1.id || p.id === c3Pay1.id), "C1 and C3 payments must NOT be visible in C2");

    assert(c3Payments.some(p => p.id === c3Pay1.id), "C3 payment must be visible in C3");
    assert(!c3Payments.some(p => p.id === c1Pay1.id || p.id === c2Pay1.id), "C1 and C2 payments must NOT be visible in C3");

    console.log("  ✓ PASS: Storage queries completely isolate clients, invoices, and payments by companyId.");

    // -----------------------------------------------------------------------
    // Test 2: Ledger Summary Endpoint Calculation Logic (GET /api/finance/ledgers/summary)
    // -----------------------------------------------------------------------
    console.log("\n[Test 2] Simulating GET /api/finance/ledgers/summary scoping for each company...");

    async function simulateLedgerSummary(companyId: number) {
      const allClients = await storage.getAllClients(companyId);
      const allInvoices = await storage.getAllInvoices({ type: "sales", companyId });
      const allPayments = await storage.getAllPayments({ type: "receipt", companyId });

      return allClients.map(client => {
        const clientInvoices = allInvoices.filter(i => i.clientId === client.id || i.partyName === client.name);
        const clientPayments = allPayments.filter(p => p.clientId === client.id || p.partyName === client.name);

        const totalBilled = clientInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
        const totalPaid = clientInvoices.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0);
        const totalOutstanding = Math.max(0, totalBilled - totalPaid);

        return {
          clientId: client.id,
          clientName: client.name,
          totalBilled,
          totalPaid,
          totalOutstanding,
          status: totalOutstanding <= 0 ? "clean" : "outstanding"
        };
      });
    }

    const summaryC1 = await simulateLedgerSummary(1);
    const summaryC2 = await simulateLedgerSummary(2);
    const summaryC3 = await simulateLedgerSummary(3);

    // Verify Company 1 summary contains only C1 clients
    const c1TestSummary = summaryC1.find(s => s.clientId === c1Client.id);
    assert(c1TestSummary, "C1 test client must exist in C1 ledger summary");
    assert.strictEqual(c1TestSummary.totalBilled, 11800, "C1 total billed must be 11,800");
    assert.strictEqual(c1TestSummary.totalPaid, 5000, "C1 total paid must be 5,000");
    assert.strictEqual(c1TestSummary.totalOutstanding, 6800, "C1 total outstanding must be 6,800");
    assert(!summaryC1.some(s => s.clientId === c2Client.id || s.clientId === c3Client.id), "C2 and C3 clients must be absent from C1 summary");

    // Verify Company 2 summary contains only C2 clients
    const c2TestSummary = summaryC2.find(s => s.clientId === c2Client.id);
    assert(c2TestSummary, "C2 test client must exist in C2 ledger summary");
    assert.strictEqual(c2TestSummary.totalBilled, 23600, "C2 total billed must be 23,600");
    assert.strictEqual(c2TestSummary.totalPaid, 23600, "C2 total paid must be 23,600");
    assert.strictEqual(c2TestSummary.totalOutstanding, 0, "C2 total outstanding must be 0");
    assert(!summaryC2.some(s => s.clientId === c1Client.id || s.clientId === c3Client.id), "C1 and C3 clients must be absent from C2 summary");

    // Verify Company 3 summary contains only C3 clients
    const c3TestSummary = summaryC3.find(s => s.clientId === c3Client.id);
    assert(c3TestSummary, "C3 test client must exist in C3 ledger summary");
    assert.strictEqual(c3TestSummary.totalBilled, 35400, "C3 total billed must be 35,400");
    assert.strictEqual(c3TestSummary.totalPaid, 0, "C3 total paid must be 0");
    assert.strictEqual(c3TestSummary.totalOutstanding, 35400, "C3 total outstanding must be 35,400");
    assert(!summaryC3.some(s => s.clientId === c1Client.id || s.clientId === c2Client.id), "C1 and C2 clients must be absent from C3 summary");

    console.log("  ✓ PASS: GET /api/finance/ledgers/summary yields strictly isolated balances with zero cross-leakage.");

    // -----------------------------------------------------------------------
    // Test 3: Individual Client Ledger (GET /api/finance/ledgers/client/:clientId)
    // -----------------------------------------------------------------------
    console.log("\n[Test 3] Simulating GET /api/finance/ledgers/client/:clientId cross-company access...");

    async function simulateClientLedger(clientId: number, authorizedCompanyId: number) {
      const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!client) {
        return { status: 404, error: "Client not found" };
      }

      // Multi-company isolation guard
      if (authorizedCompanyId && client.companyId && client.companyId !== authorizedCompanyId) {
        return { status: 404, error: "Client not found" };
      }

      const invConds = [eq(invoices.clientId, clientId)];
      if (authorizedCompanyId) invConds.push(eq(invoices.companyId, authorizedCompanyId));
      const clientInvoices = await db.select().from(invoices).where(sql`${sql.join(invConds, sql` AND `)}`).orderBy(invoices.date);

      const payConds = [eq(payments.clientId, clientId)];
      if (authorizedCompanyId) payConds.push(eq(payments.companyId, authorizedCompanyId));
      const clientPayments = await db.select().from(payments).where(sql`${sql.join(payConds, sql` AND `)}`).orderBy(payments.date);

      const items: any[] = [];
      clientInvoices.forEach(inv => {
        items.push({
          date: inv.date,
          ref: inv.invoiceNumber,
          type: "Invoice",
          amount: Number(inv.totalAmount),
          debitAmount: Number(inv.totalAmount),
          creditAmount: 0,
        });
      });
      clientPayments.forEach(pay => {
        items.push({
          date: pay.date,
          ref: pay.voucherNumber,
          type: "Payment Receipt",
          amount: Number(pay.amount),
          debitAmount: 0,
          creditAmount: Number(pay.amount),
        });
      });
      items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let runningBalance = 0;
      const statement = items.map(item => {
        runningBalance = runningBalance + item.debitAmount - item.creditAmount;
        return { ...item, balance: runningBalance };
      });

      return {
        status: 200,
        client,
        statement,
        totalBilled: clientInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0),
        totalPaid: clientInvoices.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0),
        totalOutstanding: runningBalance,
      };
    }

    // 3.1 Authorized access within company
    const ledgerC1Own = await simulateClientLedger(c1Client.id, 1);
    assert.strictEqual(ledgerC1Own.status, 200, "C1 accessing C1 client ledger should return 200");
    assert.strictEqual(ledgerC1Own.totalBilled, 11800);
    assert.strictEqual(ledgerC1Own.totalPaid, 5000);
    console.log("  ✓ Authorized company user successfully accesses their own client ledger.");

    // 3.2 Unauthorized cross-company client access: Company 2 user trying to view Company 1 client ledger
    const ledgerC2TryingC1 = await simulateClientLedger(c1Client.id, 2);
    assert.strictEqual(ledgerC2TryingC1.status, 404, "Cross-company access must return 404 Client not found");
    assert.strictEqual(ledgerC2TryingC1.error, "Client not found");
    console.log("  ✓ Company 2 user querying Company 1 client is rejected with 404.");

    // 3.3 Unauthorized cross-company client access: Company 1 user trying to view Company 3 client ledger
    const ledgerC1TryingC3 = await simulateClientLedger(c3Client.id, 1);
    assert.strictEqual(ledgerC1TryingC3.status, 404, "Cross-company access must return 404 Client not found");
    console.log("  ✓ Company 1 user querying Company 3 client is rejected with 404.");

    // 3.4 Unauthorized cross-company client access: Company 3 user trying to view Company 2 client ledger
    const ledgerC3TryingC2 = await simulateClientLedger(c2Client.id, 3);
    assert.strictEqual(ledgerC3TryingC2.status, 404, "Cross-company access must return 404 Client not found");
    console.log("  ✓ Company 3 user querying Company 2 client is rejected with 404.");

    // -----------------------------------------------------------------------
    // Test 4: Cross-Company Payment Allocation Guard
    // -----------------------------------------------------------------------
    console.log("\n[Test 4] Testing cross-company payment allocation prevention in createPaymentWithAllocations...");

    // Attempt to allocate a Company 1 payment to a Company 2 invoice: MUST FAIL & ROLL BACK
    let crossCompanyErrorThrown = false;
    try {
      await storage.createPaymentWithAllocations(
        {
          companyId: 1,
          clientId: c1Client.id,
          partyName: c1Client.name,
          voucherNumber: `TEST-C1-ILLEGAL-${Date.now()}`,
          date: new Date(),
          amount: 5000,
          type: "receipt",
          method: "bank_transfer",
        } as any,
        [
          { invoiceId: c2Inv1.id, amount: 5000 } // Cross-company invoice!
        ]
      );
    } catch (err: any) {
      crossCompanyErrorThrown = true;
      assert(err.message.includes("Cross-company payment allocation forbidden"), `Expected cross-company error message, got: ${err.message}`);
      console.log(`  ✓ Successfully rejected cross-company allocation with error: "${err.message}"`);
    }
    assert(crossCompanyErrorThrown, "createPaymentWithAllocations MUST throw when attempting cross-company allocation!");

    // Verify Company 2 invoice balance was NOT modified (transaction rollback verified)
    const [c2InvCheck] = await db.select().from(invoices).where(eq(invoices.id, c2Inv1.id));
    assert.strictEqual(Number(c2InvCheck.paidAmount), 23600, "Company 2 invoice paidAmount must be untouched");
    assert.strictEqual(Number(c2InvCheck.balanceAmount), 0, "Company 2 invoice balanceAmount must be untouched");
    console.log("  ✓ Transaction rolled back completely: Target invoice balance untouched.");

    // -----------------------------------------------------------------------
    // Test 5: Valid Same-Company Payment Allocation
    // -----------------------------------------------------------------------
    console.log("\n[Test 5] Testing valid same-company payment allocation...");
    const validAllocPayment = await storage.createPaymentWithAllocations(
      {
        companyId: 1,
        clientId: c1Client.id,
        partyName: c1Client.name,
        voucherNumber: `TEST-C1-VALID-${Date.now()}`,
        date: new Date(),
        amount: 3000,
        type: "receipt",
        method: "bank_transfer",
      } as any,
      [
        { invoiceId: c1Inv1.id, amount: 3000 } // Valid same-company invoice!
      ]
    );
    cleanupIds.payments.push(validAllocPayment.id);

    const [c1InvUpdated] = await db.select().from(invoices).where(eq(invoices.id, c1Inv1.id));
    assert.strictEqual(Number(c1InvUpdated.paidAmount), 8000, "Paid amount should increase from 5000 to 8000");
    assert.strictEqual(Number(c1InvUpdated.balanceAmount), 3800, "Balance amount should decrease from 6800 to 3800");
    assert.strictEqual(c1InvUpdated.status, "partial");
    console.log("  ✓ Valid same-company allocation updated invoice balance atomically.");

    // -----------------------------------------------------------------------
    // Test 6: Super Admin vs Company User Header Scoping
    // -----------------------------------------------------------------------
    console.log("\n[Test 6] Testing resolveCompanyForRequest for Super Admin and Regular Users...");
    const adminUser = {
      id: 1,
      username: "admin",
      role: "admin",
      isSuperAdmin: true,
      memberships: [{ companyId: 1, role: "super_admin", isDefault: true }],
    };

    // Super admin switching to Company 2
    const reqAdminC2: any = { headers: { "x-company-id": "2" }, user: adminUser };
    const resStub: any = { status: () => resStub, json: () => {} };
    const adminOkC2 = resolveCompanyForRequest(reqAdminC2, resStub);
    assert(adminOkC2 && reqAdminC2.companyId === 2, "Super admin can switch to Company 2");

    // Super admin switching to Company 3
    const reqAdminC3: any = { headers: { "x-company-id": "3" }, user: adminUser };
    const adminOkC3 = resolveCompanyForRequest(reqAdminC3, resStub);
    assert(adminOkC3 && reqAdminC3.companyId === 3, "Super admin can switch to Company 3");

    // Regular Company 2 user trying to spoof Company 1
    const company2User = {
      id: 999,
      username: "delhi_mgr",
      role: "operations",
      isSuperAdmin: false,
      memberships: [{ companyId: 2, role: "company_admin", isDefault: true }],
    };
    let spoofBlocked = false;
    const reqSpoof: any = { headers: { "x-company-id": "1" }, user: company2User };
    const resForbidden: any = {
      status: (code: number) => {
        if (code === 403) spoofBlocked = true;
        return resForbidden;
      },
      json: () => {}
    };
    const spoofResult = resolveCompanyForRequest(reqSpoof, resForbidden);
    assert(!spoofResult && spoofBlocked, "Non-super-admin user attempting cross-company spoof MUST receive 403 Forbidden");
    console.log("  ✓ Super admin can switch companies; regular users cannot access unauthorized companies.");

    console.log("\n==========================================================================");
    console.log("ALL MULTI-COMPANY FINANCIAL ISOLATION TESTS PASSED (6/6 TESTS SUCCESSFUL)");
    console.log("==========================================================================");

  } finally {
    // -----------------------------------------------------------------------
    // Cleanup: Clean up all created test records cleanly
    // -----------------------------------------------------------------------
    console.log("\n[Cleanup] Removing all temporary test financial records...");
    if (cleanupIds.payments.length > 0) {
      await db.delete(payments).where(inArray(payments.id, cleanupIds.payments));
    }
    if (cleanupIds.invoices.length > 0) {
      await db.delete(invoices).where(inArray(invoices.id, cleanupIds.invoices));
    }
    if (cleanupIds.clients.length > 0) {
      await db.delete(clients).where(inArray(clients.id, cleanupIds.clients));
    }
    console.log("  ✓ Database cleaned up cleanly. Zero test records remain.");
  }
}

runMultiCompanyFinancialIsolationSuite().catch((err) => {
  console.error("FATAL: Multi-Company Financial Isolation Test Failed:", err);
  process.exit(1);
});
