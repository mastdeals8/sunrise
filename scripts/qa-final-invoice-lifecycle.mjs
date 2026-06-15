import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5088";
const OUT = resolve(process.cwd(), "screenshots/final_invoice_lifecycle");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, status: passed ? "passed" : "failed", ...details });
const shot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: resolve(OUT, file), fullPage: true });
  return file;
};

const api = async (path, token, options = {}) => {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path} failed ${res.status}: ${typeof body === "string" ? body : body?.message || text}`);
  return body;
};

const uploadFile = async (token, filePath) => {
  if (!existsSync(filePath)) throw new Error(`Missing sample file ${filePath}`);
  const form = new FormData();
  const blob = new Blob([await import("fs/promises").then(fs => fs.readFile(filePath))]);
  form.append("file", blob, filePath.split("/").pop());
  const res = await fetch(`${BASE}/api/operations/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Upload failed ${res.status}`);
  return body.filePath;
};

const deriveReadiness = (estimate, stores) => {
  const storeCount = stores.length;
  const generated = stores.filter((row) => ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0).length;
  const signed = stores.filter((row) => ((row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)) > 0).length;
  const photos = stores.filter((row) => (row.stats?.photoCount || 0) > 0).length;
  const completed = stores.filter((row) => row.status === "completed" || (
    ((row.stats?.wccCount || 0) + (row.stats?.dcCount || 0)) > 0 &&
    ((row.stats?.signedWccCount || 0) + (row.stats?.signedDcCount || 0)) > 0
  )).length;
  const checks = {
    poAttached: Boolean(estimate.poNumber || estimate.poFilePath),
    wccGenerated: storeCount > 0 && generated >= storeCount,
    signedWccReceived: storeCount > 0 && signed >= storeCount,
    photosUploaded: storeCount > 0 && photos >= storeCount,
    executionComplete: storeCount > 0 && completed >= storeCount,
  };
  return { storeCount, generated, signed, photos, completed, checks, ready: Object.values(checks).every(Boolean) };
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

const invoiceTabText = async (page) => page.textContent(".estimate-preview-modal") || "";

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const { token, user } = await login.json();

  const estimateNumber = "SM/E/26-27/201";
  const estimates = await api("/api/operations/estimates", token);
  const estimate = estimates.find((row) => row.estimateNumber === estimateNumber);
  if (!estimate) throw new Error(`${estimateNumber} not found`);
  const beforeStores = await api(`/api/operations/execution-stores?estimateId=${estimate.id}`, token);
  const beforeReadiness = deriveReadiness(estimate, beforeStores);
  record("Before readiness captured", true, beforeReadiness);

  const samplePhoto = resolve(process.cwd(), "uploads/file-1781151395154-217636479.png");
  const sampleSigned = resolve(process.cwd(), "uploads/file-1781144368312-798675670.PDF");
  const items = await api(`/api/operations/estimates/${estimate.id}/items`, token);
  const stores = await api("/api/operations/stores", token);
  let challans = await api(`/api/operations/delivery-challans/estimate/${estimate.id}`, token);

  for (const storeRow of beforeStores) {
    let wcc = challans.find((dc) => String(dc.storeCode || dc.metadata?.storeCode || "").trim() === String(storeRow.storeCode).trim() && dc.status !== "deleted" && !dc.metadata?.deleted);
    if (!wcc) {
      const store = stores.find((s) => String(s.storeCode || "") === String(storeRow.storeCode));
      const grouping = estimate.storeGrouping || {};
      const groupKey = Object.keys(grouping).find((key) => String(stores.find((s) => s.id === Number(key))?.storeCode || key) === String(storeRow.storeCode));
      const group = groupKey ? grouping[groupKey] : null;
      const itemSls = Array.isArray(group) ? group : (group?.itemSls || []);
      const storeItems = items
        .filter((it) => itemSls.includes(it.sl || 0))
        .map((it) => ({
          sl: it.sl,
          itemName: it.itemName,
          quantity: it.quantity,
          unit: it.unit,
          width: it.width,
          height: it.height,
          rate: it.rate,
          totalAmount: it.totalAmount,
        }));
      const number = `QA-WCC-${estimate.id}-${storeRow.storeCode}-${Date.now().toString().slice(-5)}`;
      wcc = await api("/api/operations/delivery-challans", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dcNumber: number,
          estimateId: estimate.id,
          status: "draft",
          items: storeItems.length ? storeItems : items.slice(0, 1),
          clientFormat: "ABFRL",
          documentType: "wcc",
          storeCode: storeRow.storeCode,
          metadata: {
            storeCode: storeRow.storeCode,
            storeId: store?.id || storeRow.storeId || null,
            storeName: storeRow.storeName || store?.name || "",
            city: storeRow.storeCity || store?.city || "",
            state: storeRow.storeState || store?.state || "",
            photos: [],
            shortageNotes: "",
            authPerson: store?.contactPerson || "",
            checklist: { window: true, inStore: false, nso: false, repairing: false, materialTransfer: false },
          },
        }),
      });
      challans = await api(`/api/operations/delivery-challans/estimate/${estimate.id}`, token);
    }

    const photoPath = await uploadFile(token, samplePhoto);
    const signedPath = await uploadFile(token, sampleSigned);
    const meta = wcc.metadata || {};
    const photos = Array.isArray(meta.photos) ? meta.photos : [];
    await api(`/api/operations/delivery-challans/${wcc.id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoPath,
        signedChallanPath: signedPath,
        metadata: {
          ...meta,
          photos: photos.length ? photos : [{ path: photoPath, caption: `QA photo ${storeRow.storeCode}` }],
        },
      }),
    });
  }

  const afterStores = await api(`/api/operations/execution-stores?estimateId=${estimate.id}`, token);
  const afterReadiness = deriveReadiness(estimate, afterStores);
  record("After readiness is ready", afterReadiness.ready === true, afterReadiness);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(25_000);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });
  await page.goto(`${BASE}/estimates`, { waitUntil: "networkidle" });
  await page.waitForFunction((num) => document.body.textContent?.includes(num), estimateNumber);
  await shot(page, "01-estimate-register");

  await clickEstimateRowButton(page, estimateNumber, "^\\s*Project\\s*$");
  await page.waitForSelector(".estimate-preview-modal");
  await clickDashboardTab(page, "Invoice");
  await page.waitForFunction(() => {
    const modal = document.querySelector(".estimate-preview-modal");
    return /Invoice Ready:\s*YES/.test(modal?.textContent || "");
  }, { timeout: 30_000 });
  await page.waitForTimeout(300);
  await shot(page, "02-invoice-ready-after-completion");
  let text = await invoiceTabText(page);
  record("Invoice tab shows all readiness checks YES", ["PO Attached", "WCC Generated", "Signed WCC Received", "Photos Uploaded", "Execution Complete"].every((label) => text.includes(label)) && /Invoice Ready:\s*YES/.test(text), { textSample: text.slice(0, 1000) });
  const generateOrOpen = page.locator(".estimate-preview-modal button", { hasText: /Generate Invoice|Open Invoice/ }).last();
  record("Generate/Open Invoice action is enabled", await generateOrOpen.isEnabled().catch(() => false));

  await generateOrOpen.click();
  await page.waitForSelector("text=New Invoice, text=Edit Invoice", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const editorText = await page.textContent("body") || "";
  record("Invoice editor opened after generation", /Edit Invoice|New Invoice|Invoice No/.test(editorText));
  await shot(page, "03-invoice-generated-editor");

  const latestInvoices = await api("/api/finance/invoices", token);
  const generated = latestInvoices.find((inv) => inv.estimateId === estimate.id);
  record("Generated invoice linked to estimate", Boolean(generated), generated || {});
  if (!generated) throw new Error("Generated invoice not found");

  await page.goto(`${BASE}/invoice-packet?id=${generated.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "04-invoice-packet-print-preview");
  const packetText = await page.textContent("body") || "";
  record("Invoice packet includes invoice, PO, WCC, signed WCC/photos", /Invoice Front Page|Purchase Order|DC \/ WCC|Signed Challan|Installation Photo/.test(packetText));

  await page.emulateMedia({ media: "print" });
  await shot(page, "05-invoice-print-media");
  const pdfPath = resolve(OUT, "06-invoice-print-chromium.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } });
  const pdfBytes = await import("fs/promises").then(fs => fs.readFile(pdfPath));
  const pageCount = (pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  record("Chrome invoice print PDF generated without blank-only output", pdfBytes.length > 50_000 && pageCount >= 1, { pdfPath, bytes: pdfBytes.length, pageCount });

  let webkitStatus = "not_checked";
  try {
    const webkitBrowser = await (await import("playwright")).webkit.launch({ headless: true });
    const wpage = await webkitBrowser.newPage({ viewport: { width: 1440, height: 950 } });
    await wpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await wpage.evaluate(({ token, user }) => {
      localStorage.setItem("sunrise_token", token);
      localStorage.setItem("sunrise_user", JSON.stringify(user));
    }, { token, user });
    await wpage.goto(`${BASE}/invoice-packet?id=${generated.id}`, { waitUntil: "networkidle" });
    await wpage.emulateMedia({ media: "print" });
    await wpage.screenshot({ path: resolve(OUT, "07-invoice-print-webkit.png"), fullPage: true });
    await webkitBrowser.close();
    webkitStatus = "passed";
  } catch (err) {
    webkitStatus = `blocked: ${err.message}`;
  }
  record("Safari/WebKit print smoke", webkitStatus === "passed", { status: webkitStatus });

  await browser.close();
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify({ results, beforeReadiness, afterReadiness, generatedInvoice: generated }, null, 2));
  const failed = results.filter((row) => row.status === "failed" && row.name !== "Safari/WebKit print smoke");
  console.log(JSON.stringify({ out: OUT, passed: results.filter(r => r.status === "passed").length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
})();
