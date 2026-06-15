// Final pass screenshot script. Captures key NEW screens added in the
// customer-rate-card / Tally / Jobs / templates pass. Output:
// screenshots/final_ratecard_erp_pass/NN-name.png + manifest.json.

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/final_ratecard_erp_pass");

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PAGES = [
  { n: 1,  slug: "dashboard-counters",          route: "/",                          notes: "Dashboard with new counters (Jobs in progress, Stores done/pending, Tally pending)" },
  { n: 2,  slug: "clients-with-actions",        route: "/operations#clients",        notes: "Clients register with View/Edit/Archive actions" },
  { n: 3,  slug: "brands-with-actions",         route: "/operations#brands",         notes: "Brands register with View/Edit/Archive + RC deep link" },
  { n: 4,  slug: "stores-list",                 route: "/operations#stores",         notes: "Stores list (sites)" },
  { n: 5,  slug: "products-list",               route: "/operations#products",       notes: "Products & rates" },
  { n: 6,  slug: "material-codes",              route: "/material-codes",            notes: "Material Codes master" },
  { n: 7,  slug: "import-export-templates",     route: "/operations#master_data",    notes: "Import / Export with downloadable templates" },
  { n: 8,  slug: "customer-rate-cards",         route: "/customer-rate-cards",       notes: "Customer Rate Cards list + resolver button" },
  { n: 9,  slug: "rate-cards-with-resolver",    route: "/customer-rate-cards",       notes: "Resolver widget expanded", postLoad: async (page) => {
        // Click "Resolver" toggle
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent?.includes("Resolver"));
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 600));
      } },
  { n: 10, slug: "estimates-list",              route: "/operations#estimates",      notes: "Estimate register" },
  { n: 11, slug: "tally-settings",              route: "/automation/tally",          notes: "Tally Integration settings" },
  { n: 12, slug: "submitted-invoices-tally",    route: "/submitted-invoices",        notes: "Submitted Invoices with Tally column + per-row XML button" },
  { n: 13, slug: "jobs-tracker",                route: "/jobs",                       notes: "Job Status Tracker with completion %" },
  { n: 14, slug: "jobs-tracker-store-detail",   route: "/jobs",                       notes: "Job Tracker — store-level row expanded", postLoad: async (page) => {
        // Click first "Stores" button to expand details for first job
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent?.trim() === "Stores");
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 800));
      } },
  { n: 15, slug: "completion-report",            route: "/jobs",                       notes: "Client completion report modal", postLoad: async (page) => {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent?.includes("Client Report"));
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      } },
  { n: 16, slug: "pending-payments",            route: "/pending-payments",          notes: "Pending Payments" },
  { n: 17, slug: "petty-cash",                  route: "/petty-cash",                 notes: "Petty Cash" },
  { n: 18, slug: "staff-master",                route: "/staff",                       notes: "Staff master" },
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
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

  // Login via API and seed JWT
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!r.ok) { console.error("login failed"); process.exit(1); }
  const { token, user } = await r.json();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  for (const p of PAGES) {
    const out = resolve(OUT, filename(p));
    try {
      const url = `${BASE}${p.route.split("#")[0]}`;
      await page.goto(url, { waitUntil: "networkidle2" });
      if (p.route.includes("#")) {
        const hash = p.route.split("#")[1];
        await page.evaluate((h) => { window.location.hash = h; }, hash);
      }
      // Wait for the React `loading` spinner to disappear. Dashboard and Staff
      // render a full-page `animate-spin` ring while their initial fetches
      // are in flight; networkidle2 fires before the useEffect fetches kick
      // off, so without this guard those pages get screenshotted mid-load.
      try {
        await page.waitForFunction(
          () => !document.querySelector(".animate-spin"),
          { timeout: 10_000 },
        );
      } catch { /* keep going; we'd rather have a screenshot than fail */ }
      // Settle: layout / icons / fonts.
      await new Promise(rr => setTimeout(rr, 1200));
      if (p.postLoad) {
        try { await p.postLoad(page); } catch (e) { console.warn("postLoad failed:", e?.message); }
      }
      await page.screenshot({ path: out, fullPage: true });
      manifest.push({ n: p.n, slug: p.slug, route: p.route, notes: p.notes, file: filename(p), status: "captured" });
      console.log(`✓ [${pad(p.n)}] ${p.slug}`);
    } catch (e) {
      console.error(`✗ ${p.slug}: ${e.message}`);
      manifest.push({ n: p.n, slug: p.slug, route: p.route, notes: p.notes, status: `failed: ${e.message}` });
    }
  }

  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\nDone. ${manifest.filter(m => m.status === "captured").length}/${PAGES.length} captured.`);
})();
