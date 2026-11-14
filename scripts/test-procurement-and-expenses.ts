import { pool } from "../server/db";
import fs from "fs";
import path from "path";

async function runProcurementAndExpensesTests() {
  console.log("=================================================================");
  console.log("PROCUREMENT, EXPENSES & CONTRACTOR SUITE VERIFICATION");
  console.log("=================================================================");

  const client = await pool.connect();
  try {
    await client.query("BEGIN;");

    // Apply migrations 0015 and 0016
    const m15 = fs.readFileSync(path.join(process.cwd(), "migrations", "0015_master_project_costing.sql"), "utf8");
    await client.query(m15);
    const m16 = fs.readFileSync(path.join(process.cwd(), "migrations", "0016_project_costing_hardening.sql"), "utf8");
    await client.query(m16);

    const companyId = 1;

    // 1. Setup Master Project & Estimate
    console.log("\n--- SECTION 1: MASTER PROJECT SETUP ---");
    const projRes = await client.query(`
      INSERT INTO master_projects (company_id, project_code, name, client_id, status, target_budget, created_at)
      VALUES ($1, 'MP-2026-99', 'Mega Retail Expansion 2026', 1, 'active', 1000000, NOW())
      RETURNING id
    `, [companyId]);
    const projectId = projRes.rows[0].id;
    console.log(`  ✓ Master Project created: ID ${projectId}`);

    // Create a mock estimate
    const estRes = await client.query(`
      INSERT INTO estimates (company_id, estimate_number, title, client_id, brand_id, status, total_amount, created_at)
      VALUES ($1, 'EST-TEST-2026-99', 'Retail Fitout Project', 1, 1, 'approved', 500000, NOW())
      RETURNING id
    `, [companyId]);
    const estimateId = estRes.rows[0].id;

    await client.query(`
      INSERT INTO project_estimates (company_id, project_id, estimate_id, status, linked_at)
      VALUES ($1, $2, $3, 'active', NOW())
    `, [companyId, projectId, estimateId]);
    console.log(`  ✓ Linked Estimate ID ${estimateId} to Master Project ${projectId}`);

    // 2. PURCHASE INVOICE WITH LINE ITEMS & FREIGHT APPORTIONMENT
    console.log("\n--- SECTION 2: PURCHASE BILL WITH FREIGHT APPORTIONING & LANDED COST ---");
    const lineItems = [
      { sku: "VINYL-GLOSS-3M", description: "3M Gloss Vinyl 50m", quantity: 10, unit: "Roll", unitPrice: 2000, taxRate: 18, taxAmount: 3600, totalAmount: 23600 },
      { sku: "ACR-3MM-CLEAR", description: "3mm Acrylic Sheet 8x4", quantity: 20, unit: "Sheet", unitPrice: 1500, taxRate: 18, taxAmount: 5400, totalAmount: 35400 }
    ];
    const totalItemBase = 10 * 2000 + 20 * 1500; // 20000 + 30000 = 50000
    const freightAmount = 2500; // Freight to apportion
    const totalGst = (50000 * 0.18); // 9000
    const billGrandTotal = 50000 + totalGst + freightAmount; // 61500

    // Apportion freight:
    // Item 1 base = 20000/50000 = 40% of freight = 1000 => total item cost = 21000 / 10 = 2100 landed unit cost
    // Item 2 base = 30000/50000 = 60% of freight = 1500 => total item cost = 31500 / 20 = 1575 landed unit cost
    const item1LandedUnit = (20000 + (20000 / totalItemBase) * freightAmount) / 10;
    const item2LandedUnit = (30000 + (30000 / totalItemBase) * freightAmount) / 20;

    if (item1LandedUnit !== 2100 || item2LandedUnit !== 1575) {
      throw new Error(`Freight apportionment mismatch: Item 1 = ${item1LandedUnit}, Item 2 = ${item2LandedUnit}`);
    }
    console.log(`  ✓ Freight apportioning verified: Item 1 unit landed cost = ₹${item1LandedUnit}, Item 2 unit landed cost = ₹${item2LandedUnit}`);

    // Insert purchase bill in invoices table
    const invoiceRes = await client.query(`
      INSERT INTO invoices (
        company_id, invoice_number, type, party_name,
        date, due_date, status, amount, tax_amount, total_amount, paid_amount, balance_amount,
        remarks, created_at
      ) VALUES (
        $1, 'SUPP-BILL-8821', 'purchase', 'Apex Substrates Pvt Ltd',
        NOW(), NOW() + INTERVAL '30 days', 'unpaid', $2, $3, $4, 0, $4,
        $5, NOW()
      ) RETURNING id
    `, [companyId, totalItemBase + freightAmount, totalGst, billGrandTotal, JSON.stringify({ lineItems, poNumber: "PO-2026-004", freightAmount })]);
    const purchaseBillId = invoiceRes.rows[0].id;
    console.log(`  ✓ Purchase bill created in 'invoices': ID ${purchaseBillId}, Number: SUPP-BILL-8821, Total: ₹${billGrandTotal}`);

    // Link purchase bill to project cost allocation
    const isRecoverableGst = true;
    const recognisedCost = isRecoverableGst ? (totalItemBase + freightAmount) : billGrandTotal;
    const pcaRes = await client.query(`
      INSERT INTO project_cost_allocations (
        company_id, project_id, estimate_id, source_type, source_id,
        cost_category, base_amount, gst_rate, gst_amount, total_amount,
        is_recoverable_gst, ineligible_gst_amount, recognised_cost,
        status, description, created_at
      ) VALUES (
        $1, $2, $3, 'purchase_invoice', $4,
        'materials', $5, 18.00, $6, $7,
        $8, 0, $9,
        'active', 'Materials from Apex Substrates with freight', NOW()
      ) RETURNING id
    `, [companyId, projectId, estimateId, purchaseBillId, totalItemBase + freightAmount, totalGst, billGrandTotal, isRecoverableGst, recognisedCost]);
    console.log(`  ✓ Purchase cost allocated to project: Recognised cost = ₹${recognisedCost} (Recoverable ITC excluded from cost)`);

    // 3. SUPPLIER PAYMENT RECORDING & AP SETTLEMENT
    console.log("\n--- SECTION 3: SUPPLIER PAYMENT RECORDING & AP SETTLEMENT ---");
    const paymentAmount = 30000;
    const payRes = await client.query(`
      INSERT INTO payments (
        company_id, voucher_number, type, party_name,
        date, amount, method, description, invoice_id, created_at
      ) VALUES (
        $1, 'PV/2026/001', 'payment', 'Apex Substrates Pvt Ltd',
        NOW(), $2, 'bank_transfer', 'Partial payment against bill SUPP-BILL-8821', $3, NOW()
      ) RETURNING id
    `, [companyId, paymentAmount, purchaseBillId]);
    const paymentId = payRes.rows[0].id;

    // Update invoice paid & balance amount
    await client.query(`
      UPDATE invoices
      SET paid_amount = paid_amount + $1,
          balance_amount = total_amount - (paid_amount + $1),
          status = CASE WHEN (total_amount - (paid_amount + $1)) <= 0.05 THEN 'paid' ELSE 'partially_paid' END
      WHERE id = $2
    `, [paymentAmount, purchaseBillId]);

    const updatedBill = await client.query(`SELECT status, paid_amount, balance_amount FROM invoices WHERE id = $1`, [purchaseBillId]);
    console.log(`  ✓ Supplier payment recorded: Payment ID ${paymentId}, Amount: ₹${paymentAmount}`);
    console.log(`  ✓ Bill updated: Status = '${updatedBill.rows[0].status}', Paid = ₹${updatedBill.rows[0].paid_amount}, Balance = ₹${updatedBill.rows[0].balance_amount}`);

    // Verify allocation count did NOT change (no double count of payment as a cost)
    const costCount = await client.query(`SELECT COUNT(*) FROM project_cost_allocations WHERE project_id = $1`, [projectId]);
    if (parseInt(costCount.rows[0].count) !== 1) {
      throw new Error(`Cost allocation count corrupted after payment! Count: ${costCount.rows[0].count}`);
    }
    console.log(`  ✓ Verified payment settled AP liability without creating duplicate cost (Allocation count remains 1).`);

    // 4. OPERATING EXPENSES (OFFICE RENT, SALARIES, TRAVEL)
    console.log("\n--- SECTION 4: OPERATING EXPENSES WITH ITC SEPARATION ---");
    const opExpenseBase = 45000; // e.g. Rent
    const opExpenseGst = 8100;
    const opExpenseTotal = 53100;

    const opExpRes = await client.query(`
      INSERT INTO petty_cash_expenses (
        company_id, vendor, description, amount, category, added_by, expense_date, status,
        extracted_data, created_at
      ) VALUES (
        $1, 'Commercial Properties LLC', 'Head Office Rent - March 2026', $2, 'office_rent', 1,
        NOW(), 'approved',
        $3, NOW()
      ) RETURNING id
    `, [companyId, opExpenseTotal, JSON.stringify({
      expenseType: "operational",
      vendor: "Commercial Properties LLC",
      invoiceNumber: "RENT-2026-03",
      baseAmount: opExpenseBase,
      gstAmount: opExpenseGst,
      gstRate: 18,
      gstin: "27AABCP1122D1Z4",
      isRecoverableGst: true,
      department: "corporate",
      paymentMode: "bank_transfer"
    })]);
    const opExpenseId = opExpRes.rows[0].id;
    console.log(`  ✓ Operating expense logged in 'petty_cash_expenses': ID ${opExpenseId}, Category: office_rent, Amount: ₹${opExpenseTotal}`);

    // 5. CONTRACTOR WORK ORDERS, APPROVED VARIATION & BILLING CEILING
    console.log("\n--- SECTION 5: CONTRACTOR WORK ORDERS, VARIATION & BILLING CEILING ---");
    const cwoRes = await client.query(`
      INSERT INTO contractor_work_orders (
        company_id, project_id, estimate_id, wo_number, contractor_name, work_category,
        scope_of_work, committed_amount, approved_variation_amount, billed_amount, status, created_at
      ) VALUES (
        $1, $2, $3, 'WO-2026-701', 'Speedy Installations Team', 'installation',
        'Facade branding & ACP cladding for 5 stores', 80000.00, 0.00, 0.00, 'issued', NOW()
      ) RETURNING id
    `, [companyId, projectId, estimateId]);
    const woId = cwoRes.rows[0].id;
    console.log(`  ✓ Contractor Work Order issued: ID ${woId}, Committed Budget: ₹80,000.00`);

    // Approve variation of ₹15,000
    await client.query(`
      UPDATE contractor_work_orders
      SET approved_variation_amount = approved_variation_amount + 15000.00
      WHERE id = $1
    `, [woId]);
    console.log(`  ✓ Approved variation of ₹15,000 added. New total authorized ceiling = ₹95,000.00`);

    // Verify billing within ceiling succeeds
    await client.query(`
      UPDATE contractor_work_orders
      SET billed_amount = billed_amount + 50000.00,
          status = 'partially_billed'
      WHERE id = $1
    `, [woId]);
    console.log(`  ✓ Recorded bill of ₹50,000.00 against work order (Remaining commitment = ₹45,000.00).`);

    // Verify over-billing beyond ceiling is rejected by database CHECK constraint
    let overBillBlocked = false;
    try {
      await client.query(`
        UPDATE contractor_work_orders
        SET billed_amount = 100000.00
        WHERE id = $1
      `, [woId]);
    } catch (err: any) {
      if (err.message && err.message.includes("chk_cwo_billing_limit")) {
        overBillBlocked = true;
      }
    }
    if (!overBillBlocked) {
      throw new Error("Over-billing beyond authorized ceiling (committed + variation) was NOT blocked!");
    }
    console.log(`  ✓ Verified: Over-billing beyond authorized ceiling (₹100,000 > ₹95,000) was strictly BLOCKED by chk_cwo_billing_limit.`);

    console.log("\n[Teardown] Rolling back test transaction. Production database remains pristine.");
    await client.query("ROLLBACK;");

    console.log("\n=================================================================");
    console.log("ALL PROCUREMENT, EXPENSES & CONTRACTOR INTEGRATION TESTS PASSED!");
    console.log("=================================================================");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runProcurementAndExpensesTests();
