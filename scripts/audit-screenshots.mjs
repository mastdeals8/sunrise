// Audit screenshot script. Captures full-page screenshots of every key ERP screen
// using Puppeteer + headless Chrome. Authenticates as admin/admin123, stores the
// JWT in localStorage as the AuthContext expects, then walks the route list.
// Output: screenshots/full_app_audit/NN-name.png + a JSON manifest.

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/full_app_audit");

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Each entry: { n, slug, route, hash, notes, postLoadAction? }
const PAGES = [
  { n: 1,  slug: "login",                     route: "/login",                preAuth: true,  notes: "Login screen" },
  { n: 2,  slug: "dashboard",                 route: "/",                     notes: "Dashboard with counters" },
  { n: 3,  slug: "sidebar",                   route: "/",                     notes: "Sidebar (same view, all sections expanded)", expandSidebar: true },
  { n: 4,  slug: "admin-users",               route: "/admin",                notes: "Admin Users" },
  { n: 5,  slug: "roles",                     route: "/admin/roles",          notes: "Roles" },
  { n: 6,  slug: "settings",                  route: "/admin/settings",       notes: "Settings" },
  { n: 7,  slug: "clients",                   route: "/operations#clients",   notes: "Masters - Clients" },
  { n: 8,  slug: "client-billing-profiles",   route: "/operations#clients",   notes: "Client GST Billing Profiles - dialog must be opened manually", manual: "open profiles dialog" },
  { n: 9,  slug: "brands",                    route: "/operations#brands",    notes: "Masters - Brands" },
  { n: 10, slug: "stores",                    route: "/operations#stores",    notes: "Masters - Stores" },
  { n: 11, slug: "products",                  route: "/operations#products",  notes: "Masters - Products & Rates" },
  { n: 12, slug: "material-codes",            route: "/material-codes",       notes: "Masters - Material Codes" },
  { n: 13, slug: "import-export",             route: "/operations#master_data", notes: "Import / Export" },
  { n: 14, slug: "all-estimates",             route: "/operations#estimates", notes: "Estimates list" },
  { n: 15, slug: "new-estimate-normal",       route: "/operations#estimates", notes: "New Estimate Normal — manual: click New + pick normal format", manual: "open new estimate normal" },
  { n: 16, slug: "new-estimate-letter",       route: "/operations#estimates", notes: "New Estimate Letter Signage — manual", manual: "open new estimate letter signage" },
  { n: 17, slug: "new-estimate-abfrl-selex",  route: "/operations#estimates", notes: "ABFRL SELEX — manual", manual: "open new estimate ABFRL SELEX" },
  { n: 18, slug: "new-estimate-abfrl-capex",  route: "/operations#estimates", notes: "ABFRL CAPEX — manual", manual: "open new estimate ABFRL CAPEX" },
  { n: 19, slug: "abfrl-store-1",             route: "/operations#estimates", notes: "ABFRL multi-store: Store 1 section — manual", manual: "select store 1 in new ABFRL estimate" },
  { n: 20, slug: "abfrl-store-2",             route: "/operations#estimates", notes: "ABFRL multi-store: Store 2 section — manual", manual: "select store 2 in new ABFRL estimate" },
  { n: 21, slug: "product-material-dropdown", route: "/operations#estimates", notes: "Product / material code dropdown — manual", manual: "open product or material dropdown in estimate row" },
  { n: 22, slug: "estimate-preview",          route: "/operations#estimates", notes: "Estimate preview — manual", manual: "open Preview on an existing estimate" },
  { n: 23, slug: "excel-export",              route: "/operations#estimates", notes: "Excel export trigger area — manual", manual: "click Export to Excel button (download)" },
  { n: 24, slug: "print-pdf-preview",         route: "/operations#estimates", notes: "Print / PDF preview — manual", manual: "click Print Preview" },
  { n: 25, slug: "po-upload-modal",           route: "/operations#estimates", notes: "PO Upload Modal — manual", manual: "click PO Upload on an estimate" },
  { n: 26, slug: "linked-documents",          route: "/operations#estimates", notes: "Linked Documents area — manual", manual: "expand linked docs on an estimate" },
  { n: 27, slug: "project-tracker",           route: "/operations#project_tracker", notes: "Project Tracker" },
  { n: 28, slug: "project-documents",         route: "/project-documents",    notes: "Project Documents" },
  { n: 29, slug: "delivery-challans",         route: "/operations#challans",  notes: "Delivery Challans list" },
  { n: 30, slug: "abfrl-wcc-editor",          route: "/operations#challans",  notes: "ABFRL WCC editor — manual", manual: "open a WCC for edit" },
  { n: 31, slug: "abfrl-wcc-print",           route: "/operations#challans",  notes: "ABFRL WCC print preview — manual", manual: "open print preview of WCC" },
  { n: 32, slug: "normal-dc",                 route: "/operations#challans",  notes: "Normal DC editor/preview — manual", manual: "open normal DC" },
  { n: 33, slug: "invoice-builder",           route: "/operations#invoices_ledger", notes: "Invoice builder" },
  { n: 34, slug: "invoice-packet-builder",    route: "/invoice-packet",       notes: "Invoice Packet Builder" },
  { n: 35, slug: "submitted-invoices",        route: "/submitted-invoices",   notes: "Submitted Invoices" },
  { n: 36, slug: "client-ledger",             route: "/client-ledger",        notes: "Client Ledger" },
  { n: 37, slug: "pending-payments",          route: "/pending-payments",     notes: "Pending Payments" },
  { n: 38, slug: "record-payment-modal",      route: "/pending-payments",     notes: "Record Payment modal — manual", manual: "open Record Payment dialog" },
  { n: 39, slug: "payment-ledger",            route: "/finance",              notes: "Payment Ledger" },
  { n: 40, slug: "petty-cash",                route: "/petty-cash",           notes: "Petty Cash" },
  { n: 41, slug: "expense-ledger",            route: "/finance",              notes: "Expense ledger visibility on Finance page" },
  { n: 42, slug: "salary-payables",           route: "/finance",              notes: "Salary Payables visibility on Finance page" },
  { n: 43, slug: "staff-master",              route: "/staff",                notes: "Staff master" },
  { n: 44, slug: "attendance",                route: "/staff",                notes: "Attendance — manual: select attendance tab", manual: "switch to attendance tab on Staff page" },
  { n: 45, slug: "salary-advances",           route: "/staff",                notes: "Salary/Advances — manual", manual: "switch to advances/payroll tab" },
  { n: 46, slug: "tasks",                     route: "/tasks",                notes: "Tasks" },
  { n: 47, slug: "telegram-settings",         route: "/automation/telegram",  notes: "Telegram Bot Settings" },
  { n: 48, slug: "whatsapp-settings",         route: "/automation/whatsapp",  notes: "WhatsApp API Settings" },
  { n: 49, slug: "bot-inbox",                 route: "/automation/inbox",     notes: "Bot Upload Inbox" },
  { n: 50, slug: "webhook-logs",              route: "/automation/inbox",     notes: "Webhook logs — manual: switch to logs tab if not default", manual: "switch to logs tab" },
];

const pad = (n) => String(n).padStart(2, "0");
const filename = (p) => `${pad(p.n)}-${p.slug}.png`;

const manifest = [];

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);

  // Suppress noisy CSP/font errors in console
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

  // 1) Pre-auth login screenshot (before storing token)
  try {
    const loginFile = `${OUT}/${filename(PAGES[0])}`;
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: loginFile, fullPage: true });
    manifest.push({ ...PAGES[0], file: filename(PAGES[0]), status: "captured" });
    console.log(`✓ ${filename(PAGES[0])}`);
  } catch (e) {
    console.error(`✗ ${filename(PAGES[0])}: ${e.message}`);
    manifest.push({ ...PAGES[0], file: filename(PAGES[0]), status: "failed", error: e.message });
  }

  // 2) Programmatic login via API; store token in localStorage under the
  //    same key AuthContext reads.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    console.error("Login failed:", res.status, await res.text());
    process.exit(1);
  }
  const { user, token } = await res.json();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  // 3) Walk all remaining pages
  for (let i = 1; i < PAGES.length; i++) {
    const p = PAGES[i];
    const file = filename(p);
    const out = `${OUT}/${file}`;
    try {
      const url = `${BASE}${p.route}`;
      await page.goto(url, { waitUntil: "networkidle2" });
      if (p.hash) await page.evaluate((h) => { window.location.hash = h; }, p.hash);
      if (p.expandSidebar) {
        // Expand collapsible sidebar sections. Skip Logout (kills session) and
        // any button without a chevron — only nav section headers carry a chevron.
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("aside nav button"));
          for (const b of buttons) {
            const txt = (b.textContent || "").trim();
            if (!txt || /logout/i.test(txt)) continue;
            // Only click section headers (they own a chevron icon)
            const hasChevron = !!b.querySelector("svg.lucide-chevron-down, svg.lucide-chevron-right");
            if (hasChevron) b.click();
          }
        });
      }
      // Settle async data: wait for any spinner to disappear, then dwell.
      try {
        await page.waitForFunction(
          () => !document.querySelector(".animate-spin"),
          { timeout: 8000 },
        );
      } catch {}
      await new Promise((r) => setTimeout(r, 1800));
      await page.screenshot({ path: out, fullPage: true });
      manifest.push({ ...p, file, status: p.manual ? "captured-base-state" : "captured" });
      console.log(`✓ ${file}${p.manual ? " (manual step needed for full coverage)" : ""}`);
    } catch (e) {
      console.error(`✗ ${file}: ${e.message}`);
      manifest.push({ ...p, file, status: "failed", error: e.message });
    }
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\nDone. ${manifest.filter(m => m.status?.startsWith("captured")).length}/${PAGES.length} screenshots captured.`);
  console.log(`Output: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
