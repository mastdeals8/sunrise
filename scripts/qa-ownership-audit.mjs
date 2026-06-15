import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5088";
const OUT = resolve(process.cwd(), "screenshots/ownership_audit");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed === "skipped" ? "skipped" : (passed ? "passed" : "failed"), ...details });
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};
const overlays = async (page) => page.evaluate(() => ({
  estimatePreview: document.querySelectorAll(".estimate-preview-modal").length,
  poViewer: document.querySelectorAll("[data-qa='po-viewer-modal']").length,
  documentList: document.querySelectorAll("[data-qa='document-list-modal']").length,
  wccPreviewOrEditor: document.querySelectorAll(".wcc-modal-backdrop").length,
  executionDocumentViewer: document.querySelectorAll("[data-qa='execution-document-viewer-modal']").length,
  projectDocumentViewer: document.querySelectorAll("[data-qa='project-document-viewer-modal']").length,
  storeDetails: document.querySelectorAll("[data-estimate-internal-modal='true']").length,
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
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""), { timeout: 20_000 });
  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*View\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await shot(page, "01-estimate-register-view-owner");
  let o = await overlays(page);
  record("Estimate Register -> View opens Estimate Owner only", o.estimatePreview === 1 && o.poViewer === 0 && o.documentList === 0 && o.wccPreviewOrEditor === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await clickEstimateRowButton(page, "SM/E/26-27/201", "PO Received", "i");
  await page.waitForSelector("[data-qa='po-viewer-modal']");
  await shot(page, "02-estimate-register-po-owner");
  o = await overlays(page);
  record("Estimate Register -> PO opens PO Owner only", o.poViewer === 1 && o.estimatePreview === 0 && o.documentList === 0 && o.wccPreviewOrEditor === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*WCC\\s*$");
  await page.waitForSelector("[data-qa='document-list-modal']");
  await shot(page, "03-estimate-register-wcc-list-owner");
  o = await overlays(page);
  record("Estimate Register -> WCC opens Document List Owner only", o.documentList === 1 && o.estimatePreview === 0 && o.poViewer === 0 && o.wccPreviewOrEditor === 0, { overlays: o });
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("[data-qa='document-list-modal'] tbody tr")).find((tr) => /DC-776061|SM\/DC\/26-27\/104/.test(tr.textContent || ""));
    const view = Array.from(row?.querySelectorAll("button") || []).find((button) => /^View$/.test((button.textContent || "").trim()));
    if (!view) throw new Error("WCC list View button not found");
    view.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "04-wcc-register-preview-owner");
  o = await overlays(page);
  record("WCC Register/List -> View opens WCC Preview Owner only above list", o.wccPreviewOrEditor === 1 && o.estimatePreview === 0 && o.poViewer === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("[data-qa='document-list-modal'] tbody tr")).find((tr) => /DC-776061|SM\/DC\/26-27\/104/.test(tr.textContent || ""));
    const edit = Array.from(row?.querySelectorAll("button") || []).find((button) => /^Edit$/.test((button.textContent || "").trim()));
    if (!edit) throw new Error("WCC list Edit button not found");
    edit.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "05-wcc-register-edit-owner");
  o = await overlays(page);
  record("WCC Register/List -> Edit opens WCC Editor Owner only above list", o.wccPreviewOrEditor === 1 && o.estimatePreview === 0 && o.poViewer === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.goto(`${BASE}/delivery-challans`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const wccTab = Array.from(document.querySelectorAll("button")).find((button) => /ABLBL WCC/.test(button.textContent || ""));
    if (wccTab) wccTab.click();
  });
  await page.waitForTimeout(500);
  await shot(page, "06-standalone-wcc-register");
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => /DC-776061|SM\/DC\/26-27\/104/.test(tr.textContent || ""));
    const view = Array.from(row?.querySelectorAll("button") || []).find((button) => /^View$/.test((button.textContent || "").trim()));
    if (!view) throw new Error("Standalone WCC Register View button not found");
    view.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "07-standalone-wcc-register-preview-owner");
  o = await overlays(page);
  record("Standalone WCC Register -> View opens WCC Preview Owner only", o.wccPreviewOrEditor === 1 && o.estimatePreview === 0 && o.poViewer === 0 && o.documentList === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) => /DC-776061|SM\/DC\/26-27\/104/.test(tr.textContent || ""));
    const edit = Array.from(row?.querySelectorAll("button") || []).find((button) => /^Edit$/.test((button.textContent || "").trim()));
    if (!edit) throw new Error("Standalone WCC Register Edit button not found");
    edit.click();
  });
  await page.waitForSelector(".wcc-modal-backdrop");
  await shot(page, "08-standalone-wcc-register-edit-owner");
  o = await overlays(page);
  record("Standalone WCC Register -> Edit opens WCC Editor Owner only", o.wccPreviewOrEditor === 1 && o.estimatePreview === 0 && o.poViewer === 0 && o.documentList === 0, { overlays: o });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /SM\/E\/26-27\/201/.test(document.body.textContent || ""), { timeout: 20_000 });
  await clickEstimateRowButton(page, "SM/E/26-27/201", "^\\s*View\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await page.evaluate(() => {
    const section = Array.from(document.querySelectorAll("h4")).find((el) => /Execution/i.test(el.textContent || ""));
    section?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr"));
    const row = rows.find((tr) => /103298|102293/.test(tr.textContent || "")) || rows.find((tr) => /Details/.test(tr.textContent || ""));
    const details = Array.from(row?.querySelectorAll("button") || []).find((button) => /^Details$/.test((button.textContent || "").trim()));
    if (!details) throw new Error("Execution Details button not found");
    details.click();
  });
  await page.waitForSelector("[data-estimate-internal-modal='true']");
  await shot(page, "09-execution-store-details-owner");
  o = await overlays(page);
  record("Execution Workspace -> Store Details opens Store Details owner", o.storeDetails === 1 && o.wccPreviewOrEditor === 0 && o.poViewer === 0, { overlays: o });
  const docClicked = await page.evaluate(() => {
    const modal = document.querySelector("[data-estimate-internal-modal='true']");
    const buttons = Array.from(modal?.querySelectorAll("button") || []);
    const docButton = buttons.find((button) => /Photo|Signed|View/.test(button.textContent || "") && !/View WCC/.test(button.textContent || "") && !/Upload/.test(button.textContent || ""));
    if (!docButton) return false;
    docButton.click();
    return true;
  });
  if (docClicked) {
    await page.waitForSelector("[data-qa='execution-document-viewer-modal']");
    await shot(page, "10-store-details-document-viewer-owner");
    o = await overlays(page);
    record("Store Details -> Document opens Document Viewer Owner without Estimate Preview", o.executionDocumentViewer === 1 && o.estimatePreview === 0 && o.wccPreviewOrEditor === 0, { overlays: o });
  } else {
    record("Store Details -> Document opens Document Viewer Owner without Estimate Preview", "skipped", { reason: "No document button available in current visible store details" });
  }

  await page.goto(`${BASE}/project-documents`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const projectDocOpened = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => /^View/.test((b.textContent || "").trim()));
    if (!button) return false;
    button.click();
    return true;
  });
  if (projectDocOpened) {
    await page.waitForSelector("[data-qa='project-document-viewer-modal'], [data-qa='execution-document-viewer-modal']", { timeout: 10_000 }).catch(() => {});
    await shot(page, "11-project-documents-viewer-owner");
    o = await overlays(page);
    record("Project Documents -> View opens Project Document Viewer", (o.projectDocumentViewer + o.executionDocumentViewer) >= 1 && o.estimatePreview === 0, { overlays: o });
  } else {
    record("Project Documents -> View opens Project Document Viewer", "skipped", { reason: "No project document row visible" });
  }

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
