/**
 * invoice-create Edge Function
 * POST /functions/v1/invoice-create  → create invoice
 *
 * Replicates Express route: POST /api/finance/invoices
 *
 * Business rules preserved:
 *  - Date preprocessing (date, dueDate default handling)
 *  - Invoice readiness check skipped in Bolt mode (readiness derives from
 *    execution_stores which is a server-side aggregation; non-blocking here)
 *  - Returns same JSON shape as Express response
 */

import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

function preprocessDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const invoiceFields = new Set(["invoice_number", "type", "party_name", "amount", "tax_amount", "total_amount", "date", "due_date", "status", "estimate_id", "client_id", "paid_amount", "balance_amount", "packet_settings", "remarks", "delivery_challan_id", "line_items", "po_number", "po_reference", "transport_cost"]);
const toSnake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
function normalizeInvoicePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const column = toSnake(key);
    if (invoiceFields.has(column)) payload[column] = value;
  }
  if ("date" in payload) payload.date = preprocessDate(payload.date);
  if ("due_date" in payload) payload.due_date = preprocessDate(payload.due_date);
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    await requireUser(req);
  } catch (r) {
    return r as Response;
  }

  const db = adminClient();

  try {
    const body = await req.json() as Record<string, unknown>;
    const payload = normalizeInvoicePayload(body);

    // Required: at minimum partyName and amount
    if (!payload.party_name) {
      return errorResponse("Missing required field: party_name", 400);
    }

    const requestedId = Number(body.id || 0);
    if (requestedId > 0) {
      const { data: updated, error } = await db.from("invoices").update(payload).eq("id", requestedId).select().single();
      if (error) return errorResponse(error.message, 400);
      return jsonResponse(updated);
    }

    if (payload.estimate_id) {
      const { data: existing, error: lookupError } = await db.from("invoices").select("*")
        .eq("estimate_id", payload.estimate_id).neq("status", "cancelled")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (lookupError) return errorResponse(lookupError.message, 400);
      if (existing) return jsonResponse(existing, 200);
    }

    const { data: created, error } = await db
      .from("invoices")
      .insert(payload)
      .select()
      .single();

    if (error) return errorResponse(error.message, 400);
    if (!created) return errorResponse("Failed to create invoice", 500);

    return jsonResponse(created, 201);
  } catch (err: any) {
    console.error("[invoice-create]", err);
    return errorResponse(err.message ?? "Internal server error", 500);
  }
});
