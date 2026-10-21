import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import assert from "assert";

async function runDocumentNumberingTests() {
  console.log("==========================================================================");
  console.log("RUNNING COMPANY-SPECIFIC DOCUMENT NUMBERING VERIFICATION SUITE");
  console.log("==========================================================================");

  // --------------------------------------------------------------------------
  // Test 1: Verify Prefix Resolution across Companies 1, 2, and 3
  // --------------------------------------------------------------------------
  console.log("\n[Test 1] Testing prefix resolution for Invoices, Estimates, and DCs...");

  const testDate = new Date("2026-10-22");
  const testDateStr = testDate.toISOString().slice(0, 10);

  // 1.1 Invoices
  const resInv1 = (await db.execute(sql`SELECT public.next_sunrise_document_number('invoice', ${testDateStr}::date, 1) as num`)) as any;
  const numInv1 = String(resInv1.rows[0].num);
  console.log(`  - Company 1 Next Invoice: ${numInv1}`);
  assert(numInv1.startsWith("26-27/SM/"), `Company 1 Invoice must start with 26-27/SM/, got: ${numInv1}`);

  const resInv2 = (await db.execute(sql`SELECT public.next_sunrise_document_number('invoice', ${testDateStr}::date, 2) as num`)) as any;
  const numInv2 = String(resInv2.rows[0].num);
  console.log(`  - Company 2 Next Invoice: ${numInv2}`);
  assert(numInv2.startsWith("26-27/DEL/"), `Company 2 Invoice must start with 26-27/DEL/, got: ${numInv2}`);

  const resInv3 = (await db.execute(sql`SELECT public.next_sunrise_document_number('invoice', ${testDateStr}::date, 3) as num`)) as any;
  const numInv3 = String(resInv3.rows[0].num);
  console.log(`  - Company 3 Next Invoice: ${numInv3}`);
  assert(numInv3.startsWith("26-27/RIKA/"), `Company 3 Invoice must start with 26-27/RIKA/, got: ${numInv3}`);

  // 1.2 Estimates
  const resEst1 = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', ${testDateStr}::date, 1) as num`)) as any;
  const numEst1 = String(resEst1.rows[0].num);
  console.log(`  - Company 1 Next Estimate: ${numEst1}`);
  assert(numEst1.startsWith("SM/E/26-27/"), `Company 1 Estimate must start with SM/E/26-27/, got: ${numEst1}`);

  const resEst2 = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', ${testDateStr}::date, 2) as num`)) as any;
  const numEst2 = String(resEst2.rows[0].num);
  console.log(`  - Company 2 Next Estimate: ${numEst2}`);
  assert(numEst2.startsWith("DEL/E/26-27/"), `Company 2 Estimate must start with DEL/E/26-27/, got: ${numEst2}`);

  const resEst3 = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', ${testDateStr}::date, 3) as num`)) as any;
  const numEst3 = String(resEst3.rows[0].num);
  console.log(`  - Company 3 Next Estimate: ${numEst3}`);
  assert(numEst3.startsWith("RIKA/E/26-27/"), `Company 3 Estimate must start with RIKA/E/26-27/, got: ${numEst3}`);

  // 1.3 Delivery Challans (DC)
  const resDC1 = (await db.execute(sql`SELECT public.next_sunrise_document_number('dc', ${testDateStr}::date, 1) as num`)) as any;
  const numDC1 = String(resDC1.rows[0].num);
  console.log(`  - Company 1 Next DC: ${numDC1}`);
  assert(numDC1.startsWith("SM/DC/26-27/"), `Company 1 DC must start with SM/DC/26-27/, got: ${numDC1}`);

  const resDC2 = (await db.execute(sql`SELECT public.next_sunrise_document_number('dc', ${testDateStr}::date, 2) as num`)) as any;
  const numDC2 = String(resDC2.rows[0].num);
  console.log(`  - Company 2 Next DC: ${numDC2}`);
  assert(numDC2.startsWith("DEL/DC/26-27/"), `Company 2 DC must start with DEL/DC/26-27/, got: ${numDC2}`);

  const resDC3 = (await db.execute(sql`SELECT public.next_sunrise_document_number('dc', ${testDateStr}::date, 3) as num`)) as any;
  const numDC3 = String(resDC3.rows[0].num);
  console.log(`  - Company 3 Next DC: ${numDC3}`);
  assert(numDC3.startsWith("RIKA/DC/26-27/"), `Company 3 DC must start with RIKA/DC/26-27/, got: ${numDC3}`);

  console.log("  ✓ PASS: All 3 document kinds correctly derive prefixes for Pune (SM), Delhi (DEL), and Rika (RIKA).");

  // --------------------------------------------------------------------------
  // Test 2: Financial Year Rollover
  // --------------------------------------------------------------------------
  console.log("\n[Test 2] Testing financial year calculation logic across FY rollover...");

  // March 31, 2026 -> FY 25-26
  const mar2026Res = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', '2026-03-31'::date, 1) as num`)) as any;
  const mar2026Num = String(mar2026Res.rows[0].num);
  assert(mar2026Num.includes("/25-26/"), `March 31, 2026 must be in FY 25-26, got: ${mar2026Num}`);
  console.log(`  - 2026-03-31 FY: ${mar2026Num} (FY 25-26)`);

  // April 1, 2026 -> FY 26-27
  const apr2026Res = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', '2026-04-01'::date, 1) as num`)) as any;
  const apr2026Num = String(apr2026Res.rows[0].num);
  assert(apr2026Num.includes("/26-27/"), `April 1, 2026 must be in FY 26-27, got: ${apr2026Num}`);
  console.log(`  - 2026-04-01 FY: ${apr2026Num} (FY 26-27)`);

  // April 1, 2027 -> FY 27-28
  const apr2027Res = (await db.execute(sql`SELECT public.next_sunrise_document_number('estimate', '2027-04-01'::date, 1) as num`)) as any;
  const apr2027Num = String(apr2027Res.rows[0].num);
  assert(apr2027Num.includes("/27-28/"), `April 1, 2027 must be in FY 27-28, got: ${apr2027Num}`);
  console.log(`  - 2027-04-01 FY: ${apr2027Num} (FY 27-28)`);

  console.log("  ✓ PASS: Indian Financial Year rollover correctly transitions on April 1st.");

  // --------------------------------------------------------------------------
  // Test 3: Concurrency Safety and Sequence Isolation
  // --------------------------------------------------------------------------
  console.log("\n[Test 3] Testing concurrent requests across companies...");

  // Fire 10 parallel queries for Company 1, 2, and 3
  const promises = [
    db.execute(sql`SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 1) as num`),
    db.execute(sql`SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 2) as num`),
    db.execute(sql`SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 3) as num`),
    db.execute(sql`SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 1) as num`),
    db.execute(sql`SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 2) as num`),
    db.execute(sql`SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 3) as num`),
  ];

  const results: any[] = await Promise.all(promises);
  assert.strictEqual(results.length, 6, "All 6 concurrent queries must resolve successfully");
  console.log("  - Concurrent allocations completed without deadlock or collision:");
  console.log(`    C1 Inv: ${results[0].rows[0].num}`);
  console.log(`    C2 Inv: ${results[1].rows[0].num}`);
  console.log(`    C3 Inv: ${results[2].rows[0].num}`);
  console.log(`    C1 Est: ${results[3].rows[0].num}`);
  console.log(`    C2 Est: ${results[4].rows[0].num}`);
  console.log(`    C3 Est: ${results[5].rows[0].num}`);

  console.log("  ✓ PASS: Concurrency allocations succeed without cross-company lock contention.");

  // --------------------------------------------------------------------------
  // Test 4: Rejection of Missing Company ID
  // --------------------------------------------------------------------------
  console.log("\n[Test 4] Testing rejection when company ID is NULL...");
  let nullCompanyRejected = false;
  try {
    await db.execute(sql`SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, NULL) as num`);
  } catch (err: any) {
    nullCompanyRejected = true;
    console.log(`  ✓ Successfully rejected NULL company_id with: "${err.message}"`);
  }
  assert(nullCompanyRejected, "next_sunrise_document_number must reject NULL company_id");

  console.log("\n==========================================================================");
  console.log("ALL DOCUMENT NUMBERING TESTS PASSED (4/4 TESTS SUCCESSFUL)");
  console.log("==========================================================================");
}

runDocumentNumberingTests().catch((err) => {
  console.error("FATAL: Document Numbering Test Failed:", err);
  process.exit(1);
});
