import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5000";
const OUT = resolve(process.cwd(), "screenshots/ui_modernization");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed ? "passed" : "failed", ...details });
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};
const overlays = async (page) => page.evaluate(() => ({
  dashboard: document.querySelectorAll(".estimate-preview-modal").length,
  wcc: document.querySelectorAll(".wcc-modal-backdrop").length,
  docViewer: document.querySelectorAll("[data-qa='execution-document-viewer-modal']").length,
  storeDetails: document.querySelectorAll("[data-estimate-internal-modal='true']").length,
}));

const clickEstimateRowButton = async (page, estimateNumber, reSource, reFlags = "") => {
  await page.evaluate(({ estimateNumber, reSource, reFlags }) => {
    const re = new RegExp(reSource, reFlags);
    const row = Array.from(document.querySelectorAll("tr")).find((tr) => (tr.textContent || "").includes(estimateNumber));
    if (!row) throw new Error(`Estimate row ${estimateNumber} not found`);
    const button = Array.from(row.querySelectorAll("button,a")).find((b) => re.test(b.textContent || ""));
    if (!button) throw new Error(`Button ${re} not found`);
    button.click();
  }, { estimateNumber, reSource, reFlags });
};

const clickDashboardTab = async (page, label) => {
  await page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll(".estimate-preview-modal button")).find((b) => (b.textContent || "").trim() === label);
    if (!button) throw new Error(`Dashboard tab ${label} not found`);
    button.click();
  }, label);
};

const clickFirstExecutionIcon = async (page, title) => {
  await page.evaluate((title) => {
    const button = Array.from(document.querySelectorAll(".estimate-preview-modal [title]")).find((el) => (el.getAttribute("title") || "") === title);
    if (!button) throw new Error(`${title} action not found`);
    button.click();
  }, title);
};

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { token, user } = await login.json();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(25_000);

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""));
  await shot(page, "01-estimate-register-project-list");
  const rowActions = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tr")).find((tr) => (tr.textContent || "").includes("SM/E/26-27/201"));
    return Array.from(row?.querySelectorAll("button,a") || []).map((el) => (el.textContent || "").trim()).filter(Boolean);
  });
  record("Estimate Register row is simplified", rowActions.includes("Project") && rowActions.includes("Edit") && rowActions.includes("Excel") && !rowActions.some((text) => /Upload PO|PO Received|WCC|Invoice|Open Invoice/.test(text)), { rowActions });

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*Project\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await page.waitForFunction(() => /Project Command Center/.test(document.querySelector(".estimate-preview-modal")?.textContent || ""));
  await shot(page, "02-dashboard-overview-modernized");
  record("Project Dashboard overview command center visible", /Project Command Center|PO Status|Invoice Status/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Execution");
  await page.waitForFunction(() => /Last Activity|Execution Status/.test(document.querySelector(".estimate-preview-modal")?.textContent || ""));
  await shot(page, "03-execution-modernized");
  record("Execution tab uses compact icon actions", await page.locator(".estimate-preview-modal [title='View WCC']").count() > 0 && await page.locator(".estimate-preview-modal [title='Upload Photos']").count() > 0);

  await clickFirstExecutionIcon(page, "View WCC");
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "04-wcc-preview-owned-by-dashboard");
  let o = await overlays(page);
  record("Dashboard remains owner behind WCC preview", o.dashboard === 1 && o.wcc === 1, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  o = await overlays(page);
  record("Closing WCC preview returns to dashboard execution", o.dashboard === 1 && o.wcc === 0 && /Execution/.test(await page.textContent(".estimate-preview-modal") || ""), { overlays: o });

  await clickFirstExecutionIcon(page, "Edit WCC");
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "05-wcc-editor-owned-by-dashboard");
  o = await overlays(page);
  record("Dashboard remains owner behind WCC editor", o.dashboard === 1 && o.wcc === 1, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  o = await overlays(page);
  record("Closing WCC editor returns to dashboard execution", o.dashboard === 1 && o.wcc === 0, { overlays: o });

  await clickFirstExecutionIcon(page, "Open store");
  await page.waitForSelector("[data-estimate-internal-modal='true']");
  await shot(page, "06-store-details-modernized");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await clickDashboardTab(page, "Documents");
  await page.waitForFunction(() => /Document Type|Project Documents/.test(document.querySelector(".estimate-preview-modal")?.textContent || ""));
  await shot(page, "07-documents-modernized");
  record("Documents tab has indicators and compact actions", await page.locator(".estimate-preview-modal [title='History']").count() > 0 && /Project Documents/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Invoice");
  await page.waitForTimeout(500);
  await shot(page, "08-invoice-modernized");

  await page.goto(`${BASE}/delivery-challans`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "09-wcc-register-history-screen");
  await page.goto(`${BASE}/project-documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "10-project-documents-history-screen");

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
