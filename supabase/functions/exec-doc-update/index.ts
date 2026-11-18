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

  let authenticatedUser: { id: string; email?: string };
  try {
    const auth = await requireUser(req);
    authenticatedUser = auth.user;
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
      .select("id, company_id, status, estimate_id, file_path")
      .eq("id", id)
      .maybeSingle();

    if (findErr) return errorResponse(findErr.message, 400);
    if (!existing) return errorResponse("Document not found", 404);

    // 2. Enforce workspace access check
    const { data: authLinkedUser } = await db
      .from("users")
      .select("id, role")
      .eq("auth_user_id", authenticatedUser.id)
      .maybeSingle();
    const { data: emailLinkedUser } = authLinkedUser || !authenticatedUser.email
      ? { data: null }
      : await db
          .from("users")
          .select("id, role")
          .eq("email", authenticatedUser.email)
          .maybeSingle();
    const dbUser = authLinkedUser || emailLinkedUser;

    if (!dbUser) return errorResponse("Access denied", 403);
    const isSuper = dbUser.id === 1 || dbUser.role === "admin";
    if (!isSuper) {
      const { data: cu } = await db
        .from("company_users")
        .select("id, role")
        .eq("user_id", dbUser.id)
        .eq("company_id", existing.company_id)
        .maybeSingle();
      if (!cu) {
        return errorResponse("Access denied", 403);
      }
      const allowedCompanyRoles = ["super_admin", "company_admin"];
      const allowedGlobalRoles = ["admin", "manager", "production", "installer"];
      if (!allowedCompanyRoles.includes(String(cu.role)) && !allowedGlobalRoles.includes(String(dbUser.role))) {
        return errorResponse("You do not have permission to delete this file", 403);
      }
    }

    // 3. This endpoint only supports deletion; do not allow arbitrary field updates.
    if (fields.status !== "deleted") {
      return errorResponse("Only document deletion is supported", 400);
    }

    // 4. Remove the selected storage object first. A missing object is safe to
    // treat as already deleted, but any other storage error preserves the DB row.
    const filePath = typeof existing.file_path === "string" ? existing.file_path : "";
    if (filePath && !/^https?:\/\//i.test(filePath)) {
      const { error: storageErr } = await db.storage.from("execution-documents").remove([filePath]);
      if (storageErr) return errorResponse("Could not delete the file", 502);
    }

    const { data, error } = await db
      .from("execution_documents")
      .update({ status: "deleted", deleted_at: fields.deleted_at ?? new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", existing.company_id)
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
