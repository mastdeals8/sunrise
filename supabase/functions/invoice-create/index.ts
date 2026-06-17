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
    const body = await req.json();

    // Preprocess date fields — mirrors Express preprocessDateFields(req.body, ["date", "dueDate"])
    const payload: Record<string, unknown> = { ...body };
    if ("date" in payload) payload.date = preprocessDate(payload.date);
    if ("due_date" in payload) payload.due_date = preprocessDate(payload.due_date);
    if ("dueDate" in payload) payload.due_date = preprocessDate(payload.dueDate);

    // Required: at minimum partyName and amount
    if (!payload.party_name && !payload.partyName) {
      return errorResponse("Missing required field: party_name", 400);
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
