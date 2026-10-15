/**
 * exec-doc-update Edge Function
 * PATCH /functions/v1/exec-doc-update
 *
 * Body: { id: number, ...fields to update }
 * Updates an execution_document row using the admin client (bypasses RLS).
 * Used for soft-delete: { id, status: "deleted", deleted_at: <iso> }
 */

import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    await requireUser(req);
  } catch (r) {
    return r as Response;
  }

  if (req.method !== "PATCH") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const { id, ...fields } = body;

    if (!id || typeof id !== "number") {
      return errorResponse("Missing or invalid id", 400);
    }
    if (Object.keys(fields).length === 0) {
      return errorResponse("No fields to update", 400);
    }

    const db = adminClient();

    // 1. Verify existence and company_id of target document
    const { data: existing, error: findErr } = await db
      .from("execution_documents")
      .select("id, company_id, status, estimate_id")
      .eq("id", id)
      .maybeSingle();

    if (findErr) return errorResponse(findErr.message, 400);
    if (!existing) return errorResponse("Document not found", 404);

    // 2. Enforce workspace access check
    const { data: dbUser } = await db
      .from("users")
      .select("id, role")
      .eq("email", user.email!)
      .maybeSingle();

    const isSuper = dbUser && (dbUser.id === 1 || dbUser.role === "admin");
    if (!isSuper && dbUser) {
      const { data: cu } = await db
        .from("company_users")
        .select("id, role")
        .eq("user_id", dbUser.id)
        .eq("company_id", existing.company_id)
        .maybeSingle();
      if (!cu) {
        return errorResponse(`Access denied to company workspace ${existing.company_id}`, 403);
      }
    }

    // 3. Disallow modifying company_id
    delete fields.company_id;
    delete fields.companyId;

    const { data, error } = await db
      .from("execution_documents")
      .update(fields)
      .eq("id", id)
      .select()
      .single();

    if (error) return errorResponse(error.message, 400);
    if (!data) return errorResponse("Document not found", 404);

    return jsonResponse(data);
  } catch (err: any) {
    console.error("[exec-doc-update]", err);
    return errorResponse(err.message ?? "Internal server error", 500);
  }
});
