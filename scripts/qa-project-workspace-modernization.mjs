import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5000";
const OUT = resolve(process.cwd(), "screenshots/project_workspace_modernization");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed ? "passed" : "failed", ...details });
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
};
const text = async (page, selector = "body") => page.locator(selector).textContent().catch(() => "");

const clickByText = async (page, label) => {
  await page.evaluate((label) => {
    const target = Array.from(document.querySelectorAll("button,a")).find((el) => (el.textContent || "").trim() === label);
    if (!target) throw new Error(`Clickable ${label} not found`);
    target.click();
  }, label);
};

const clickWorkspaceTab = async (page, label) => {
  await page.evaluate((label) => {
    const workspace = document.querySelector("[data-qa='project-workspace-page']");
    const target = Array.from(workspace?.querySelectorAll("button") || []).find((el) => (el.textContent || "").trim() === label);
    if (!target) throw new Error(`Workspace tab ${label} not found`);
    target.click();
  }, label);
};

const clickFirstTitle = async (page, title) => {
  await page.evaluate((title) => {
    const workspace = document.querySelector("[data-qa='project-workspace-page']");
    const target = Array.from(workspace?.querySelectorAll("[title]") || []).find((el) => el.getAttribute("title") === title);
    if (!target) throw new Error(`Action ${title} not found`);
    target.click();
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
  await page.waitForFunction(() => /Estimate Register/.test(document.body.textContent || ""));
  await shot(page, "01-estimate-register-project-list");
  const sidebarText = await text(page, ".app-sidebar");
  record("Sidebar reflects project ownership", /Estimate Register/.test(sidebarText || "") && /Projects/.test(sidebarText || "") && /Invoices/.test(sidebarText || "") && /Estimate Templates/.test(sidebarText || "") && !/PO Uploads/.test(sidebarText || "") && !/Delivery Challan \/ WCC/.test(sidebarText || ""));

  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-qa='projects-page']");
  await shot(page, "02-projects-page");
  record("Projects page renders project table", /Operational Projects/.test(await text(page)) && /Open Project/.test(await text(page)));

  await clickByText(page, "Open Project");
  await page.waitForSelector("[data-qa='project-workspace-page']");
  await page.waitForFunction(() => !document.querySelector("[data-qa='project-dashboard-modal']"));
  await page.waitForFunction(() => !/WCC Progress\s*Loading|Signed WCC Progress\s*Loading|Photos Progress\s*Loading/.test(document.querySelector("[data-qa='project-workspace-page']")?.textContent || ""));
  await shot(page, "03-project-workspace-overview-full-page");
  const workspaceOverviewText = await text(page, "[data-qa='project-workspace-page']");
  record("Project Workspace is full page, not popup", await page.locator("[data-qa='project-workspace-page']").count() === 1 && await page.locator("[data-qa='project-dashboard-modal']").count() === 0 && await page.locator(".fixed.inset-0.bg-slate-900\\/60").count().catch(() => 0) === 0);
  record("Overview is command center only", /Project Command Center/.test(workspaceOverviewText || "") && /Recent Activity/.test(workspaceOverviewText || "") && /Pending Actions/.test(workspaceOverviewText || "") && !/Estimate Summary/.test(workspaceOverviewText || ""));
  record("Workspace header removed estimate-era buttons", !/Workflow Status|PO Received|Generate WCC Certificate|Detailed Excel/.test(workspaceOverviewText || "") && /View Estimate|Print Estimate/.test(workspaceOverviewText || ""));
  const kpis = await page.evaluate(() => {
    const text = document.querySelector("[data-qa='project-workspace-page']")?.textContent || "";
    return {
      wcc: /WCC Progress\s*([0-9]+\/[0-9]+)/.exec(text)?.[1] || "",
      signed: /Signed WCC Progress\s*([0-9]+\/[0-9]+)/.exec(text)?.[1] || "",
      photos: /Photos Progress\s*([0-9]+\/[0-9]+)/.exec(text)?.[1] || "",
    };
  });
  record("Overview KPIs have nonzero derived project progress", Boolean(kpis.wcc && kpis.signed && kpis.photos) && !Object.values(kpis).some((value) => /^0\//.test(value)), { kpis });

  await clickWorkspaceTab(page, "Execution");
  await page.waitForFunction(() => /Execution Status/.test(document.querySelector("[data-qa='project-workspace-page']")?.textContent || ""));
  await shot(page, "04-execution-daily-work-screen");
  const executionText = await text(page, "[data-qa='project-workspace-page']");
  record("Execution tab is daily operations only", /Store Code/.test(executionText || "") && /WCC Status/.test(executionText || "") && /Signed WCC Status/.test(executionText || "") && !/WCC \/ DC List/.test(executionText || ""));

  await clickFirstTitle(page, "Open store");
  await page.waitForSelector("[data-qa='store-details-page']");
  await shot(page, "05-store-details-gallery");
  await page.waitForTimeout(800);
  const imageStats = await page.evaluate(() => Array.from(document.querySelectorAll("[data-estimate-internal-modal='true'] img")).map((img) => ({
    src: img.getAttribute("src"),
    complete: img.complete,
    width: img.naturalWidth,
    height: img.naturalHeight,
  })));
  const storeDetailsText = await text(page, "[data-qa='store-details-page']");
  record("Store Details is page, not popup", await page.locator("[data-qa='store-details-page']").count() === 1 && await page.locator(".fixed.inset-0.bg-slate-950\\/60").count().catch(() => 0) === 0 && /Back to Execution/.test(storeDetailsText || ""));
  record("Store Details photo gallery handles thumbnails", /Photo Gallery/.test(storeDetailsText || "") && (/Photo 1/.test(storeDetailsText || "") || /Preview unavailable/.test(storeDetailsText || "")) && imageStats.every((img) => img.complete && img.width > 0 && img.height > 0), { imageStats });
  await clickByText(page, "Back to Execution");
  await page.waitForTimeout(300);

  await clickWorkspaceTab(page, "Documents");
  await page.waitForFunction(() => /Other Documents|Project Documents/.test(document.querySelector("[data-qa='project-workspace-page']")?.textContent || ""));
  await shot(page, "06-documents-cards");
  const documentsText = await text(page, "[data-qa='project-workspace-page']");
  record("Documents tab starts with document cards", /PO/.test(documentsText || "") && /Signed WCC/.test(documentsText || "") && /Photos/.test(documentsText || "") && /Other Documents/.test(documentsText || ""));

  await clickWorkspaceTab(page, "Invoice");
  await page.waitForFunction(() => /Invoice Destination/.test(document.querySelector("[data-qa='project-workspace-page']")?.textContent || ""));
  await shot(page, "07-invoice-destination");
  const invoiceText = await text(page, "[data-qa='project-workspace-page']");
  record("Invoice tab is final project destination", /Final Project Stage|Invoice Destination|Generate Invoice|Open Generated Invoice|Print \/ View Invoice PDF/.test(invoiceText || ""));

  await page.goto(`${BASE}/delivery-challans`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /WCC Audit Register/.test(document.body.textContent || ""));
  await shot(page, "08-wcc-audit-register");
  const wccText = await text(page);
  record("WCC Register is audit/history/reprint oriented", /Audit \/ History \/ Reprint/.test(wccText || "") && /Daily execution work stays inside Project Workspace/.test(wccText || ""));

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
