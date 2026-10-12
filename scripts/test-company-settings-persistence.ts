import { pool } from "../server/db";

async function runTests() {
  console.log("==========================================================");
  console.log("   COMPANY SETTINGS PERSISTENCE & BRANDING TEST SUITE     ");
  console.log("==========================================================");

  let passed = 0;
  let failed = 0;

  function assert(desc: string, cond: boolean) {
    if (cond) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    // 1. Verify schema columns
    console.log("\n1. Verifying Database Schema for Branding Columns in `companies` table...");
    const colsRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'companies' 
      ORDER BY ordinal_position
    `);
    const colNames = new Set(colsRes.rows.map(r => r.column_name));
    
    const requiredCols = [
      "signature_path",
      "seal_path",
      "footer_bg_color",
      "footer_text_color",
      "header_bg_color",
      "header_text_color",
      "footer_alignment",
      "branding_options",
      "doc_header_text",
      "doc_footer_text",
      "logo_path",
      "legal_name",
      "trade_name",
      "display_name"
    ];

    for (const c of requiredCols) {
      assert(`Column '${c}' exists in 'companies' table`, colNames.has(c));
    }

    // 2. Snapshot current state of companies 1, 2, 3
    console.log("\n2. Capturing Baseline Snapshot of Companies 1, 2, 3...");
    const snapRes = await pool.query(`
      SELECT id, name, display_name, legal_name, gstin, logo_path, signature_path, seal_path, footer_bg_color, footer_text_color, doc_header_text, doc_footer_text
      FROM companies 
      WHERE id IN (1, 2, 3) 
      ORDER BY id
    `);
    const compMap = new Map(snapRes.rows.map(r => [r.id, r]));
    console.log("  Baseline Companies Found:", Array.from(compMap.keys()));

    const c1Before = compMap.get(1);
    const c3Before = compMap.get(3);
    assert("Company 1 (Sunrise Media) exists", !!c1Before);
    assert("Company 2 (Delhi Company) exists", !!compMap.get(2));
    assert("Company 3 (Rika Store) exists", !!c3Before);

    // 3. Test company-specific save for Company 2 (Delhi Company)
    console.log("\n3. Testing Company Settings Persistence for Company 2 (Delhi Company)...");
    const testDelhiBranding = {
      legal_name: "Delhi Media & Signage Private Limited",
      trade_name: "Delhi Sign Solutions",
      display_name: "Delhi Sign Solutions",
      gstin: "07AAAAA1234A1Z5",
      pan: "AAAAA1234A",
      state: "Delhi",
      state_code: "07",
      address: "102 Okhla Industrial Area Phase III, New Delhi 110020",
      mobile: "+91 9811002233",
      email: "delhi@sunrisemedia.in",
      bank_name: "ICICI Bank",
      bank_account_number: "000105001234",
      bank_ifsc: "ICIC0000001",
      bank_branch: "Connaught Place, New Delhi",
      logo_path: "https://rswvsvvuycoyzfxbepet.supabase.co/storage/v1/object/public/company-assets/company-2/logos/delhi-logo.png",
      signature_path: "https://rswvsvvuycoyzfxbepet.supabase.co/storage/v1/object/public/company-assets/company-2/signatures/delhi-sign.png",
      seal_path: "https://rswvsvvuycoyzfxbepet.supabase.co/storage/v1/object/public/company-assets/company-2/seals/delhi-seal.png",
      footer_bg_color: "#1e3a8a",
      footer_text_color: "#ffffff",
      header_bg_color: "#f8fafc",
      header_text_color: "#0f172a",
      footer_alignment: "center",
      doc_header_text: "DELHI REGIONAL OFFICE & PRINT PRODUCTION FACILITY",
      doc_footer_text: "DELHI MEDIA & SIGNAGE PVT LTD • 102 OKHLA IND AREA PHASE III, NEW DELHI",
      branding_options: JSON.stringify({ showGstInHeader: true, showBankInFooter: true })
    };

    const updateQuery = `
      UPDATE companies SET
        legal_name = $1,
        trade_name = $2,
        display_name = $3,
        gstin = $4,
        pan = $5,
        state = $6,
        state_code = $7,
        address = $8,
        mobile = $9,
        email = $10,
        bank_name = $11,
        bank_account_number = $12,
        bank_ifsc = $13,
        bank_branch = $14,
        logo_path = $15,
        signature_path = $16,
        seal_path = $17,
        footer_bg_color = $18,
        footer_text_color = $19,
        header_bg_color = $20,
        header_text_color = $21,
        footer_alignment = $22,
        doc_header_text = $23,
        doc_footer_text = $24,
        branding_options = $25::jsonb,
        updated_at = NOW()
      WHERE id = 2
      RETURNING *
    `;

    const updateRes = await pool.query(updateQuery, [
      testDelhiBranding.legal_name,
      testDelhiBranding.trade_name,
      testDelhiBranding.display_name,
      testDelhiBranding.gstin,
      testDelhiBranding.pan,
      testDelhiBranding.state,
      testDelhiBranding.state_code,
      testDelhiBranding.address,
      testDelhiBranding.mobile,
      testDelhiBranding.email,
      testDelhiBranding.bank_name,
      testDelhiBranding.bank_account_number,
      testDelhiBranding.bank_ifsc,
      testDelhiBranding.bank_branch,
      testDelhiBranding.logo_path,
      testDelhiBranding.signature_path,
      testDelhiBranding.seal_path,
      testDelhiBranding.footer_bg_color,
      testDelhiBranding.footer_text_color,
      testDelhiBranding.header_bg_color,
      testDelhiBranding.header_text_color,
      testDelhiBranding.footer_alignment,
      testDelhiBranding.doc_header_text,
      testDelhiBranding.doc_footer_text,
      testDelhiBranding.branding_options
    ]);

    assert("Update query for Company 2 returned successfully", updateRes.rows.length === 1);
    const updatedC2 = updateRes.rows[0];

    // Verify all fields persisted
    assert("Company 2 legal_name matches", updatedC2.legal_name === testDelhiBranding.legal_name);
    assert("Company 2 display_name matches", updatedC2.display_name === testDelhiBranding.display_name);
    assert("Company 2 trade_name matches", updatedC2.trade_name === testDelhiBranding.trade_name);
    assert("Company 2 gstin matches", updatedC2.gstin === testDelhiBranding.gstin);
    assert("Company 2 pan matches", updatedC2.pan === testDelhiBranding.pan);
    assert("Company 2 logo_path matches", updatedC2.logo_path === testDelhiBranding.logo_path);
    assert("Company 2 signature_path matches", updatedC2.signature_path === testDelhiBranding.signature_path);
    assert("Company 2 seal_path matches", updatedC2.seal_path === testDelhiBranding.seal_path);
    assert("Company 2 footer_bg_color matches (#1e3a8a)", updatedC2.footer_bg_color === testDelhiBranding.footer_bg_color);
    assert("Company 2 footer_text_color matches (#ffffff)", updatedC2.footer_text_color === testDelhiBranding.footer_text_color);
    assert("Company 2 header_bg_color matches (#f8fafc)", updatedC2.header_bg_color === testDelhiBranding.header_bg_color);
    assert("Company 2 header_text_color matches (#0f172a)", updatedC2.header_text_color === testDelhiBranding.header_text_color);
    assert("Company 2 footer_alignment matches (center)", updatedC2.footer_alignment === testDelhiBranding.footer_alignment);
    assert("Company 2 doc_header_text matches", updatedC2.doc_header_text === testDelhiBranding.doc_header_text);
    assert("Company 2 doc_footer_text matches", updatedC2.doc_footer_text === testDelhiBranding.doc_footer_text);

    // 4. Verification after reload (simulating refresh / fresh connection)
    console.log("\n4. Verifying Persistence on Clean SELECT Query (simulating page reload)...");
    const reloadRes = await pool.query(`
      SELECT * FROM companies WHERE id = 2
    `);
    const reloadedC2 = reloadRes.rows[0];
    assert("Persisted after reload: legal_name", reloadedC2.legal_name === testDelhiBranding.legal_name);
    assert("Persisted after reload: footer_bg_color", reloadedC2.footer_bg_color === "#1e3a8a");
    assert("Persisted after reload: signature_path", reloadedC2.signature_path === testDelhiBranding.signature_path);
    assert("Persisted after reload: seal_path", reloadedC2.seal_path === testDelhiBranding.seal_path);

    // 5. Test Company Workspace Isolation
    console.log("\n5. Verifying Company Workspace Isolation (Companies 1 and 3 are untouched)...");
    const isoRes = await pool.query(`
      SELECT id, name, display_name, legal_name, gstin, logo_path, signature_path, seal_path, footer_bg_color, footer_text_color, doc_header_text, doc_footer_text
      FROM companies 
      WHERE id IN (1, 3) 
      ORDER BY id
    `);
    const c1After = isoRes.rows.find(r => r.id === 1);
    const c3After = isoRes.rows.find(r => r.id === 3);

    assert("Company 1 display_name was NOT changed by Company 2 edits", c1After?.display_name === c1Before?.display_name);
    assert("Company 1 footer_bg_color was NOT changed by Company 2 edits", c1After?.footer_bg_color === c1Before?.footer_bg_color);
    assert("Company 1 signature_path was NOT changed by Company 2 edits", c1After?.signature_path === c1Before?.signature_path);
    assert("Company 1 seal_path was NOT changed by Company 2 edits", c1After?.seal_path === c1Before?.seal_path);
    assert("Company 1 gstin was NOT changed by Company 2 edits", c1After?.gstin === c1Before?.gstin);

    assert("Company 3 display_name was NOT changed by Company 2 edits", c3After?.display_name === c3Before?.display_name);
    assert("Company 3 footer_bg_color was NOT changed by Company 2 edits", c3After?.footer_bg_color === c3Before?.footer_bg_color);
    assert("Company 3 signature_path was NOT changed by Company 2 edits", c3After?.signature_path === c3Before?.signature_path);
    assert("Company 3 seal_path was NOT changed by Company 2 edits", c3After?.seal_path === c3Before?.seal_path);

    console.log("\n==========================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==========================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
