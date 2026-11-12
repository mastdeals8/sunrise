import { pool } from "../server/db";
import fs from "fs";
import path from "path";

async function runDatabaseHardeningTestSuite() {
  console.log("=================================================================");
  console.log("PROJECT COSTING DATABASE HARDENING — VERIFICATION TEST SUITE");
  console.log("=================================================================\n");

  const client = await pool.connect();

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}${detail ? ` (${detail})` : ""}`);
      failedTests++;
    }
  }

  async function expectError(
    testName: string,
    operation: () => Promise<any>,
    errorMatcher: (err: any) => boolean
  ) {
    await client.query("SAVEPOINT expect_err_sp");
    let failedAsExpected = false;
    let actualError: any = null;
    try {
      await operation();
    } catch (err: any) {
      actualError = err;
      failedAsExpected = errorMatcher(err);
      await client.query("ROLLBACK TO SAVEPOINT expect_err_sp");
    } finally {
      await client.query("RELEASE SAVEPOINT expect_err_sp").catch(() => {});
    }
    assert(
      failedAsExpected,
      testName,
      actualError ? actualError.message : "expected error but operation succeeded"
    );
  }

  try {
    await client.query("BEGIN");
    console.log("[Setup] Started atomic test transaction (will ROLLBACK on completion).");

    // 1. DDL Migration 0015 & 0016
    console.log("\n[Step 1] Applying Migration 0015 (base tables) & 0016 (hardening)...");
    const migration0015 = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0015_master_project_costing.sql"),
      "utf-8"
    );
    await client.query(migration0015);

    const migration0016 = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0016_project_costing_hardening.sql"),
      "utf-8"
    );
    await client.query(migration0016);
    console.log("  ✓ Migrations 0015 and 0016 executed cleanly in sequence.");

    // Verify column types in information_schema
    const colTypes = await client.query(`
      SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name IN ('master_projects', 'project_cost_allocations', 'contractor_work_orders')
        AND column_name IN ('target_budget', 'budget_revenue', 'base_amount', 'gst_rate', 'total_amount', 'committed_amount', 'approved_variation_amount')
      ORDER BY table_name, column_name;
    `);

    for (const r of colTypes.rows) {
      assert(
        r.data_type === "numeric",
        `Column ${r.table_name}.${r.column_name} is NUMERIC`,
        `got ${r.data_type}`
      );
    }

    // 2. Fetch real test fixtures
    const clientRows = await client.query(`SELECT id, company_id, name FROM clients LIMIT 2;`);
    const estRows = await client.query(`SELECT id, company_id, client_id, estimate_number, total_amount FROM estimates WHERE company_id = 1 LIMIT 3;`);
    
    if (clientRows.rows.length === 0 || estRows.rows.length < 2) {
      throw new Error("Insufficient fixture data in DB to run hardening test suite");
    }

    const testClient1 = clientRows.rows[0];
    const testEst1 = estRows.rows[0];
    const testEst2 = estRows.rows[1];

    // Ensure testEst1 belongs to testClient1 for project linking tests
    await client.query(`UPDATE estimates SET client_id = ${testClient1.id} WHERE id = ${testEst1.id};`);

    // =========================================================================
    // TEST SECTION A: Archived Estimate Relinking & Audit Preservation
    // =========================================================================
    console.log("\n[Test Section A] Archived Estimate Relinking & Audit Preservation");

    // A1: Create Project Alpha
    const p1 = await client.query(`
      INSERT INTO master_projects (company_id, client_id, project_code, name, status, target_budget)
      VALUES (1, ${testClient1.id}, 'PRJ-ALPHA', 'Project Alpha', 'active', 50000.00)
      RETURNING id;
    `);
    const projAlphaId = p1.rows[0].id;

    // Link testEst1 to Project Alpha
    await client.query(`
      INSERT INTO project_estimates (company_id, project_id, estimate_id, status)
      VALUES (1, ${projAlphaId}, ${testEst1.id}, 'active');
    `);
    assert(true, "Linked Estimate 1 to active Project Alpha");

    // A2: Create Project Beta
    const p2 = await client.query(`
      INSERT INTO master_projects (company_id, client_id, project_code, name, status, target_budget)
      VALUES (1, ${testClient1.id}, 'PRJ-BETA', 'Project Beta', 'active', 60000.00)
      RETURNING id;
    `);
    const projBetaId = p2.rows[0].id;

    // A3: Attempt to link testEst1 to Project Beta while Project Alpha is active -> MUST FAIL
    await expectError(
      "Blocked linking Estimate 1 to Project Beta while Project Alpha is active",
      () =>
        client.query(`
          INSERT INTO project_estimates (company_id, project_id, estimate_id, status)
          VALUES (1, ${projBetaId}, ${testEst1.id}, 'active');
        `),
      (err) => err.message.includes("uq_active_project_estimate") || err.message.includes("already actively linked")
    );

    // A4: Archive Project Alpha -> Trigger should sync project_estimates.status = 'archived'
    await client.query(`
      UPDATE master_projects SET status = 'archived' WHERE id = ${projAlphaId};
    `);
    const linkStatusAlpha = await client.query(`
      SELECT status FROM project_estimates WHERE project_id = ${projAlphaId} AND estimate_id = ${testEst1.id};
    `);
    assert(
      linkStatusAlpha.rows[0].status === "archived",
      "Archiving Project Alpha automatically transitioned project_estimates.status to 'archived'"
    );

    // A5: Now link testEst1 to Project Beta -> MUST SUCCEED
    await client.query(`
      INSERT INTO project_estimates (company_id, project_id, estimate_id, status)
      VALUES (1, ${projBetaId}, ${testEst1.id}, 'active');
    `);
    assert(true, "Successfully relinked Estimate 1 to Project Beta after Project Alpha was archived");

    // A6: Verify historical audit trail preserves both links
    const auditRows = await client.query(`
      SELECT project_id, estimate_id, status FROM project_estimates 
      WHERE estimate_id = ${testEst1.id} 
      ORDER BY id;
    `);
    assert(
      auditRows.rows.length === 2 &&
      auditRows.rows[0].status === "archived" && auditRows.rows[0].project_id === projAlphaId &&
      auditRows.rows[1].status === "active" && auditRows.rows[1].project_id === projBetaId,
      "Historical audit trail preserves both archived and active project links"
    );

    // A7: Attempt to unarchive Project Alpha while Estimate 1 is active on Project Beta -> MUST FAIL
    await expectError(
      "Blocked unarchiving Project Alpha while Estimate 1 is actively linked to Project Beta",
      () =>
        client.query(`
          UPDATE master_projects SET status = 'active' WHERE id = ${projAlphaId};
        `),
      (err) =>
        err.message.includes("Cannot unarchive Master Project") ||
        err.message.includes("uq_active_project_estimate") ||
        err.message.includes("already actively linked")
    );

    // A8: Unlink Estimate 1 from Project Beta (status = 'unlinked')
    await client.query(`
      UPDATE project_estimates 
      SET status = 'unlinked', unlinked_at = NOW() 
      WHERE project_id = ${projBetaId} AND estimate_id = ${testEst1.id};
    `);
    assert(true, "Unlinked Estimate 1 from Project Beta");

    // A9: Now unarchiving Project Alpha -> MUST SUCCEED
    await client.query(`
      UPDATE master_projects SET status = 'active' WHERE id = ${projAlphaId};
    `);
    const linkStatusAlphaRestored = await client.query(`
      SELECT status FROM project_estimates WHERE project_id = ${projAlphaId} AND estimate_id = ${testEst1.id};
    `);
    assert(
      linkStatusAlphaRestored.rows[0].status === "active",
      "Unarchiving Project Alpha successfully restored its active estimate link"
    );

    // =========================================================================
    // TEST SECTION B: Cross-Company and Cross-Client Ownership Guards
    // =========================================================================
    console.log("\n[Test Section B] Cross-Company and Cross-Client Ownership Guards");

    // Setup dummy Company 2 and Client for Company 2
    await client.query(`INSERT INTO companies (id, name) VALUES (999, 'Competitor Corp') ON CONFLICT (id) DO NOTHING;`);
    const c2Res = await client.query(`
      INSERT INTO clients (company_id, name) VALUES (999, 'Foreign Client') RETURNING id;
    `);
    const foreignClientId = c2Res.rows[0].id;

    // B1: Master Project with client belonging to Company 2 -> MUST FAIL
    await expectError(
      "Blocked Master Project with client belonging to another company",
      () =>
        client.query(`
          INSERT INTO master_projects (company_id, client_id, project_code, name, status)
          VALUES (1, ${foreignClientId}, 'PRJ-CROSS', 'Cross Company Project', 'active');
        `),
      (err) => err.message.toLowerCase().includes("belongs to company 999") || err.message.toLowerCase().includes("cross-company")
    );

    // B2: Link estimate of Client B to Project created for Client A -> MUST FAIL
    const otherClientRes = await client.query(`
      INSERT INTO clients (company_id, name) VALUES (1, 'Different Local Client') RETURNING id;
    `);
    const diffClientId = otherClientRes.rows[0].id;
    await client.query(`UPDATE estimates SET client_id = ${diffClientId} WHERE id = ${testEst2.id};`);

    await expectError(
      "Blocked linking estimate whose client differs from project's client",
      () =>
        client.query(`
          INSERT INTO project_estimates (company_id, project_id, estimate_id, status)
          VALUES (1, ${projAlphaId}, ${testEst2.id}, 'active');
        `),
      (err) => err.message.includes("Cross-client violation") || err.message.includes("does not match project client")
    );

    // B3: Cost allocation with mismatched company_id -> MUST FAIL
    await expectError(
      "Blocked cost allocation with mismatched company_id",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            999, ${projAlphaId}, 'manual', 1, 'REF-1',
            'materials', 'Test', 100.00, 18.00, 18.00, 118.00,
            100.00, 'active'
          );
        `),
      (err) => err.message.toLowerCase().includes("cross-company violation") || err.message.includes("belongs to Company 1")
    );

    // B4: Cost allocation referencing estimate NOT linked to project -> MUST FAIL
    await expectError(
      "Blocked cost allocation referencing unlinked estimate",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, estimate_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, ${testEst2.id}, 'manual', 1, 'REF-2',
            'materials', 'Test', 100.00, 18.00, 18.00, 118.00,
            100.00, 'active'
          );
        `),
      (err) => err.message.includes("Cross-project violation") || err.message.includes("is not actively linked to Master Project")
    );

    // =========================================================================
    // TEST SECTION C: Financial Precision NUMERIC(14, 2)
    // =========================================================================
    console.log("\n[Test Section C] Financial Precision (Exact Decimals)");

    const precisionTest = await client.query(`
      INSERT INTO project_cost_allocations (
        company_id, project_id, estimate_id, source_type, source_id, source_reference,
        cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
        recognised_cost, status
      ) VALUES (
        1, ${projAlphaId}, ${testEst1.id}, 'manual', 2, 'REF-PREC',
        'materials', 'Precision test', 1234567.89, 18.00, 222222.22, 1456790.11,
        1234567.89, 'active'
      ) RETURNING base_amount, gst_amount, total_amount;
    `);

    assert(
      precisionTest.rows[0].base_amount === "1234567.89" &&
      precisionTest.rows[0].gst_amount === "222222.22" &&
      precisionTest.rows[0].total_amount === "1456790.11",
      "NUMERIC(14, 2) preserves exact high-magnitude monetary decimals without floating-point inaccuracy"
    );

    // =========================================================================
    // TEST SECTION D: Source Allocation Integrity
    // =========================================================================
    console.log("\n[Test Section D] Source Allocation Integrity");

    // D1: Purchase invoice source must exist in invoices table
    await expectError(
      "Blocked cost allocation for non-existent purchase invoice",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'purchase_invoice', 99999999, 'INV-MISSING',
            'materials', 'Ghost Invoice', 500.00, 18.00, 90.00, 590.00,
            500.00, 'active'
          );
        `),
      (err) => err.message.includes("does not exist") || err.message.includes("not found")
    );

    // D2: Cancelled purchase invoice cannot be allocated
    const invRes = await client.query(`
      INSERT INTO invoices (
        company_id, client_id, invoice_number, party_name, type, status, amount, tax_amount, total_amount, date, due_date
      ) VALUES (
        1, ${testClient1.id}, 'PI-CANCEL-TEST', 'Supplier A', 'purchase', 'cancelled', 1000.00, 180.00, 1180.00, NOW(), NOW()
      ) RETURNING id;
    `);
    const cancelledInvId = invRes.rows[0].id;

    await expectError(
      "Blocked cost allocation from a cancelled purchase invoice",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'purchase_invoice', ${cancelledInvId}, 'PI-CANCEL-TEST',
            'materials', 'Cancelled Invoice', 500.00, 18.00, 90.00, 590.00,
            500.00, 'active'
          );
        `),
      (err) => err.message.toLowerCase().includes("cancelled purchase invoice")
    );

    // D3: Over-allocation prevention (total active allocations > invoice base)
    const validInvRes = await client.query(`
      INSERT INTO invoices (
        company_id, client_id, invoice_number, party_name, type, status, amount, tax_amount, total_amount, date, due_date
      ) VALUES (
        1, ${testClient1.id}, 'PI-VALID-TEST', 'Supplier B', 'purchase', 'approved', 1000.00, 180.00, 1180.00, NOW(), NOW()
      ) RETURNING id;
    `);
    const validInvId = validInvRes.rows[0].id;

    // First allocation: 800.00 (OK)
    await client.query(`
      INSERT INTO project_cost_allocations (
        company_id, project_id, source_type, source_id, source_reference,
        cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
        recognised_cost, status
      ) VALUES (
        1, ${projAlphaId}, 'purchase_invoice', ${validInvId}, 'PI-VALID-TEST',
        'materials', 'Part 1', 800.00, 18.00, 144.00, 944.00,
        800.00, 'active'
      );
    `);
    assert(true, "First allocation of ₹800 against ₹1000 invoice accepted");

    // Second allocation: 300.00 (Total 1100 > 1000 -> MUST FAIL)
    await expectError(
      "Over-allocation blocked: ₹800 + ₹300 = ₹1100 > ₹1000 limit",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'purchase_invoice', ${validInvId}, 'PI-VALID-TEST',
            'materials', 'Part 2', 300.00, 18.00, 54.00, 354.00,
            300.00, 'active'
          );
        `),
      (err) => err.message.toLowerCase().includes("exceeds purchase invoice base amount") || err.message.toLowerCase().includes("over-allocation")
    );

    // D4: Petty cash non-duplication
    const userRes = await client.query(`SELECT id FROM users LIMIT 1;`);
    const testUserId = userRes.rows[0]?.id || 1;
    const pcRes = await client.query(`
      INSERT INTO petty_cash_expenses (
        company_id, amount, status, category, expense_date, added_by
      ) VALUES (
        1, 250.00, 'approved', 'office_supplies', NOW(), ${testUserId}
      ) RETURNING id;
    `);
    const pcId = pcRes.rows[0].id;

    // First allocation of petty cash -> OK
    await client.query(`
      INSERT INTO project_cost_allocations (
        company_id, project_id, source_type, source_id, source_reference,
        cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
        recognised_cost, status
      ) VALUES (
        1, ${projAlphaId}, 'petty_cash', ${pcId}, 'PC-${pcId}',
        'petty_cash', 'Hardware', 250.00, 0.00, 0.00, 250.00,
        250.00, 'active'
      );
    `);
    assert(true, "Petty cash first allocation accepted");

    // Second active allocation of same petty cash -> MUST FAIL
    await expectError(
      "Duplicate active petty cash allocation blocked by partial unique index",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'petty_cash', ${pcId}, 'PC-${pcId}',
            'petty_cash', 'Hardware dup', 250.00, 0.00, 0.00, 250.00,
            250.00, 'active'
          );
        `),
      (err) => err.message.includes("uq_active_petty_cash_allocation") || err.message.includes("duplicate")
    );

    // =========================================================================
    // TEST SECTION E: Accounting & Check Constraints
    // =========================================================================
    console.log("\n[Test Section E] Accounting & Check Constraints");

    // E1: Negative budget
    await expectError(
      "Negative target budget rejected by CHECK constraint",
      () =>
        client.query(`
          INSERT INTO master_projects (company_id, client_id, project_code, name, status, target_budget)
          VALUES (1, ${testClient1.id}, 'PRJ-NEG', 'Neg Budget', 'active', -500.00);
        `),
      (err) => err.message.includes("chk_mp_target_budget")
    );

    // E2: Negative allocation amount
    await expectError(
      "Negative cost allocation base amount rejected by CHECK constraint",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'manual', 3, 'REF-NEG',
            'materials', 'Negative', -100.00, 0.00, 0.00, -100.00,
            -100.00, 'active'
          );
        `),
      (err) => err.message.includes("chk_pca_base_amount")
    );

    // E3: Cost allocation total mismatch (base + gst != total)
    await expectError(
      "Total amount mismatch (base + gst != total) rejected by CHECK constraint",
      () =>
        client.query(`
          INSERT INTO project_cost_allocations (
            company_id, project_id, source_type, source_id, source_reference,
            cost_category, description, base_amount, gst_rate, gst_amount, total_amount,
            recognised_cost, status
          ) VALUES (
            1, ${projAlphaId}, 'manual', 4, 'REF-MISMATCH',
            'materials', 'Mismatch', 100.00, 18.00, 18.00, 150.00,
            100.00, 'active'
          );
        `),
      (err) => err.message.includes("chk_pca_total_calc")
    );

    // E4: Contractor Work Order billed > committed + approved_variation
    const cwoRes = await client.query(`
      INSERT INTO contractor_work_orders (
        company_id, project_id, contractor_name, wo_number, work_category, scope_of_work,
        committed_amount, approved_variation_amount, billed_amount, status
      ) VALUES (
        1, ${projAlphaId}, 'Acme Builders', 'WO-TEST-001', 'fabrication', 'Carpentry',
        10000.00, 2000.00, 5000.00, 'in_progress'
      ) RETURNING id;
    `);
    const cwoId = cwoRes.rows[0].id;
    assert(true, "Contractor work order created with committed=₹10,000, variation=₹2,000, billed=₹5,000");

    await expectError(
      "Billed amount exceeding (committed + approved_variation) rejected by CHECK constraint",
      () =>
        client.query(`
          UPDATE contractor_work_orders SET billed_amount = 13000.00 WHERE id = ${cwoId};
        `),
      (err) => err.message.includes("chk_cwo_billing_limit")
    );

    // E5: Invalid status enum on master_projects
    await expectError(
      "Invalid master project status rejected by CHECK constraint",
      () =>
        client.query(`
          UPDATE master_projects SET status = 'bogus_status' WHERE id = ${projAlphaId};
        `),
      (err) => err.message.includes("chk_mp_status")
    );

    // E6: Invalid status enum on project_estimates
    await expectError(
      "Invalid project estimate status rejected by CHECK constraint",
      () =>
        client.query(`
          UPDATE project_estimates SET status = 'deleted' WHERE project_id = ${projAlphaId} AND estimate_id = ${testEst1.id};
        `),
      (err) => err.message.includes("chk_pe_status")
    );

    // Rollback atomic transaction
    await client.query("ROLLBACK");
    console.log("\n[Teardown] Transaction successfully ROLLED BACK. Production DB remains pristine.");

    console.log("\n=================================================================");
    console.log(`TEST SUITE COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log("=================================================================\n");

    if (failedTests > 0) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nFATAL TEST FAILURE:", err);
    process.exit(1);
  } finally {
    client.release();
  }
}

runDatabaseHardeningTestSuite().catch(console.error);
