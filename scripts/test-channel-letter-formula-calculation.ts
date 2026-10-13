import { calculateRowValues } from "../client/src/pages/operations/utils/calculations";
import { calculateEstimateRowValues } from "../client/src/pages/operations/utils/estimateCalculations";
import { pool } from "../server/db";

let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${desc}${extra ? ` - ${extra}` : ""}`);
    failed++;
  }
}

async function runTests() {
  console.log("==================================================================");
  console.log("    CHANNEL LETTER WITH LED FORMULA CALCULATION REGRESSION TESTS   ");
  console.log("==================================================================");

  // -------------------------------------------------------------------------
  // TEST 1: Channel Letter with LED exact formula: (H × Letters × Q) × Rate
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 1] CHANNEL LETTER WITH LED FORMULA: (H × Letters × Q) × Rate");

  // Case A: 1 set of 12 letters, H = 4 inches, Rate = 300, GST = 18%
  // Formula: (4 × 12 × 1) × 300 = 14,400.00
  // CGST 9% = 1,296.00, SGST 9% = 1,296.00, Total = 16,992.00
  {
    const res = calculateRowValues("running_inch", 12, 4, 1, 300, 18, "CGST+SGST", "inch");
    assert("calculateRowValues: W=12, H=4, Q=1, Rate=300 -> Amount = 14400.00", res.amount === "14400.00", `Got ${res.amount}`);
    assert("calculateRowValues: CGST is 1296.00", res.cgstAmount === "1296.00", `Got ${res.cgstAmount}`);
    assert("calculateRowValues: SGST is 1296.00", res.sgstAmount === "1296.00", `Got ${res.sgstAmount}`);
    assert("calculateRowValues: Total is 16992.00", res.totalAmount === "16992.00", `Got ${res.totalAmount}`);
    assert("calculateRowValues: validationError is undefined", res.validationError === undefined);
  }

  {
    const resEst = calculateEstimateRowValues("running_inch", 12, 4, 1, 300, 18, "CGST+SGST", "inch");
    assert("calculateEstimateRowValues: W=12, H=4, Q=1, Rate=300 -> Amount = 14400.00", resEst.amount === "14400.00", `Got ${resEst.amount}`);
    assert("calculateEstimateRowValues: Total is 16992.00", resEst.totalAmount === "16992.00", `Got ${resEst.totalAmount}`);
    assert("calculateEstimateRowValues: validationError is undefined", resEst.validationError === undefined);
  }

  // Case B: unit = "running_inch" also works identically
  {
    const resUnit = calculateRowValues("running_inch", 8, 4, 1, 300, 18, "CGST+SGST", "running_inch");
    assert("running_inch with unit='running_inch': W=8, H=4, Q=1, Rate=300 -> Amount = 9600.00", resUnit.amount === "9600.00", `Got ${resUnit.amount}`);
    assert("running_inch with unit='running_inch': Total is 11328.00", resUnit.totalAmount === "11328.00", `Got ${resUnit.totalAmount}`);
  }

  // Case C: Multiplier quantity (Q = 2 sets of 12 letters)
  // (4 × 12 × 2) × 300 = 28,800.00
  {
    const resMulti = calculateEstimateRowValues("running_inch", 12, 4, 2, 300, 18, "CGST+SGST", "inch");
    assert("Multi-qty running inch: W=12, H=4, Q=2, Rate=300 -> Amount = 28800.00", resMulti.amount === "28800.00", `Got ${resMulti.amount}`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Missing formula input validation (No silent fallback to Qty × Rate)
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 2] MISSING FORMULA INPUT: NO SILENT FALLBACK TO QTY × RATE");

  // Screenshot reproduction: W = 0, H = 4, Qty = 12, Rate = 300
  // Previous bug: silently calculated Qty × Rate = 12 × 300 = 3600.00, Total = 4248.00!
  // Correct behavior: Amount = 0.00, validationError is flagged!
  {
    const resMissingW = calculateRowValues("running_inch", 0, 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("W=0 does NOT fall back to Qty*Rate (3600); Amount is 0.00", resMissingW.amount === "0.00", `Got ${resMissingW.amount}`);
    assert("W=0 Total is 0.00", resMissingW.totalAmount === "0.00", `Got ${resMissingW.totalAmount}`);
    assert("W=0 flags clear validation message", typeof resMissingW.validationError === "string" && resMissingW.validationError.includes("Letters"), `Got ${resMissingW.validationError}`);

    const resEstMissingW = calculateEstimateRowValues("running_inch", 0, 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateEstimateRowValues W=0 Amount is 0.00", resEstMissingW.amount === "0.00", `Got ${resEstMissingW.amount}`);
    assert("calculateEstimateRowValues W=0 flags validation message", Boolean(resEstMissingW.validationError));
  }

  // Missing H (Height): W = 12, H = 0, Qty = 1, Rate = 300
  {
    const resMissingH = calculateRowValues("running_inch", 12, 0, 1, 300, 18, "CGST+SGST", "inch");
    assert("H=0 does NOT fall back to Qty*Rate; Amount is 0.00", resMissingH.amount === "0.00", `Got ${resMissingH.amount}`);
    assert("H=0 flags clear validation message", Boolean(resMissingH.validationError));
  }

  // -------------------------------------------------------------------------
  // TEST 3: Existing Qty × Rate rule (piece-based products)
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 3] EXISTING QTY × RATE RULES UNCHANGED");

  // Piece products: unit="nos", rate=500, qty=10
  {
    const resNos = calculateRowValues("fixed", 0, 0, 10, 500, 18, "CGST+SGST", "nos");
    assert("unit='nos': Qty=10, Rate=500 -> Amount = 5000.00", resNos.amount === "5000.00", `Got ${resNos.amount}`);
    assert("unit='nos': Total is 5900.00", resNos.totalAmount === "5900.00", `Got ${resNos.totalAmount}`);
  }

  // Piece products: unit="job", rate=1200, qty=2
  {
    const resJob = calculateEstimateRowValues("fixed", 0, 0, 2, 1200, 18, "CGST+SGST", "job");
    assert("unit='job': Qty=2, Rate=1200 -> Amount = 2400.00", resJob.amount === "2400.00", `Got ${resJob.amount}`);
  }

  // Piece products: unit="pcs", rate=250, qty=4
  {
    const resPcs = calculateEstimateRowValues("fixed", 0, 0, 4, 250, 18, "CGST+SGST", "pcs");
    assert("unit='pcs': Qty=4, Rate=250 -> Amount = 1000.00", resPcs.amount === "1000.00", `Got ${resPcs.amount}`);
  }

  // Zero-dimension standard product with calcType="fixed": qty * rate
  {
    const resZeroDim = calculateRowValues("fixed", 0, 0, 5, 200, 18, "CGST+SGST", "unit");
    assert("Zero dimensions fixed product: Qty=5, Rate=200 -> Amount = 1000.00", resZeroDim.amount === "1000.00", `Got ${resZeroDim.amount}`);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Other calculation rules: sqft, feet, percentage
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 4] OTHER CALCULATION RULES UNCHANGED");

  // Sqft area-based: W=120 in, H=48 in, Qty=2, Rate=50
  // Sqft = (120 × 48 × 2) / 144 = 80 sqft -> 80 × 50 = 4,000.00
  {
    const resSqft = calculateRowValues("sqft", 120, 48, 2, 50, 18, "CGST+SGST", "sqft");
    assert("sqft formula (W*H*Q/144)*Rate: 120x48 in, Q=2, Rate=50 -> Amount = 4000.00", resSqft.amount === "4000.00", `Got ${resSqft.amount}`);
    assert("sqft total: 4720.00", resSqft.totalAmount === "4720.00", `Got ${resSqft.totalAmount}`);
  }

  // Feet-based dimensions: W=10 ft, H=4 ft, Qty=2, Rate=50 -> 10 × 4 × 2 × 50 = 4,000.00
  {
    const resFeet = calculateEstimateRowValues("sqft", 10, 4, 2, 50, 18, "CGST+SGST", "feet");
    assert("feet formula (W*H*Q)*Rate: 10x4 ft, Q=2, Rate=50 -> Amount = 4000.00", resFeet.amount === "4000.00", `Got ${resFeet.amount}`);
  }

  // Percentage service charge
  {
    const resPct = calculateRowValues("percentage", 0, 0, 1, 5, 18, "CGST+SGST", "percentage");
    assert("percentage rule: Rate=5 -> Amount = 5.00", resPct.amount === "5.00", `Got ${resPct.amount}`);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Database historical audit check
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 5] HISTORICAL DATABASE ESTIMATES AUDIT");
  const affected = await pool.query(
    "SELECT id, estimate_id, sl, item_name, product_id, width, height, quantity, unit, calculation_type, rate, total_price, total_amount FROM estimate_items WHERE calculation_type = 'running_inch' AND width = 0"
  );
  assert("Database audit correctly identifies affected zero-width running inch rows", affected.rows.length >= 1);
  if (affected.rows.length > 0) {
    const row = affected.rows[0];
    console.log(`    -> Affected record: Estimate #${row.estimate_id}, Row #${row.sl} ("${row.item_name}"), saved total_price: ₹${row.total_price}`);
  }

  await pool.end();

  console.log("\n==================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
