// API smoke test for Sunrise Media ERP. Hits read endpoints and runs three
// write+read flows: ABFRL SELEX (no material code), ABFRL CAPEX (with material
// code, and a negative test without material code), and a normal estimate.
//
// Run:  node scripts/audit-api-tests.mjs
// Output: TEST_RESULTS.md at project root (overwrite).

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const RESULTS_PATH = resolve(process.cwd(), "TEST_RESULTS.md");
const results = [];
let token = "";

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`${tag.padEnd(4)}  ${name}${detail ? `  —  ${detail}` : ""}`);
}

async function call(method, path, body, expect = 200) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* */ }
  return { status: res.status, json, text: txt };
}

(async () => {
  // 1. Login
  {
    const r = await call("POST", "/api/auth/login", { username: "admin", password: "admin123" });
    const ok = r.status === 200 && r.json?.token;
    if (ok) token = r.json.token;
    record("Login admin/admin123", ok, ok ? `user=${r.json.user.username} role=${r.json.user.role}` : `status=${r.status}`);
  }

  // 2. List users
  {
    const r = await call("GET", "/api/users");
    record("List users", r.status === 200 && Array.isArray(r.json), `${r.json?.length ?? "?"} users`);
  }

  // 3. List clients
  let clients = [];
  {
    const r = await call("GET", "/api/operations/clients");
    clients = r.json || [];
    record("List clients", r.status === 200 && Array.isArray(r.json), `${clients.length} clients`);
  }

  // 4. List brands & stores
  let brands = [], stores = [];
  {
    const rb = await call("GET", "/api/operations/brands");
    brands = rb.json || [];
    record("List brands", rb.status === 200, `${brands.length} brands`);
    const rs = await call("GET", "/api/operations/stores");
    stores = rs.json || [];
    record("List stores", rs.status === 200, `${stores.length} stores`);
  }

  // 5. List products & material codes
  let products = [], materialCodes = [];
  {
    const rp = await call("GET", "/api/operations/products");
    products = rp.json || [];
    record("List products", rp.status === 200, `${products.length} products`);
    const rm = await call("GET", "/api/material-codes");
    materialCodes = rm.json || [];
    record("List material codes", rm.status === 200, `${materialCodes.length} codes`);
  }

  // Find ABFRL client (format = ABFRL) and a normal client.
  const abfrlClient = clients.find(c => c.format === "ABFRL") || clients[0];
  const normalClient = clients.find(c => c.format === "normal" || c.format !== "ABFRL") || clients[0];
  const abfrlBrand = brands[0];
  const abfrlStore = stores.find(s => s.clientId === abfrlClient?.id) || stores[0];
  const someProduct = products[0];
  const someMaterialCode = materialCodes.find(m => m.isActive) || materialCodes[0];

  const tag = () => Date.now().toString(36).slice(-6);

  // 6. Normal estimate creation
  {
    const number = `QA-NORMAL-${tag()}`;
    const r = await call("POST", "/api/operations/estimates", {
      estimate: {
        estimateNumber: number,
        clientId: normalClient.id,
        brandId: abfrlBrand?.id ?? brands[0]?.id,
        storeId: stores[0]?.id,
        title: "QA normal estimate",
        clientFormat: "normal",
        gstType: "CGST+SGST",
        subtotal: 1000, taxAmount: 180, totalAmount: 1180, status: "draft",
      },
      items: [{
        itemName: "Test item", quantity: 1, unit: "pcs", rate: 1000,
        totalPrice: 1000, totalAmount: 1180, sl: 1, isStandard: true,
      }],
    });
    record("Create normal estimate", r.status === 201, `est=${number} status=${r.status}`);
  }

  // 7. ABFRL SELEX (no material code required) — must succeed
  {
    const number = `QA-SELEX-${tag()}`;
    const r = await call("POST", "/api/operations/estimates", {
      estimate: {
        estimateNumber: number,
        clientId: abfrlClient.id,
        brandId: abfrlBrand?.id ?? brands[0]?.id,
        storeId: abfrlStore?.id ?? stores[0]?.id,
        title: "QA SELEX estimate (no material code)",
        clientFormat: "abfrl_multi_store",
        abfrlProjectType: "SELEX",
        gstType: "CGST+SGST",
        subtotal: 1000, taxAmount: 180, totalAmount: 1180, status: "draft",
      },
      items: [{
        itemName: "SELEX item", quantity: 1, unit: "pcs", rate: 1000,
        totalPrice: 1000, totalAmount: 1180, sl: 1, isStandard: true,
        // no materialCode / materialCodeId
      }],
    });
    record("Create ABFRL SELEX estimate (no material code)", r.status === 201, `est=${number} status=${r.status}`);
  }

  // 8. ABFRL CAPEX without material code — must REJECT (400)
  {
    const number = `QA-CAPEX-NOMC-${tag()}`;
    const r = await call("POST", "/api/operations/estimates", {
      estimate: {
        estimateNumber: number,
        clientId: abfrlClient.id,
        brandId: abfrlBrand?.id ?? brands[0]?.id,
        storeId: abfrlStore?.id ?? stores[0]?.id,
        title: "QA CAPEX without material code (should reject)",
        clientFormat: "abfrl_multi_store",
        abfrlProjectType: "CAPEX",
        gstType: "CGST+SGST",
        subtotal: 1000, taxAmount: 180, totalAmount: 1180, status: "draft",
      },
      items: [{
        itemName: "CAPEX item", quantity: 1, unit: "pcs", rate: 1000,
        totalPrice: 1000, totalAmount: 1180, sl: 1, isStandard: true,
      }],
    });
    const ok = r.status === 400 && /material code/i.test(r.json?.message || "");
    record("Reject ABFRL CAPEX without material code", ok, `status=${r.status} msg=${r.json?.message?.slice(0, 80)}`);
  }

  // 9. ABFRL CAPEX WITH material code — must succeed
  {
    const number = `QA-CAPEX-OK-${tag()}`;
    const r = await call("POST", "/api/operations/estimates", {
      estimate: {
        estimateNumber: number,
        clientId: abfrlClient.id,
        brandId: abfrlBrand?.id ?? brands[0]?.id,
        storeId: abfrlStore?.id ?? stores[0]?.id,
        title: "QA CAPEX with material code",
        clientFormat: "abfrl_multi_store",
        abfrlProjectType: "CAPEX",
        gstType: "CGST+SGST",
        subtotal: 1000, taxAmount: 180, totalAmount: 1180, status: "draft",
      },
      items: [{
        itemName: "CAPEX item", quantity: 1, unit: "pcs", rate: 1000,
        totalPrice: 1000, totalAmount: 1180, sl: 1, isStandard: true,
        materialCode: someMaterialCode?.code ?? "MC-TEST-001",
        materialCodeId: someMaterialCode?.id ?? null,
      }],
    });
    record("Create ABFRL CAPEX with material code", r.status === 201, `est=${number} status=${r.status}`);
  }

  // 10. List estimates
  {
    const r = await call("GET", "/api/operations/estimates");
    record("List estimates", r.status === 200, `${r.json?.length ?? "?"} estimates`);
  }

  // 11. Invoices list + dashboard
  {
    const r = await call("GET", "/api/finance/invoices");
    record("List invoices", r.status === 200, `${r.json?.length ?? "?"} invoices`);
  }
  {
    const r = await call("GET", "/api/finance/dashboard");
    const ok = r.status === 200 && typeof r.json?.salaryPayable === "number" && typeof r.json?.totalAdvances === "number";
    record("Finance dashboard returns aggregated fields", ok,
      ok ? `salaryPayable=${r.json.salaryPayable} totalAdvances=${r.json.totalAdvances} outstanding=${r.json.totalOutstanding}` : `status=${r.status}`);
  }

  // 12. Payments list
  {
    const r = await call("GET", "/api/finance/payments");
    record("List payments", r.status === 200, `${r.json?.length ?? "?"} payments`);
  }

  // 13. Petty cash / advances / payroll
  {
    const r1 = await call("GET", "/api/petty-cash");
    record("List petty cash", r1.status === 200, `${r1.json?.length ?? "?"} entries`);
    const r2 = await call("GET", "/api/advances");
    record("List advances", r2.status === 200, `${r2.json?.length ?? "?"} entries`);
    const d = new Date();
    const r3 = await call("GET", `/api/payroll?month=${d.getMonth() + 1}&year=${d.getFullYear()}`);
    record("List payroll (this month)", r3.status === 200, `${r3.json?.length ?? "?"} entries`);
  }

  // 14. Tasks / attendance
  {
    const r1 = await call("GET", "/api/tasks");
    record("List tasks", r1.status === 200, `${r1.json?.length ?? "?"} tasks`);
    const r2 = await call("GET", `/api/attendance?userId=1&from=2026-05-01&to=2026-05-31`);
    record("List attendance", r2.status === 200, `${r2.json?.length ?? "?"} entries`);
  }

  // 15. Bot settings (security: must mask botToken)
  {
    const r1 = await call("GET", "/api/automation/telegram");
    const masked = r1.json?.botToken === null || /^•{2,}/.test(String(r1.json?.botToken || ""));
    record("Telegram settings — no raw token returned", r1.status === 200 && masked,
      `botToken=${JSON.stringify(r1.json?.botToken)}`);
    const r2 = await call("GET", "/api/automation/whatsapp");
    const masked2 = r2.json?.botToken === null || /^•{2,}/.test(String(r2.json?.botToken || ""));
    record("WhatsApp settings — no raw token returned", r2.status === 200 && masked2,
      `botToken=${JSON.stringify(r2.json?.botToken)}`);
  }

  // 16. Bot inbox & webhook logs
  {
    const r1 = await call("GET", "/api/bot-inbox");
    record("List bot inbox", r1.status === 200, `${r1.json?.length ?? "?"} entries`);
    const r2 = await call("GET", "/api/automation/logs/telegram");
    record("List telegram webhook logs", r2.status === 200, `${r2.json?.length ?? "?"} entries`);
    const r3 = await call("GET", "/api/automation/logs/whatsapp");
    record("List whatsapp webhook logs", r3.status === 200, `${r3.json?.length ?? "?"} entries`);
  }

  // 17. WhatsApp webhook verify endpoint
  {
    const goodChallenge = "challenge_check_" + Date.now();
    const ok = await fetch(`${BASE}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=sunrise_verify&hub.challenge=${goodChallenge}`);
    const okText = await ok.text();
    record("WhatsApp verify accepts correct token", ok.status === 200 && okText === goodChallenge,
      `status=${ok.status}`);
    const bad = await fetch(`${BASE}/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x`);
    record("WhatsApp verify rejects wrong token", bad.status === 403, `status=${bad.status}`);
  }

  // 18. Customer rate cards CRUD + resolver
  {
    const r1 = await call("GET", "/api/customer-rate-cards");
    record("List customer rate cards", r1.status === 200, `${r1.json?.length ?? "?"} cards`);

    if (clients.length > 0 && brands.length > 0) {
      const cid = clients[0].id;
      const bid = brands[0].id;
      const created = await call("POST", "/api/customer-rate-cards", {
        name: "Smoke test card " + Date.now(),
        clientId: cid, brandId: bid,
        projectType: "CAPEX",
        effectiveFrom: null, effectiveTo: null,
        isActive: true,
        notes: "audit-api-tests",
      });
      record("Create rate card", created.status === 201, `id=${created.json?.id}`);

      if (created.json?.id) {
        // Add one item
        const products = (await call("GET", "/api/operations/products")).json || [];
        if (products.length > 0) {
          const itemCreate = await call("POST", `/api/customer-rate-cards/${created.json.id}/items`, {
            productId: products[0].id, rate: 9876, gstPercent: 18, uom: "sqft", isActive: true,
          });
          record("Add rate card item", itemCreate.status === 201, `item=${itemCreate.json?.id} rate=${itemCreate.json?.rate}`);

          // Resolver should match
          const resolved = await call("GET", `/api/customer-rate-cards/resolve?clientId=${cid}&brandId=${bid}&productId=${products[0].id}&projectType=CAPEX`);
          record("Resolver returns rate card match", resolved.status === 200 && resolved.json?.source === "customer_rate_card",
            `rate=${resolved.json?.rate ?? "null"}`);
        }

        // Archive the card we created so we don't pollute the master
        await call("PATCH", `/api/customer-rate-cards/${created.json.id}`, { isActive: false });
      }
    }
  }

  // 19. Tally export
  {
    const r1 = await call("GET", "/api/tally/settings");
    record("Get Tally settings", r1.status === 200, `enabled=${r1.json?.enabled ?? "?"}`);

    const allInvoices = (await call("GET", "/api/finance/invoices")).json || [];
    if (allInvoices.length > 0) {
      const inv = allInvoices.find((i) => i.type === "sales") || allInvoices[0];
      const r = await fetch(`${BASE}/api/tally/export-xml/${inv.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const txt = await r.text();
      const okShape = txt.includes("<ENVELOPE>") && txt.includes(`<VOUCHERNUMBER>${inv.invoiceNumber}`);
      record("Tally XML download has correct shape", r.status === 200 && okShape, `len=${txt.length}`);
    }
  }

  // 20. Project store status
  {
    const ests = (await call("GET", "/api/operations/estimates")).json || [];
    if (ests.length > 0) {
      const eid = ests[0].id;
      const w = await call("PUT", `/api/project-store-status/${eid}/SMK-001`, { status: "in_progress", remarks: "audit" });
      record("Project store status upsert", w.status === 200 || w.status === 201, `status=${w.json?.status ?? "?"}`);
      const r = await call("GET", `/api/project-store-status/${eid}`);
      record("Project store status list", r.status === 200, `${r.json?.length ?? "?"} entries`);
    }
  }

  // 21. Sample template download
  {
    const r = await fetch(`${BASE}/api/templates/CUSTOMER_RATE_CARDS_TEMPLATE`);
    const buf = await r.arrayBuffer();
    record("Sample rate-card template downloads", r.status === 200 && buf.byteLength > 1000, `size=${buf.byteLength} bytes`);
  }

  // Write report
  const total = results.length;
  const pass = results.filter(r => r.pass).length;
  const fail = total - pass;
  const md = `# Test Results — Sunrise Media ERP

Generated: ${new Date().toISOString()}
Run via: \`node scripts/audit-api-tests.mjs\`
Target:  ${BASE}

## Summary

- **Total:** ${total}
- **Passed:** ${pass}
- **Failed:** ${fail}

## Results

| # | Test | Status | Detail |
|---|------|--------|--------|
${results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail || ""} |`).join("\n")}

${fail === 0 ? "All API smoke tests pass." : `**${fail} test(s) failed — see table above.**`}
`;
  writeFileSync(RESULTS_PATH, md);
  console.log(`\nResults: ${pass}/${total} passed. Report → ${RESULTS_PATH}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
