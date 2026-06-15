import { db } from "./db";
import { auditLogs } from "@shared/schema";
import type { AuthRequest } from "./auth";

/**
 * Phase 3: Audit logging (Roadmap A1).
 * Records who did what, when, with before/after values and links to the
 * project (estimate), invoice and WCC/DC where applicable.
 *
 * Design: fire-and-forget — auditing must NEVER break a business action.
 * Failures log to console and the action proceeds.
 */
export type AuditEntry = {
  action: "create" | "update" | "delete" | "approve" | "reject" | "status_change";
  entityType: string;          // "estimate" | "invoice" | "delivery_challan" | ...
  entityId?: number | null;
  entityLabel?: string | null; // human-readable number/name
  estimateId?: number | null;
  invoiceId?: number | null;
  deliveryChallanId?: number | null;
  oldValue?: any;
  newValue?: any;
};

const MAX_JSON_BYTES = 50_000; // keep rows bounded; huge payloads truncated

const bounded = (v: any) => {
  if (v === undefined || v === null) return null;
  try {
    const s = JSON.stringify(v);
    if (s.length <= MAX_JSON_BYTES) return v;
    return { _truncated: true, preview: s.slice(0, MAX_JSON_BYTES) };
  } catch {
    return { _unserializable: true };
  }
};

/** Strip noisy/secret fields from logged values. */
const scrub = (v: any) => {
  if (!v || typeof v !== "object") return v;
  const { password, token, ...rest } = v as Record<string, any>;
  return rest;
};

export const audit = (req: AuthRequest | null, entry: AuditEntry): void => {
  const row = {
    userId: req?.user?.id ?? null,
    userName: req?.user?.name || req?.user?.username || "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel ?? null,
    estimateId: entry.estimateId ?? null,
    invoiceId: entry.invoiceId ?? null,
    deliveryChallanId: entry.deliveryChallanId ?? null,
    oldValue: bounded(scrub(entry.oldValue)),
    newValue: bounded(scrub(entry.newValue)),
  };
  // Fire-and-forget: never await in the request path, never throw.
  db.insert(auditLogs)
    .values(row as any)
    .catch((err: any) => console.error("[audit] write failed:", err?.message));
};

/** Compute a minimal old→new diff for update logs (only changed keys). */
export const diffForAudit = (oldObj: any, newObj: any) => {
  if (!oldObj || !newObj) return { oldValue: oldObj ?? null, newValue: newObj ?? null };
  const oldOut: Record<string, any> = {};
  const newOut: Record<string, any> = {};
  for (const key of Object.keys(newObj)) {
    const a = (oldObj as any)[key];
    const b = (newObj as any)[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      oldOut[key] = a;
      newOut[key] = b;
    }
  }
  return { oldValue: oldOut, newValue: newOut };
};
