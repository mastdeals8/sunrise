import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5000";
const OUT = resolve(process.cwd(), "screenshots/wcc_duplicate_cleanup");
mkdirSync(OUT, { recursive: true });

const results = [];
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};
const record = (name, status, details = {}) => results.push({ name, status, ...details });

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
};

const activeWccSnapshot = async (token) => {
  const rows = await fetch(`${BASE}/api/operations/delivery-challans`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const active = rows.filter((row) => {
    const text = String(row.documentType || row.clientFormat || "");
    return /wcc|ABFRL|ABLBL/i.test(text) && row.status !== "deleted" && !row.metadata?.deleted;
  });
  const groups = new Map();
  for (const row of active) {
    const key = `${row.estimateId}|${String(row.storeCode || row.metadata?.storeCode || row.metadata?.storeId || "").trim().toLowerCase()}|wcc`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const duplicateIds = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const at = new Date(a.createdAt || a.deliveryDate || 0).getTime();
      const bt = new Date(b.createdAt || b.deliveryDate || 0).getTime();
      return bt - at || (b.id || 0) - (a.id || 0);
    });
    duplicateIds.push(...list.slice(1).map((row) => row.id));
  }
  return { active, duplicateIds };
};

(async () => {
  const { token, user } = await login();
  const before = await activeWccSnapshot(token);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(20_000);
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });
  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""), { timeout: 20_000 });

  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const row = rows.find((tr) => /SM\/E\/26-27\/201/.test(tr.textContent || ""));
    if (!row) throw new Error("Estimate row not found");
    const button = Array.from(row.querySelectorAll("button")).find((b) => /^\s*WCC\s*$/.test(b.textContent || ""));
    if (!button) throw new Error("WCC button not found");
    button.click();
  });

  await page.waitForSelector("[data-qa='document-list-modal']");
  await page.waitForTimeout(800);
  await shot(page, "01-before-cleanup-5-wcc-rows");

  const visibleWccNumbers = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-qa='document-list-modal'] tbody tr"))
      .map((row) => row.textContent || "")
      .filter((text) => /SM\/DC\/26-27|DC-776061/.test(text)).length
  );
  const duplicateBadges = await page.locator("text=Duplicate").count();
  const deleteButtons = await page.locator("[data-qa='document-list-modal'] button", { hasText: "Delete" }).count();
  record("5 WCC rows visible before cleanup", visibleWccNumbers === 5 ? "passed" : "failed", { visibleWccNumbers });
  record("Duplicate rows visible before cleanup", duplicateBadges >= 3 ? "passed" : "failed", { duplicateBadges });
  record("Delete action available per WCC row", deleteButtons >= 5 ? "passed" : "failed", { deleteButtons });

  const cleanupButton = page.locator("button", { hasText: "Delete Duplicate WCCs" });
  await cleanupButton.click();
  await page.waitForTimeout(1600);
  await shot(page, "02-after-cleanup-completed");

  const after = await activeWccSnapshot(token);
  record("Cleanup soft-deleted duplicate WCC rows", before.duplicateIds.length === 3 && after.duplicateIds.length === 0 ? "passed" : "failed", {
    beforeActive: before.active.map((row) => ({ id: row.id, dcNumber: row.dcNumber, storeCode: row.storeCode || row.metadata?.storeCode })),
    deletedDuplicateIds: before.duplicateIds,
    afterActive: after.active.map((row) => ({ id: row.id, dcNumber: row.dcNumber, storeCode: row.storeCode || row.metadata?.storeCode })),
    afterDuplicateIds: after.duplicateIds,
  });

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status !== "passed");
  console.log(JSON.stringify({ out: OUT, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
