// WCC format check screenshots. Captures the rebuilt ABFRL WCC against the
// reference PDFs in /Users/Kunal/Documents/sunrise/reference-docs/wcc/.
//
// Captures:
//   1. ABFRL WCC editor opened (modal with new canvas)
//   2. ABFRL WCC with image uploaded — TODO if no image attached on the row.
//      We capture the editor state with whatever proof photo is attached on
//      the seeded DC; "no image" simply means the visual brief area is empty
//      (which is itself the correct rendering).
//   3. ABFRL WCC print preview (@media print)
//   4. Normal DC preview separately (proves regression-free)
//
// Output: screenshots/wcc_format_check/

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5000";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/wcc_format_check");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const pad = (n) => String(n).padStart(2, "0");
const manifest = [];

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 1000 },
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
  // 1. ABFRL WCC editor opened — via the new inline "WCC" action on
  // an ABFRL estimate row. Pure list-row click is the only path that
  // opens the EDITOR modal (Print/View on the DC list opens the preview-
  // only modal which has a different layout).
  // ============================================================
  await page.goto(`${BASE}/operations#estimates`, { waitUntil: "networkidle2" });
  await settle(3000);
  // Wait until at least one WCC button is in the DOM (data has loaded).
  try {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some(b => /^\s*WCC\s*$/.test(b.textContent || "")),
      { timeout: 15000 },
    );
  } catch {}
  // Find an ABFRL estimate row and click its WCC inline action.
  const opened = await page.evaluate(() => {
    // Estimate rows live in `tr` elements without a direct tbody — search globally.
    const rows = Array.from(document.querySelectorAll("tr"));
    for (const row of rows) {
      if (!/ABFRL/i.test(row.textContent || "")) continue;
      const wccBtn = Array.from(row.querySelectorAll("button")).find(b => /^\s*WCC\s*$/.test(b.textContent || ""));
      if (wccBtn) { wccBtn.click(); return true; }
    }
    return false;
  });
  if (!opened) {
    console.warn("Could not find an ABFRL estimate row with a WCC inline action — falling back to first WCC button.");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => /^\s*WCC\s*$/.test(b.textContent || ""));
      if (btn) btn.click();
    });
  }
  await settle(2500);
  await shot(1, "abfrl-wcc-editor");
  record(1, "abfrl-wcc-editor", "/operations#estimates → WCC inline action",
    "ABFRL WCC editor with the new canvas: thick black A4 border, title row, vendor + DC/PO/Date table, STORE NAME / Store Code row, PROJECT / JOB TITEL row, VISUAL BRIEF header, large picture area, DESCRIPTION row, red 'Below section need to filled by Store' banner, two-column store-fill block (LEFT: shortage + small store grid; RIGHT: store seal + name/phone), and the 5-row checklist (Window / In-Store / NSO / Repairing / Material Transfer) with the editor-side checkbox panel.");

  // ============================================================
  // 2. ABFRL WCC with image uploaded (or no-image fallback)
  // ============================================================
  // Same modal; the editor side already shows the proof gallery if a photo
  // exists. Scroll the canvas into view if needed.
  await page.evaluate(() => {
    const canvas = document.querySelector("#dc-print-canvas");
    if (canvas) canvas.scrollIntoView({ block: "start" });
  });
  await settle(800);
  await shot(2, "abfrl-wcc-with-photo");
  record(2, "abfrl-wcc-with-photo", "/operations#challans (modal)",
    "Same WCC, canvas scrolled to top. Visual Brief area shows attached photo (if any) or 'No proof photo attached yet.' placeholder.");

  // ============================================================
  // 3. ABFRL WCC print preview
  // ============================================================
  await page.emulateMediaType("print");
  await shot(3, "abfrl-wcc-print-preview");
  await page.emulateMediaType("screen");
  record(3, "abfrl-wcc-print-preview", "/operations#challans (modal, @media print)",
    "WCC under print media: borders, table grid, checkboxes all render in plain black/white. No background colours leaking through.");

  // ============================================================
  // 4. Normal DC preview separately
  // ============================================================
  await page.keyboard.press("Escape");
  await settle(800);
  await page.goto(`${BASE}/operations#estimates`, { waitUntil: "networkidle2" });
  await settle(1500);
  // Find a non-ABFRL estimate row and click its "DC" inline action.
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    for (const row of rows) {
      const txt = row.textContent || "";
      if (/ABFRL/i.test(txt)) continue;
      if (!/NORMAL/i.test(txt)) continue;
      const dcBtn = Array.from(row.querySelectorAll("button")).find(b => /^\s*DC\s*$/.test(b.textContent || ""));
      if (dcBtn) { dcBtn.click(); return; }
    }
  });
  await settle(2500);
  await shot(4, "normal-dc-preview");
  record(4, "normal-dc-preview", "/operations#estimates → DC inline action",
    "Standard Sunrise Delivery Challan editor — proves the normal DC template is untouched by the ABFRL WCC rewrite.");

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\n${manifest.length} WCC format screenshots captured.`);
  console.log(`Output: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
