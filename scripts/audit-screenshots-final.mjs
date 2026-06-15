// Final correction screenshots. Targets the 7 screens called out as wrong:
//
//  1. Invoice Builder (the "Invoice Builder" sub-tab on /operations#invoices_ledger,
//     not the WCC editor that the prior pass accidentally captured).
//  2. Record Payment modal — actually opened from the Invoice Ledger sub-tab.
//  3. ABFRL WCC editor — with clientFormat=ABFRL.
//  4. ABFRL WCC print preview — same with @media print.
//  5. Petty Cash detail.
//  6. Staff Attendance tab.
//  7. Staff Salary / Advances tab.
//
// Output: screenshots/final_correction_audit/

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/final_correction_audit");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const pad = (n) => String(n).padStart(2, "0");
const manifest = [];

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  page.on("dialog", (d) => d.dismiss());

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const { user, token } = await res.json();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  const settle = async (ms = 1500) => {
    try { await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 6000 }); } catch {}
    await new Promise((r) => setTimeout(r, ms));
  };
  const shot = (n, slug) => page.screenshot({ path: `${OUT}/${pad(n)}-${slug}.png`, fullPage: true });
  const record = (n, slug, route, note) =>
    manifest.push({ n, file: `${pad(n)}-${slug}.png`, route, note, status: "captured" });

  // ============================================================
  // 1. Invoice Builder (packets sub-tab)
  // ============================================================
  await page.goto(`${BASE}/operations#invoices_ledger`, { waitUntil: "networkidle2" });
  await settle();
  // Click "Invoice Builder" sub-tab explicitly.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const t = tabs.find(b => /^\s*Invoice Builder\s*$/.test(b.textContent || ""));
    if (t) t.click();
  });
  await settle(1500);
  await shot(1, "invoice-builder");
  record(1, "invoice-builder", "/operations#invoices_ledger",
    "Invoice Builder sub-tab: list of approved estimates with 'Create Invoice' button per row.");

  // ============================================================
  // 2. Record Payment modal — open it
  // ============================================================
  // Switch to "Invoice Ledger" sub-tab where Record Payment buttons live.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const t = tabs.find(b => /^\s*Invoice Ledger\s*$/.test(b.textContent || ""));
    if (t) t.click();
  });
  await settle(1500);
  // Find a "Record Payment" button.
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const t = btns.find(b => /Record Payment/.test(b.textContent || ""));
    if (t) { t.click(); return true; }
    return false;
  });
  if (clicked) {
    await settle(1500);
  } else {
    // No "Record Payment" in the operations Invoice Ledger view —
    // try the standalone pending-payments page instead.
    await page.goto(`${BASE}/pending-payments`, { waitUntil: "networkidle2" });
    await settle(1500);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const t = btns.find(b => /Record Payment/.test(b.textContent || ""));
      if (t) t.click();
    });
    await settle(1500);
  }
  await shot(2, "record-payment-modal");
  record(2, "record-payment-modal", "(modal opened)",
    "Record Payment modal: amount, mode, date, optional invoice allocation.");

  // ============================================================
  // 3. ABFRL WCC editor — with ABFRL format selected
  // ============================================================
  await page.goto(`${BASE}/operations#challans`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Find an ABFRL DC row and click its "Print/View" or "View" or "Edit" button.
  // First look for a row labeled ABFRL in the format column.
  const opened = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    for (const row of rows) {
      const txt = row.textContent || "";
      if (/ABFRL/i.test(txt)) {
        const btn = Array.from(row.querySelectorAll("button")).find(b => /Print\/View|View|Edit/i.test(b.textContent || ""));
        if (btn) { btn.click(); return true; }
      }
    }
    return false;
  });
  if (!opened) {
    // Fallback: open the first DC row and force the format dropdown to ABFRL.
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => /Print\/View|View|Edit/i.test(b.textContent || ""));
      if (btn) btn.click();
    });
    await settle(1500);
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const fmt = selects.find(s => Array.from(s.options).some(o => /ABFRL|WCC/i.test(o.textContent || "")));
      if (fmt) {
        const opt = Array.from(fmt.options).find(o => /ABFRL|WCC/i.test(o.textContent || ""));
        if (opt) {
          fmt.value = opt.value;
          fmt.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
  }
  await settle(1500);
  await shot(3, "abfrl-wcc-editor");
  record(3, "abfrl-wcc-editor", "/operations#challans",
    "WCC editor with ABFRL format active. NOTE: visual layout follows current template — Part B (matching the real WCC reference PDFs) is on hold pending PDF placement in reference-docs/wcc/.");

  // ============================================================
  // 4. ABFRL WCC print preview
  // ============================================================
  await page.emulateMediaType("print");
  await shot(4, "abfrl-wcc-print-preview");
  await page.emulateMediaType("screen");
  record(4, "abfrl-wcc-print-preview", "/operations#challans",
    "WCC editor rendered in @media print.");

  // ============================================================
  // 5. Petty Cash detail / proof upload
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(500);
  await page.goto(`${BASE}/petty-cash`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Click the "Add Expense" button to expose the proof-upload form.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b =>
      /Add Expense|New Expense|\+ Add|New Petty Cash/i.test(b.textContent || "")
    );
    if (btn) btn.click();
  });
  await settle(1500);
  await shot(5, "petty-cash-detail");
  record(5, "petty-cash-detail", "/petty-cash",
    "Petty Cash with the add/edit form open — shows category, amount, vendor, expense date, proof upload.");

  // ============================================================
  // 6. Staff Attendance tab
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(500);
  await page.goto(`${BASE}/staff`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Attendance is the default tab but click explicitly to be safe.
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const t = tabs.find(b => /^\s*Attendance/.test(b.textContent || ""));
    if (t) t.click();
  });
  await settle(1500);
  await shot(6, "staff-attendance");
  record(6, "staff-attendance", "/staff",
    "Staff Attendance tab: clock-in/out controls and attendance list.");

  // ============================================================
  // 7. Staff Salary / Advances tab
  // ============================================================
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const t = tabs.find(b => /^\s*Advances/.test(b.textContent || ""));
    if (t) t.click();
  });
  await settle(1500);
  await shot(7, "staff-salary-advances");
  record(7, "staff-salary-advances", "/staff",
    "Staff Salary / Advances tab: advance entries with date, amount, payment mode.");

  // ============================================================
  // 8. (Bonus) Customer Rate Cards new resolver page
  // ============================================================
  await page.goto(`${BASE}/customer-rate-cards`, { waitUntil: "networkidle2" });
  await settle(1500);
  await shot(8, "customer-rate-cards-resolver");
  record(8, "customer-rate-cards-resolver", "/customer-rate-cards",
    "Customer Rate Cards page upgraded from placeholder: 'Coming next' banner + live 'Try the resolver' widget calling /api/customer-rate-cards/resolve.");

  // ============================================================
  // 9. (Bonus) ABFRL per-store totals visible in the estimate form
  // ============================================================
  await page.goto(`${BASE}/operations?new=1#estimates`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Pick an ABFRL client FIRST — selecting client overwrites the format,
  // so picking format before client gets reset to "normal".
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label")).filter(l => /Corporate Client/i.test(l.textContent || ""));
    const dd = labels[0]?.parentElement?.querySelector("select");
    if (!dd) return;
    const opt = Array.from(dd.options).find(o => /ABFRL|Aditya Birla|Pantaloons/i.test(o.textContent || ""));
    if (opt) {
      dd.value = opt.value;
      dd.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await settle(1500);
  // Now force abfrl_multi_store (handleClientSelectChange may have set ABFRL or normal).
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label")).filter(l => /Format Style/.test(l.textContent || ""));
    const dd = labels[0]?.parentElement?.querySelector("select");
    if (dd) { dd.value = "abfrl_multi_store"; dd.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await settle(800);
  // Add 2 extra rows.
  await page.evaluate(() => {
    const addBtn = Array.from(document.querySelectorAll("button")).find(b => /Insert New Spreadsheet Row/.test(b.textContent || ""));
    if (addBtn) { addBtn.click(); addBtn.click(); }
  });
  await settle(800);
  await page.evaluate(() => {
    const rowSelects = Array.from(document.querySelectorAll("table tbody select"));
    const storeSelects = rowSelects.filter(s => Array.from(s.options).some(o => /Store Code/i.test(o.textContent || "")));
    if (storeSelects[0] && storeSelects[0].options.length > 1) {
      storeSelects[0].value = storeSelects[0].options[1].value;
      storeSelects[0].dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (storeSelects[1] && storeSelects[1].options.length > 2) {
      storeSelects[1].value = storeSelects[1].options[2].value;
      storeSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
    } else if (storeSelects[1] && storeSelects[1].options.length > 1) {
      storeSelects[1].value = storeSelects[1].options[1].value;
      storeSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (storeSelects[2] && storeSelects[2].options.length > 1) {
      storeSelects[2].value = storeSelects[2].options[1].value;
      storeSelects[2].dispatchEvent(new Event("change", { bubbles: true }));
    }
    // Set non-zero rates: find rate inputs (right-aligned numeric inputs inside table rows).
    Array.from(document.querySelectorAll('table tbody tr')).forEach((row, i) => {
      const rateInput = Array.from(row.querySelectorAll('input[type="number"]')).find(i => i.className.includes("text-right"));
      if (rateInput) {
        rateInput.value = String(1000 + i * 250);
        rateInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
  await settle(1000);
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h4")).find(h => /Per-Store Totals/i.test(h.textContent || ""));
    if (heading) heading.scrollIntoView({ block: "start" });
  });
  await settle(800);
  await shot(9, "abfrl-per-store-totals");
  record(9, "abfrl-per-store-totals", "/operations?new=1#estimates",
    "ABFRL Per-Store Totals panel (after items table): Material / Packing / Installation / Transport / Store Total per attached store.");

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\n${manifest.length} screenshots captured.`);
  console.log(`Output: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
