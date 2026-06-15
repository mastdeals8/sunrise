// Captures the Bolt-style redesigned screens. Uses the new top-level routes
// (/clients, /brands, /estimates, /delivery-challans, etc.) so each capture
// proves the dedicated-page UX, not the old Operations hub.

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/bolt_redesign");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PAGES = [
  { n: 1,  slug: "dashboard",               route: "/",                       notes: "Compact dashboard with new sidebar groups" },
  { n: 2,  slug: "estimate-register",       route: "/estimates",              notes: "Estimate Register with Brand + Linked Docs (PO/DC/INV) columns + workflow-gated actions" },
  { n: 3,  slug: "delivery-challan-all",    route: "/delivery-challans",      notes: "DC/WCC Register: All filter" },
  { n: 4,  slug: "delivery-challan-normal", route: "/delivery-challans",      notes: "DC/WCC Register: Normal DC only", postLoad: async (page) => {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => /Normal DC/.test(x.textContent || ""));
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 600));
      } },
  { n: 5,  slug: "delivery-challan-wcc",    route: "/delivery-challans",      notes: "DC/WCC Register: ABLBL WCC only", postLoad: async (page) => {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => /ABLBL WCC/.test(x.textContent || ""));
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 600));
      } },
  { n: 6,  slug: "products-rates",          route: "/products",               notes: "Products & Rates — dedicated page, no hub chrome" },
  { n: 7,  slug: "brands-master",           route: "/brands",                 notes: "Brands master — dedicated page" },
  { n: 8,  slug: "stores-master",           route: "/stores",                 notes: "Stores master — dedicated page" },
  { n: 9,  slug: "clients-list",            route: "/clients",                notes: "Clients list — dedicated page" },
  { n: 10, slug: "client-workspace",        route: "/clients/1",              notes: "Client Workspace (Overview tab) for ABFRL" },
  { n: 11, slug: "client-workspace-estimates", route: "/clients/1",            notes: "Client Workspace: Estimates tab", postLoad: async (page) => {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => (x.textContent || "").trim() === "Estimates");
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 600));
      } },
  { n: 12, slug: "client-workspace-invoices",   route: "/clients/1",          notes: "Client Workspace: Invoices tab", postLoad: async (page) => {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button")).find(x => (x.textContent || "").trim() === "Invoices");
          if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 600));
      } },
  { n: 13, slug: "po-uploads",              route: "/po-uploads",             notes: "PO Uploads — same estimate panel, dedicated page" },
  { n: 14, slug: "invoices",                route: "/invoices",               notes: "Invoices ledger — dedicated page" },
  { n: 15, slug: "jobs-tracker",            route: "/jobs",                   notes: "Job Status Tracker — Jobs.tsx page (no Operations hub)" },
  { n: 16, slug: "project-documents",       route: "/project-documents",      notes: "Project Documents — dedicated page" },
  { n: 17, slug: "material-codes",          route: "/material-codes",         notes: "Material Codes master" },
  { n: 18, slug: "rate-cards",              route: "/customer-rate-cards",    notes: "Customer Rate Cards" },
  { n: 19, slug: "import-export",           route: "/import-export",          notes: "Import / Export — dedicated page" },
  { n: 20, slug: "finance",                 route: "/finance",                notes: "Finance page" },
  { n: 21, slug: "tally-export",            route: "/automation/tally",       notes: "Tally Export settings" },
];

const pad = (n) => String(n).padStart(2, "0");
const filename = (p) => `${pad(p.n)}-${p.slug}.png`;
const manifest = [];

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

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
      await page.goto(`${BASE}${p.route}`, { waitUntil: "networkidle2" });
      try {
        await page.waitForFunction(
          () => !document.querySelector(".animate-spin"),
          { timeout: 15_000 },
        );
      } catch {}
      // OperationsPage doesn't show a spinner during fetchData. The empty
      // state literal "No estimates yet" appears in the table while data is
      // loading too, so we can't bail on that — wait a generous 5s for the
      // full fetch chain (clients/brands/stores/products/material-codes/
      // estimates/challans/ledger summary) to land.
      await new Promise((r) => setTimeout(r, 5000));
      if (p.postLoad) {
        try { await p.postLoad(page); } catch (e) { console.warn("postLoad failed:", e?.message); }
      }
      await page.screenshot({ path: out, fullPage: true });
      manifest.push({ ...p, file: filename(p), status: "captured" });
      console.log(`✓ [${pad(p.n)}] ${p.slug}`);
    } catch (e) {
      console.error(`✗ ${p.slug}: ${e.message}`);
      manifest.push({ ...p, status: `failed: ${e.message}` });
    }
  }
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\nDone. ${manifest.filter(m => m.status === "captured").length}/${PAGES.length} captured.`);
})();
