// Corrected audit screenshots. Drives interactive states (opens New Estimate,
// switches formats, adds rows, opens dropdowns and modals) so the captures
// reflect actual workflow surfaces, not just default landing pages.
//
// Output: screenshots/full_app_audit_corrected/

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/full_app_audit_corrected");

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const manifest = [];
const pad = (n) => String(n).padStart(2, "0");
const recordCapture = (n, slug, route, note, status = "captured") => {
  manifest.push({ n, file: `${pad(n)}-${slug}.png`, route, note, status });
};

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);

  page.on("dialog", (d) => d.dismiss());

  // Pre-write auth so every navigation is authenticated.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    console.error("Login failed", res.status);
    process.exit(1);
  }
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
  const click = async (selectorOrText) => {
    // Click first matching element by visible text or selector.
    return await page.evaluate((q) => {
      const all = Array.from(document.querySelectorAll("button, a, [role='button'], select, option"));
      const el = all.find(e => (e.textContent || "").trim().includes(q));
      if (el) { el.click(); return true; }
      return false;
    }, selectorOrText);
  };

  // ============================================================
  // 1. New Estimate — Step 1 (Customer)
  // ============================================================
  await page.goto(`${BASE}/operations?new=1#estimates`, { waitUntil: "networkidle2" });
  await settle();
  await shot(1, "new-estimate-step1-customer");
  recordCapture(1, "new-estimate-step1-customer", "/operations?new=1#estimates",
    "New Estimate auto-opened via ?new=1; shows the 6-step progress strip and Customer fields (Step 1).");

  // ============================================================
  // 2. Normal estimate (default format=normal already)
  // ============================================================
  await page.evaluate(() => {
    const select = document.querySelector('select[class*="Format Style"], select');
    // Find the format dropdown by neighboring label text.
    const labels = Array.from(document.querySelectorAll("label")).filter(l => /Format Style/.test(l.textContent || ""));
    if (labels[0]) {
      const dd = labels[0].parentElement?.querySelector("select");
      if (dd) {
        dd.value = "normal";
        dd.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
  await settle(800);
  await shot(2, "estimate-format-normal");
  recordCapture(2, "estimate-format-normal", "/operations?new=1#estimates",
    "Normal estimate form: blue workflow strip, single store/site picker, no Material Code column.");

  // ============================================================
  // 3. Letter signage format
  // ============================================================
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label")).filter(l => /Format Style/.test(l.textContent || ""));
    const dd = labels[0]?.parentElement?.querySelector("select");
    if (dd) { dd.value = "letter_signage"; dd.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await settle(800);
  await shot(3, "estimate-format-letter");
  recordCapture(3, "estimate-format-letter", "/operations?new=1#estimates",
    "Letter signage format: dimension headers swap to 'Letter Height' / 'No. of Letters'.");

  // ============================================================
  // 4. ABFRL multi-store + SELEX
  // ============================================================
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label")).filter(l => /Format Style/.test(l.textContent || ""));
    const dd = labels[0]?.parentElement?.querySelector("select");
    if (dd) { dd.value = "abfrl_multi_store"; dd.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await settle(800);
  // SELEX is default. Capture.
  await shot(4, "estimate-format-abfrl-selex");
  recordCapture(4, "estimate-format-abfrl-selex", "/operations?new=1#estimates",
    "ABFRL multi-store + SELEX: purple workflow strip with Project Type dropdown showing SELEX; Material Code column visible (optional for SELEX).");

  // ============================================================
  // 5. ABFRL multi-store + CAPEX
  // ============================================================
  await page.evaluate(() => {
    // Find the Project Type select inside the purple ABFRL strip.
    const selects = Array.from(document.querySelectorAll("select"));
    const projectTypeSelect = selects.find(s => Array.from(s.options).some(o => /SELEX/.test(o.value)) && Array.from(s.options).some(o => /CAPEX/.test(o.value)));
    if (projectTypeSelect) {
      projectTypeSelect.value = "CAPEX";
      projectTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await settle(600);
  await shot(5, "estimate-format-abfrl-capex");
  recordCapture(5, "estimate-format-abfrl-capex", "/operations?new=1#estimates",
    "ABFRL multi-store + CAPEX: Project Type set to CAPEX. Server-side rule will reject save unless every row has a Material Code.");

  // ============================================================
  // 6. ABFRL Add-Store / store picker visible in row
  // ============================================================
  // The store picker is the right-most select in each row, labeled "Store Code".
  await page.evaluate(() => {
    const rowSelects = Array.from(document.querySelectorAll("table select"));
    // Find a row select that has "Store Code" as a placeholder option.
    const storeSel = rowSelects.find(s => Array.from(s.options).some(o => /Store Code|Choose Location/i.test(o.textContent || "")));
    if (storeSel) {
      storeSel.scrollIntoView({ block: "center" });
      storeSel.focus();
    }
  });
  await settle(500);
  await shot(6, "estimate-add-store-picker");
  recordCapture(6, "estimate-add-store-picker", "/operations?new=1#estimates",
    "ABFRL row-level Store Code picker. Each item row attaches to a store; this is how multi-store grouping is captured.");

  // ============================================================
  // 7-8. Store 1 + Store 2 with item rows (use existing stores).
  // ============================================================
  // Add an extra row via "Insert New Spreadsheet Row".
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => /Insert New Spreadsheet Row/.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await settle(600);
  // Set first row's store and second row's store programmatically.
  await page.evaluate(() => {
    const rowSelects = Array.from(document.querySelectorAll("table tbody select"));
    // Filter to "store" selects (have a placeholder including "Store Code").
    const storeSelects = rowSelects.filter(s => Array.from(s.options).some(o => /Store Code/i.test(o.textContent || "")));
    if (storeSelects.length >= 1 && storeSelects[0].options.length > 1) {
      storeSelects[0].value = storeSelects[0].options[1].value;
      storeSelects[0].dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (storeSelects.length >= 2 && storeSelects[1].options.length > 2) {
      storeSelects[1].value = storeSelects[1].options[2].value;
      storeSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await settle(500);
  // Scroll to first row
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    if (rows[0]) rows[0].scrollIntoView({ block: "center" });
  });
  await settle(400);
  await shot(7, "estimate-abfrl-store-1-rows");
  recordCapture(7, "estimate-abfrl-store-1-rows", "/operations?new=1#estimates",
    "ABFRL row attached to Store 1; demonstrates the per-row Store Code grouping.");

  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    if (rows[1]) rows[1].scrollIntoView({ block: "center" });
  });
  await settle(400);
  await shot(8, "estimate-abfrl-store-2-rows");
  recordCapture(8, "estimate-abfrl-store-2-rows", "/operations?new=1#estimates",
    "ABFRL row attached to Store 2; shows that a single estimate can hold rows for multiple stores.");

  // ============================================================
  // 9. Material code dropdown open (CAPEX requires it)
  // ============================================================
  await page.evaluate(() => {
    // First row's material code select.
    const rowSelects = Array.from(document.querySelectorAll("table tbody select"));
    const mcSel = rowSelects.find(s => Array.from(s.options).some(o => /code|—/.test(o.textContent || "")));
    if (mcSel) {
      mcSel.scrollIntoView({ block: "center" });
      mcSel.focus();
    }
  });
  await settle(400);
  await shot(9, "estimate-material-code-dropdown");
  recordCapture(9, "estimate-material-code-dropdown", "/operations?new=1#estimates",
    "Material Code dropdown in an ABFRL row. Required for CAPEX, optional for SELEX.");

  // ============================================================
  // 10. Row duplicate/copy/paste/delete controls visible
  // ============================================================
  // The Del/Copy buttons live in the last column of each row.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    const lastRow = rows[rows.length - 1];
    if (lastRow) lastRow.scrollIntoView({ block: "center", inline: "end" });
    // Scroll the table horizontally to show the rightmost columns
    const table = document.querySelector("table");
    if (table?.parentElement) table.parentElement.scrollLeft = 9999;
  });
  await settle(400);
  await shot(10, "estimate-row-actions");
  recordCapture(10, "estimate-row-actions", "/operations?new=1#estimates",
    "Per-row Duplicate (copy icon) + Delete (trash icon) controls visible in the rightmost column.");

  // ============================================================
  // 11. Store duplicate/copy controls visible
  // ============================================================
  await page.evaluate(() => {
    // Scroll the spreadsheet section header into view.
    const heading = Array.from(document.querySelectorAll("span")).find(s => /Itemized Sizing Spreadsheet/.test(s.textContent || ""));
    if (heading) heading.scrollIntoView({ block: "center" });
  });
  await settle(400);
  await shot(11, "estimate-store-duplicate-toolbar");
  recordCapture(11, "estimate-store-duplicate-toolbar", "/operations?new=1#estimates",
    "Top-of-table toolbar with 'Duplicate store From → To' selectors, 'Copy rows', and 'Clear source' buttons (ABFRL only).");

  // ============================================================
  // 12. Estimate document preview (the View modal that opens from the register)
  // ============================================================
  // Open a brand new context so the form's local state is reset and
  // the register list renders.
  await page.goto(`${BASE}/operations#estimates`, { waitUntil: "networkidle2" });
  await settle(1500);
  // If the form is still open from prior runs (it shouldn't be, but the
  // dev server is persistent), click "Back to Register" once.
  await page.evaluate(() => {
    const back = Array.from(document.querySelectorAll("button")).find(b => /Back to Register/.test(b.textContent || ""));
    if (back) back.click();
  });
  await settle(1000);
  // Click the first "View" button in the register table.
  await page.evaluate(() => {
    const viewBtns = Array.from(document.querySelectorAll("table button")).filter(b => {
      const t = (b.textContent || "").trim();
      return t === "View" || /^\s*View\s*$/.test(t);
    });
    if (viewBtns[0]) viewBtns[0].click();
  });
  await settle(2000);
  await shot(12, "estimate-view-modal");
  recordCapture(12, "estimate-view-modal", "/operations#estimates",
    "Estimate View / Details modal: shows estimate fields, items, totals, and workflow controls.");

  // ============================================================
  // 13. Excel export trigger (capture page with download link visible)
  // ============================================================
  // Close any open modal first
  await page.keyboard.press("Escape");
  await settle(500);
  // Capture the estimate register with the new Excel inline action visible.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("a, button")).find(b => /^\s*Excel\s*$/.test(b.textContent || ""));
    if (btn) btn.scrollIntoView({ block: "center" });
  });
  await settle(400);
  await shot(13, "estimate-excel-export-button");
  recordCapture(13, "estimate-excel-export-button", "/operations#estimates",
    "Inline 'Excel' action in the estimate register — direct download of the server-side XLSX export.");

  // ============================================================
  // 14. Print / PDF preview (browser print dialog — fall back to View+print css)
  // ============================================================
  // Trigger the "Print" inline action — opens the View modal and calls window.print.
  // We can't capture the native print dialog; capture the View modal in print mode instead.
  await page.evaluate(() => {
    const printBtns = Array.from(document.querySelectorAll("button")).filter(b => /^\s*Print\s*$/.test(b.textContent || ""));
    if (printBtns[0]) printBtns[0].click();
  });
  await settle(1500);
  await page.emulateMediaType("print");
  await shot(14, "estimate-print-preview");
  await page.emulateMediaType("screen");
  recordCapture(14, "estimate-print-preview", "/operations#estimates",
    "Estimate View modal rendered in @media print — what the PDF/printer would render.");

  // ============================================================
  // 15. Estimate View page (re-shot once back in normal media for clarity)
  // ============================================================
  await page.evaluate(() => {
    const viewBtns = Array.from(document.querySelectorAll("button")).filter(b => /^\s*View\s*$/.test(b.textContent || ""));
    if (viewBtns[0]) viewBtns[0].click();
  });
  await settle(1500);
  await shot(15, "estimate-view-page");
  recordCapture(15, "estimate-view-page", "/operations#estimates",
    "Full Estimate View — includes items, linked DC list, linked invoice list, payment state, and action controls.");

  // ============================================================
  // 16. PO Upload modal
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(b => /^\s*PO\s*$/.test(b.textContent || ""));
    if (btns[0]) btns[0].click();
  });
  await settle(1500);
  await shot(16, "po-upload-modal");
  recordCapture(16, "po-upload-modal", "/operations#estimates",
    "PO Upload modal — pick PO file, set PO number/date/amount/remarks.");

  // ============================================================
  // 17. Linked Documents section (inside View modal)
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(400);
  await page.evaluate(() => {
    const viewBtns = Array.from(document.querySelectorAll("button")).filter(b => /^\s*View\s*$/.test(b.textContent || ""));
    if (viewBtns[0]) viewBtns[0].click();
  });
  await settle(1500);
  // Scroll to bottom of modal to expose linked documents region
  await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], .fixed"));
    const scrollable = dialogs.find(d => d.scrollHeight > d.clientHeight);
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });
  await settle(500);
  await shot(17, "linked-documents");
  recordCapture(17, "linked-documents", "/operations#estimates",
    "Linked Documents region inside the estimate View modal: PO file, signed challan, photos, transport receipts.");

  // ============================================================
  // 18. WCC editor (DC modal)
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(b => /^\s*WCC\s*$|^\s*DC\s*$/.test(b.textContent || ""));
    if (btns[0]) btns[0].click();
  });
  await settle(1500);
  await shot(18, "wcc-editor");
  recordCapture(18, "wcc-editor", "/operations#estimates",
    "WCC / DC editor modal: number, format (normal vs ABFRL), delivered-by, received-by, remarks, photo uploads.");

  // ============================================================
  // 19. WCC print preview (print CSS on the DC editor)
  // ============================================================
  await page.emulateMediaType("print");
  await shot(19, "wcc-print-preview");
  await page.emulateMediaType("screen");
  recordCapture(19, "wcc-print-preview", "/operations#estimates",
    "WCC editor under @media print — clean printable version.");

  // ============================================================
  // 20. Invoice Builder (invoices_ledger tab)
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(400);
  await page.goto(`${BASE}/operations#invoices_ledger`, { waitUntil: "networkidle2" });
  await settle(1500);
  await shot(20, "invoice-builder");
  recordCapture(20, "invoice-builder", "/operations#invoices_ledger",
    "Invoice Builder tab: invoice packets / ledger / clients sub-tabs, new invoice form, totals.");

  // ============================================================
  // 21. Invoice Packet Builder
  // ============================================================
  await page.goto(`${BASE}/invoice-packet`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Click first invoice in the list if any, to populate the packet preview.
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(".glass-panel button, button.w-full"));
    const btn = candidates.find(b => /INV-/i.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await settle(1800);
  await shot(21, "invoice-packet-builder");
  recordCapture(21, "invoice-packet-builder", "/invoice-packet",
    "Invoice Packet Builder with an invoice selected: page list, packet preview with branded headers.");

  // ============================================================
  // 22. Record Payment modal (Pending Payments page)
  // ============================================================
  await page.goto(`${BASE}/pending-payments`, { waitUntil: "networkidle2" });
  await settle(1500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(b => /Record Payment/i.test(b.textContent || ""));
    if (btns[0]) btns[0].click();
  });
  await settle(1500);
  await shot(22, "record-payment-modal");
  recordCapture(22, "record-payment-modal", "/pending-payments",
    "Record Payment modal: amount, mode (cash/bank/UPI/cheque), date, reference, allocation to invoice.");

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await browser.close();
  const captured = manifest.filter(m => m.status === "captured").length;
  console.log(`\n${captured}/${manifest.length} corrected screenshots captured.`);
  console.log(`Output: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
