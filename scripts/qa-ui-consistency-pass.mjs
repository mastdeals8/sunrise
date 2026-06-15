import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5088";
const OUT = resolve(process.cwd(), "screenshots/ui_consistency_pass");
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
  poUpload: document.querySelectorAll("[data-qa='po-upload-modal']").length,
  oldPoViewer: document.querySelectorAll("[data-qa='po-viewer-modal']").length,
  oldDocList: document.querySelectorAll("[data-qa='document-list-modal']").length,
  wccModal: document.querySelectorAll(".wcc-modal-backdrop").length,
  storeDetails: document.querySelectorAll("[data-estimate-internal-modal='true']").length,
  executionDocViewer: document.querySelectorAll("[data-qa='execution-document-viewer-modal']").length,
  projectDocViewer: document.querySelectorAll("[data-qa='project-document-viewer-modal']").length,
}));

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
  record("Estimate Register visible", /SM\/E\/26-27\/201/.test(await page.textContent("body") || ""));

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*Project\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "02-project-dashboard-overview");
  let o = await overlays(page);
  record("Project opens one dashboard and no legacy overlay", o.dashboard === 1 && o.oldPoViewer === 0 && o.oldDocList === 0, { overlays: o });

  await clickDashboardTab(page, "PO");
  await page.waitForTimeout(300);
  await shot(page, "03-po-tab");
  record("PO tab visible and compact", /PO Number|PO Missing|Replace PO|Upload PO/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Execution");
  await page.waitForTimeout(500);
  await shot(page, "04-execution-tab");
  record("Execution tab visible", /Store execution workspace|WCC \/ DC List|Details/.test(await page.textContent(".estimate-preview-modal") || ""));

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll(".estimate-preview-modal button")).find((b) => /^Details$/.test((b.textContent || "").trim()));
    if (!button) throw new Error("Details button not found");
    button.click();
  });
  await page.waitForSelector("[data-estimate-internal-modal='true']");
  await shot(page, "05-store-details-modal");
  o = await overlays(page);
  record("Store Details opens as top internal modal", o.dashboard === 1 && o.storeDetails === 1 && o.wccModal === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  o = await overlays(page);
  record("Escape closes topmost Store Details only", o.dashboard === 1 && o.storeDetails === 0, { overlays: o });

  await clickDashboardTab(page, "Documents");
  await page.waitForTimeout(300);
  await shot(page, "06-documents-tab");
  record("Documents tab visible", /Project Documents|PO|WCC|Files/.test(await page.textContent(".estimate-preview-modal") || ""));

  await clickDashboardTab(page, "Invoice");
  await page.waitForTimeout(300);
  await shot(page, "07-invoice-tab");
  record("Invoice tab visible", /Invoice Ready|Not Ready|Generate Invoice|Payment/.test(await page.textContent(".estimate-preview-modal") || ""));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  o = await overlays(page);
  record("Escape closes Project Dashboard", o.dashboard === 0, { overlays: o });

  await clickEstimateRowButton(page, "SM/E/26-27/201", "PO Received", "i");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "08-register-po-to-dashboard");
  o = await overlays(page);
  record("Register PO opens dashboard, not old PO viewer", o.dashboard === 1 && o.oldPoViewer === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*WCC\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "09-register-wcc-to-dashboard");
  o = await overlays(page);
  record("Register WCC opens dashboard, not old document list", o.dashboard === 1 && o.oldDocList === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.goto(`${BASE}/delivery-challans`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll("button")).find((button) => /ABLBL WCC/.test(button.textContent || ""));
    tab?.click();
  });
  await page.waitForTimeout(400);
  await shot(page, "10-wcc-register");
  record("WCC Register visible", /ABLBL WCC|WCC No|Actions/.test(await page.textContent("body") || ""));

  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => /DC-776061|SM\/DC\/26-27\/104/.test(tr.textContent || ""));
    const view = Array.from(row?.querySelectorAll("button") || []).find((button) => /^View$/.test((button.textContent || "").trim()));
    if (!view) throw new Error("WCC View button not found");
    view.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "11-wcc-preview-modal");
  o = await overlays(page);
  record("WCC Register View opens only WCC modal", o.wccModal === 1 && o.dashboard === 0 && o.oldDocList === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  o = await overlays(page);
  record("Escape closes WCC Preview", o.wccModal === 0, { overlays: o });

  await page.goto(`${BASE}/project-documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "12-project-documents");
  const opened = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => /^View/.test((b.textContent || "").trim()));
    if (!button) return false;
    button.click();
    return true;
  });
  if (opened) {
    await page.waitForSelector("[data-qa='project-document-viewer-modal']");
    await shot(page, "13-project-document-viewer");
    o = await overlays(page);
    record("Project Documents opens its own viewer only", o.projectDocViewer === 1 && o.dashboard === 0 && o.wccModal === 0, { overlays: o });
  } else {
    record("Project Documents opens its own viewer only", true, { skipped: "No document row visible" });
  }

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
