/**
 * api.ts — Dual-mode data layer
 *
 * BOLT mode  (VITE_BOLT_PREVIEW=true): reads go directly to Supabase tables.
 * EXPRESS mode (npm run dev:full):      reads go to existing /api/* endpoints.
 *
 * Write operations always go through Express (or will become Edge Functions).
 * In Bolt mode all writes currently return a "not available" placeholder.
 */
import { supabase, isBoltMode } from "./supabase";

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── read helpers (Supabase) ─────────────────────────────────────────────────

/** Fetch all rows from a Supabase table. Returns [] on error with console warn. */
async function sbSelect<T>(
  table: string,
  query: (q: ReturnType<typeof supabase.from>) => any = (q) => q.select("*")
): Promise<T[]> {
  try {
    const { data, error } = await query(supabase.from(table));
    if (error) {
      console.warn(`[api] Supabase ${table}:`, error.message);
      return [];
    }
    return (data ?? []) as T[];
  } catch (err) {
    console.warn(`[api] Supabase ${table} fetch failed:`, err);
    return [];
  }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

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

  // Bolt mode: compute from raw Supabase reads
  const [invoices, estimates, deliveryChallans, executionStores] =
    await Promise.all([
      sbSelect<any>("invoices"),
      sbSelect<any>("estimates"),
      sbSelect<any>("delivery_challans"),
      sbSelect<any>("execution_stores"),
    ]);

  const inRange = (v: string | null) => {
    if (!v) return true; // no filter if no date
    const t = new Date(v).getTime();
    const s = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : 0;
    const e = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;
    return Number.isFinite(t) && t >= s && t <= (e as number);
  };

  const salesInvoices = invoices.filter(
    (inv: any) => inv.type === "sales" && inRange(inv.date || inv.created_at)
  );

  const totalRevenue = salesInvoices.reduce(
    (s: number, inv: any) => s + (inv.total_amount || 0),
    0
  );
  const totalReceivables = salesInvoices
    .filter((inv: any) => inv.status !== "paid")
    .reduce((s: number, inv: any) => s + (inv.total_amount || 0), 0);

  const filteredEstimates = estimates.filter((e: any) =>
    inRange(e.estimate_date || e.created_at)
  );
  const filteredDc = deliveryChallans.filter((dc: any) =>
    inRange(dc.created_at || dc.delivery_date)
  );

  // Build recent activity from estimates + delivery_challans (most recent 10)
  const recentItems = [
    ...filteredEstimates.slice(-5).map((e: any) => ({
      type: "estimate",
      label: e.estimate_number ?? `Estimate #${e.id}`,
      meta: e.title ?? "",
      date: e.created_at ?? null,
      href: "/operations",
    })),
    ...filteredDc.slice(-5).map((dc: any) => ({
      type: dc.document_type === "wcc" ? "wcc" : "wcc",
      label: dc.dc_number ?? `DC #${dc.id}`,
      meta: dc.status ?? "",
      date: dc.created_at ?? null,
      href: "/operations",
    })),
  ]
    .sort((a, b) =>
      new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
    )
    .slice(0, 10);

  return {
    totalRevenue,
    totalReceivables,
    erpCounters: {
      estimatesDraft: filteredEstimates.filter((e: any) => e.status === "draft").length,
      estimatesAwaitingPo: filteredEstimates.filter((e: any) => e.status === "awaiting_po").length,
      estimatesApproved: filteredEstimates.filter((e: any) => e.status === "approved").length,
      poReceived: filteredEstimates.filter((e: any) => e.status === "po_received").length,
      dcPending: filteredDc.filter((dc: any) => dc.status === "pending").length,
      dcDelivered: filteredDc.filter((dc: any) => dc.status === "delivered" || dc.status === "completed").length,
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

export async function fetchEstimates(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/estimates", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("estimates", (q) =>
    q.select("*, clients(name), brands(name), stores(name)").order("created_at", { ascending: false })
  );
}

export async function fetchInvoices(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/finance/invoices", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("invoices", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchDeliveryChallans(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/delivery-challans", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("delivery_challans", (q) =>
    q.select("*").order("created_at", { ascending: false })
  );
}

export async function fetchExecutionDocuments(token: string | null, estimateId?: number) {
  if (!isBoltMode) {
    const url = estimateId
      ? `/api/operations/execution-documents?estimateId=${estimateId}`
      : "/api/operations/execution-documents";
    const res = await apiFetch(url, token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("execution_documents", (q) => {
    const base = q.select("*").order("created_at", { ascending: false });
    return estimateId ? base.eq("estimate_id", estimateId) : base;
  });
}

export async function fetchExecutionStores(token: string | null, estimateId?: number) {
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

export async function fetchNotifications(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/notifications", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("notifications", (q) =>
    q.select("*").order("created_at", { ascending: false }).limit(50)
  );
}

export async function fetchMaterialCodes(token: string | null) {
  if (!isBoltMode) {
    const res = await apiFetch("/api/operations/material-codes", token);
    return res.ok ? res.json() : [];
  }
  return sbSelect("material_codes", (q) => q.select("*").order("code"));
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
