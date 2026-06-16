import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE || "http://localhost:5000";
const OUT = resolve(process.cwd(), "screenshots/go_live_signoff");
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, passed, details = {}) => results.push({ name, ...details, status: passed ? "passed" : "failed" });
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: true });
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

const loginAs = async (username, password) => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed for ${username}: ${body.message || res.status}`);
  return body;
};

const ensureUser = async (adminToken, user) => {
  const users = await api("/api/users", adminToken);
  const existing = users.find((row) => row.username === user.username);
  if (existing) return existing;
  const created = await api("/api/auth/register", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  return created.user;
};

const uploadFile = async (token, filePath, mimeType = "application/octet-stream") => {
  if (!existsSync(filePath)) throw new Error(`Missing sample file ${filePath}`);
  const form = new FormData();
  const blob = new Blob([await readFile(filePath)], { type: mimeType });
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
  const completed = stores.filter((row) => row.status === "completed").length;
  const checks = {
    poAttached: Boolean(estimate.poNumber || estimate.poFilePath),
    wccGenerated: storeCount > 0 && generated >= storeCount,
    signedWccReceived: storeCount > 0 && signed >= storeCount,
    photosUploaded: storeCount > 0 && photos >= storeCount,
    executionComplete: storeCount > 0 && completed >= storeCount,
  };
  return { storeCount, generated, signed, photos, completed, checks, ready: Object.values(checks).every(Boolean) };
};

const clickWorkspaceTab = async (page, label) => {
  await page.evaluate((label) => {
    const workspace = document.querySelector("[data-qa='project-workspace-page']");
    const target = Array.from(workspace?.querySelectorAll("button") || []).find((el) => (el.textContent || "").trim() === label);
    if (!target) throw new Error(`Workspace tab ${label} not found`);
    target.click();
  }, label);
};

const main = async () => {
  const adminLogin = await loginAs("admin", "admin123");
  const adminToken = adminLogin.token;

  const roleUsers = [
    { username: "qa_manager", password: "QAmanager123!", email: "qa.manager@sunrisemedia.in", name: "QA Manager", role: "manager", employeeId: "QA-MANAGER" },
    { username: "qa_execution", password: "QAexecution123!", email: "qa.execution@sunrisemedia.in", name: "QA Execution User", role: "production", employeeId: "QA-EXECUTION" },
  ];
  for (const user of roleUsers) await ensureUser(adminToken, user);
  const managerLogin = await loginAs("qa_manager", "QAmanager123!");
  const executionLogin = await loginAs("qa_execution", "QAexecution123!");
  record("Admin login works", Boolean(adminToken), { role: adminLogin.user.role });
  record("Manager login works", managerLogin.user.role === "manager", { role: managerLogin.user.role });
  record("Execution user login works", executionLogin.user.role === "production", { role: executionLogin.user.role });

  const clients = await api("/api/operations/clients", adminToken);
  const brands = await api("/api/operations/brands", adminToken);
  const stores = await api("/api/operations/stores", adminToken);
  const products = await api("/api/operations/products", adminToken);
  const client = clients.find((row) => /aditya|abfrl|ablbl/i.test(`${row.name} ${row.clientGroupName || ""}`)) || clients[0];
  const brand = brands.find((row) => row.parentClientId === client.id) || brands[0];
  const projectStores = stores.filter((row) => row.clientId === client.id && (!brand || row.brandId === brand.id)).slice(0, 2);
  if (projectStores.length < 2) throw new Error("Need at least two stores for golden project");
  const product = products[0];
  if (!client || !brand || !product) throw new Error("Missing client/brand/product master data");

  const samplePhoto = resolve(process.cwd(), "uploads/file-1779733286421-225509077.jpg");
  const sampleSigned = resolve(process.cwd(), "uploads/file-1781144368312-798675670.PDF");
  const samplePo = resolve(process.cwd(), "uploads/file-1781149464877-750518154.PDF");
  const poPath = await uploadFile(adminToken, samplePo, "application/pdf");

  const storeGrouping = {};
  const items = [];
  projectStores.forEach((store, index) => {
    const sl = index + 1;
    storeGrouping[String(store.id)] = {
      storeName: store.name,
      storeCode: store.storeCode,
      storeCity: store.city,
      storeState: store.state,
      storeAddress: store.address,
      itemSls: [sl],
    };
    items.push({
      sl,
      productId: product.id,
      itemName: product.name || "Golden Project Signage",
      description: "Golden project QA execution item",
      quantity: 1,
      unit: "pcs",
      rate: 1000,
      totalPrice: 1000,
      totalAmount: 1180,
      cgstPercent: 9,
      sgstPercent: 9,
      cgstAmount: 90,
      sgstAmount: 90,
      igstPercent: 0,
      igstAmount: 0,
      width: 10,
      height: 10,
      totalSize: 100,
    });
  });

  const createdEstimate = await api("/api/operations/estimates", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      estimate: {
        title: `Golden Project QA ${Date.now()}`,
        clientId: client.id,
        brandId: brand.id,
        storeId: projectStores[0].id,
        clientFormat: "ABLBL",
        status: "po_received",
        estimateDate: new Date().toISOString(),
        totalAmount: 2360,
        subtotal: 2000,
        cgstAmount: 180,
        sgstAmount: 180,
        igstAmount: 0,
        taxAmount: 360,
        gstType: "CGST+SGST",
        storeGrouping,
        poNumber: `QA-PO-${Date.now()}`,
        poDate: new Date().toISOString(),
        poAmount: 2360,
        poFilePath: poPath,
      },
      items,
    }),
  });
  const estimate = createdEstimate.estimate || createdEstimate;
  record("Golden estimate created through existing estimate API", Boolean(estimate.id && estimate.estimateNumber), { estimateNumber: estimate.estimateNumber, id: estimate.id });

  let executionStores = await api(`/api/operations/execution-stores?estimateId=${estimate.id}`, adminToken);
  record("Golden execution stores backfilled", executionStores.length === projectStores.length, { stores: executionStores.map((row) => row.storeCode) });

  const estimateItems = await api(`/api/operations/estimates/${estimate.id}/items`, adminToken);
  const generatedWccs = [];
  for (const row of executionStores) {
    const dcNumber = (await api("/api/numbering/dc/next", adminToken)).number;
    const store = projectStores.find((item) => String(item.storeCode) === String(row.storeCode));
    const grouping = storeGrouping[String(store?.id)];
    const itemSls = grouping?.itemSls || [];
    const storeItems = estimateItems.filter((item) => itemSls.includes(item.sl));
    const wcc = await api("/api/operations/delivery-challans", adminToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dcNumber,
        estimateId: estimate.id,
        status: "draft",
        documentType: "wcc",
        clientFormat: "ABFRL",
        storeCode: row.storeCode,
        items: storeItems,
        metadata: {
          storeCode: row.storeCode,
          storeId: store?.id || row.storeId,
          storeName: row.storeName || store?.name,
          city: row.storeCity || store?.city,
          state: row.storeState || store?.state,
          photos: [],
          checklist: { window: true, inStore: true, nso: false, repairing: false, materialTransfer: false },
        },
      }),
    });
    generatedWccs.push(wcc);
    const photoPath = await uploadFile(adminToken, samplePhoto, "image/jpeg");
    const signedPath = await uploadFile(adminToken, sampleSigned, "application/pdf");
    await api(`/api/operations/delivery-challans/${wcc.id}`, adminToken, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photoPath,
        signedChallanPath: signedPath,
        metadata: {
          ...(wcc.metadata || {}),
          photos: [{ path: photoPath, caption: `Golden QA photo ${row.storeCode}` }],
        },
      }),
    });
  }
  record("Golden WCCs generated for every store", generatedWccs.length === projectStores.length, { wccs: generatedWccs.map((row) => row.dcNumber) });

  executionStores = await api(`/api/operations/execution-stores?estimateId=${estimate.id}`, adminToken);
  const readiness = deriveReadiness(estimate, executionStores);
  record("Golden project invoice readiness is YES", readiness.ready, readiness);

  const invoiceNumber = (await api("/api/numbering/invoice/next", adminToken)).number;
  const invoice = await api("/api/finance/invoices", adminToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceNumber,
      type: "sales",
      partyName: client.name,
      amount: 2000,
      taxAmount: 360,
      totalAmount: 2360,
      date: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "draft",
      estimateId: estimate.id,
      clientId: client.id,
      paidAmount: 0,
      balanceAmount: 2360,
      deliveryChallanId: generatedWccs[0]?.id || null,
      lineItems: estimateItems,
      poNumber: estimate.poNumber,
      poReference: "Golden project QA",
      packetSettings: { source: "go_live_signoff", readiness },
      remarks: `Generated from ${estimate.estimateNumber}`,
    }),
  });
  record("Invoice generated with existing numbering system", /^SM\/INV\/\d{2}-\d{2}\/\d+$/.test(invoice.invoiceNumber), { invoiceNumber: invoice.invoiceNumber, id: invoice.id });
  const packet = await api(`/api/finance/invoice-packet/${invoice.id}`, adminToken);
  record("Invoice packet links estimate, PO, WCC and stores", Boolean(packet.invoice?.id && packet.estimate?.id && packet.challans?.length >= projectStores.length && packet.estimate?.poFilePath), {
    invoice: packet.invoice?.invoiceNumber,
    challans: packet.challans?.length,
  });

  const roleChecks = [];
  const roleMatrix = [
    { name: "admin", token: adminToken, canCreateEstimate: true, canCreateWcc: true, canCreateInvoice: true },
    { name: "manager", token: managerLogin.token, canCreateEstimate: true, canCreateWcc: true, canCreateInvoice: true },
    { name: "execution", token: executionLogin.token, canCreateEstimate: false, canCreateWcc: true, canCreateInvoice: false },
  ];
  for (const role of roleMatrix) {
    const estimateRead = await fetch(`${BASE}/api/operations/estimates`, { headers: { Authorization: `Bearer ${role.token}` } });
    const wccRead = await fetch(`${BASE}/api/operations/delivery-challans/estimate/${estimate.id}`, { headers: { Authorization: `Bearer ${role.token}` } });
    const invoiceRead = await fetch(`${BASE}/api/finance/invoices`, { headers: { Authorization: `Bearer ${role.token}` } });
    const createEstimate = await fetch(`${BASE}/api/operations/estimates`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${role.token}` }, body: JSON.stringify({ estimate: {}, items: [] }) });
    const createInvoice = await fetch(`${BASE}/api/finance/invoices`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${role.token}` }, body: JSON.stringify({}) });
    roleChecks.push({
      role: role.name,
      visibility: { estimates: estimateRead.status, wcc: wccRead.status, invoices: invoiceRead.status },
      createEstimate: createEstimate.status,
      createInvoice: createInvoice.status,
    });
    record(`${role.name} visibility`, estimateRead.ok && wccRead.ok && invoiceRead.ok, { role: role.name, estimateRead: estimateRead.status, wccRead: wccRead.status, invoiceRead: invoiceRead.status });
    record(`${role.name} create estimate permission`, role.canCreateEstimate ? createEstimate.status !== 403 : createEstimate.status === 403, { status: createEstimate.status });
    record(`${role.name} create invoice permission`, role.canCreateInvoice ? createInvoice.status !== 403 : createInvoice.status === 403, { status: createInvoice.status });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token: adminToken, user: adminLogin.user });
  await page.goto(`${BASE}/projects?estimateId=${estimate.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-qa='project-workspace-page']");
  await page.waitForTimeout(1000);
  await shot(page, "01-golden-project-overview");
  await clickWorkspaceTab(page, "Execution");
  await page.waitForTimeout(800);
  await shot(page, "02-golden-project-execution");
  await clickWorkspaceTab(page, "Documents");
  await page.waitForTimeout(800);
  await shot(page, "03-golden-project-documents");
  await clickWorkspaceTab(page, "Invoice");
  await page.waitForTimeout(800);
  await shot(page, "04-golden-project-invoice-ready");
  const invoiceText = await page.textContent("[data-qa='project-workspace-page']") || "";
  record("Invoice tab shows ready YES", /Invoice Ready:\s*YES/.test(invoiceText), { sample: invoiceText.slice(0, 600) });

  await page.goto(`${BASE}/invoice-packet?id=${invoice.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot(page, "05-invoice-packet");
  await page.emulateMedia({ media: "print" });
  await shot(page, "06-invoice-print-media");
  const pdfPath = resolve(OUT, "07-invoice-print-chromium.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } });
  const pdf = await readFile(pdfPath);
  record("Chrome invoice print PDF generated", pdf.length > 50_000, { bytes: pdf.length, pdfPath });

  await page.goto(`${BASE}/projects?estimateId=${estimate.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-qa='project-workspace-page']");
  await clickWorkspaceTab(page, "Execution");
  await page.waitForTimeout(800);
  await page.evaluate(() => Array.from(document.querySelectorAll("[title='View WCC']")).find((el) => !el.disabled)?.click());
  await page.waitForSelector(".wcc-modal-backdrop");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  record("Escape closes WCC preview and keeps workspace", await page.locator(".wcc-modal-backdrop").count() === 0 && await page.locator("[data-qa='project-workspace-page']").count() === 1);
  await page.evaluate(() => Array.from(document.querySelectorAll("[title='Edit WCC']")).find((el) => !el.disabled)?.click());
  await page.waitForSelector(".wcc-modal-backdrop");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  record("Escape closes WCC editor and keeps workspace", await page.locator(".wcc-modal-backdrop").count() === 0 && await page.locator("[data-qa='project-workspace-page']").count() === 1);

  await browser.close();

  const docs = await api(`/api/operations/execution-documents?estimateId=${estimate.id}`, adminToken);
  const activePhotoDocs = docs.filter((doc) => doc.status === "active" && doc.documentType === "photo");
  const photoStorage = [];
  for (const doc of activePhotoDocs) {
    const localPath = resolve(process.cwd(), doc.filePath.replace(/^\/+/, ""));
    photoStorage.push({ id: doc.id, filePath: doc.filePath, exists: existsSync(localPath), fileSize: existsSync(localPath) ? (await readFile(localPath)).length : 0 });
  }
  record("Photo storage paths exist and are nonempty", photoStorage.every((row) => row.exists && row.fileSize > 0), { photoStorage });

  const legacyStores = await api("/api/operations/execution-stores?estimateId=2", adminToken);
  record("Legacy impossible state suppressed", legacyStores.find((row) => row.storeCode === "101387")?.status === "pending", legacyStores.find((row) => row.storeCode === "101387"));

  const output = {
    generatedAt: new Date().toISOString(),
    goldenProject: { estimateId: estimate.id, estimateNumber: estimate.estimateNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
    readiness,
    roleChecks,
    results,
  };
  writeFileSync(resolve(OUT, "qa-result.json"), JSON.stringify(output, null, 2));
  const failed = results.filter((row) => row.status === "failed");
  console.log(JSON.stringify({ out: OUT, passed: results.length - failed.length, failed: failed.length, goldenProject: output.goldenProject, failedResults: failed }, null, 2));
  if (failed.length) process.exit(1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
