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
  console.log("    CHANNEL LETTER WITH LED: Height × Qty × Rate REGRESSION TESTS ");
  console.log("==================================================================");

  // -------------------------------------------------------------------------
  // TEST 1: Required formula: Amount = Height × Qty × Rate (W optional / 0 / blank)
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 1] REQUIRED FORMULA: Amount = Height × Qty × Rate");

  // Case 1A: W = blank (0 / NaN), H = 4, Qty = 12, Rate = 300 -> Amount = 14400.00
  {
    const resBlankW = calculateRowValues("running_inch", Number(""), 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateRowValues: W=blank, H=4, Qty=12, Rate=300 -> Amount = 14400.00", resBlankW.amount === "14400.00", `Got ${resBlankW.amount}`);
    assert("calculateRowValues: CGST is 1296.00", resBlankW.cgstAmount === "1296.00", `Got ${resBlankW.cgstAmount}`);
    assert("calculateRowValues: SGST is 1296.00", resBlankW.sgstAmount === "1296.00", `Got ${resBlankW.sgstAmount}`);
    assert("calculateRowValues: Total is 16992.00", resBlankW.totalAmount === "16992.00", `Got ${resBlankW.totalAmount}`);
    assert("calculateRowValues: validationError is undefined", resBlankW.validationError === undefined);

    const resEstBlankW = calculateEstimateRowValues("running_inch", Number(""), 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateEstimateRowValues: W=blank, H=4, Qty=12, Rate=300 -> Amount = 14400.00", resEstBlankW.amount === "14400.00", `Got ${resEstBlankW.amount}`);
    assert("calculateEstimateRowValues: Total is 16992.00", resEstBlankW.totalAmount === "16992.00", `Got ${resEstBlankW.totalAmount}`);
    assert("calculateEstimateRowValues: validationError is undefined", resEstBlankW.validationError === undefined);
  }

  // Case 1B: W = 0, H = 4, Qty = 12, Rate = 300 -> Amount = 14400.00
  {
    const resZeroW = calculateRowValues("running_inch", 0, 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateRowValues: W=0, H=4, Qty=12, Rate=300 -> Amount = 14400.00", resZeroW.amount === "14400.00", `Got ${resZeroW.amount}`);
    assert("calculateRowValues: validationError is undefined", resZeroW.validationError === undefined);

    const resEstZeroW = calculateEstimateRowValues("running_inch", 0, 4, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateEstimateRowValues: W=0, H=4, Qty=12, Rate=300 -> Amount = 14400.00", resEstZeroW.amount === "14400.00", `Got ${resEstZeroW.amount}`);
    assert("calculateEstimateRowValues: validationError is undefined", resEstZeroW.validationError === undefined);
  }

  // Case 1C: Unit = "running_inch" also works identically
  {
    const resUnit = calculateRowValues("running_inch", 0, 8, 2, 300, 18, "CGST+SGST", "running_inch");
    assert("unit='running_inch': H=8, Qty=2, Rate=300 -> Amount = 4800.00", resUnit.amount === "4800.00", `Got ${resUnit.amount}`);
    assert("unit='running_inch': Total is 5664.00", resUnit.totalAmount === "5664.00", `Got ${resUnit.totalAmount}`);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Missing H (Height) validation: No silent fallback
  // -------------------------------------------------------------------------
  console.log("\n>>> [TEST 2] MISSING H VALIDATION: NO SILENT FALLBACK");

  // H = 0, Qty = 12, Rate = 300
  // Must NOT fall back to Qty × Rate = 12 × 300 = 3600; Amount must be 0.00 and validationError flagged
  {
    const resZeroH = calculateRowValues("running_inch", 0, 0, 12, 300, 18, "CGST+SGST", "inch");
    assert("H=0 does NOT fall back to Qty*Rate (3600); Amount is 0.00", resZeroH.amount === "0.00", `Got ${resZeroH.amount}`);
    assert("H=0 Total is 0.00", resZeroH.totalAmount === "0.00", `Got ${resZeroH.totalAmount}`);
    assert("H=0 flags clear validation message containing Height", typeof resZeroH.validationError === "string" && resZeroH.validationError.includes("Height"), `Got ${resZeroH.validationError}`);

    const resEstZeroH = calculateEstimateRowValues("running_inch", 0, 0, 12, 300, 18, "CGST+SGST", "inch");
    assert("calculateEstimateRowValues H=0 Amount is 0.00", resEstZeroH.amount === "0.00", `Got ${resEstZeroH.amount}`);
    assert("calculateEstimateRowValues H=0 flags validation message", Boolean(resEstZeroH.validationError));
  }

  // H = blank (NaN), Qty = 12, Rate = 300
  {
    const resBlankH = calculateRowValues("running_inch", 0, Number(""), 12, 300, 18, "CGST+SGST", "inch");
    assert("H=blank does NOT fall back to Qty*Rate; Amount is 0.00", resBlankH.amount === "0.00", `Got ${resBlankH.amount}`);
    assert("H=blank flags clear validation message", Boolean(resBlankH.validationError));
  }

  // -------------------------------------------------------------------------
  // TEST 3: Existing Qty × Rate rules (piece-based products) unchanged
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
  // TEST 4: Other calculation rules: sqft, feet, percentage unchanged
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
  assert("Database audit correctly identifies zero-width running inch rows", affected.rows.length >= 1);
  if (affected.rows.length > 0) {
    const row = affected.rows[0];
    console.log(`    -> Historical record: Estimate #${row.estimate_id}, Row #${row.sl} ("${row.item_name}"), saved total_price: ₹${row.total_price}`);
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
