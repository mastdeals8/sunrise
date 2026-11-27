import { config } from "dotenv";
config();

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../server/db";
import { invoices, estimates, clients, stores, products, deliveryChallans, executionDocuments, executionStores } from "../shared/schema";
import { eq } from "drizzle-orm";
import InvoiceDocument from "../client/src/components/InvoiceDocument";

async function verifyInvoicePacket184() {
  console.log("=== VERIFYING INVOICE PACKET BUILDER ASSEMBLY FOR INVOICE 184 ===");

  // 1. Fetch invoice 184
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, 184));
  if (!inv) throw new Error("Invoice 184 not found");

  // 2. Fetch linked estimate
  const [est] = inv.estimateId
    ? await db.select().from(estimates).where(eq(estimates.id, inv.estimateId))
    : [null];

  // 3. Fetch client
  const [client] = inv.clientId
    ? await db.select().from(clients).where(eq(clients.id, inv.clientId))
    : [null];

  // 4. Fetch delivery challans and execution documents
  const dcs = inv.estimateId
    ? await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, inv.estimateId))
    : [];

  const docs = inv.estimateId
    ? await db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, inv.estimateId))
    : [];

  const allStores = await db.select().from(stores);
  const allProducts = await db.select().from(products);

  const packet = {
    invoice: inv,
    estimate: est,
    client: client,
    challans: dcs,
    documents: docs,
    stores: allStores,
    products: allProducts,
  };

  const sellerProfile = {
    companyId: 1,
    name: "Sunrise Media",
    gstin: "27ABZFS5736R1ZR",
    address: "Shop No. 1, Pune",
  };

  // 5. Render InvoiceDocument exactly as InvoicePacketDocument does in InvoicePacket.tsx line 1781
  console.log("Rendering InvoicePacketDocument for Invoice 184...");
  const packetDocHtml = renderToStaticMarkup(
    React.createElement(InvoiceDocument, {
      invoice: packet.invoice,
      estimate: packet.estimate,
      client: packet.client,
      sellerProfile: sellerProfile,
      assetToken: "test-token",
      products: packet.products || [],
      stores: packet.stores || [],
    })
  );

  if (!packetDocHtml.includes("26-27/SM/193")) {
    throw new Error("Rendered packet invoice did not contain expected invoice number");
  }

  console.log(`✓ InvoicePacketDocument rendered cleanly (${packetDocHtml.length} characters)`);
  console.log("=== INVOICE PACKET 184 VERIFICATION PASSED ===");
}

verifyInvoicePacket184().catch(err => {
  console.error(err);
  process.exit(1);
});
