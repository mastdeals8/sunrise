import { db } from "./db";
import {
  notifications, estimates, invoices, deliveryChallans, executionDocuments, executionStores,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * Phase 3: Notification engine (Roadmap A3).
 *
 * Design: the six required alert types are all *conditions derivable from
 * current data* (a WCC is pending, a payment is overdue...), so instead of a
 * fragile event bus, deriveNotifications() scans state and reconciles the
 * notifications table against it:
 *   - condition true  → upsert (dedupeKey keeps exactly one open row)
 *   - condition false → auto-resolve the row
 * It runs on demand (GET /api/notifications triggers a refresh at most every
 * 60s) — no scheduler infrastructure required; a cron can call the same
 * function later for push delivery (Telegram hook point marked below).
 */

type Derived = {
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  estimateId?: number | null;
  invoiceId?: number | null;
  deliveryChallanId?: number | null;
  dedupeKey: string;
  forRole?: string | null;
};

const isDcDeleted = (dc: any) => dc.status === "deleted" || dc.metadata?.deleted;
const DAY = 24 * 60 * 60 * 1000;

export const deriveNotifications = async (): Promise<{ created: number; resolved: number; open: number }> => {
  const [allEstimates, allDcs, allDocs, allStores, allInvoices] = await Promise.all([
    db.select().from(estimates),
    db.select().from(deliveryChallans),
    db.select().from(executionDocuments),
    db.select().from(executionStores),
    db.select().from(invoices),
  ]);

  const derived: Derived[] = [];
  const activeDcs = (allDcs as any[]).filter((d) => !isDcDeleted(d));
  const activeDocs = (allDocs as any[]).filter((d) => d.status === "active");
  const docsByDc = new Map<number, any[]>();
  for (const doc of activeDocs) {
    if (!doc.deliveryChallanId) continue;
    const list = docsByDc.get(doc.deliveryChallanId) || [];
    list.push(doc);
    docsByDc.set(doc.deliveryChallanId, list);
  }
  const dcsByEstimate = new Map<number, any[]>();
  for (const dc of activeDcs) {
    const list = dcsByEstimate.get(dc.estimateId) || [];
    list.push(dc);
    dcsByEstimate.set(dc.estimateId, list);
  }

  // 1. Pending WCC — PO received but no active WCC/DC generated yet
  for (const est of allEstimates as any[]) {
    const hasPo = Boolean(est.poNumber || est.poFilePath || est.status === "po_received");
    if (!hasPo || est.status === "cancelled") continue;
    if ((dcsByEstimate.get(est.id) || []).length === 0) {
      derived.push({
        type: "pending_wcc", severity: "warning",
        title: `WCC pending for ${est.estimateNumber}`,
        message: `PO received but no WCC/DC generated yet (${est.title || ""}).`,
        estimateId: est.id, dedupeKey: `pending_wcc:estimate:${est.id}`,
        forRole: null,
      });
    }
  }

  // 2 & 3. Missing photos / missing signed WCC per active WCC
  for (const dc of activeDcs) {
    const docs = docsByDc.get(dc.id) || [];
    const label = dc.dcNumber || `WCC #${dc.id}`;
    if (!docs.some((d) => d.documentType === "photo")) {
      derived.push({
        type: "missing_photos", severity: "info",
        title: `Photos missing for ${label}`,
        message: `No site photos uploaded for ${label} (store ${dc.storeCode || dc.metadata?.storeCode || "?"}).`,
        estimateId: dc.estimateId, deliveryChallanId: dc.id,
        dedupeKey: `missing_photos:dc:${dc.id}`, forRole: null,
      });
    }
    if (!docs.some((d) => d.documentType === "signed_wcc" || d.documentType === "signed_dc")) {
      derived.push({
        type: "missing_signed_wcc", severity: "warning",
        title: `Signed copy missing for ${label}`,
        message: `Signed WCC/DC not yet received for ${label}.`,
        estimateId: dc.estimateId, deliveryChallanId: dc.id,
        dedupeKey: `missing_signed_wcc:dc:${dc.id}`, forRole: null,
      });
    }
  }

  // 4. Invoice ready — signed proof exists, no invoice yet
  const invoicedEstimates = new Set((allInvoices as any[]).filter((i) => i.status !== "cancelled").map((i) => i.estimateId));
  for (const dc of activeDcs) {
    const docs = docsByDc.get(dc.id) || [];
    const signed = docs.some((d) => d.documentType === "signed_wcc" || d.documentType === "signed_dc");
    if (signed && !invoicedEstimates.has(dc.estimateId)) {
      const est = (allEstimates as any[]).find((e) => e.id === dc.estimateId);
      derived.push({
        type: "invoice_ready", severity: "info",
        title: `Invoice ready: ${est?.estimateNumber || dc.estimateId}`,
        message: `Signed proof received for ${dc.dcNumber || dc.id} — invoice can be raised.`,
        estimateId: dc.estimateId, deliveryChallanId: dc.id,
        dedupeKey: `invoice_ready:estimate:${dc.estimateId}`, forRole: "accounts",
      });
    }
  }

  // 5 & 6. Payment due (within 7 days) / overdue
  const now = Date.now();
  for (const inv of allInvoices as any[]) {
    if (inv.status === "paid" || inv.status === "cancelled" || !inv.dueDate) continue;
    const balance = Number(inv.balanceAmount ?? (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
    if (balance <= 0) continue;
    const due = new Date(inv.dueDate).getTime();
    if (due < now) {
      const daysOver = Math.floor((now - due) / DAY);
      derived.push({
        type: "payment_overdue", severity: "critical",
        title: `Overdue ${daysOver}d: ${inv.invoiceNumber}`,
        message: `${inv.partyName || "Client"} — ₹${balance.toLocaleString("en-IN")} overdue by ${daysOver} day(s).`,
        invoiceId: inv.id, estimateId: inv.estimateId ?? null,
        dedupeKey: `payment_overdue:invoice:${inv.id}`, forRole: "accounts",
      });
    } else if (due - now <= 7 * DAY) {
      derived.push({
        type: "payment_due", severity: "warning",
        title: `Due soon: ${inv.invoiceNumber}`,
        message: `${inv.partyName || "Client"} — ₹${balance.toLocaleString("en-IN")} due ${new Date(due).toLocaleDateString("en-IN")}.`,
        invoiceId: inv.id, estimateId: inv.estimateId ?? null,
        dedupeKey: `payment_due:invoice:${inv.id}`, forRole: "accounts",
      });
    }
  }

  // Reconcile against table
  const open = await db.select().from(notifications).where(isNull(notifications.resolvedAt));
  const openByKey = new Map((open as any[]).map((n) => [n.dedupeKey, n]));
  const derivedKeys = new Set(derived.map((d) => d.dedupeKey));

  let created = 0;
  for (const d of derived) {
    if (!openByKey.has(d.dedupeKey)) {
      try {
        await db.insert(notifications).values(d as any).onConflictDoNothing();
        created++;
        // ── Telegram/WhatsApp push hook point (Roadmap A4/B2) ──
        // await sendBotNotification(d);  // intentionally not implemented in Phase 3
      } catch { /* dedupe race — ignore */ }
    }
  }

  let resolved = 0;
  const toResolve = (open as any[]).filter((n) => !derivedKeys.has(n.dedupeKey)).map((n) => n.id);
  if (toResolve.length) {
    await db.update(notifications).set({ resolvedAt: new Date() }).where(inArray(notifications.id, toResolve));
    resolved = toResolve.length;
  }

  return { created, resolved, open: derived.length };
};

let lastRefresh = 0;
export const refreshNotificationsThrottled = async () => {
  if (Date.now() - lastRefresh < 60_000) return null;
  lastRefresh = Date.now();
  return deriveNotifications();
};
