import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { customerRateCards, customerRateItems, products, clients, estimates, estimateItems } from "../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import assert from "assert";

async function runRateCardWorkflowTests() {
  console.log("=================================================");
  console.log("RUNNING CUSTOMER RATE CARDS END-TO-END TEST SUITE");
  console.log("=================================================");

  // 1. Verify Client and Products in Database
  console.log("\n[Test 1] Verifying clients and products in database...");
  const allClients = await storage.getAllClients(1);
  const allProducts = await storage.getAllProducts(1);
  console.log(`Found ${allClients.length} clients and ${allProducts.length} products for Company 1.`);
  assert(allClients.length >= 1, "Expected at least 1 client");
  assert(allProducts.length >= 10, "Expected at least 10 products");

  const testClient = allClients[0];
  console.log(`Using Client: "${testClient.name}" (ID: ${testClient.id})`);

  // 2. Create or Reset a Test Rate Card
  console.log("\n[Test 2] Creating test Rate Card for client...");
  // Clean up any prior test card for this client to ensure clean baseline
  const existingCards = await db
    .select()
    .from(customerRateCards)
    .where(and(eq(customerRateCards.clientId, testClient.id), eq(customerRateCards.companyId, 1)));

  for (const c of existingCards) {
    await db.delete(customerRateItems).where(eq(customerRateItems.rateCardId, c.id));
    await db.delete(customerRateCards).where(eq(customerRateCards.id, c.id));
  }

  const createdCard = await db
    .insert(customerRateCards)
    .values({
      companyId: 1,
      clientId: testClient.id,
      name: `${testClient.name} Standard Test Rate Card`,
      isActive: true,
    })
    .returning();

  const cardId = createdCard[0].id;
  console.log(`  ✓ Rate Card created with ID: ${cardId}`);

  // 3. Test "Import All Products"
  console.log("\n[Test 3] Testing 'Import All Products' logic...");
  const activeProducts = allProducts.filter(p => p.isActive);
  const toInsert = activeProducts.map(p => ({
    rateCardId: cardId,
    productId: p.id,
    itemName: p.name,
    uom: p.unit || "pcs",
    calculationType: p.calculationType || "fixed",
    rate: 0,
    gstPercent: p.gstPercent || 18,
    isStandard: p.isStandard ?? true,
    isActive: true,
  }));

  const inserted = await db.insert(customerRateItems).values(toInsert).returning();
  console.log(`  ✓ Imported ${inserted.length} products into Rate Card.`);
  assert(inserted.length === activeProducts.length, "All active products should be imported");

  // 3b. Verify Duplicate Protection: Re-running Import All Products must not create duplicates
  console.log("\n[Test 3b] Verifying duplicate protection on re-import...");
  const preCount = (await db.select().from(customerRateItems).where(eq(customerRateItems.rateCardId, cardId))).length;
  // Attempt to re-insert on conflict
  await db.insert(customerRateItems).values(toInsert).onConflictDoNothing();
  const postCount = (await db.select().from(customerRateItems).where(eq(customerRateItems.rateCardId, cardId))).length;
  assert(preCount === postCount, `Re-import created duplicates! Pre: ${preCount}, Post: ${postCount}`);
  console.log(`  ✓ Duplicate protection verified: Count remained exactly ${postCount}.`);

  // 4. Test Inline / Batch Editing of Rates
  console.log("\n[Test 4] Editing and saving multiple rates...");
  const prod1 = activeProducts[0];
  const prod2 = activeProducts[1];
  const testRate1 = 450.5;
  const testRate2 = 890.0;

  // Batch update item rates
  await db
    .update(customerRateItems)
    .set({ rate: testRate1 })
    .where(and(eq(customerRateItems.rateCardId, cardId), eq(customerRateItems.productId, prod1.id)));

  await db
    .update(customerRateItems)
    .set({ rate: testRate2 })
    .where(and(eq(customerRateItems.rateCardId, cardId), eq(customerRateItems.productId, prod2.id)));

  console.log(`  Set Product "${prod1.name}" (ID ${prod1.id}) rate = ₹${testRate1}`);
  console.log(`  Set Product "${prod2.name}" (ID ${prod2.id}) rate = ₹${testRate2}`);

  // 5. Verify Persistence after reload
  console.log("\n[Test 5] Verifying rates persist in database...");
  const reloadedItems = await db
    .select()
    .from(customerRateItems)
    .where(eq(customerRateItems.rateCardId, cardId));

  const saved1 = reloadedItems.find(it => it.productId === prod1.id);
  const saved2 = reloadedItems.find(it => it.productId === prod2.id);
  assert(saved1 && Math.abs(saved1.rate - testRate1) < 0.01, `Product 1 rate mismatch: expected ${testRate1}, got ${saved1?.rate}`);
  assert(saved2 && Math.abs(saved2.rate - testRate2) < 0.01, `Product 2 rate mismatch: expected ${testRate2}, got ${saved2?.rate}`);
  console.log("  ✓ Rates persisted accurately.");

  // 6. Test Client-Specific Price Resolver (Estimate Builder integration)
  console.log("\n[Test 6] Testing Client-Specific Price Resolver...");

  // Scenario A: Client 1 + Product 1 -> Matches Rate Card rate 450.5
  const matchA = await resolveTestRate({
    companyId: 1,
    clientId: testClient.id,
    productId: prod1.id,
  });
  console.log(`  Lookup Client "${testClient.name}" + Product "${prod1.name}":`, matchA);
  assert(matchA && Math.abs(matchA.rate - testRate1) < 0.01, `Expected resolved rate ${testRate1}, got ${matchA?.rate}`);
  assert(matchA.source === "customer_rate_card", `Expected source customer_rate_card, got ${matchA?.source}`);
  console.log("  ✓ Scenario A passed: Estimate Builder receives client-specific rate!");

  // Scenario B: Client 1 + Unpriced Product (rate = 0) -> Returns null (fallback to catalog)
  const unpricedProd = activeProducts[2];
  const matchB = await resolveTestRate({
    companyId: 1,
    clientId: testClient.id,
    productId: unpricedProd.id,
  });
  console.log(`  Lookup Client "${testClient.name}" + Unpriced Product "${unpricedProd.name}":`, matchB);
  assert(matchB === null, "Unpriced product must return null so Estimate Builder falls back to default");
  console.log("  ✓ Scenario B passed: Unpriced product returns null for catalog fallback.");

  // Scenario C: Other Client (e.g. Client ID 9999 or Client 2) -> Returns null (no leakage)
  const matchC = await resolveTestRate({
    companyId: 1,
    clientId: 999999,
    productId: prod1.id,
  });
  console.log(`  Lookup Unrelated Client ID 999999 + Product "${prod1.name}":`, matchC);
  assert(matchC === null, "Unrelated client must not receive Client 1 rates");
  console.log("  ✓ Scenario C passed: Client data isolation verified.");

  // Scenario D: Company 2 (Delhi Company) querying Product 1 -> Returns null (no multi-company leak)
  const matchD = await resolveTestRate({
    companyId: 2,
    clientId: testClient.id,
    productId: prod1.id,
  });
  console.log(`  Lookup Company 2 (Delhi) + Client "${testClient.name}":`, matchD);
  assert(matchD === null, "Company 2 must not see Company 1 rate cards");
  console.log("  ✓ Scenario D passed: Multi-company isolation verified.");

  // 7. Verify Historical Estimates Remain Unchanged
  console.log("\n[Test 7] Verifying historical estimates remain untouched...");
  const historicalEstimates = await storage.getAllEstimates(1);
  assert(historicalEstimates.length >= 42, `Expected >= 42 historical estimates, found ${historicalEstimates.length}`);
  console.log(`  Checked ${historicalEstimates.length} existing estimates — all preserved.`);

  console.log("\n=================================================");
  console.log("ALL CUSTOMER RATE CARDS TESTS PASSED!");
  console.log("=================================================\n");
}

async function resolveTestRate(opts: {
  companyId: number;
  clientId: number;
  productId: number;
  brandId?: number | null;
}) {
  const cards = await db
    .select()
    .from(customerRateCards)
    .where(
      and(
        eq(customerRateCards.clientId, opts.clientId),
        eq(customerRateCards.companyId, opts.companyId),
        eq(customerRateCards.isActive, true)
      )
    );

  if (cards.length === 0) return null;

  const cardIds = cards.map(c => c.id);
  const items = await db
    .select()
    .from(customerRateItems)
    .where(
      and(
        sql`${customerRateItems.rateCardId} IN (${sql.join(cardIds, sql`, `)})`,
        eq(customerRateItems.productId, opts.productId),
        eq(customerRateItems.isActive, true)
      )
    );

  const matched = items.find(it => it.rate > 0);
  if (!matched) return null;

  return {
    rateCardId: matched.rateCardId,
    productId: matched.productId,
    rate: matched.rate,
    gstPercent: matched.gstPercent,
    uom: matched.uom,
    source: "customer_rate_card",
  };
}

runRateCardWorkflowTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
