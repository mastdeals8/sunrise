import assert from "node:assert";
import {
  escapeXml,
  buildTallyInvoiceXml,
  DEFAULT_TALLY_SETTINGS,
} from "../client/src/lib/tally";

console.log("=================================================");
console.log("Running Tally XML & Settings Comprehensive Regression Tests");
console.log("=================================================");

// Test 1: escapeXml
{
  const unsafe = `Sunrise & "Son's" <Media> > Pune`;
  const safe = escapeXml(unsafe);
  assert.strictEqual(
    safe,
    `Sunrise &amp; &quot;Son&apos;s&quot; &lt;Media&gt; &gt; Pune`,
    "escapeXml should sanitize XML special characters"
  );
  console.log("✅ Test 1 Passed: XML special character escaping");
}

// Test 2: Intrastate Invoice XML Generation (Maharashtra -> Maharashtra: CGST + SGST)
{
  const mockInvoice = {
    id: 101,
    invoiceNumber: "INV-2026-001",
    date: "2026-10-15T00:00:00.000Z",
    partyName: "Raymond Ltd",
    status: "submitted",
    amount: 100000,
    taxAmount: 18000,
    totalAmount: 118000,
  };

  const mockCompany = {
    name: "Sunrise Media Pune",
    stateCode: "27",
    gstin: "27AABCS1429B1Z1",
  };

  const mockClient = {
    name: "Raymond Ltd",
    stateCode: "27",
    gstNumber: "27AAACR1234A1Z5",
  };

  const mockSettings = {
    companyName: "Sunrise Media Pune",
    salesLedger: "Sales - Signage",
    cgstLedger: "CGST Output",
    sgstLedger: "SGST Output",
    igstLedger: "IGST Output",
    voucherType: "Sales",
  };

  const xml = buildTallyInvoiceXml(mockInvoice, {
    settings: mockSettings,
    company: mockCompany,
    client: mockClient,
  });

  assert.ok(xml.includes("<TALLYREQUEST>Import Data</TALLYREQUEST>"), "XML must have Tally envelope header");
  assert.ok(xml.includes("<VOUCHERNUMBER>INV-2026-001</VOUCHERNUMBER>"), "Voucher number must match invoiceNumber");
  assert.ok(xml.includes("<PARTYLEDGERNAME>Raymond Ltd</PARTYLEDGERNAME>"), "Party ledger must match client name");
  assert.ok(xml.includes("<LEDGERNAME>Sales - Signage</LEDGERNAME>"), "Sales ledger mapping must be respected");
  assert.ok(xml.includes("<LEDGERNAME>CGST Output</LEDGERNAME>"), "Intrastate must include CGST Output");
  assert.ok(xml.includes("<LEDGERNAME>SGST Output</LEDGERNAME>"), "Intrastate must include SGST Output");
  assert.ok(!xml.includes("<LEDGERNAME>IGST Output</LEDGERNAME>"), "Intrastate must NOT include IGST Output");
  assert.ok(xml.includes("<AMOUNT>9000.00</AMOUNT>"), "CGST amount must be 50% of 18000 (9000.00)");
  console.log("✅ Test 2 Passed: Intrastate invoice XML generation with custom ledgers");
}

// Test 3: Interstate Invoice XML Generation (Maharashtra -> Delhi: IGST only)
{
  const mockInvoice = {
    id: 102,
    invoiceNumber: "INV-2026-002",
    date: "2026-10-18T00:00:00.000Z",
    partyName: "Delhi Retail Hub",
    status: "approved",
    amount: 50000,
    taxAmount: 9000,
    totalAmount: 59000,
  };

  const mockCompany = {
    name: "Sunrise Media Pune",
    stateCode: "27",
  };

  const mockClient = {
    name: "Delhi Retail Hub",
    stateCode: "07", // Delhi
  };

  const mockSettings = {
    salesLedger: "Sales",
    cgstLedger: "CGST",
    sgstLedger: "SGST",
    igstLedger: "IGST",
  };

  const xml = buildTallyInvoiceXml(mockInvoice, {
    settings: mockSettings,
    company: mockCompany,
    client: mockClient,
  });

  assert.ok(xml.includes("<LEDGERNAME>IGST</LEDGERNAME>"), "Interstate invoice must include IGST ledger");
  assert.ok(!xml.includes("<LEDGERNAME>CGST</LEDGERNAME>"), "Interstate invoice must NOT include CGST");
  assert.ok(!xml.includes("<LEDGERNAME>SGST</LEDGERNAME>"), "Interstate invoice must NOT include SGST");
  assert.ok(xml.includes("<AMOUNT>9000.00</AMOUNT>"), "IGST amount must be full taxAmount (9000.00)");
  console.log("✅ Test 3 Passed: Interstate invoice XML generation with IGST");
}

// Test 4: Round-off & Ledger Balance Verification (Sum of debits == Sum of credits)
{
  const mockInvoice = {
    id: 103,
    invoiceNumber: "INV-2026-003",
    date: "2026-10-20T00:00:00.000Z",
    partyName: "Kunal & Sons",
    status: "submitted",
    amount: 1000.54, // Taxable
    taxAmount: 180.10, // Total tax
    totalAmount: 1181.00, // Rounded total (diff = +0.36)
  };

  const mockCompany = { name: "Sunrise Media", stateCode: "27" };
  const mockClient = { name: "Kunal & Sons", stateCode: "27" };
  const mockSettings = {
    salesLedger: "Sales",
    cgstLedger: "CGST",
    sgstLedger: "SGST",
    roundOffLedger: "Round Off A/C",
  };

  const xml = buildTallyInvoiceXml(mockInvoice, {
    settings: mockSettings,
    company: mockCompany,
    client: mockClient,
  });

  assert.ok(xml.includes("<LEDGERNAME>Round Off A/C</LEDGERNAME>"), "Must include Round Off ledger");
  assert.ok(xml.includes("<AMOUNT>0.36</AMOUNT>"), "Round off amount must be 0.36");
  assert.ok(xml.includes("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>"), "Credit round off must have ISDEEMEDPOSITIVE No");

  // Parse each ALLLEDGERENTRIES.LIST top-level <AMOUNT> and verify sum equals 0
  const ledgerBlocks = xml.split("</ALLLEDGERENTRIES.LIST>").slice(0, -1);
  const ledgerAmounts = ledgerBlocks.map(block => {
    const match = block.match(/<AMOUNT>(-?\d+\.\d+)<\/AMOUNT>/);
    return match ? parseFloat(match[1]) : 0;
  });
  // In Tally XML, Party debit is entered as negative (-1181.00), credits are positive (1000.54, 90.05, 90.05, 0.36)
  const sum = ledgerAmounts.reduce((acc, val) => acc + val, 0);
  assert.ok(Math.abs(sum) < 0.001, `Sum of voucher allocations must balance to 0, got ${sum}`);
  console.log("✅ Test 4 Passed: Round-off balancing and zero-sum ledger verification");
}

// Test 5: Special Characters in Company and Party Names
{
  const mockInvoice = {
    id: 104,
    invoiceNumber: "INV-2026-004",
    partyName: "A & B <Retail> 'Mart' \"Pune\"",
    status: "paid",
    amount: 2000,
    taxAmount: 360,
    totalAmount: 2360,
  };

  const mockCompany = { name: "Sunrise & Co <Signage> 'HQ'" };
  const mockClient = { name: "A & B <Retail> 'Mart' \"Pune\"" };

  const xml = buildTallyInvoiceXml(mockInvoice, {
    company: mockCompany,
    client: mockClient,
  });

  assert.ok(xml.includes("Sunrise &amp; Co &lt;Signage&gt; &apos;HQ&apos;"), "Company name must be escaped");
  assert.ok(xml.includes("A &amp; B &lt;Retail&gt; &apos;Mart&apos; &quot;Pune&quot;"), "Party name must be escaped");
  console.log("✅ Test 5 Passed: Special characters in party/company names safely escaped");
}

// Test 6: Ineligible Invoice Rejection (draft status)
{
  const mockDraftInvoice = {
    id: 105,
    invoiceNumber: "INV-DRAFT-001",
    status: "draft",
    amount: 5000,
    totalAmount: 5900,
  };

  let caught = false;
  try {
    buildTallyInvoiceXml(mockDraftInvoice, {});
  } catch (err: any) {
    caught = true;
    assert.ok(err.message.includes("Only submitted or approved invoices"), "Must reject draft invoice");
  }
  assert.ok(caught, "Draft invoice must throw an error");
  console.log("✅ Test 6 Passed: Ineligible draft invoice rejected");
}

// Test 7: Missing Ledger Mapping Detection
{
  const mockInvoice = {
    id: 106,
    invoiceNumber: "INV-2026-006",
    status: "submitted",
    amount: 1000,
    taxAmount: 180,
    totalAmount: 1180,
  };

  let caught = false;
  try {
    buildTallyInvoiceXml(mockInvoice, {
      settings: {
        salesLedger: "", // Empty sales ledger
      },
      company: { stateCode: "27" },
      client: { stateCode: "27" },
    });
  } catch (err: any) {
    caught = true;
    assert.ok(err.message.includes("Missing required Tally mapping: Sales Ledger"), "Must report missing sales ledger");
  }
  assert.ok(caught, "Empty sales ledger mapping must be caught");
  console.log("✅ Test 7 Passed: Missing required ledger mapping detected and reported");
}

// Test 8: Default Settings Structure
{
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.enabled, false);
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.tallyUrl, "http://localhost:9000");
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.voucherType, "Sales");
  console.log("✅ Test 8 Passed: Default Tally settings integrity");
}

// Test 9: checkInvoiceTallyEligibility checks
{
  const { checkInvoiceTallyEligibility } = await import("../client/src/lib/tally");
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "draft", invoiceNumber: "INV-1" }).eligible, false);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "cancelled", invoiceNumber: "INV-2" }).eligible, false);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "hold", invoiceNumber: "INV-3" }).eligible, false);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "approved", invoiceNumber: "INV-4", totalAmount: 0 }).eligible, false);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "approved", invoiceNumber: "INV-5", totalAmount: 1500 }).eligible, true);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "paid", invoiceNumber: "INV-6", totalAmount: 2000 }).eligible, true);
  assert.strictEqual(checkInvoiceTallyEligibility({ status: "unpaid", invoiceNumber: "INV-7", totalAmount: 2000 }).eligible, true);
  console.log("✅ Test 9 Passed: Invoice eligibility checks (draft, cancelled, hold, valid)");
}

// Test 10: Multi-invoice Batch XML Generation
{
  const { buildTallyBatchXml } = await import("../client/src/lib/tally");
  const inv1 = {
    id: 201,
    invoiceNumber: "INV-2026-B1",
    partyName: "Party 1",
    status: "approved",
    amount: 10000,
    taxAmount: 1800,
    totalAmount: 11800,
    date: "2026-10-21T00:00:00.000Z",
  };
  const inv2 = {
    id: 202,
    invoiceNumber: "INV-2026-B2",
    partyName: "Party 2",
    status: "paid",
    amount: 20000,
    taxAmount: 3600,
    totalAmount: 23600,
    date: "2026-10-21T00:00:00.000Z",
  };

  const res = buildTallyBatchXml([inv1, inv2], {
    settings: { companyName: "Sunrise Media" },
    company: { stateCode: "27" },
  });

  assert.strictEqual(res.exportedInvoices.length, 2, "Both invoices should be exported");
  assert.strictEqual(res.ineligibleInvoices.length, 0, "No ineligible invoices");
  assert.ok(res.xml.includes("<VOUCHERNUMBER>INV-2026-B1</VOUCHERNUMBER>"));
  assert.ok(res.xml.includes("<VOUCHERNUMBER>INV-2026-B2</VOUCHERNUMBER>"));
  assert.ok(res.filename.startsWith("Tally_SalesVouchers_Batch_2_"));
  console.log("✅ Test 10 Passed: Multi-invoice batch XML generation");
}

// Test 11: Batch XML with mixed eligible and ineligible invoices
{
  const { buildTallyBatchXml } = await import("../client/src/lib/tally");
  const invEligible = {
    id: 301,
    invoiceNumber: "INV-2026-E1",
    partyName: "Eligible Client",
    status: "approved",
    amount: 5000,
    taxAmount: 900,
    totalAmount: 5900,
  };
  const invDraft = {
    id: 302,
    invoiceNumber: "INV-2026-D1",
    partyName: "Draft Client",
    status: "draft",
    amount: 5000,
    taxAmount: 900,
    totalAmount: 5900,
  };

  const res = buildTallyBatchXml([invEligible, invDraft], {
    settings: { companyName: "Sunrise Media" },
    company: { stateCode: "27" },
  });

  assert.strictEqual(res.exportedInvoices.length, 1, "Only eligible invoice should be exported");
  assert.strictEqual(res.ineligibleInvoices.length, 1, "Draft invoice must be in ineligible list");
  assert.strictEqual(res.ineligibleInvoices[0].invoice.invoiceNumber, "INV-2026-D1");
  assert.ok(res.ineligibleInvoices[0].reason.includes("draft"));
  assert.ok(res.xml.includes("<VOUCHERNUMBER>INV-2026-E1</VOUCHERNUMBER>"));
  assert.ok(!res.xml.includes("<VOUCHERNUMBER>INV-2026-D1</VOUCHERNUMBER>"));
  console.log("✅ Test 11 Passed: Batch export separates eligible and reports ineligible with reason");
}

console.log("=================================================");
console.log("ALL 11 TALLY REGRESSION TESTS PASSED!");
console.log("=================================================");

