/**
 * api.ts — Dual-mode data layer
 *
 * BOLT mode  (VITE_BOLT_PREVIEW=true): reads go directly to Supabase tables.
 * EXPRESS mode (npm run dev:full):      reads go to existing /api/* endpoints.
 *
 * Write operations always go through Express (or will become Edge Functions).
 * In Bolt mode, writes gracefully fail — the app stays in read-only mode.
 */
import { supabase, isBoltMode } from "./supabase";

// ─── Signed URL session cache ─────────────────────────────────────────────────
// Signed URLs for the private execution-documents bucket are valid for 2 hours
// (7200 s). Regenerating them on every fetchExecutionDocuments call produces a
// unique URL each time, which the CDN cannot cache → non-cached egress.
// Cache the signed URL per storage path and reuse it until 60 minutes before
// expiry (i.e. refresh at the 60-minute mark, giving a 60-minute reuse window).
interface SignedUrlEntry { url: string; expiresAt: number }
const _signedUrlCache = new Map<string, SignedUrlEntry>();
const SIGNED_URL_TTL_S = 7200;
const SIGNED_URL_REFRESH_BEFORE_S = 3600; // refresh when < 60 min remain

function _cachedSignedUrl(path: string): string | null {
  const entry = _signedUrlCache.get(path);
  if (!entry) return null;
  const refreshAt = entry.expiresAt - SIGNED_URL_REFRESH_BEFORE_S * 1000;
  return Date.now() < refreshAt ? entry.url : null;
}

function _cacheSignedUrl(path: string, url: string): void {
  _signedUrlCache.set(path, { url, expiresAt: Date.now() + SIGNED_URL_TTL_S * 1000 });
}

// ─── Bolt safety interceptor ─────────────────────────────────────────────────
// In Bolt mode, any stray /api/* fetch call would silently receive index.html
// and then fail with "Unexpected token '<'" when parsed as JSON.
// Intercept at module load so the error is immediate and clearly labelled.
if (isBoltMode && typeof window !== "undefined") {
  const _origFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (url.startsWith("/api/")) {
      const err = new Error(`[Bolt] Blocked legacy /api call: ${url}`);
      console.error(err);
      return Promise.reject(err);
    }
    return _origFetch.call(window, input, init);
  };
}

// ─── camelCase transformer ────────────────────────────────────────────────────
// Supabase returns snake_case; the Express/Drizzle backend returns camelCase.
// Apply this to all Supabase results so existing component code is unchanged.
function toCamel(o: any): any {
  if (Array.isArray(o)) return o.map(toCamel);
  if (o !== null && typeof o === "object") {
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        toCamel(v),
      ])
    );
  }
  return o;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Show in-app toast or console message for blocked write actions in Bolt mode. */
export function notAvailableInBolt(action: string): never {
  throw new Error(
    `"${action}" requires the Express backend (npm run dev:full) or a Supabase Edge Function. ` +
      `This action is not yet available in Bolt preview mode.`
  );
}

/** Authenticated fetch to Express backend (full mode only). */
export async function apiFetch(
  path: string,
  token: string | null,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
}

/** Read from a Supabase table. Returns camelCase [] on error. */
async function sbSelect<T>(
  table: string,
  build: (q: ReturnType<typeof supabase.from>) => any = (q) => q.select("*")
): Promise<T[]> {
  try {
    const { data, error } = await build(supabase.from(table));
    if (error) {
      console.warn(`[api] Supabase ${table}:`, error.message);
      return [];
    }
    return toCamel(data ?? []) as T[];
  } catch (err) {
    console.warn(`[api] Supabase ${table} fetch failed:`, err);
    return [];
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalRevenue: number;
  totalReceivables: number;
  totalOutstanding?: number;
  monthlyBilling?: number;
  monthlyCollections?: number;
  erpCounters?: {
    estimatesAwaitingPo: number;
    poReceived: number;
    estimatesDraft: number;
    estimatesApproved: number;
    dcPending: number;
    dcDelivered: number;
    invoicePending: number;
    invoicePaid: number;
    invoiceOverdue: number;
    staffPresentToday: number;
    pettyCashPending: number;
    storesCompleted?: number;
    storesPending?: number;
    invoicesReady?: number;
    invoicesSubmitted?: number;
    dcWccPending?: number;
  };
  recentActivity?: Array<{
    type: string;
    label: string;
    meta: string;
    date: string | null;
    href: string;
  }>;
}

export async function fetchDashboard(
  token: string | null,
  startDate: string,
  endDate: string
): Promise<DashboardStats> {
  if (!isBoltMode) {
    const params = new URLSearchParams({ startDate, endDate });
    const res = await apiFetch(`/api/finance/dashboard?${params}`, token);
    if (res.ok) return res.json();
    return { totalRevenue: 0, totalReceivables: 0 };
  }

  const [invoices, estimates, deliveryChallans, executionStores] =
    await Promise.all([
      sbSelect<any>("invoices"),
      sbSelect<any>("estimates"),
      sbSelect<any>("delivery_challans"),
      sbSelect<any>("execution_stores"),
    ]);

  const inRange = (v: string | null) => {
    if (!v || (!startDate && !endDate)) return true;
    const t = new Date(v).getTime();
    const s = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : 0;
    const e = endDate
      ? new Date(endDate).setHours(23, 59, 59, 999)
      : Infinity;
    return Number.isFinite(t) && t >= s && t <= (e as number);
  };

  const salesInvoices = invoices.filter(
    (inv: any) => inv.type === "sales" && inRange(inv.date || inv.createdAt)
  );
  const totalRevenue = salesInvoices.reduce(
    (s: number, inv: any) => s + (inv.totalAmount || 0),
    0
  );
  const totalReceivables = salesInvoices
    .filter((inv: any) => inv.status !== "paid")
    .reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);

  const filteredEst = estimates.filter((e: any) =>
    inRange(e.estimateDate || e.createdAt)
  );
  const filteredDc = deliveryChallans.filter((dc: any) =>
    inRange(dc.createdAt || dc.deliveryDate)
  );

  const recentItems = [
    ...filteredEst.slice(-5).map((e: any) => ({
      type: "estimate",
      label: e.estimateNumber ?? `Est #${e.id}`,
      meta: e.title ?? "",
      date: e.createdAt ?? null,
      href: "/operations",
    })),
    ...filteredDc.slice(-5).map((dc: any) => ({
      type: "wcc",
      label: dc.dcNumber ?? `DC #${dc.id}`,
      meta: dc.status ?? "",
      date: dc.createdAt ?? null,
      href: "/operations",
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
    )
    .slice(0, 10);

  return {
    totalRevenue,
    totalReceivables,
    erpCounters: {
      estimatesDraft: filteredEst.filter((e: any) => e.status === "draft").length,
      estimatesAwaitingPo: filteredEst.filter((e: any) => e.status === "awaiting_po").length,
      estimatesApproved: filteredEst.filter((e: any) => e.status === "approved").length,
      poReceived: filteredEst.filter((e: any) => e.status === "po_received").length,
      dcPending: filteredDc.filter((dc: any) => dc.status === "pending").length,
      dcDelivered: filteredDc.filter(
        (dc: any) => dc.status === "delivered" || dc.status === "completed"
      ).length,
      invoicePending: invoices.filter((inv: any) => inv.status === "unpaid").length,
      invoicePaid: invoices.filter((inv: any) => inv.status === "paid").length,
      invoiceOverdue: invoices.filter((inv: any) => inv.status === "overdue").length,
      staffPresentToday: 0,
      pettyCashPending: 0,
      storesCompleted: executionStores.filter((s: any) => s.status === "completed").length,
      storesPending: executionStores.filter((s: any) => s.status === "pending_execution").length,
      invoicesReady: invoices.filter((inv: any) => inv.status === "unpaid").length,
      invoicesSubmitted: invoices.filter((inv: any) => inv.status === "submitted").length,
      dcWccPending: filteredDc.filter((dc: any) => dc.status === "pending").length,
    },
    recentActivity: recentItems,
  };
}

// ─── Master data reads ────────────────────────────────────────────────────────

export async function fetchClients(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/clients", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("clients", (q) => q.select("*").order("name"));
}

export async function fetchBrands(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/brands", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("brands", (q) => q.select("*").order("name"));
}

export async function fetchStores(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/stores", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("stores", (q) => q.select("*").order("name"));
}

export async function fetchProducts(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/products", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("products", (q) => q.select("*").order("name"));
}

export async function fetchMaterialCodes(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/material-codes", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("material_codes", (q) => q.select("*").order("code"));
}

export async function fetchEstimates(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/estimates", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("estimates", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchEstimateItems(token: string | null, estimateId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/estimates/${estimateId}/items`, token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("estimate_items", (q) =>
    q.select("*").eq("estimate_id", estimateId).order("id", { ascending: true })
  );
}

export async function fetchDeliveryChallans(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/delivery-challans", token);
    return res.ok ? await attachPhotoSignedUrls(await res.json()) : [];
  }
  const rows = await sbSelect<any>("delivery_challans", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
  return attachPhotoSignedUrls(rows);
}

export async function fetchDeliveryChallansForEstimate(
  token: string | null,
  estimateId: number
) {
  if (!isBoltMode) {
    const res = await apiFetch(
      `/api/operations/delivery-challans/estimate/${estimateId}`,
      token
    );
    return res.ok ? await attachPhotoSignedUrls(await res.json()) : [];
  }
  const rows = await sbSelect<any>("delivery_challans", (q) =>
    q
      .select("*")
      .eq("estimate_id", estimateId)
      .order("created_at", { ascending: false })
  );
  return attachPhotoSignedUrls(rows);
}

export async function fetchExecutionDocuments(
  token: string | null,
  estimateId?: number
) {
  if (!isBoltMode) {
    const url = estimateId
      ? `/api/operations/execution-documents?estimateId=${estimateId}`
      : "/api/operations/execution-documents";
    const res = await apiFetch(url, token);
    return res.ok ? res.json() : [];
  }
  const docs = await sbSelect<any>("execution_documents", (q) => {
    const base = q.select("*").eq("status", "active").order("created_at", { ascending: false });
    return estimateId ? base.eq("estimate_id", estimateId) : base;
  });
  if (!docs.length) return docs;

  // Replace raw storage paths with 2-hour signed URLs so they can render in <img>/<a>.
  // Reuse cached signed URLs (valid for up to 60 min past generation) to avoid
  // generating unique URLs on every call — unique URLs bypass CDN cache.
  const paths = docs.map((d: any) => d.filePath).filter(Boolean) as string[];
  if (paths.length === 0) return docs;
  try {
    const stale: string[] = [];
    const hitMap = new Map<string, string>();
    for (const p of paths) {
      const cached = _cachedSignedUrl(p);
      if (cached) hitMap.set(p, cached);
      else stale.push(p);
    }
    if (stale.length > 0) {
      const { data: signed } = await supabase.storage
        .from("execution-documents")
        .createSignedUrls(stale, SIGNED_URL_TTL_S);
      if (signed) {
        for (const s of signed) {
          if (s.signedUrl) {
            _cacheSignedUrl(s.path, s.signedUrl);
            hitMap.set(s.path, s.signedUrl);
          }
        }
      }
    }
    return docs.map((d: any) => ({ ...d, filePath: hitMap.get(d.filePath) ?? d.filePath }));
  } catch { /* return raw paths as fallback */ }
  return docs;
}

export async function fetchExecutionStores(
  token: string | null,
  estimateId?: number
) {
  if (!isBoltMode) {
    const url = estimateId
      ? `/api/operations/execution-stores?estimateId=${estimateId}`
      : "/api/operations/execution-stores";
    const res = await apiFetch(url, token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("execution_stores", (q) => {
    const base = q.select("*");
    return estimateId ? base.eq("estimate_id", estimateId) : base;
  });
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export async function fetchInvoices(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/invoices", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("invoices", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchPayments(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/payments", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("payments", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchAccounts(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/accounts", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("chart_of_accounts", (q) => q.select("*").order("name"));
}

export async function fetchLedgerSummary(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/ledgers/summary", token);
    return res.ok ? res.json() : [];
  }
  // Compute client-level summary from raw reads
  const [clients, invoices, payments] = await Promise.all([
    sbSelect<any>("clients", (q) => q.select("id, name")),
    sbSelect<any>("invoices", (q) =>
      q.select("client_id, total_amount, paid_amount, status, type")
    ),
    sbSelect<any>("payments", (q) => q.select("client_id, amount")),
  ]);

  return clients
    .map((c: any) => {
      const cInv = invoices.filter(
        (i: any) => i.clientId === c.id && i.type === "sales"
      );
      const totalBilled = cInv.reduce(
        (s: number, i: any) => s + (i.totalAmount || 0),
        0
      );
      const cPay = payments.filter((p: any) => p.clientId === c.id);
      const totalPaid = cPay.reduce(
        (s: number, p: any) => s + (p.amount || 0),
        0
      );
      return {
        clientId: c.id,
        clientName: c.name,
        totalBilled,
        totalPaid,
        totalOutstanding: totalBilled - totalPaid,
        status: totalBilled - totalPaid > 0 ? "outstanding" : "settled",
      };
    })
    .filter((l: any) => l.totalBilled > 0);
}

// ─── Staff / HR ───────────────────────────────────────────────────────────────

export async function fetchUsers(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/users", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("users", (q) =>
    q.select("id, username, name, email, role, department, designation, phone, telegram_chat_id, joining_date, basic_salary, daily_wage, is_active, created_at")
      .eq("is_active", true)
      .order("name")
  );
}

export async function fetchAttendance(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/attendance", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("attendance", (q) =>
    q.select("*").order("date", { ascending: false }).limit(500)
  );
}

export async function fetchAdvances(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/advances", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("staff_advances", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchPayroll(
  token: string | null,
  month: number,
  year: number
) {
  if (!isBoltMode) {
    const res = await apiFetch(
      `/api/payroll?month=${month}&year=${year}`,
      token
    );
    return res.ok ? res.json() : [];
  }
  return sbSelect("payroll", (q) =>
    q.select("*").eq("month", month).eq("year", year)
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function fetchTasks(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/tasks", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("tasks", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function fetchNotifications(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/notifications", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("notifications", (q) =>
    q.select("*").order("created_at", { ascending: false }).limit(50)
  );
}

// ─── Company Settings ─────────────────────────────────────────────────────────

export async function fetchCompanySettings(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/company-settings", token);
    return res.ok ? res.json() : null;
  }
  const rows = await sbSelect<any>("app_settings", (q) =>
    q.select("key, value")
  );
  // Convert [{key, value}] → flat object with aliased shorthand keys.
  const out: Record<string, any> = {};
  const BANK_KEY_MAP: Record<string, string> = {
    name: "bankName",
    accountNumber: "bankAccountNumber",
    ifsc: "bankIfsc",
    branch: "bankBranch",
  };
  const DEFAULTS_KEY_MAP: Record<string, string> = {
    gstPercent: "defaultGstPercent",
    packingPercent: "defaultPacking",
    implementationPercent: "defaultImplementation",
    localTransport: "defaultLocalTransport",
    outstationTransportRate: "defaultOutstationTransportRate",
    terms: "terms",
  };
  for (const r of rows) {
    out[r.key] = r.value;
    const key = r.key as string;
    if (key.startsWith("company.")) {
      out[key.slice("company.".length)] = r.value;
    } else if (key.startsWith("bank.")) {
      const sub = key.slice("bank.".length);
      const mapped = BANK_KEY_MAP[sub];
      if (mapped) out[mapped] = r.value;
    } else if (key.startsWith("defaults.")) {
      const sub = key.slice("defaults.".length);
      const mapped = DEFAULTS_KEY_MAP[sub];
      if (mapped) out[mapped] = r.value;
    }
  }
  return out;
}

// ─── Client Ledger Statement ──────────────────────────────────────────────────

export async function fetchClientLedger(token: string | null, clientId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/finance/ledgers/client/${clientId}`, token);
    return res.ok ? res.json() : { statement: [] };
  }
  // Compute statement from raw tables in Bolt mode.
  const [invRows, payRows] = await Promise.all([
    sbSelect<any>("invoices", (q) =>
      q.select("*").eq("client_id", clientId).order("date", { ascending: true })
    ),
    sbSelect<any>("payments", (q) =>
      q.select("*").eq("client_id", clientId).order("date", { ascending: true })
    ),
  ]);
  const statement = [
    ...invRows.map((i: any) => ({ type: "invoice", date: i.date || i.createdAt, description: `Invoice ${i.invoiceNumber}`, debit: i.totalAmount, credit: 0, balance: 0 })),
    ...payRows.map((p: any) => ({ type: "payment", date: p.date || p.createdAt, description: `Payment ${p.voucherNumber || p.id}`, debit: 0, credit: p.amount, balance: 0 })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let running = 0;
  statement.forEach(row => { running += row.debit - row.credit; row.balance = running; });
  return { statement };
}

// ─── Billing Profiles ─────────────────────────────────────────────────────────

export async function fetchBillingProfiles(token: string | null, clientId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/clients/${clientId}/billing-profiles`, token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("client_billing_profiles", (q) =>
    q.select("*").eq("client_id", clientId).order("legal_company_name")
  );
}

// ─── Invoice for a single estimate ───────────────────────────────────────────

export async function fetchEstimateById(token: string | null, estimateId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/estimates/${estimateId}`, token);
    return res.ok ? res.json() : null;
  }
  const rows = await sbSelect<any>("estimates", (q) =>
    q.select("*").eq("id", estimateId).limit(1)
  );
  return rows[0] ?? null;
}

export async function fetchPaymentsForInvoice(token: string | null, invoiceId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/finance/invoices/${invoiceId}/payments`, token);
    return res.ok ? res.json() : [];
  }
  return sbSelect<any>("payments", (q) =>
    q.select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true })
  );
}

export async function fetchInvoiceById(token: string | null, invoiceId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/finance/invoices/${invoiceId}`, token);
    return res.ok ? res.json() : null;
  }
  const rows = await sbSelect<any>("invoices", (q) =>
    q.select("*").eq("id", invoiceId).limit(1)
  );
  return rows[0] ?? null;
}

export async function fetchInvoiceForEstimate(token: string | null, estimateId: number) {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/finance/invoices/estimate/${estimateId}`, token);
    return res.ok ? res.json() : null;
  }
  const rows = await sbSelect<any>("invoices", (q) =>
    q.select("*").eq("estimate_id", estimateId).limit(1)
  );
  return rows[0] ?? null;
}

// ─── Customer Rate Cards ──────────────────────────────────────────────────────

export async function fetchCustomerRateCards(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/customer-rate-cards", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("customer_rate_cards", (q) => q.select("*").order("name"));
}

// ─── Storage uploads ─────────────────────────────────────────────────────────

/**
 * Upload a file to Supabase Storage.
 * Returns the storage path (relative) and a URL for display/download.
 * Private buckets → signed URL (1 hour). Public buckets → public URL.
 */
export async function uploadToStorage(
  bucket: string,
  storagePath: string,
  file: File
): Promise<{ storagePath: string; displayUrl: string }> {
  const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);

  // company-assets bucket is public; execution-documents is private
  if (bucket === "company-assets") {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return { storagePath, displayUrl: data.publicUrl };
  }
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600);
  if (signErr) throw new Error(signErr.message);
  return { storagePath, displayUrl: data!.signedUrl };
}

/**
 * Register an uploaded execution document in the DB.
 * Bolt mode: direct Supabase insert.
 * Express mode: POST /api/operations/execution-documents.
 */
export async function registerExecutionDocument(
  token: string | null,
  doc: {
    estimateId: number;
    storeCode: string;
    documentType: string;
    filePath: string;
    originalFileName: string;
    mimeType?: string | null;
    fileSize?: number | null;
    uploadedVia?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<any> {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/execution-documents", token, {
      method: "POST",
      body: JSON.stringify({
        estimateId: doc.estimateId,
        storeCode: doc.storeCode,
        documentType: doc.documentType,
        filePath: doc.filePath,
        originalFileName: doc.originalFileName,
        mimeType: doc.mimeType ?? null,
        fileSize: doc.fileSize ?? null,
        uploadedVia: doc.uploadedVia ?? "project_workspace",
        metadata: doc.metadata ?? {},
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Failed to register document");
    return res.json();
  }
  const row: Record<string, unknown> = {
    estimate_id: doc.estimateId,
    store_code: doc.storeCode,
    document_type: doc.documentType,
    file_path: doc.filePath,
    original_file_name: doc.originalFileName,
    mime_type: doc.mimeType ?? null,
    file_size: doc.fileSize ?? null,
    uploaded_via: doc.uploadedVia ?? "project_workspace",
    metadata: doc.metadata ?? {},
  };
  const { data, error } = await supabase.from("execution_documents").insert(row).select().single();
  if (error) throw new Error(error.message);
  return toCamel(data);
}

/**
 * Best-effort delete of a proof photo: removes the storage object and marks
 * matching execution_documents row(s) as deleted. Both steps are optional —
 * either can fail without blocking the UI (photo is already removed from
 * dcPhotos state before this runs). Legacy rows whose stored `path` is a full
 * URL rather than a storage key are skipped for the storage step.
 */
export async function deleteWccPhotoArtifacts(
  token: string | null,
  photoPath: string | null | undefined,
  bucket: string = "execution-documents",
): Promise<void> {
  if (!photoPath || typeof photoPath !== "string") return;
  const isUrl = /^https?:\/\//i.test(photoPath);

  // 1. Storage object — skip legacy URL-shaped paths (no reliable key extraction).
  if (!isUrl) {
    try { await supabase.storage.from(bucket).remove([photoPath]); }
    catch (e) { console.warn("[deleteWccPhotoArtifacts] storage remove failed", e); }
  }

  // 2. execution_documents audit row (Bolt: direct update; Express: PATCH endpoint)
  try {
    if (isBoltMode) {
      await supabase
        .from("execution_documents")
        .update({ status: "deleted" })
        .eq("file_path", photoPath)
        .eq("status", "active");
    } else {
      await apiFetch(`/api/operations/execution-documents/by-path`, token, {
        method: "PATCH",
        body: JSON.stringify({ filePath: photoPath, status: "deleted" }),
      }).catch(() => {});
    }
  } catch (e) { console.warn("[deleteWccPhotoArtifacts] audit update failed", e); }
}

/**
 * Save a company asset (logo / stamp) path to app_settings.
 * Bolt mode: direct Supabase upsert. Express mode: embedded in PUT /api/company-settings.
 */
export async function saveAssetSetting(
  token: string | null,
  settingKey: string,
  value: string
): Promise<void> {
  if (!isBoltMode) {
    // Express mode handles this through the company-settings PUT endpoint
    return;
  }
  await upsertAppSettings(token, { [settingKey]: value });
}

// ─── Write helpers — Edge Functions (Bolt) or Express (full mode) ─────────────

/**
 * Call a Supabase Edge Function with the user's JWT.
 * SUPABASE_URL must be set as VITE_SUPABASE_URL in .env.
 */
async function edgeFetch(
  functionName: string,
  token: string | null,
  options: RequestInit & { pathSuffix?: string } = {}
): Promise<Response> {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const { pathSuffix = "", ...fetchOptions } = options;
  const url = `${supabaseUrl}/functions/v1/${functionName}${pathSuffix}`;
  return fetch(url, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  });
}

// ─── Estimates ────────────────────────────────────────────────────────────────

export async function createEstimate(
  token: string | null,
  payload: { estimate: Record<string, unknown>; items: unknown[] }
): Promise<any> {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/estimates", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create estimate");
    return res.json();
  }
  const res = await edgeFetch("estimate-save", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create estimate");
  return res.json();
}

export async function updateEstimate(
  token: string | null,
  id: number,
  payload: Record<string, unknown>
): Promise<any> {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/estimates/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to update estimate");
    return res.json();
  }
  // Bypass the edge function — use Supabase JS client directly (PostgREST always works in Bolt mode).
  const toSnake = (s: string) => s.replace(/([A-Z])/g, "_$1").toLowerCase();

  const { items: rawItems, ...estimateFields } = payload as Record<string, unknown> & { items?: unknown };
  const replaceItems = Array.isArray(rawItems) ? (rawItems as Record<string, unknown>[]) : undefined;

  // Convert estimate field keys to snake_case
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(estimateFields)) {
    updates[toSnake(k)] = v;
  }

  // Billing profile snapshot
  if (updates.billing_profile_id) {
    const { data: bp } = await supabase
      .from("client_billing_profiles")
      .select("*")
      .eq("id", Number(updates.billing_profile_id))
      .maybeSingle();
    if (bp) {
      updates.billing_legal_name_snapshot = (bp as any).legal_company_name;
      updates.billing_gstin_snapshot = (bp as any).gstin;
      updates.billing_state_snapshot = (bp as any).state;
      updates.billing_state_code_snapshot = (bp as any).state_code;
      updates.billing_address_snapshot = (bp as any).billing_address;
      updates.shipping_address_snapshot = (bp as any).shipping_address;
      updates.billing_to = (bp as any).legal_company_name;
      updates.gstin = (bp as any).gstin;
      if ((bp as any).pan) updates.pan = (bp as any).pan;
      updates.state_code = (bp as any).state_code;
    }
  }

  // Update the estimate row
  const { data: updated, error: updateErr } = await supabase
    .from("estimates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (updateErr) throw new Error(updateErr.message ?? "Failed to update estimate");
  if (!updated) throw new Error("Estimate not found");

  // Replace items if provided
  if (replaceItems !== undefined) {
    await supabase.from("estimate_items").delete().eq("estimate_id", id);
    if (replaceItems.length > 0) {
      const itemRows = replaceItems.map((it) => {
        const row: Record<string, unknown> = { estimate_id: id };
        for (const [k, v] of Object.entries(it)) row[toSnake(k)] = v;
        return row;
      });
      const { error: itemErr } = await supabase.from("estimate_items").insert(itemRows);
      if (itemErr) throw new Error(`Items replace failed: ${itemErr.message}`);
    }
  }

  return toCamel(updated);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function createInvoice(
  token: string | null,
  payload: Record<string, unknown>
): Promise<any> {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/invoices", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create invoice");
    return res.json();
  }
  const res = await edgeFetch("invoice-create", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create invoice");
  return res.json();
}

// ─── Delivery Challans ────────────────────────────────────────────────────────

const isLegacyWccPhotoPath = (value: string) =>
  value.startsWith("/uploads/") || value.startsWith("/api/");

const isDisplayUrl = (value: string) =>
  /^https?:\/\//i.test(value) || value.startsWith("blob:") || value.startsWith("data:");

export function isValidWccPhotoPath(photo: any): boolean {
  if (!photo || typeof photo !== "object") return false;
  const path = typeof photo.path === "string" ? photo.path.trim() : "";
  const url = typeof photo.url === "string" ? photo.url.trim() : "";
  const storagePath = typeof photo.storagePath === "string" ? photo.storagePath.trim() : "";
  const primary = path || storagePath || url;
  if (!primary) return false;
  if (isLegacyWccPhotoPath(primary)) return false;
  if (primary.startsWith("/")) return false;
  return Boolean(path || storagePath || isDisplayUrl(url));
}

export function normalizeWccPhotos(photos: any): any[] {
  if (!Array.isArray(photos)) return [];
  const seen = new Set<string>();
  const clean: any[] = [];
  for (const photo of photos) {
    if (!isValidWccPhotoPath(photo)) continue;
    const { signedUrl, _signedUrl, ...rest } = photo;
    const path = typeof rest.path === "string" ? rest.path.trim() : "";
    const storagePath = typeof rest.storagePath === "string" ? rest.storagePath.trim() : "";
    const url = typeof rest.url === "string" ? rest.url.trim() : "";
    const id = rest.id != null ? String(rest.id) : "";
    const name = typeof rest.name === "string" ? rest.name.trim() : "";
    const key = path || storagePath || url || id || name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clean.push({ ...rest, ...(storagePath && !path ? { path: storagePath } : {}) });
  }
  return clean;
}

export const dedupeWccPhotos = normalizeWccPhotos;

/**
 * WCC/DC photos live inside metadata.photos[] as JSONB. Persist ONLY the raw
 * storage path — never the (short-lived) signed URL. `signedUrl` is a transient
 * field attached on read; strip it before every write. Also strips any legacy
 * `_signedUrl` fields from older builds and drops legacy Express upload paths.
 */
function stripPhotoTransients(payload: Record<string, unknown>): Record<string, unknown> {
  const meta = (payload as any)?.metadata;
  if (!meta || !Array.isArray(meta.photos)) return payload;
  const cleanPhotos = normalizeWccPhotos(meta.photos);
  return { ...payload, metadata: { ...meta, photos: cleanPhotos } };
}

/**
 * Batch-sign every storage path found in row.metadata.photos[] across all
 * delivery_challans rows. Attaches a transient `signedUrl` (2h TTL, cached).
 * Legacy rows whose `path` is already a full URL are passed through unchanged.
 */
async function attachPhotoSignedUrls<T extends { metadata?: any }>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const paths = new Set<string>();
  for (const row of rows) {
    const photos = row.metadata?.photos;
    if (!Array.isArray(photos)) continue;
    for (const p of photos) {
      if (!p?.path || typeof p.path !== "string") continue;
      // http(s) URLs render as-is; skip.
      if (/^https?:\/\//i.test(p.path)) continue;
      if (p.path.startsWith("/uploads/") || p.path.startsWith("/api/")) continue;
      paths.add(p.path);
    }
  }
  if (paths.size === 0) {
    return rows.map((row) => {
      const photos = row.metadata?.photos;
      if (!Array.isArray(photos)) return row;
      return { ...row, metadata: { ...row.metadata, photos: normalizeWccPhotos(photos) } };
    });
  }
  const hitMap = new Map<string, string>();
  const stale: string[] = [];
  for (const p of paths) {
    const cached = _cachedSignedUrl(p);
    if (cached) hitMap.set(p, cached);
    else stale.push(p);
  }
  if (stale.length > 0) {
    try {
      const { data: signed } = await supabase.storage
        .from("execution-documents")
        .createSignedUrls(stale, SIGNED_URL_TTL_S);
      if (signed) {
        for (const s of signed) {
          if (s.signedUrl) {
            _cacheSignedUrl(s.path, s.signedUrl);
            hitMap.set(s.path, s.signedUrl);
          }
        }
      }
    } catch { /* fall through — photos will render as broken links, not blank */ }
  }
  return rows.map((row) => {
    const photos = row.metadata?.photos;
    const normalized = normalizeWccPhotos(photos);
    if (normalized.length === 0) return { ...row, metadata: { ...row.metadata, photos: [] } };
    return {
      ...row,
      metadata: {
        ...row.metadata,
        photos: normalized.map((p: any) => (p?.path && hitMap.has(p.path) ? { ...p, signedUrl: hitMap.get(p.path) } : p)),
      },
    };
  });
}

export async function createDeliveryChallan(
  token: string | null,
  payload: Record<string, unknown>
): Promise<any> {
  const cleaned = stripPhotoTransients(payload);
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/delivery-challans", token, {
      method: "POST",
      body: JSON.stringify(cleaned),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create delivery challan");
    return res.json();
  }
  const res = await edgeFetch("dc-save", token, {
    method: "POST",
    body: JSON.stringify(cleaned),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create delivery challan");
  return res.json();
}

export async function updateDeliveryChallan(
  token: string | null,
  id: number,
  payload: Record<string, unknown>
): Promise<any> {
  const cleaned = stripPhotoTransients(payload);
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/delivery-challans/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(cleaned),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to update delivery challan");
    return res.json();
  }
  // Bolt mode: Supabase gateway returns 405 for path-suffixed edge function calls
  // (e.g. /functions/v1/dc-save/6). Write directly via PostgREST instead.
  const toSnake = (s: string) => s.replace(/([A-Z])/g, "_$1").toLowerCase();
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cleaned)) {
    updates[toSnake(k)] = v;
  }
  if (!updates.delivery_date) updates.delivery_date = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("delivery_challans")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message ?? "Failed to update delivery challan");
  if (!updated) throw new Error("Delivery challan not found");
  return toCamel(updated);
}

// ─── Master Data (clients / brands / stores / products / billing-profiles) ────

/**
 * Call master-data-save Edge Function in Bolt mode, or fall back to Express.
 * entity: "clients" | "brands" | "stores" | "products" | "billing-profiles"
 * method: "POST" | "PATCH" | "DELETE"
 */
export async function masterDataSave(
  token: string | null,
  entity: string,
  method: "POST" | "PATCH" | "DELETE",
  id?: number | null,
  payload?: Record<string, unknown>
): Promise<any> {
  if (!isBoltMode) {
    const url = id ? `/api/operations/${entity}/${id}` : `/api/operations/${entity}`;
    const res = await apiFetch(url, token, {
      method,
      body: method !== "DELETE" ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw Object.assign(new Error(j.message ?? `${entity} ${method} failed`), { status: res.status, body: j });
    }
    return res.json().catch(() => ({}));
  }
  const pathSuffix = id ? `/${entity}/${id}` : `/${entity}`;
  const res = await edgeFetch("master-data-save", token, {
    method,
    pathSuffix,
    body: method !== "DELETE" ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error(j.message ?? `${entity} ${method} failed`), { status: res.status, body: j });
  }
  return res.json().catch(() => ({}));
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function createPayment(
  token: string | null,
  payload: Record<string, unknown>
): Promise<any> {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/payments", token, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create payment");
    return res.json();
  }
  const res = await edgeFetch("payment-post", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "Failed to create payment");
  return res.json();
}

// ─── Execution Document mutations ─────────────────────────────────────────────

/** Soft-delete an execution document. */
export async function deleteExecutionDocument(
  token: string | null,
  docId: number
): Promise<void> {
  if (!isBoltMode) {
    const res = await apiFetch(`/api/operations/execution-documents/${docId}`, token, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    return;
  }
  // Use edge function with admin client to bypass RLS on execution_documents.
  const res = await edgeFetch("exec-doc-update", token, {
    method: "PATCH",
    body: JSON.stringify({ id: docId, status: "deleted", deleted_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message ?? `Delete failed (${res.status})`);
  }
}

/**
 * Upload a file to execution-documents bucket and register it in the DB.
 * Returns the raw storagePath, a signed displayUrl, and the DB row.
 */
export async function uploadExecutionDocument(
  token: string | null,
  file: File,
  opts: {
    estimateId: number;
    storeCode: string;
    documentType: string;
    uploadedVia?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ storagePath: string; displayUrl: string; doc: any }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `estimate-${opts.estimateId}/${opts.storeCode || "misc"}/${Date.now()}-${safeName}`;
  const { storagePath: saved, displayUrl } = await uploadToStorage("execution-documents", storagePath, file);
  const doc = await registerExecutionDocument(token, {
    estimateId: opts.estimateId,
    storeCode: opts.storeCode,
    documentType: opts.documentType,
    filePath: saved,
    originalFileName: file.name,
    mimeType: file.type || null,
    fileSize: file.size || null,
    uploadedVia: opts.uploadedVia ?? "project_workspace",
    metadata: opts.metadata ?? {},
  });
  return { storagePath: saved, displayUrl, doc };
}

/** Generate a 2-hour signed URL for a private execution-documents storage path. */
export async function getExecutionDocumentDisplayUrl(storagePath: string): Promise<string> {
  const cached = _cachedSignedUrl(storagePath);
  if (cached) return cached;
  const { data, error } = await supabase.storage
    .from("execution-documents")
    .createSignedUrl(storagePath, SIGNED_URL_TTL_S);
  if (error) throw new Error(error.message);
  _cacheSignedUrl(storagePath, data!.signedUrl);
  return data!.signedUrl;
}

/**
 * Normalize a company asset path to a displayable URL.
 * Handles: full HTTPS URLs (as-is), Supabase storage paths (no leading slash → public bucket URL),
 * and legacy Express /uploads/company-assets/ paths (rewritten for Bolt mode).
 */
export function getCompanyAssetUrl(pathOrUrl?: string | null): string {
  const clean = String(pathOrUrl || "").trim();
  if (!clean) return "";
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
  if (!clean.startsWith("/")) {
    const { data } = supabase.storage.from("company-assets").getPublicUrl(clean);
    return data.publicUrl;
  }
  if (clean.startsWith("/uploads/company-assets/")) {
    const filename = clean.split("/").pop() ?? "";
    if (isBoltMode) {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
      return `${supabaseUrl}/storage/v1/object/public/company-assets/${encodeURIComponent(filename)}`;
    }
    return `/api/company-assets/${encodeURIComponent(filename)}`;
  }
  return clean;
}

// ─── Company Settings (Bolt write) ───────────────────────────────────────────

/**
 * Upsert a batch of key→value pairs into app_settings via the settings-save
 * edge function which uses the service-role client to bypass RLS INSERT block.
 */
export async function upsertAppSettings(
  token: string | null,
  settings: Record<string, string | null>
): Promise<void> {
  const res = await edgeFetch("settings-save", token, {
    method: "POST",
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Settings save failed");
  }
}
