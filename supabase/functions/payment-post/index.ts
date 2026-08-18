/**
 * payment-post Edge Function
 * POST /functions/v1/payment-post  → create payment record
 *
 * Replicates Express route: POST /api/finance/payments
 *
 * Business rules preserved:
 *  - Date preprocessing (date field, defaults to today if missing)
 *  - Returns same JSON shape as Express response
 */

import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

function preprocessDate(value: unknown, defaultTo?: () => Date): string | null {
  if (value === null || value === undefined) {
    return defaultTo ? defaultTo().toISOString() : null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return defaultTo ? defaultTo().toISOString() : null;
  }
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? (defaultTo ? defaultTo().toISOString() : null) : d.toISOString();
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

    // Preprocess date — mirrors Express preprocessDateFields(req.body, ["date"])
    const payload: Record<string, unknown> = { ...body };
    payload.date = preprocessDate(payload.date, () => new Date());

    // Validate minimum required fields
    if (!payload.amount) {
      return errorResponse("Missing required field: amount", 400);
    }

    const { data: created, error } = await db
      .from("payments")
      .insert(payload)
      .select()
      .single();

    if (error) return errorResponse(error.message, 400);
    if (!created) return errorResponse("Failed to create payment", 500);

    // Preserve the existing Sunrise payment behavior: a receipt linked to an
    // invoice updates only the invoice's stored paid/balance/status fields.
    // Journal generation is intentionally not added here; its accounting
    // treatment is outside this Bolt stabilization change.
    const invoiceId = Number(payload.invoice_id ?? payload.invoiceId ?? 0);
    if (invoiceId > 0) {
      const { data: invoice, error: invoiceError } = await db
        .from("invoices")
        .select("id, total_amount, paid_amount")
        .eq("id", invoiceId)
        .maybeSingle();
      if (invoiceError) return errorResponse(invoiceError.message, 400);
      if (!invoice) return errorResponse("Linked invoice not found", 400);
      const paidAmount = Math.round((Number(invoice.paid_amount || 0) + Number(payload.amount || 0)) * 100) / 100;
      const balanceAmount = Math.max(0, Math.round((Number(invoice.total_amount || 0) - paidAmount) * 100) / 100);
      const status = balanceAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
      const { error: updateError } = await db.from("invoices").update({
        paid_amount: paidAmount,
        balance_amount: balanceAmount,
        status,
      }).eq("id", invoiceId);
      if (updateError) return errorResponse(updateError.message, 400);
    }

    return jsonResponse(created, 201);
  } catch (err: any) {
    console.error("[payment-post]", err);
    return errorResponse(err.message ?? "Internal server error", 500);
  }
});
