import assert from "node:assert";
import {
  escapeXml,
  buildTallyInvoiceXml,
  DEFAULT_TALLY_SETTINGS,
} from "../client/src/lib/tally";

console.log("=================================================");
console.log("Running Tally XML & Settings Regression Tests");
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

// Test 4: Default Settings Structure
{
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.enabled, false);
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.tallyUrl, "http://localhost:9000");
  assert.strictEqual(DEFAULT_TALLY_SETTINGS.voucherType, "Sales");
  console.log("✅ Test 4 Passed: Default Tally settings integrity");
}

console.log("=================================================");
console.log("ALL TALLY REGRESSION TESTS PASSED!");
console.log("=================================================");
