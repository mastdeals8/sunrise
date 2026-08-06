import { createClient } from "@supabase/supabase-js";

// Vite always supplies import.meta.env in Bolt. Keep module-only regression
// checks safe under Node as well, without changing the browser configuration.
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY;

if (viteEnv.VITE_BOLT_PREVIEW === "true") {
  console.log("[supabase] URL configured:", supabaseUrl ? "yes" : "no");
  console.log("[supabase] anon key configured:", supabaseAnonKey ? "yes" : "no");
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key"
);

// True when running as pure Vite frontend (Bolt preview / Bolt hosting).
// False when running under Express (npm run dev:full / production).
export const isBoltMode = viteEnv.VITE_BOLT_PREVIEW === "true";

export const hasSupabaseConfig =
  Boolean(supabaseUrl) && Boolean(supabaseAnonKey) &&
  supabaseUrl !== "https://placeholder.supabase.co";
