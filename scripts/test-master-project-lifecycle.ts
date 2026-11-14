import { pool } from "../server/db";
import fs from "fs";
import path from "path";

async function testLifecycle() {
  console.log("=================================================================");
  console.log("TESTING MASTER PROJECT ESTIMATE SELECTOR & LIFECYCLE");
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
    const clientId = 1; // Aditya Birla Lifestyle Brands Limited
    const brandId = 1;  // Peter England

    // 1. Query available estimates for Client 1 and Brand 1
    console.log("\n[Test 1] Querying available estimates for Client 1 (Aditya Birla) & Brand 1 (Peter England)...");
    const q1 = await client.query(`
      SELECT e.id, e.estimate_number, e.title, e.client_id, c.name as client_name, e.brand_id, b.name as brand_name,
             e.status, e.total_amount, e.subtotal, e.po_number, e.po_date, e.estimate_date, e.created_at,
             (SELECT COUNT(DISTINCT store_code) FROM estimate_items WHERE estimate_id = e.id) as item_store_count
      FROM estimates e
      LEFT JOIN clients c ON e.client_id = c.id
      LEFT JOIN brands b ON e.brand_id = b.id
      WHERE e.company_id = $1
        AND e.client_id = $2
        AND e.brand_id = $3
        AND e.id NOT IN (
          SELECT pe.estimate_id 
          FROM project_estimates pe
          INNER JOIN master_projects mp ON pe.project_id = mp.id
          WHERE pe.company_id = $1 AND pe.status = 'active' AND mp.status != 'archived'
        )
      ORDER BY e.id DESC
    `, [companyId, clientId, brandId]);

    console.log(`  ✓ Found ${q1.rows.length} candidate estimates for Peter England (Expected: 25).`);
    if (q1.rows.length !== 25) {
      throw new Error(`Expected 25 estimates for Brand 1, got ${q1.rows.length}`);
    }

    // 2. Query available estimates for Client 1 across ALL brands
    console.log("\n[Test 2] Querying available estimates for Client 1 across ALL brands...");
    const q2 = await client.query(`
      SELECT e.id, e.estimate_number, e.title, e.brand_id, b.name as brand_name, e.status, e.total_amount, e.po_number
      FROM estimates e
      LEFT JOIN brands b ON e.brand_id = b.id
      WHERE e.company_id = $1
        AND e.client_id = $2
        AND e.id NOT IN (
          SELECT pe.estimate_id 
          FROM project_estimates pe
          INNER JOIN master_projects mp ON pe.project_id = mp.id
          WHERE pe.company_id = $1 AND pe.status = 'active' AND mp.status != 'archived'
        )
      ORDER BY e.id DESC
    `, [companyId, clientId]);

    console.log(`  ✓ Found ${q2.rows.length} candidate estimates for Aditya Birla across all brands (Expected: 35).`);
    if (q2.rows.length !== 35) {
      throw new Error(`Expected 35 estimates for Client 1, got ${q2.rows.length}`);
    }

    // 3. Search query: Search for 'Diwali'
    console.log("\n[Test 3] Search filter test: search='Diwali'...");
    const q3 = await client.query(`
      SELECT e.id, e.estimate_number, e.title, e.po_number
      FROM estimates e
      WHERE e.company_id = $1
        AND e.client_id = $2
        AND (e.estimate_number ILIKE '%Diwali%' OR e.title ILIKE '%Diwali%' OR e.po_number ILIKE '%Diwali%')
      ORDER BY e.id DESC
    `, [companyId, clientId]);
    console.log(`  ✓ Found ${q3.rows.length} estimates matching 'Diwali'.`);
    if (q3.rows.length === 0) throw new Error("Expected Diwali estimates!");

    // 4. Search query: Search by exact PO '6010034676'
    console.log("\n[Test 4] Search filter test: search='6010034676' (PO number)...");
    const q4 = await client.query(`
      SELECT e.id, e.estimate_number, e.title, e.po_number
      FROM estimates e
      WHERE e.company_id = $1
        AND (e.estimate_number ILIKE '%6010034676%' OR e.title ILIKE '%6010034676%' OR e.po_number ILIKE '%6010034676%')
      ORDER BY e.id DESC
    `, [companyId]);
    console.log(`  ✓ Found ${q4.rows.length} estimate matching PO 6010034676 (Estimate #${q4.rows[0]?.estimate_number}, Title: "${q4.rows[0]?.title}").`);
    if (q4.rows.length !== 1) throw new Error("Expected exactly 1 estimate for PO 6010034676!");

    // 5. Create a Master Project linking Estimates 227 and 228
    console.log("\n[Test 5] Creating Master Project with Estimates 227 and 228 linked...");
    const mpRes = await client.query(`
      INSERT INTO master_projects (company_id, project_code, name, client_id, brand_id, status, target_budget, created_at)
      VALUES ($1, 'MP-PE-DIWALI-26', 'Peter England Festive Rollout 2026', 1, 1, 'active', 650000, NOW())
      RETURNING id
    `, [companyId]);
    const mpId = mpRes.rows[0].id;

    await client.query(`
      INSERT INTO project_estimates (company_id, project_id, estimate_id, status, linked_at)
      VALUES ($1, $2, 227, 'active', NOW()), ($1, $2, 228, 'active', NOW())
    `, [companyId, mpId]);
    console.log(`  ✓ Created Master Project ID ${mpId} and linked estimates 227 and 228.`);

    // 6. Verify single-active-project rule: estimates 227 and 228 must NO LONGER appear for a new project
    console.log("\n[Test 6] Verifying estimates 227 and 228 are excluded from candidate list for other projects...");
    const q6 = await client.query(`
      SELECT e.id FROM estimates e
      WHERE e.company_id = $1 AND e.client_id = $2 AND e.brand_id = $3
        AND e.id NOT IN (
          SELECT pe.estimate_id 
          FROM project_estimates pe
          INNER JOIN master_projects mp ON pe.project_id = mp.id
          WHERE pe.company_id = $1 AND pe.status = 'active' AND mp.status != 'archived'
        )
    `, [companyId, clientId, brandId]);
    console.log(`  ✓ Available count is now ${q6.rows.length} (25 - 2 = 23).`);
    if (q6.rows.length !== 23) throw new Error(`Expected 23 available estimates, got ${q6.rows.length}`);
    const remainingIds = new Set(q6.rows.map(r => r.id));
    if (remainingIds.has(227) || remainingIds.has(228)) {
      throw new Error("Estimates 227 or 228 were not excluded from candidates!");
    }

    // 7. Verify that when editing Project mpId, estimates 227 and 228 ARE included!
    console.log("\n[Test 7] Verifying estimates 227 and 228 ARE included when editing project ID " + mpId + "...");
    const q7 = await client.query(`
      SELECT e.id FROM estimates e
      WHERE e.company_id = $1 AND e.client_id = $2 AND e.brand_id = $3
        AND e.id NOT IN (
          SELECT pe.estimate_id 
          FROM project_estimates pe
          INNER JOIN master_projects mp ON pe.project_id = mp.id
          WHERE pe.company_id = $1 AND pe.status = 'active' AND mp.status != 'archived'
            AND pe.project_id != $4
        )
    `, [companyId, clientId, brandId, mpId]);
    console.log(`  ✓ Available count for editing project is ${q7.rows.length} (25).`);
    if (q7.rows.length !== 25) throw new Error(`Expected 25 available estimates when editing, got ${q7.rows.length}`);

    console.log("\n[Teardown] Rolling back transaction. Database remains unmodified.");
    await client.query("ROLLBACK;");

    console.log("\n=================================================================");
    console.log("ALL MASTER PROJECT ESTIMATE SELECTOR & LIFECYCLE TESTS PASSED!");
    console.log("=================================================================");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Test failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

testLifecycle()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

