import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5088";
const OUT = resolve(process.cwd(), "screenshots/project_dashboard_flow");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed ? "passed" : "failed", ...details });
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};

const clickEstimateRowButton = async (page, estimateNumber, reSource, reFlags = "") => {
  await page.evaluate(({ estimateNumber, reSource, reFlags }) => {
    const re = new RegExp(reSource, reFlags);
    const row = Array.from(document.querySelectorAll("tr")).find((tr) => (tr.textContent || "").includes(estimateNumber));
    if (!row) throw new Error(`Estimate row ${estimateNumber} not found`);
    const button = Array.from(row.querySelectorAll("button")).find((b) => re.test(b.textContent || ""));
    if (!button) throw new Error(`Button ${re} not found`);
    button.click();
  }, { estimateNumber, reSource, reFlags });
};

const dashboardState = async (page) => page.evaluate(() => ({
  dashboard: document.querySelectorAll(".estimate-preview-modal").length,
  title: document.body.textContent?.includes("Project Dashboard") || false,
  overview: document.body.textContent?.includes("Overview") || false,
  po: document.body.textContent?.includes("PO") || false,
  execution: document.body.textContent?.includes("Execution") || false,
  documents: document.body.textContent?.includes("Documents") || false,
  invoice: document.body.textContent?.includes("Invoice") || false,
  standalonePoViewer: document.querySelectorAll("[data-qa='po-viewer-modal']").length,
  standaloneDocList: document.querySelectorAll("[data-qa='document-list-modal']").length,
}));

const clickDashboardTab = async (page, label) => {
  await page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll(".estimate-preview-modal button")).find((b) => (b.textContent || "").trim() === label);
    if (!button) throw new Error(`Dashboard tab ${label} not found`);
    button.click();
  }, label);
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
  page.setDefaultTimeout(20_000);

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""));
  await shot(page, "01-estimate-register");

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*Project\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "02-project-dashboard-overview");
  let state = await dashboardState(page);
  record("Estimate Register -> Project opens Project Dashboard", state.dashboard === 1 && state.title && state.overview && state.po && state.execution && state.documents && state.invoice, { state });

  await clickDashboardTab(page, "PO");
  await page.waitForTimeout(300);
  await shot(page, "03-project-dashboard-po-tab");
  record("Project Dashboard PO tab shows PO controls", /PO Number|PO Missing|Replace PO|Upload PO/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Execution");
  await page.waitForTimeout(500);
  await shot(page, "04-project-dashboard-execution-tab");
  record("Project Dashboard Execution tab shows store workflow", /Store execution workspace|WCC \/ DC List|Details/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Documents");
  await page.waitForTimeout(300);
  await shot(page, "05-project-dashboard-documents-tab");
  record("Project Dashboard Documents tab shows project files", /Project Documents|PO|WCC|Files/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Invoice");
  await page.waitForTimeout(300);
  await shot(page, "06-project-dashboard-invoice-tab");
  record("Project Dashboard Invoice tab shows readiness", /Invoice Ready|Not Ready|Generate Invoice|Payment/.test(await page.textContent(".estimate-preview-modal") || ""));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await clickEstimateRowButton(page, "SM/E/26-27/201", "PO Received", "i");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "07-register-po-opens-dashboard-po");
  state = await dashboardState(page);
  record("Estimate Register -> PO opens Project Dashboard, not standalone PO Viewer", state.dashboard === 1 && state.standalonePoViewer === 0 && /PO Number|Replace PO/.test(await page.textContent(".estimate-preview-modal") || ""), { state });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*WCC\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "08-register-wcc-opens-dashboard-execution");
  state = await dashboardState(page);
  record("Estimate Register -> WCC opens Project Dashboard Execution, not standalone list", state.dashboard === 1 && state.standaloneDocList === 0 && /WCC \/ DC List|Store execution workspace/.test(await page.textContent(".estimate-preview-modal") || ""), { state });

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
