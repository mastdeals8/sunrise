/**
 * estimate-save Edge Function
 * POST   /functions/v1/estimate-save       → create estimate + items
 * PATCH  /functions/v1/estimate-save/:id   → update estimate + optionally replace items
 *
 * Replicates Express routes:
 *   POST  /api/operations/estimates
 *   PATCH /api/operations/estimates/:id
 *
 * Business rules preserved exactly:
 *  - Billing profile snapshot (legalName, GSTIN, state, address)
 *  - GST type derivation: same stateCode → CGST+SGST, different → IGST
 *  - FY-aware estimate numbering (SM/E/26-27/201+)
 *  - ABFRL CAPEX: every item must carry a materialCode/materialCodeId
 *  - Item replace: DELETE + INSERT in a single transaction (via RPC)
 */

import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";
import { nextDocumentNumber } from "../_shared/numbering.ts";

// Mirrors routes.ts deriveGstType()
function deriveGstType(
  sellerStateCode: string | null | undefined,
  billingStateCode: string | null | undefined,
): "CGST+SGST" | "IGST" {
  const norm = (v: unknown) => String(v ?? "").trim().padStart(2, "0").slice(0, 2);
  const a = norm(sellerStateCode);
  const b = norm(billingStateCode);
  if (!b) return "CGST+SGST";
  return a === b ? "CGST+SGST" : "IGST";
}

// Mirrors shared/textFormat.ts isAblblFormat()
function isAblblFormat(format: unknown): boolean {
  const normalized = String(format ?? "").trim().toLowerCase();
  return ["abfrl", "abfrl_multi_store", "ablbl", "ablbl_multi_store"].includes(normalized);
}

function preprocessDate(value: unknown, defaultTo?: () => Date): Date | null | undefined {
  if (value === null || value === undefined) {
    return defaultTo ? defaultTo() : undefined;
  }
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? (defaultTo ? defaultTo() : undefined) : d;
}

async function getSellerStateCode(db: ReturnType<typeof adminClient>): Promise<string | null> {
  try {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "company.stateCode")
      .maybeSingle();
    if (data?.value && typeof (data.value as any) === "string") return (data.value as any);
    // Try "seller.stateCode" key as used by getSellerProfile
    const { data: d2 } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "seller.stateCode")
      .maybeSingle();
    if (d2?.value && typeof (d2.value as any) === "string") return (d2.value as any);
    // Try "billing" top-level config
    const { data: d3 } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "seller")
      .maybeSingle();
    return (d3?.value as any)?.stateCode ?? null;
  } catch {
    return null;
  }
}

// Convert camelCase keys to snake_case so frontend can send either format.
function normalizeKeys(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const snake = k.replace(/([A-Z])/g, "_$1").toLowerCase();
    result[snake] = v;
  }
  return result;
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

  // ID resolution: path segment → query param ?id= → body _estimateId
  const pathParts = url.pathname.replace(/^\/functions\/v1\/estimate-save/, "").split("/").filter(Boolean);
  const pathId = pathParts[0] ? parseInt(pathParts[0], 10) : null;
  const queryId = url.searchParams.get("id") ? parseInt(url.searchParams.get("id")!, 10) : null;

  try {
    if (req.method === "PATCH") {
      // ---- UPDATE PATH ----
      const rawBody = await req.json();
      // Body-based ID: legacy fallback kept for backwards compatibility.
      const bodyId = rawBody._estimateId ? parseInt(String(rawBody._estimateId), 10) : null;
      delete rawBody._estimateId;
      const estimateId = pathId ?? queryId ?? bodyId;
      if (!estimateId) return errorResponse("Missing estimate id", 400);

      // Normalize camelCase keys to snake_case (e.g. poNumber → po_number)
      const updates: Record<string, unknown> = normalizeKeys(rawBody);

      // Preprocess date fields
      if ("estimate_date" in updates) updates.estimate_date = preprocessDate(updates.estimate_date)?.toISOString() ?? null;
      if ("po_date" in updates) updates.po_date = preprocessDate(updates.po_date)?.toISOString() ?? null;

      // Extract items array if provided (separate op from estimate fields)
      const replaceItems: unknown[] | undefined = Array.isArray(updates.items)
        ? (updates.items as unknown[])
        : undefined;
      if (replaceItems !== undefined) delete updates.items;

      // Billing profile snapshot
      if (updates.billing_profile_id) {
        const { data: bp } = await db
          .from("client_billing_profiles")
          .select("*")
          .eq("id", Number(updates.billing_profile_id))
          .maybeSingle();
        if (bp) {
          updates.billing_legal_name_snapshot = bp.legal_company_name;
          updates.billing_gstin_snapshot = bp.gstin;
          updates.billing_state_snapshot = bp.state;
          updates.billing_state_code_snapshot = bp.state_code;
          updates.billing_address_snapshot = bp.billing_address;
          updates.shipping_address_snapshot = bp.shipping_address;
          updates.billing_to = bp.legal_company_name;
          updates.gstin = bp.gstin;
          if (bp.pan) updates.pan = bp.pan;
          updates.state_code = bp.state_code;
        }
      }

      // Re-derive gstType when state changes
      if (updates.gst_type === undefined && (updates.state_code || updates.billing_state_code_snapshot)) {
        const sellerStateCode = await getSellerStateCode(db);
        const newStateCode = (updates.billing_state_code_snapshot || updates.state_code) as string | null;
        updates.gst_type = deriveGstType(sellerStateCode, newStateCode);
      }

      if (replaceItems !== undefined) {
        // Transaction: update estimate + delete old items + insert new items
        const { data: updatedRow, error: updateErr } = await db
          .from("estimates")
          .update(updates)
          .eq("id", estimateId)
          .select()
          .single();
        if (updateErr) return errorResponse(updateErr.message, 400);
        if (!updatedRow) return errorResponse("Estimate not found", 404);

        // Delete existing items
        await db.from("estimate_items").delete().eq("estimate_id", estimateId);

        // Insert new items
        if (replaceItems.length > 0) {
          const itemRows = replaceItems.map((it: any) => ({ ...it, estimate_id: estimateId }));
          const { error: itemErr } = await db.from("estimate_items").insert(itemRows);
          if (itemErr) return errorResponse(`Items replace failed: ${itemErr.message}`, 400);
        }

        return jsonResponse(updatedRow);
      }

      // Simple update (no items replacement)
      const { data: updated, error: updErr } = await db
        .from("estimates")
        .update(updates)
        .eq("id", estimateId)
        .select()
        .single();
      if (updErr) return errorResponse(updErr.message, 400);
      if (!updated) return errorResponse("Estimate not found", 404);
      return jsonResponse(updated);
    }

    if (req.method === "POST") {
      // ---- CREATE PATH ----
      const { estimate, items } = await req.json() as { estimate: Record<string, unknown>; items: unknown[] };

      if (!estimate) return errorResponse("Missing estimate", 400);
      if (!Array.isArray(items) || items.length === 0) {
        return errorResponse("Estimate must contain at least one item", 400);
      }

      // Billing profile snapshot
      if (estimate.billing_profile_id || estimate.billingProfileId) {
        const bpId = Number(estimate.billing_profile_id ?? estimate.billingProfileId);
        const { data: bp } = await db
          .from("client_billing_profiles")
          .select("*")
          .eq("id", bpId)
          .maybeSingle();
        if (bp) {
          estimate.billing_legal_name_snapshot = bp.legal_company_name;
          estimate.billing_gstin_snapshot = bp.gstin;
          estimate.billing_state_snapshot = bp.state;
          estimate.billing_state_code_snapshot = bp.state_code;
          estimate.billing_address_snapshot = bp.billing_address;
          estimate.shipping_address_snapshot = bp.shipping_address;
          estimate.billing_to = bp.legal_company_name;
          estimate.gstin = bp.gstin;
          if (bp.pan) estimate.pan = bp.pan;
          estimate.state_code = bp.state_code;
        }
      }

      // Auto-derive gstType if not explicitly set
      if (!estimate.gst_type && !estimate.gstType) {
        const sellerStateCode = await getSellerStateCode(db);
        const billingStateCode = (estimate.billing_state_code_snapshot || estimate.state_code) as string | null | undefined;
        estimate.gst_type = deriveGstType(sellerStateCode, billingStateCode);
      }

      // Preprocess date fields
      estimate.estimate_date = preprocessDate(estimate.estimate_date || estimate.estimateDate, () => new Date())?.toISOString();
      if (estimate.po_date || estimate.poDate) {
        estimate.po_date = preprocessDate(estimate.po_date ?? estimate.poDate)?.toISOString() ?? null;
      }

      // Generate estimate number
      estimate.estimate_number = await nextDocumentNumber(db, "estimate");

      // ABFRL CAPEX: every line must have a material code
      const fmt = estimate.client_format || estimate.clientFormat;
      if (isAblblFormat(fmt) && (estimate.abfrl_project_type || estimate.abfrlProjectType) === "CAPEX") {
        const missing = (items as any[])
          .map((it: any, i: number) => ({ sl: it.sl ?? i + 1, mc: it.material_code ?? it.materialCode, id: it.material_code_id ?? it.materialCodeId }))
          .filter((r: any) => !r.mc && !r.id);
        if (missing.length > 0) {
          return errorResponse(
            `ABLBL CAPEX requires Material Code on every row. Missing on row(s): ${missing.map((m: any) => m.sl).join(", ")}.`,
            400,
          );
        }
      }

      // Insert estimate
      const { data: created, error: createErr } = await db
        .from("estimates")
        .insert(estimate)
        .select()
        .single();
      if (createErr) return errorResponse(createErr.message, 400);
      if (!created) return errorResponse("Failed to create estimate", 500);

      // Insert items linked to the new estimate
      const itemRows = (items as any[]).map((it: any) => ({
        ...it,
        estimate_id: created.id,
      }));
      const { error: itemErr } = await db.from("estimate_items").insert(itemRows);
      if (itemErr) return errorResponse(`Items insert failed: ${itemErr.message}`, 400);

      return jsonResponse(created, 201);
    }

    return errorResponse("Method not allowed", 405);
  } catch (err: any) {
    console.error("[estimate-save]", err);
    return errorResponse(err.message ?? "Internal server error", 500);
  }
});
