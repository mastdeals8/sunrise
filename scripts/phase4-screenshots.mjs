// Phase 4 UI modernization — before/after screenshot capture.
// Usage:
//   1) Start the app:  npm run dev   (or your prod start)
//   2) BEFORE the UI changes:  PHASE=before node scripts/phase4-screenshots.mjs
//   3) AFTER  the UI changes:  PHASE=after  node scripts/phase4-screenshots.mjs
//   4) Compare screenshots/phase4/before vs screenshots/phase4/after
//
// Captures desktop (1440px) and mobile (390px) for each target screen.
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5000";
const USER = process.env.QA_USER || "admin";
const PASS = process.env.QA_PASS || "admin123";
const PHASE = process.env.PHASE || "after";
const OUT = resolve(process.cwd(), `screenshots/phase4/${PHASE}`);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// The seven Phase-4 target areas. Routes only — adjust IDs to a real project
// in your data if deep links differ.
const SCREENS = [
  { slug: "sidebar-dashboard", route: "/" },
  { slug: "project-workspace", route: "/operations" },
  { slug: "execution",         route: "/operations" }, // navigate to Execution tab in-app
  { slug: "documents",         route: "/project-documents" },
  { slug: "wcc-register",      route: "/delivery-challans" },
  { slug: "client-ledger",     route: "/client-ledger" },
  { slug: "finance",           route: "/finance" },
];

const VIEWPORTS = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "mobile",  width: 390,  height: 844 },
];

const run = async () => {
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();

    // login
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    if (await page.locator('input[type="password"]').count()) {
      await page.fill('input[name="username"], input[type="text"]', USER).catch(() => {});
      await page.fill('input[type="password"]', PASS).catch(() => {});
      await page.click('button[type="submit"]').catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    for (const s of SCREENS) {
      try {
        await page.goto(`${BASE}${s.route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${s.slug}-${vp.tag}.png`, fullPage: true });
        console.log(`captured ${PHASE}/${s.slug}-${vp.tag}.png`);
      } catch (e) {
        console.warn(`skip ${s.slug}-${vp.tag}: ${e.message}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nDone. Screenshots in ${OUT}`);
};

run().catch((e) => { console.error(e); process.exit(1); });
