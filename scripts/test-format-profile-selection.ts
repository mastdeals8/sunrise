import "dotenv/config";
import assert from "assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { db } from "../server/db";
import { estimates, stores, clients } from "../shared/schema";
import { eq } from "drizzle-orm";
import {
  resolveCustomerFormatProfile,
  ESTIMATE_FORMAT_PROFILES,
} from "../shared/estimateProfiles";
import EstimateDocument from "../client/src/components/EstimateDocument";
import { renderEstimatePdfBuffer } from "../server/utils/estimatePdfRenderer";

async function runTests() {
  console.log("=================================================================");
  console.log("TESTING ESTIMATE PREVIEW & PRINT FORMAT SELECTION (AUTOMATIC PARITY)");
  console.log("=================================================================\n");

  // ── TEST 1: Unit tests for resolveCustomerFormatProfile ────────────────────
  console.log("[Test 1] Testing resolveCustomerFormatProfile rules...");

  // 1a. ABFRL by client name
  const p1 = resolveCustomerFormatProfile(
    { formatProfileCode: "normal", clientFormat: "normal" },
    { id: 1, name: "Aditya Birla Lifestyle Brands Limited" }
  );
  assert.strictEqual(p1.code, "ABLBL", "ABFRL client name must resolve to ABLBL profile");
  assert.strictEqual(p1.printLayout, "abfrl_grouped", "ABFRL layout must be abfrl_grouped");
  console.log("  ✓ ABFRL client name automatically resolved to ABLBL format profile");

  // 1b. ABFRL by client group name
  const p1b = resolveCustomerFormatProfile(
    { formatProfileCode: null, clientFormat: null },
    { id: 10, name: "Allen Solly Store 12", clientGroupName: "ABFRL" }
  );
  assert.strictEqual(p1b.code, "ABLBL", "ABFRL client group must resolve to ABLBL profile");
  console.log("  ✓ ABFRL client group automatically resolved to ABLBL format profile");

  // 1c. ABFRL by client format setting
  const p1c = resolveCustomerFormatProfile(
    {},
    { id: 11, name: "Special Enterprise", format: "ABLBL" }
  );
  assert.strictEqual(p1c.code, "ABLBL", "Client format ABLBL must resolve to ABLBL profile");
  console.log("  ✓ Client format ABLBL automatically resolved to ABLBL format profile");

  // 1d. Wakefit by client name
  const p2 = resolveCustomerFormatProfile(
    { formatProfileCode: "normal", clientFormat: "normal" },
    { id: 3, name: "Wakefit Innovations Pvt Ltd" }
  );
  assert.strictEqual(p2.code, "RETAIL_SINGLE_STORE", "Wakefit client name must resolve to RETAIL_SINGLE_STORE profile");
  assert.strictEqual(p2.printLayout, "retail_single_store", "Wakefit layout must be retail_single_store");
  console.log("  ✓ Wakefit client name automatically resolved to Retail Store format profile");

  // 1e. Wakefit by client group name
  const p2b = resolveCustomerFormatProfile(
    { formatProfileCode: null, clientFormat: null },
    { id: 12, name: "Store Koramangala", clientGroupName: "Wakefit" }
  );
  assert.strictEqual(p2b.code, "RETAIL_SINGLE_STORE", "Wakefit client group must resolve to RETAIL_SINGLE_STORE profile");
  console.log("  ✓ Wakefit client group automatically resolved to Retail Store format profile");

  // 1f. Other retail client with configured RETAIL_SINGLE_STORE profile
  const p2c = resolveCustomerFormatProfile(
    {},
    { id: 15, name: "FabIndia Retail Ltd", defaultFormatProfileCode: "RETAIL_SINGLE_STORE" }
  );
  assert.strictEqual(p2c.code, "RETAIL_SINGLE_STORE", "Configured retail client must resolve to RETAIL_SINGLE_STORE profile");
  console.log("  ✓ Configured retail client automatically resolved to Retail Store format profile");

  // 1g. Other corporate customer with default format
  const p3 = resolveCustomerFormatProfile(
    { formatProfileCode: null, clientFormat: null },
    { id: 20, name: "Generic Corporate Client" }
  );
  assert.strictEqual(p3.code, "normal", "Standard client must resolve to normal profile");
  assert.strictEqual(p3.printLayout, "standard", "Standard client layout must be standard");
  console.log("  ✓ Standard corporate client automatically resolved to default format profile");

  // ── TEST 2: Template Determination in Canonical EstimateDocument ──────────
  console.log("\n[Test 2] Testing canonical EstimateDocument template markup...");

  const mockItem = {
    id: 1,
    sl: 1,
    estimateId: 100,
    itemName: "Wall Graphics",
    description: "Self Adhesive Vinyl",
    isStandard: true,
    hsn: "3919",
    width: "10",
    height: "10",
    quantity: 1,
    totalSize: 100,
    rate: 50,
    totalPrice: 5000,
    sgstPercent: 9,
    cgstPercent: 9,
    igstPercent: 0,
    sgstAmount: 450,
    cgstAmount: 450,
    igstAmount: 0,
    totalAmount: 5900,
  };

  const mockStore = {
    id: 10,
    clientId: 3,
    storeCode: "R007",
    name: "Kharadi Store",
    city: "Pune",
    state: "Maharashtra",
  };

  // Render with Wakefit client -> MUST NOT have Total Material Cost row
  const wakefitClient = { id: 3, name: "Wakefit Innovations Pvt Ltd", defaultFormatProfileCode: "RETAIL_SINGLE_STORE" };
  const wakefitEstimate = {
    id: 100,
    estimateNumber: "SM/E/TEST/WAKEFIT",
    clientId: 3,
    storeId: 10,
    totalAmount: 5900,
  };

  const wakefitMarkup = renderToStaticMarkup(
    React.createElement(EstimateDocument, {
      estimate: wakefitEstimate as any,
      items: [mockItem as any],
      stores: [mockStore as any],
      clients: [wakefitClient as any],
    })
  );

  assert(
    !wakefitMarkup.includes("data-pdf-material-cost-row"),
    "Wakefit markup must NOT include Total Material Cost row"
  );
  assert(
    !wakefitMarkup.includes("Total Material Cost :"),
    "Wakefit markup must NOT display 'Total Material Cost :'"
  );
  assert(
    wakefitMarkup.includes("Store: Kharadi Store, Store Code: R007"),
    "Wakefit markup must display store heading with store code"
  );
  console.log("  ✓ Wakefit renders canonical Retail Store template (No Total Material Cost row, with Store heading)");

  // Render with ABFRL client -> MUST have Total Material Cost row
  const abfrlClient = { id: 1, name: "Aditya Birla Lifestyle Brands Limited", format: "ABLBL" };
  const abfrlEstimate = {
    id: 101,
    estimateNumber: "SM/E/TEST/ABFRL",
    clientId: 1,
    storeId: 10,
    storeGrouping: { "10": { storeName: "Kharadi Store", itemSls: [1] } },
    totalAmount: 5900,
  };

  const abfrlMarkup = renderToStaticMarkup(
    React.createElement(EstimateDocument, {
      estimate: abfrlEstimate as any,
      items: [mockItem as any],
      stores: [mockStore as any],
      clients: [abfrlClient as any],
    })
  );

  assert(
    abfrlMarkup.includes("data-pdf-material-cost-row"),
    "ABFRL markup must include data-pdf-material-cost-row"
  );
  assert(
    abfrlMarkup.includes("Total Material Cost"),
    "ABFRL markup must display 'Total Material Cost'"
  );
  console.log("  ✓ ABFRL renders canonical ABFRL template (Preserves Total Material Cost row)");

  // ── TEST 3: Live PDF Generation Parity on Real DB Estimates ────────────────
  console.log("\n[Test 3] Testing live PDF generation parity on DB estimates...");

  // 3a. Wakefit estimate SM/E/26-27/248
  const [dbWakefit] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.estimateNumber, "SM/E/26-27/248"))
    .limit(1);

  if (dbWakefit) {
    const wakefitPdf = await renderEstimatePdfBuffer({
      estimateId: dbWakefit.id,
      scale: 100,
      density: "normal",
    });

    const parsedWakefit = await PDFDocument.load(wakefitPdf.buffer);
    assert.strictEqual(parsedWakefit.getPageCount(), 1, "Wakefit PDF must be 1 page");
    const p = parsedWakefit.getPage(0);
    assert(Math.abs(p.getWidth() - 595.28) < 2, "A4 width 595.28pt");
    assert(Math.abs(p.getHeight() - 841.89) < 2, "A4 height 841.89pt");
    console.log(`  ✓ Wakefit SM/E/26-27/248 PDF rendered canonically: ${wakefitPdf.filename} (${wakefitPdf.buffer.length} bytes, 1 page A4)`);
  }

  // 3b. ABFRL estimate SM/E/26-27/221
  const [dbAbfrl] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.estimateNumber, "SM/E/26-27/221"))
    .limit(1);

  if (dbAbfrl) {
    const abfrlPdf = await renderEstimatePdfBuffer({
      estimateId: dbAbfrl.id,
      scale: 100,
      density: "normal",
    });

    const parsedAbfrl = await PDFDocument.load(abfrlPdf.buffer);
    assert(parsedAbfrl.getPageCount() >= 1, "ABFRL PDF must have at least 1 page");
    const p = parsedAbfrl.getPage(0);
    assert(Math.abs(p.getWidth() - 595.28) < 2, "A4 width 595.28pt");
    assert(Math.abs(p.getHeight() - 841.89) < 2, "A4 height 841.89pt");
    console.log(`  ✓ ABFRL SM/E/26-27/221 PDF rendered canonically: ${abfrlPdf.filename} (${abfrlPdf.buffer.length} bytes, ${parsedAbfrl.getPageCount()} page(s) A4)`);
  }

  console.log("\n=================================================================");
  console.log("ALL FORMAT PROFILE SELECTION & CANONICAL RENDERER CHECKS PASSED!");
  console.log("=================================================================");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
