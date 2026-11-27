import { config } from "dotenv";
config();

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../server/db";
import { invoices, estimates, clients, stores, products, companyUsers } from "../shared/schema";
import { eq } from "drizzle-orm";
import InvoiceDocument from "../client/src/components/InvoiceDocument";

async function main() {
  console.log("=== TESTING INVOICE DOCUMENT RENDER REGRESSION ===");

  // 1. Fetch real Invoice ID 184
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, 184));
  if (!inv) {
    throw new Error("Invoice 184 not found in database");
  }
  console.log(`Loaded Invoice: ${inv.invoiceNumber} (ID: ${inv.id})`);

  // 2. Fetch linked Estimate
  const est = inv.estimateId
    ? (await db.select().from(estimates).where(eq(estimates.id, inv.estimateId)))[0]
    : null;

  // 3. Fetch Client
  const client = inv.clientId
    ? (await db.select().from(clients).where(eq(clients.id, inv.clientId)))[0]
    : null;

  // 4. Fetch Products & Stores
  const allProducts = await db.select().from(products);
  const allStores = await db.select().from(stores);

  const sellerProfile = {
    companyId: 1,
    name: "Sunrise Media",
    gstin: "27ABZFS5736R1ZR",
    address: "Shop No. 1, Pune",
  };

  // 5. Render with real-shaped Invoice 184 data
  console.log("Rendering InvoiceDocument with Invoice 184 data...");
  let html = "";
  try {
    html = renderToStaticMarkup(
      React.createElement(InvoiceDocument, {
        invoice: inv,
        estimate: est,
        client: client,
        sellerProfile: sellerProfile,
        assetToken: "dummy-token",
        products: allProducts,
        stores: allStores,
      })
    );
  } catch (err: any) {
    console.error("FATAL: InvoiceDocument threw during render:", err);
    throw err;
  }

  // 6. Verify rendered content assertions
  if (!html || html.length < 100) {
    throw new Error("Rendered HTML is unexpectedly empty or too small");
  }
  if (!html.includes(inv.invoiceNumber)) {
    throw new Error(`Expected rendered HTML to include invoice number ${inv.invoiceNumber}`);
  }
  if (!html.includes("30ABACA5076G1Z3")) {
    throw new Error("Expected rendered HTML to include authoritative GSTIN 30ABACA5076G1Z3");
  }
  if (!html.includes("TAX INVOICE")) {
    throw new Error("Expected rendered HTML to include TAX INVOICE header");
  }

  console.log(`✓ InvoiceDocument rendered successfully (${html.length} bytes of HTML generated)`);
  console.log(`✓ Verified invoice number ${inv.invoiceNumber} and GSTIN in output`);

  // 7. Test edge case: Invoice with null/empty lineItems
  console.log("Testing InvoiceDocument with empty lineItems fallback...");
  const emptyInv = { ...inv, lineItems: null, line_items: null, amount: 5000, taxAmount: 900, totalAmount: 5900 };
  const emptyHtml = renderToStaticMarkup(
    React.createElement(InvoiceDocument, {
      invoice: emptyInv,
      estimate: est,
      client: client,
      sellerProfile: sellerProfile,
      assetToken: "dummy-token",
      products: allProducts,
      stores: allStores,
    })
  );
  if (!emptyHtml.includes("5,000") && !emptyHtml.includes("5000")) {
    throw new Error("Expected fallback subtotal amount to render when lineItems is empty");
  }
  console.log("✓ Empty lineItems fallback rendered cleanly without error");

  console.log("=== ALL INVOICE DOCUMENT RENDER TESTS PASSED ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
