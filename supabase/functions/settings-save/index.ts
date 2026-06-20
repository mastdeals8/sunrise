import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

/**
 * Upsert app_settings key-value pairs using the service-role admin client,
 * bypassing RLS restrictions that block INSERT from the browser anon client.
 *
 * Body: { [key: string]: string | null }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    await requireUser(req);
    const db = adminClient();

    const body: Record<string, string | null> = await req.json().catch(() => ({}));
    const entries = Object.entries(body);
    if (entries.length === 0) return jsonResponse({ ok: true, updated: 0 });

    for (const [key, value] of entries) {
      if (!key || typeof key !== "string") continue;
      const { error } = await db
        .from("app_settings")
        .upsert({ key, value }, { onConflict: "key" });
      if (error) throw new Error(`Failed to save key "${key}": ${error.message}`);
    }

    return jsonResponse({ ok: true, updated: entries.length });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    return errorResponse(err instanceof Error ? err.message : "Unknown error");
  }
});
