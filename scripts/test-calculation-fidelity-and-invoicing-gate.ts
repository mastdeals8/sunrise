import assert from "node:assert/strict";
import { calculateEstimateRowValues, calculateServiceChargeRowValues, calculateEstimateTotals } from "../client/src/pages/operations/utils/estimateCalculations";
import { validateEstimateItemsBatch } from "../shared/validation";

async function runQualityGateCalculationsSuite() {
  console.log("==========================================================================");
  console.log("RUNNING QUALITY GATE: ESTIMATE CALCULATION FIDELITY & ROUNDING SUITE");
  console.log("==========================================================================");

  // --------------------------------------------------------------------------
  // Test 1: Supported Units & Formulas
  // --------------------------------------------------------------------------
  console.log("\n[Test 1] Testing all 5 supported unit types and dimensions formulas...");

  // 1.1 Feet (W x H x Qty x Rate)
  // 12.5 ft wide x 4.0 ft high x 2 units @ ₹120/sqft = 100 sqft @ ₹120 = ₹12,000.00
  const calcFeet = calculateEstimateRowValues("feet", 12.5, 4.0, 2, 120, 18, "CGST+SGST", "feet");
  assert.equal(calcFeet.amount, "12000.00", "Feet calculation should be exactly 12,000.00");
  assert.equal(calcFeet.cgstAmount, "1080.00", "CGST 9% should be 1,080.00");
  assert.equal(calcFeet.sgstAmount, "1080.00", "SGST 9% should be 1,080.00");
  assert.equal(calcFeet.totalAmount, "14160.00", "Total with 18% GST should be 14,160.00");
  console.log("  ✓ 1. Feet unit formula verified: 12.5w x 4.0h x 2qty @ ₹120 = ₹12,000 + 18% GST = ₹14,160.00");

  // 1.2 Inch / Sqft ((W x H x Qty) / 144 x Rate)
  // 36 in wide x 24 in high x 3 units = 2592 / 144 = 18 sqft @ ₹250/sqft = ₹4,500.00
  const calcInch = calculateEstimateRowValues("inch", 36, 24, 3, 250, 18, "IGST", "inch");
  assert.equal(calcInch.amount, "4500.00", "Inch to Sqft calculation should be exactly 4,500.00");
  assert.equal(calcInch.igstAmount, "810.00", "IGST 18% should be 810.00");
  assert.equal(calcInch.totalAmount, "5310.00", "Total with 18% IGST should be 5,310.00");
  console.log("  ✓ 2. Inch/Sqft unit formula verified: 36w x 24h x 3qty (18 sqft) @ ₹250 = ₹4,500 + 18% IGST = ₹5,310.00");

  // 1.3 Running Inch (Height x Qty x Rate, W ignored)
  // Height = 18 inches, Qty = 12 letters @ ₹45/inch = ₹9,720.00
  const calcRInch = calculateEstimateRowValues("running_inch", 0, 18, 12, 45, 18, "CGST+SGST", "running_inch");
  assert.equal(calcRInch.amount, "9720.00", "Running inch calculation should be exactly 9,720.00");
  assert.equal(calcRInch.cgstAmount, "874.80", "CGST 9% should be 874.80");
  assert.equal(calcRInch.sgstAmount, "874.80", "SGST 9% should be 874.80");
  assert.equal(calcRInch.totalAmount, "11469.60", "Total with 18% GST should be 11,469.60");
  console.log("  ✓ 3. Running Inch formula verified: 18h x 12qty @ ₹45 = ₹9,720 + 18% GST = ₹11,469.60");

  // 1.4 Piece / Nos / Fixed (Qty x Rate)
  // 5 pieces @ ₹3,200/piece = ₹16,000.00
  const calcPiece = calculateEstimateRowValues("fixed", 0, 0, 5, 3200, 18, "CGST+SGST", "nos");
  assert.equal(calcPiece.amount, "16000.00", "Piece calculation should be exactly 16,000.00");
  assert.equal(calcPiece.totalAmount, "18880.00", "Total with 18% GST should be 18,880.00");
  console.log("  ✓ 4. Piece/Nos formula verified: 5qty @ ₹3,200 = ₹16,000 + 18% GST = ₹18,880.00");

  // 1.5 Percentage-based Service Charges (Packing & Installation)
  // Material total = ₹42,220.00; Packing @ 4% = ₹1,688.80
  const materialSubtotal = 42220;
  const calcPacking = calculateServiceChargeRowValues("4%", materialSubtotal, 18, "CGST+SGST");
  assert.equal(calcPacking.amount, "1688.80", "4% Packing on ₹42,220 should be 1,688.80");
  assert.equal(calcPacking.totalAmount, "1992.78", "Packing with GST should be 1,992.78");

  // Installation @ 7% = ₹2,955.40
  const calcInstall = calculateServiceChargeRowValues("7%", materialSubtotal, 18, "CGST+SGST");
  assert.equal(calcInstall.amount, "2955.40", "7% Installation on ₹42,220 should be 2,955.40");
  assert.equal(calcInstall.totalAmount, "3487.37", "Installation with GST should be 3,487.37");
  console.log("  ✓ 5. Service charge percentage formulas verified: 4% Packing (₹1,688.80), 7% Installation (₹2,955.40)");

  // --------------------------------------------------------------------------
  // Test 2: Aggregate Totals, Tax Split & Rounding Precision
  // --------------------------------------------------------------------------
  console.log("\n[Test 2] Testing multi-line aggregate totals and tax split...");

  const allItems = [
    { amount: calcFeet.amount, cgstAmount: calcFeet.cgstAmount, sgstAmount: calcFeet.sgstAmount, igstAmount: "0" },
    { amount: calcInch.amount, cgstAmount: "0", sgstAmount: "0", igstAmount: calcInch.igstAmount },
    { amount: calcRInch.amount, cgstAmount: calcRInch.cgstAmount, sgstAmount: calcRInch.sgstAmount, igstAmount: "0" },
    { amount: calcPiece.amount, cgstAmount: calcPiece.cgstAmount, sgstAmount: calcPiece.sgstAmount, igstAmount: "0" },
  ];

  const totals = calculateEstimateTotals(allItems, "4", "7", "1500");
  // Subtotal = 12000 + 4500 + 9720 + 16000 = 42220
  assert.equal(totals.subtotal, 42220, "Material subtotal must be exactly 42,220.00");

  // Base amount = 42220 + 4% (1688.8) + 7% (2955.4) + 1500 transport = 48364.20
  // Final Tax (18% on base) = 48364.20 * 0.18 = 8705.556
  // Grand Total = 48364.20 + 8705.556 = 57069.756
  const grandTotalRounded = Math.round((totals.grandTotal + Number.EPSILON) * 100) / 100;
  assert.equal(grandTotalRounded, 57069.76, "Grand total with packing, implementation, and transport should be ₹57,069.76");
  console.log(`  ✓ Subtotal: ₹${totals.subtotal.toFixed(2)}, Tax: ₹${totals.tax.toFixed(2)}, Grand Total: ₹${grandTotalRounded.toFixed(2)}`);

  // --------------------------------------------------------------------------
  // Test 3: Zero / Negative Value Guards
  // --------------------------------------------------------------------------
  console.log("\n[Test 3] Testing negative rates and zero dimension validation guards...");

  const invalidBatch = [
    { sl: 1, element: "Item 1", rate: "-50", quantity: 1 },
    { sl: 2, element: "Item 2", rate: "100", quantity: "-2" },
  ];
  const validation = validateEstimateItemsBatch(invalidBatch as any);
  assert.equal(validation.valid, false, "Batch validation must fail on negative rate and qty");
  assert.ok(validation.errors.some(e => e.includes("Row 1") && e.includes("Rate cannot be negative")));
  assert.ok(validation.errors.some(e => e.includes("Row 2") && e.includes("Quantity must be greater than 0")));
  console.log("  ✓ Negative rates and zero/negative quantities strictly rejected with row attribution.");

  // Running inch with height = 0
  const rInchZeroHeight = calculateEstimateRowValues("running_inch", 10, 0, 5, 50, 18, "CGST+SGST", "running_inch");
  assert.equal(rInchZeroHeight.amount, "0.00", "Running inch with H=0 must yield 0 amount");
  assert.ok(rInchZeroHeight.validationError?.includes("requires H"), "Running inch must flag missing height");
  console.log("  ✓ Running inch with zero height safely zeroed and flagged.");

  console.log("\n==========================================================================");
  console.log("QUALITY GATE: ALL ESTIMATE CALCULATION CHECKS PASSED (3/3 TESTS SUCCESSFUL)");
  console.log("==========================================================================");
}

runQualityGateCalculationsSuite().catch((err) => {
  console.error("Quality gate calculation test failed:", err);
  process.exit(1);
});
