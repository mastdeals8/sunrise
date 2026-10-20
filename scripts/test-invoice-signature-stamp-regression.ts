import "dotenv/config";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvoiceDocument from "../client/src/components/InvoiceDocument";
import EstimateDocument from "../client/src/components/EstimateDocument";
import { registerRoutes } from "../server/routes";
import { generateToken } from "../server/auth";
import { db } from "../server/db";
import { companies, invoices, estimates, estimateItems } from "../shared/schema";
import { eq } from "drizzle-orm";
import express from "express";
import assert from "assert";

async function runInvoiceSignatureStampSuite() {
  console.log("======================================================================");
  console.log("  RUNNING INVOICE SIGNATURE & STAMP VERIFICATION REGRESSION SUITE");
  console.log("======================================================================");

  // 1. Check Database State for Company 1
  console.log("\n[Test 1] Inspecting database record for Company 1...");
  const [c1] = await db.select().from(companies).where(eq(companies.id, 1)).limit(1);
  assert(c1, "Company 1 must exist");
  assert.strictEqual(c1.signaturePath, null, "Requirement 1: Separate signature in Company 1 MUST be blank (null)");
  assert(
    c1.sealPath && c1.sealPath.includes("stamp_and_sign"),
    "Requirement 2: Combined stamp and signature image must exist in Company 1 sealPath"
  );
  console.log("  ✓ PASS: DB confirms signature_path is blank (null) and seal_path contains the combined image.");

  // 2. Check /api/company-settings via Express API
  console.log("\n[Test 2] Testing /api/company-settings endpoint for Company 1 and Company 2...");
  const app = express();
  await registerRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const adminToken = generateToken({ id: 1, username: "admin", role: "admin" });

  try {
    const resC1 = await fetch(`http://127.0.0.1:${port}/api/company-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, "X-Company-Id": "1" },
    });
    assert.strictEqual(resC1.status, 200, "Should return 200");
    const dataC1 = await resC1.json();
    assert.strictEqual(dataC1.signaturePath, "", "Company 1 signaturePath must be blank in seller profile");
    assert(dataC1.sealPath && dataC1.sealPath.includes("stamp_and_sign"), "Company 1 sealPath must contain combined stamp_and_sign image");
    assert(!JSON.stringify(dataC1).includes("file-1780897714393-225895475.png"), "No stale file-1780897714393-225895475.png in Company 1 profile");
    console.log("  ✓ PASS: /api/company-settings returns blank signaturePath and combined sealPath for Company 1.");

    // Check Company 2
    const resC2 = await fetch(`http://127.0.0.1:${port}/api/company-settings`, {
      headers: { Authorization: `Bearer ${adminToken}`, "X-Company-Id": "2" },
    });
    assert.strictEqual(resC2.status, 200, "Should return 200");
    const dataC2 = await resC2.json();
    assert(dataC2.sealPath && dataC2.sealPath.includes("delhi-seal"), "Company 2 sealPath must be unchanged");
    assert(!dataC2.sealPath.includes("stamp_and_sign"), "Company 1 combined image must not leak to Company 2");
    console.log("  ✓ PASS: Multi-company isolation verified: Company 2 branding is intact and isolated.");

    // 3. Render InvoiceDocument for Company 1 and verify output
    console.log("\n[Test 3] Testing canonical InvoiceDocument rendering for Company 1...");
    const mockInvoice: any = {
      id: 101,
      invoiceNumber: "26-27/SM/101",
      date: "2026-10-15",
      dueDate: "2026-11-15",
      partyName: "Test Client Ltd",
      totalAmount: 11800,
      subtotal: 10000,
      taxAmount: 1800,
      lineItems: [
        { itemName: "Signage Board", quantity: 1, unit: "Nos", rate: 10000, amount: 10000, taxPercent: 18, taxAmount: 1800, totalAmount: 11800 }
      ]
    };

    const htmlC1 = renderToStaticMarkup(React.createElement(InvoiceDocument, {
      invoice: mockInvoice,
      sellerProfile: dataC1
    }));

    assert(!htmlC1.includes("file-1780897714393-225895475.png"), "Old stale signature must NOT appear on invoice");
    assert(htmlC1.includes("stamp_and_sign"), "Combined stamp and signature image must appear on invoice");
    const sigImgMatches = htmlC1.match(/<img[^>]*alt="Signature and stamp"[^>]*>/g) || [];
    assert.strictEqual(sigImgMatches.length, 1, `Expected exactly 1 signature/stamp image, found ${sigImgMatches.length}`);
    const sealImgMatches = htmlC1.match(/<img[^>]*alt="Company seal"[^>]*>/g) || [];
    assert.strictEqual(sealImgMatches.length, 0, "No duplicate separate company seal image should be rendered");
    console.log("  ✓ PASS: Stale signature eliminated. Exactly ONE combined signature-and-stamp image rendered.");

    // 4. Test Historical Invoice from DB (e.g. invoice 52)
    console.log("\n[Test 4] Testing historical invoice rendering from real database records...");
    const [histInv] = await db.select().from(invoices).where(eq(invoices.id, 52)).limit(1);
    assert(histInv, "Historical invoice 52 must exist");
    const [histEst] = await db.select().from(estimates).where(eq(estimates.id, histInv.estimateId!)).limit(1);

    const histHtml = renderToStaticMarkup(React.createElement(InvoiceDocument, {
      invoice: histInv,
      estimate: histEst,
      sellerProfile: dataC1
    }));

    assert(!histHtml.includes("file-1780897714393-225895475.png"), "Historical invoice must NOT show old signature");
    assert(histHtml.includes("stamp_and_sign"), "Historical invoice must show combined stamp and sign image");
    const histSigMatches = histHtml.match(/<img[^>]*alt="Signature and stamp"[^>]*>/g) || [];
    assert.strictEqual(histSigMatches.length, 1, `Historical invoice must have exactly 1 stamp/sign image, found ${histSigMatches.length}`);
    console.log("  ✓ PASS: Historical invoice 52 renders single combined image with zero obsolete references.");

    // 5. Test EstimateDocument rendering (Invoice Packet Page 2)
    console.log("\n[Test 5] Testing EstimateDocument rendering (Packet Page 2 / Estimate view)...");
    const histEstItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, histEst.id));
    const estHtml = renderToStaticMarkup(React.createElement(EstimateDocument, {
      estimate: histEst,
      items: histEstItems,
      sellerProfile: dataC1
    }));

    assert(!estHtml.includes("file-1780897714393-225895475.png"), "Estimate page must NOT show old stale signature");
    assert(estHtml.includes("stamp_and_sign"), "Estimate page must show combined stamp and sign image");
    // Verify only 1 image in the signature space
    const estSigSpaceMatch = estHtml.match(/class="estimate-signature-space"[^>]*>([\s\S]*?)<\/div>/);
    assert(estSigSpaceMatch, "Estimate signature space must exist");
    const estImgCount = (estSigSpaceMatch[1].match(/<img/g) || []).length;
    assert.strictEqual(estImgCount, 1, `Estimate must have exactly 1 signature/stamp image, found ${estImgCount}`);
    console.log("  ✓ PASS: EstimateDocument renders single combined image with zero obsolete references.");

    // 6. Test Company 2 isolation
    console.log("\n[Test 6] Testing InvoiceDocument rendering for Company 2...");
    const htmlC2 = renderToStaticMarkup(React.createElement(InvoiceDocument, {
      invoice: mockInvoice,
      sellerProfile: dataC2
    }));
    assert(!htmlC2.includes("stamp_and_sign"), "Company 1 image must not appear on Company 2 invoice");
    assert(htmlC2.includes("delhi-seal"), "Company 2 seal must appear on Company 2 invoice");
    console.log("  ✓ PASS: Company 2 invoice renders Company 2 branding without interference.");

    console.log("\n======================================================================");
    console.log("  ALL INVOICE SIGNATURE & STAMP TESTS PASSED (100% PASS RATE)!");
    console.log("======================================================================");
    server.close(() => process.exit(0));
  } catch (err) {
    server.close();
    throw err;
  }
}

runInvoiceSignatureStampSuite().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
