import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5088";
const OUT = resolve(process.cwd(), "screenshots/ui_workflow_stabilization");
mkdirSync(OUT, { recursive: true });

const results = [];
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};
const record = (name, status, details = {}) => results.push({ name, status, ...details });

const waitForApp = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
};

const clickByText = async (page, selector, pattern) => {
  const handle = await page.evaluateHandle(({ selector, source, flags }) => {
    const re = new RegExp(source, flags);
    return Array.from(document.querySelectorAll(selector)).find((el) => re.test(el.textContent || "")) || null;
  }, { selector, source: pattern.source, flags: pattern.flags });
  const el = handle.asElement();
  if (!el) throw new Error(`No ${selector} matched ${pattern}`);
  await el.click();
};

const countOverlays = async (page) => page.evaluate(() => ({
  estimate: document.querySelectorAll(".estimate-preview-modal").length,
  po: document.querySelectorAll("[data-qa='po-upload-modal']").length,
  poViewer: document.querySelectorAll("[data-qa='po-viewer-modal']").length,
  docList: document.querySelectorAll("[data-qa='document-list-modal']").length,
  wcc: document.querySelectorAll(".wcc-modal-backdrop").length,
  internal: document.querySelectorAll("[data-estimate-internal-modal='true']").length,
}));

const clickEstimateRowButton = async (page, estimateNumber, matcherSource, matcherFlags = "") => {
  await page.evaluate(({ estimateNumber, matcherSource, matcherFlags }) => {
    const re = new RegExp(matcherSource, matcherFlags);
    const rows = Array.from(document.querySelectorAll("tr"));
    const row = rows.find((tr) => (tr.textContent || "").includes(estimateNumber));
    if (!row) throw new Error(`Estimate ${estimateNumber} row not found`);
    const button = Array.from(row.querySelectorAll("button")).find((b) => re.test(b.textContent || ""));
    if (!button) throw new Error(`Button ${re} not found for ${estimateNumber}`);
    button.click();
  }, { estimateNumber, matcherSource, matcherFlags });
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(20_000);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { token, user } = await login.json();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });
  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await waitForApp(page);
  if (!(await page.locator("text=SM/E/26-27/201").count())) {
    await clickByText(page, "button,a", /Estimate Register/i).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""), { timeout: 20_000 });
  await shot(page, "01-estimate-register");
  record("Estimate register opens", "passed");

  await clickEstimateRowButton(page, "SM/E/26-27/201", "PO Received", "i");
  await waitForApp(page);
  await page.waitForSelector("[data-qa='po-viewer-modal']");
  const poOverlayCounts = await countOverlays(page);
  const poDetailsVisible = await page.locator("text=PO Number").count();
  await shot(page, "02-po-opens-directly");
  record("Estimate Register -> PO opens PO Viewer directly", poOverlayCounts.poViewer === 1 && poOverlayCounts.estimate === 0 && poOverlayCounts.po === 0 && poDetailsVisible > 0 ? "passed" : "failed", { poOverlayCounts, poDetailsVisible });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record("Escape closes PO Viewer", (await countOverlays(page)).poViewer === 0 ? "passed" : "failed");

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*WCC\\s*$");
  await waitForApp(page);
  await page.waitForSelector("[data-qa='document-list-modal']");
  await page.waitForSelector("text=WCC List");
  await page.waitForTimeout(400);
  const wccCounts = await countOverlays(page);
  const tableRows = await page.locator("text=SM/DC/26-27").count();
  await shot(page, "03-wcc-list-opens-directly");
  record("Estimate Register -> WCC opens WCC List directly", wccCounts.docList === 1 && wccCounts.estimate === 0 && wccCounts.wcc === 0 && tableRows > 0 ? "passed" : "failed", { wccCounts, tableRows });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record("Escape closes WCC List", (await countOverlays(page)).docList === 0 ? "passed" : "failed");

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*View\\s*$");
  await waitForApp(page);
  await page.waitForSelector(".estimate-preview-modal");
  const viewEstimateCounts = await countOverlays(page);
  await shot(page, "04-view-opens-estimate-preview");
  record("Estimate Register -> View opens Estimate Preview", viewEstimateCounts.estimate === 1 && viewEstimateCounts.docList === 0 && viewEstimateCounts.poViewer === 0 ? "passed" : "failed", { viewEstimateCounts });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record("Escape closes Estimate Preview", (await countOverlays(page)).estimate === 0 ? "passed" : "failed");

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*WCC\\s*$");
  await waitForApp(page);
  await page.waitForSelector("[data-qa='document-list-modal']");
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const row = rows.find((tr) => /SM\/DC\/26-27\/104/.test(tr.textContent || "") && Array.from(tr.querySelectorAll("button")).some((b) => /^\s*Edit\s*$/.test(b.textContent || "")))
      || rows.find((tr) => /SM\/DC\/26-27/.test(tr.textContent || "") && Array.from(tr.querySelectorAll("button")).some((b) => /^\s*Edit\s*$/.test(b.textContent || "")));
    if (!row) throw new Error("WCC row not found for edit");
    const edit = Array.from(row.querySelectorAll("button")).find((b) => /^\s*Edit\s*$/.test(b.textContent || ""));
    if (!edit) throw new Error("Edit action not found");
    edit.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  const editCounts = await countOverlays(page);
  await shot(page, "05-wcc-edit-from-standalone-list");
  record("WCC Edit from standalone list opens WCC editor only", editCounts.estimate === 0 && editCounts.docList === 1 && editCounts.wcc === 1 ? "passed" : "failed", { editCounts });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  record("Escape closes WCC editor", (await countOverlays(page)).wcc === 0 ? "passed" : "failed");

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status !== "passed");
  console.log(JSON.stringify({ out: OUT, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
