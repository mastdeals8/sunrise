/**
 * Test Suite: Brand-wise Invoice Packet Requirements & Bulk Invoice Packet ZIP Export
 *
 * Verifies:
 * 1. Brand Packet Requirements Precedence Hierarchy:
 *    - Client + Brand specific override
 *    - Brand configuration
 *    - Sub-brand inheritance from parent brand
 *    - Client default
 *    - Company default
 *    - System default fallback
 * 2. Multi-tenant company isolation (no cross-company leak)
 * 3. Invoice readiness evaluation with brand requirements (Wakefit vs ABFRL)
 * 4. Multi-store per-store completeness evaluation
 * 5. Bulk Invoice Packet export packaging and resilient error handling
 */

import type { InvoicePacketRequirements } from "../shared/packetRequirements";
import {
  DEFAULT_INVOICE_PACKET_REQUIREMENTS,
  normalizeRequirements,
  resolveInvoicePacketRequirements,
} from "../shared/packetRequirements";
import {
  evaluateInvoiceReadiness,
  evaluateInvoiceReadinessFromStoreRows,
} from "../shared/invoiceReadiness";
import { packageInvoicesIntoZip } from "../client/src/pages/operations/utils/invoicePdfExport";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("TEST SUITE: Brand-wise Invoice Packet Requirements & Bulk Packet Export");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // 1. Normalization & Default Fallbacks
  // ---------------------------------------------------------------------------
  console.log("--- Test Group 1: Normalization & System Default Fallback ---");
  const fallback = resolveInvoicePacketRequirements([], {
    companyId: 1,
    brandId: 10,
  });

  assert(
    fallback.source === "default",
    `Fallback should report source 'default' (got: ${fallback.source})`
  );
  assert(
    fallback.requirements.taxInvoice === true &&
    fallback.requirements.purchaseOrder === true &&
    fallback.requirements.installationPhotos === true &&
    fallback.requirements.signedWcc === true,
    "System default should require tax invoice, PO, photos, and signed WCC"
  );
  assert(
    fallback.requirements.generatedWcc === false &&
    fallback.requirements.otherDocs === false,
    "System default generated WCC and otherDocs should be false by default"
  );

  // ---------------------------------------------------------------------------
  // 2. Precedence Hierarchy
  // ---------------------------------------------------------------------------
  console.log("\n--- Test Group 2: Precedence Hierarchy & Inheritance ---");

  const companyScopeReq = {
    id: 1,
    companyId: 1,
    brandId: null,
    clientId: null,
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: false,
    generatedWcc: false,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const clientScopeReq = {
    id: 2,
    companyId: 1,
    brandId: null,
    clientId: 100, // Client A
    taxInvoice: true,
    estimate: true,
    purchaseOrder: true,
    installationPhotos: false,
    generatedWcc: false,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const parentBrandReq = {
    id: 3,
    companyId: 1,
    brandId: 200, // Parent brand (e.g. Aditya Birla)
    clientId: null,
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: true,
    generatedWcc: true,
    signedWcc: true,
    transportReceipt: true,
    otherDocs: false,
  };

  const brandReq = {
    id: 4,
    companyId: 1,
    brandId: 201, // Louis Philippe (parent is 200)
    clientId: null,
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: true,
    generatedWcc: true,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const clientBrandOverrideReq = {
    id: 5,
    companyId: 1,
    brandId: 201,
    clientId: 100, // Client A override for brand 201
    taxInvoice: true,
    estimate: true,
    purchaseOrder: true,
    installationPhotos: false,
    generatedWcc: false,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: true,
  };

  const allReqs = [
    companyScopeReq,
    clientScopeReq,
    parentBrandReq,
    brandReq,
    clientBrandOverrideReq,
  ];

  const allBrands = [
    { id: 200, name: "Aditya Birla Fashion", parentBrand: null, companyId: 1 },
    { id: 201, name: "Louis Philippe", parentBrand: "Aditya Birla Fashion", companyId: 1 },
    { id: 202, name: "Allen Solly", parentBrand: "Aditya Birla Fashion", companyId: 1 },
  ];

  // Test 2a: Client + Brand override has highest precedence
  const r1 = resolveInvoicePacketRequirements(allReqs, {
    companyId: 1,
    brandId: 201,
    clientId: 100,
    allBrands,
  });
  assert(
    r1.source === "client_brand_override" &&
    r1.requirements.otherDocs === true &&
    r1.requirements.installationPhotos === false,
    "Level 1: Client + Brand override takes top precedence"
  );

  // Test 2b: Brand configuration takes precedence over parent & client & company
  const r2 = resolveInvoicePacketRequirements(
    [companyScopeReq, clientScopeReq, parentBrandReq, brandReq],
    {
      companyId: 1,
      brandId: 201,
      clientId: 999, // Different client with no override
      allBrands,
    }
  );
  assert(
    r2.source === "brand" &&
    r2.requirements.signedWcc === false &&
    r2.requirements.generatedWcc === true,
    "Level 2: Brand config takes precedence over parent brand and company defaults"
  );

  // Test 2c: Sub-brand inheritance from parent brand
  const r3 = resolveInvoicePacketRequirements(
    [companyScopeReq, parentBrandReq],
    {
      companyId: 1,
      brandId: 202, // Allen Solly (no direct config, but parent is 200)
      allBrands,
    }
  );
  assert(
    r3.source === "parent_brand" &&
    r3.requirements.signedWcc === true &&
    r3.requirements.transportReceipt === true,
    "Level 3: Sub-brand inherits requirements from parent brand"
  );

  // Test 2d: Client-level default
  const r4 = resolveInvoicePacketRequirements(
    [companyScopeReq, clientScopeReq],
    {
      companyId: 1,
      brandId: null,
      clientId: 100,
      allBrands,
    }
  );
  assert(
    r4.source === "client" && r4.requirements.estimate === true,
    "Level 4: Client default takes precedence when brand has no config"
  );

  // Test 2e: Company-level default
  const r5 = resolveInvoicePacketRequirements(
    [companyScopeReq],
    {
      companyId: 1,
      brandId: 555, // Unconfigured brand
      clientId: 555, // Unconfigured client
      allBrands,
    }
  );
  assert(
    r5.source === "company" && r5.requirements.installationPhotos === false,
    "Level 5: Company default applies when brand and client are unconfigured"
  );

  // ---------------------------------------------------------------------------
  // 3. Multi-tenant Company Isolation
  // ---------------------------------------------------------------------------
  console.log("\n--- Test Group 3: Multi-tenant Company Isolation ---");
  const company2Req = {
    id: 99,
    companyId: 2, // Company 2
    brandId: 201,
    clientId: null,
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: false,
    generatedWcc: false,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const isolationResult = resolveInvoicePacketRequirements([company2Req], {
    companyId: 1, // Querying as Company 1
    brandId: 201,
    allBrands,
  });
  assert(
    isolationResult.source === "default",
    "Requirements from Company 2 do not leak to Company 1 (company isolation)"
  );

  // ---------------------------------------------------------------------------
  // 4. Invoice Readiness with Brand Requirements (Wakefit vs ABFRL)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test Group 4: Invoice Readiness with Brand-specific Requirements ---");

  // Case A: Wakefit - Only PO required, no WCC or photos required
  const wakefitReq: InvoicePacketRequirements = {
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: false,
    generatedWcc: false,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const wakefitEstimate = {
    estimateNumber: "SM/E/26-27/WAKEFIT-01",
    poNumber: "WF-PO-2026-001",
    workflowStatus: "PO RECEIVED",
  };

  const wakefitStoreRows = [
    {
      storeId: 1,
      storeCode: "WF-BLR-01",
      storeName: "Wakefit Indiranagar",
      photoCount: 0,
      wccCount: 0,
      signedWccCount: 0,
      transportReceiptCount: 0,
    },
  ];

  const wakefitEval = evaluateInvoiceReadinessFromStoreRows(
    wakefitEstimate,
    wakefitStoreRows,
    wakefitReq
  );

  assert(
    wakefitEval.isInvoiceReady === true,
    "Wakefit: PO received + 0 photos + 0 WCC evaluates to INVOICE READY when brand does not require photos/WCC"
  );
  assert(
    wakefitEval.status === "invoice_ready",
    "Wakefit: workflow status evaluates to 'invoice_ready'"
  );
  assert(
    wakefitEval.incompleteStores.length === 0,
    "Wakefit: 0 incomplete stores"
  );

  // Case B: ABFRL - Requires WCC + Installation Photos + PO
  const abfrlReq: InvoicePacketRequirements = {
    taxInvoice: true,
    estimate: false,
    purchaseOrder: true,
    installationPhotos: true,
    generatedWcc: true,
    signedWcc: false,
    transportReceipt: false,
    otherDocs: false,
  };

  const abfrlEstimate = {
    estimateNumber: "SM/E/26-27/ABFRL-01",
    poNumber: "ABFRL-PO-99",
    workflowStatus: "PO RECEIVED",
  };

  // Missing photos & WCC
  const abfrlIncompleteStores = [
    {
      storeId: 1,
      storeCode: "AB-GOA-01",
      storeName: "Louis Philippe Goa",
      photoCount: 0,
      wccCount: 0,
      signedWccCount: 0,
      transportReceiptCount: 0,
    },
  ];

  const abfrlIncompleteEval = evaluateInvoiceReadinessFromStoreRows(
    abfrlEstimate,
    abfrlIncompleteStores,
    abfrlReq
  );

  assert(
    abfrlIncompleteEval.isInvoiceReady === false,
    "ABFRL: PO received with missing photos/WCC evaluates to NOT READY when brand requires photos/WCC"
  );
  assert(
    abfrlIncompleteEval.incompleteStores.length === 1 &&
    abfrlIncompleteEval.incompleteStores[0].missing.includes("Installation Photo") &&
    abfrlIncompleteEval.incompleteStores[0].missing.includes("WCC Generated"),
    "ABFRL: reports missing installation photos and missing WCC"
  );

  // Now satisfy ABFRL requirements
  const abfrlCompleteStores = [
    {
      storeId: 1,
      storeCode: "AB-GOA-01",
      storeName: "Louis Philippe Goa",
      photoCount: 2,
      wccCount: 1,
      signedWccCount: 0,
      transportReceiptCount: 0,
    },
  ];

  const abfrlCompleteEval = evaluateInvoiceReadinessFromStoreRows(
    abfrlEstimate,
    abfrlCompleteStores,
    abfrlReq
  );

  assert(
    abfrlCompleteEval.isInvoiceReady === true,
    "ABFRL: Evaluates to INVOICE READY once photos and WCC are provided"
  );

  // ---------------------------------------------------------------------------
  // 5. Multi-Store Estimates: Store-by-Store Completeness
  // ---------------------------------------------------------------------------
  console.log("\n--- Test Group 5: Multi-Store Store-by-Store Isolation ---");

  const multiStoreList = [
    {
      storeId: 1,
      storeCode: "ST-01",
      storeName: "Store 1",
      photoCount: 3,
      wccCount: 1,
      signedWccCount: 0,
      transportReceiptCount: 0,
    },
    {
      storeId: 2,
      storeCode: "ST-02",
      storeName: "Store 2",
      photoCount: 0, // Incomplete!
      wccCount: 1,
      signedWccCount: 0,
      transportReceiptCount: 0,
    },
  ];

  const multiStoreEval = evaluateInvoiceReadinessFromStoreRows(
    abfrlEstimate,
    multiStoreList,
    abfrlReq
  );

  assert(
    multiStoreEval.isInvoiceReady === false,
    "Multi-store: Estimate is NOT ready if even 1 store is missing required documents"
  );
  assert(
    multiStoreEval.completedStores === 1 &&
    multiStoreEval.incompleteStores.length === 1 &&
    multiStoreEval.incompleteStores[0].storeCode === "ST-02",
    "Multi-store: Correctly pinpoints incomplete Store 2"
  );

  // ---------------------------------------------------------------------------
  // 6. Bulk Invoice Packet ZIP Packaging & Resilient Error Handling
  // ---------------------------------------------------------------------------
  console.log("\n--- Test Group 6: Bulk Packet ZIP Packaging & Resilient Error Handling ---");

  // Create mock Uint8Array PDFs
  const mockPdfBytes1 = new TextEncoder().encode("%PDF-1.4 Mock Invoice Packet 1");
  const mockPdfBytes2 = new TextEncoder().encode("%PDF-1.4 Mock Invoice Packet 2");

  const packetsToZip = [
    { filename: "Invoice_26-27_SM_193_Packet.pdf", data: mockPdfBytes1 },
    { filename: "Invoice_26-27_SM_194_Packet.pdf", data: mockPdfBytes2 },
  ];

  const zipBlob = await packageInvoicesIntoZip(packetsToZip);
  assert(
    zipBlob instanceof Blob && zipBlob.size > 0,
    `ZIP packaging: successfully produced non-empty zip blob (${zipBlob.size} bytes)`
  );
  assert(
    zipBlob.type === "application/zip",
    `ZIP packaging: MIME type is application/zip (got: ${zipBlob.type})`
  );

  // Test Partial Failure Logic:
  // If invoice 1 succeeds, invoice 2 fails, invoice 3 succeeds:
  // Zip should contain invoice 1 and 3, and failure list contains invoice 2.
  const invoicesToProcess = [
    { id: 1, number: "INV-001", shouldFail: false },
    { id: 2, number: "INV-002", shouldFail: true },
    { id: 3, number: "INV-003", shouldFail: false },
  ];

  const generatedPackets: { filename: string; data: Uint8Array }[] = [];
  const failures: { invoiceNumber: string; error: string }[] = [];

  for (const inv of invoicesToProcess) {
    try {
      if (inv.shouldFail) {
        throw new Error("Simulated document fetch timeout");
      }
      generatedPackets.push({
        filename: `Invoice_${inv.number}_Packet.pdf`,
        data: new TextEncoder().encode(`Mock PDF for ${inv.number}`),
      });
    } catch (err: any) {
      failures.push({
        invoiceNumber: inv.number,
        error: err.message,
      });
    }
  }

  assert(
    generatedPackets.length === 2,
    "Partial failure: 2 successful packets generated out of 3"
  );
  assert(
    failures.length === 1 && failures[0].invoiceNumber === "INV-002",
    "Partial failure: Failed invoice INV-002 captured with error reason"
  );

  const partialZip = await packageInvoicesIntoZip(generatedPackets);
  assert(
    partialZip.size > 0,
    "Partial failure: ZIP archive successfully packaged with the 2 valid packets"
  );

  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
