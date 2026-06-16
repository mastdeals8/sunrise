import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5000";
const OUT = resolve(process.cwd(), "screenshots/execution_documents_invoice_readiness");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed ? "passed" : "failed", ...details });
const skip = (name, details = {}) => results.push({ name, status: "skipped", ...details });
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};

const api = async (path, token) => {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
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

const clickDashboardTab = async (page, label) => {
  await page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll(".estimate-preview-modal button")).find((b) => (b.textContent || "").trim() === label);
    if (!button) throw new Error(`Dashboard tab ${label} not found`);
    button.click();
  }, label);
};

const deriveReadiness = (estimate, stores) => {
  const storeCount = stores.length;
  const generated = stores.filter((row) => ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0).length;
  const signed = stores.filter((row) => ((row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)) > 0).length;
  const photos = stores.filter((row) => (row.stats?.photoCount || 0) > 0).length;
  const completed = stores.filter((row) => row.status === "completed" || (
    ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0 &&
    ((row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)) > 0 &&
    (row.stats?.photoCount || 0) > 0
  )).length;
  const checks = {
    poAttached: Boolean(estimate.poNumber || estimate.poFilePath),
    wccGenerated: storeCount > 0 && generated >= storeCount,
    signedWccReceived: storeCount > 0 && signed >= storeCount,
    photosUploaded: storeCount > 0 && photos >= storeCount,
    executionComplete: storeCount > 0 && completed >= storeCount,
  };
  return { estimateNumber: estimate.estimateNumber, storeCount, generated, signed, photos, completed, checks, ready: Object.values(checks).every(Boolean) };
};

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { token, user } = await login.json();

  const estimates = await api("/api/operations/estimates", token);
  const readiness = [];
  for (const estimate of estimates) {
    const stores = await api(`/api/operations/execution-stores?estimateId=${estimate.id}`, token);
    readiness.push(deriveReadiness(estimate, stores));
  }
  const readyProject = readiness.find((row) => row.ready) || null;
  const notReadyProject = readiness.find((row) => !row.ready) || null;
  if (readyProject) record("Ready project example found", true, readyProject);
  else skip("Ready project example unavailable in current data", { note: "No invoice-ready project exists in current data" });
  record("Not ready project example found", Boolean(notReadyProject), notReadyProject || {});

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

  const testEstimate = notReadyProject?.estimateNumber || readyProject?.estimateNumber || "SM/E/26-27/201";
  await clickEstimateRowButton(page, testEstimate, "^\\s*Project\\s*$");
  await page.waitForSelector(".estimate-preview-modal");

  await clickDashboardTab(page, "Execution");
  await page.waitForTimeout(600);
  await shot(page, "02-project-dashboard-execution-polished");
  let text = await page.textContent(".estimate-preview-modal") || "";
  record("Estimate Register -> Project Dashboard -> Execution", /Stores|Completed|Pending|WCC Generated|Signed WCC Received|Photos Uploaded|Last Activity|Last Updated|Execution Status|Upload Signed|Upload Photos/.test(text));

  await clickDashboardTab(page, "Documents");
  await page.waitForTimeout(400);
  await shot(page, "03-project-dashboard-documents-polished");
  text = await page.textContent(".estimate-preview-modal") || "";
  record("Estimate Register -> Project Dashboard -> Documents", /Project Documents|Document Type|File Name|Uploaded By|Uploaded Date|Replace|History|Delete/.test(text));

  await clickDashboardTab(page, "Invoice");
  await page.waitForTimeout(400);
  await shot(page, "04-project-dashboard-invoice-readiness");
  text = await page.textContent(".estimate-preview-modal") || "";
  record("Estimate Register -> Project Dashboard -> Invoice", /PO Attached|WCC Generated|Signed WCC Received|Photos Uploaded|Execution Complete|Invoice Ready: (YES|NO)/.test(text));
  record("Invoice tab is readiness-only", !/Generate Invoice/.test(text));

  if (readyProject) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await clickEstimateRowButton(page, readyProject.estimateNumber, "^\\s*Project\\s*$");
    await page.waitForSelector(".estimate-preview-modal");
    await clickDashboardTab(page, "Invoice");
    await page.waitForTimeout(400);
    await shot(page, "05-ready-project-invoice-example");
  }

  if (notReadyProject) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await clickEstimateRowButton(page, notReadyProject.estimateNumber, "^\\s*Project\\s*$");
    await page.waitForSelector(".estimate-preview-modal");
    await clickDashboardTab(page, "Invoice");
    await page.waitForTimeout(400);
    await shot(page, "06-not-ready-project-invoice-example");
  }

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify({ results, readiness }, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, readiness, results }, null, 2));
  if (failed.length) process.exit(1);
})();
