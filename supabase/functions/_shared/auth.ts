import { createClient } from "npm:@supabase/supabase-js@2";

// Returns { user } or throws Response with 401.
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new Response(JSON.stringify({ message: "Missing Authorization header" }), { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Use the user's own JWT — Supabase validates it against the project secret.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
  return { user, jwt };
}

// Admin client using service role key — only server-side, never exposed to frontend.
export function adminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
