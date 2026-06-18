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
