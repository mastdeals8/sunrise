/**
 * dc-save Edge Function
 * POST   /functions/v1/dc-save       → create DC or WCC
 * PATCH  /functions/v1/dc-save/:id   → update DC or WCC
 *
 * Replicates Express routes:
 *   POST  /api/operations/delivery-challans
 *   PATCH /api/operations/delivery-challans/:id
 *
 * Business rules preserved exactly:
 *  - documentTypeForDc: ABFRL/ABLBL format → "wcc", otherwise "dc"
 *  - findActiveDuplicateWcc: prevent double-creation of WCC for same store
 *  - deliveryDate defaults to now if missing
 *  - On POST: returns { ...created, duplicatePrevented: true } if WCC already exists
 *  - On PATCH: returns 409 if WCC uniqueness violation
 */

import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

// Mirrors routes.ts isAblblFormat() from shared/textFormat.ts
function isAblblFormat(format: unknown): boolean {
  const normalized = String(format ?? "").trim().toLowerCase();
  return ["abfrl", "abfrl_multi_store", "ablbl", "ablbl_multi_store"].includes(normalized);
}

// Mirrors routes.ts documentTypeForDc()
function documentTypeForDc(value: Record<string, unknown>): "wcc" | "dc" {
  if (isAblblFormat(value?.document_type || value?.client_format)) return "wcc";
  if (String(value?.document_type || "").toLowerCase() === "wcc") return "wcc";
  return "dc";
}

// Mirrors routes.ts storeCodeForDc()
function storeCodeForDc(value: Record<string, unknown>): string {
  const meta = value?.metadata as Record<string, unknown> | null | undefined;
  return String(
    value?.store_code ||
    meta?.storeCode ||
    meta?.storeId ||
    "",
  ).trim();
}

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

  try {
    await requireUser(req);
  } catch (r) {
    return r as Response;
  }

  const db = adminClient();
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/functions\/v1\/dc-save/, "").split("/").filter(Boolean);
  const dcId = pathParts[0] ? parseInt(pathParts[0], 10) : null;

  try {
    if (req.method === "PATCH" && dcId) {
      // ---- UPDATE PATH ----
      const body = await req.json() as Record<string, unknown>;

      // Fetch existing DC
      const { data: existing, error: fetchErr } = await db
        .from("delivery_challans")
        .select("*")
        .eq("id", dcId)
        .maybeSingle();
      if (fetchErr || !existing) return errorResponse("Delivery challan not found", 404);

      const updates: Record<string, unknown> = { ...body };

      // Preprocess deliveryDate
      if ("delivery_date" in updates || "deliveryDate" in updates) {
        updates.delivery_date = preprocessDate(updates.delivery_date ?? updates.deliveryDate);
        delete updates.deliveryDate;
      }

      // Re-derive documentType and check WCC uniqueness if relevant fields changed
      const relevantChange =
        updates.client_format !== undefined ||
        updates.document_type !== undefined ||
        updates.metadata !== undefined ||
        updates.store_code !== undefined ||
        updates.estimate_id !== undefined;

      if (relevantChange) {
        const uniquenessPayload = {
          ...existing,
          ...updates,
          metadata: updates.metadata !== undefined ? updates.metadata : existing.metadata,
        } as Record<string, unknown>;
        updates.document_type = documentTypeForDc(uniquenessPayload);

        if (updates.document_type === "wcc") {
          const storeCode = storeCodeForDc({ ...uniquenessPayload, document_type: updates.document_type });
          const estimateId = Number(uniquenessPayload.estimate_id);
          if (estimateId && storeCode) {
            const { data: siblings } = await db
              .from("delivery_challans")
              .select("*")
              .eq("estimate_id", estimateId);
            const conflict = (siblings ?? []).find((row: any) => {
              if (Number(row.id) === dcId) return false;
              if (row.status === "deleted" || (row.metadata as any)?.deleted) return false;
              if (documentTypeForDc(row) !== "wcc") return false;
              return storeCodeForDc(row) === storeCode;
            });
            if (conflict) {
              return jsonResponse({ message: "WCC already exists for this store", existingWcc: conflict }, 409);
            }
          }
        }
      }

      const { data: updated, error: updErr } = await db
        .from("delivery_challans")
        .update(updates)
        .eq("id", dcId)
        .select()
        .single();
      if (updErr) return errorResponse(updErr.message, 400);
      if (!updated) return errorResponse("Delivery challan not found", 404);
      return jsonResponse(updated);
    }

    if (req.method === "POST") {
      // ---- CREATE PATH ----
      const body = await req.json() as Record<string, unknown>;

      // deliveryDate defaults to now
      const payload: Record<string, unknown> = { ...body };
      payload.delivery_date = preprocessDate(
        payload.delivery_date ?? payload.deliveryDate,
        () => new Date(),
      );
      delete payload.deliveryDate;

      // Derive document type
      payload.document_type = documentTypeForDc(payload);

      // Prevent duplicate WCC for the same store/estimate
      if (payload.document_type === "wcc") {
        const storeCode = storeCodeForDc(payload);
        const estimateId = Number(payload.estimate_id);
        if (estimateId && storeCode) {
          const { data: siblings } = await db
            .from("delivery_challans")
            .select("*")
            .eq("estimate_id", estimateId);
          const existing = (siblings ?? []).find((row: any) => {
            if (row.status === "deleted" || (row.metadata as any)?.deleted) return false;
            if (documentTypeForDc(row) !== "wcc") return false;
            return storeCodeForDc(row) === storeCode;
          });
          if (existing) {
            return jsonResponse({ ...existing, duplicatePrevented: true, message: "WCC already exists for this store" }, 200);
          }
        }
      }

      const { data: created, error: createErr } = await db
        .from("delivery_challans")
        .insert(payload)
        .select()
        .single();
      if (createErr) return errorResponse(createErr.message, 400);
      if (!created) return errorResponse("Failed to create delivery challan", 500);
      return jsonResponse(created, 201);
    }

    return errorResponse("Method not allowed", 405);
  } catch (err: any) {
    console.error("[dc-save]", err);
    return errorResponse(err.message ?? "Internal server error", 500);
  }
});
