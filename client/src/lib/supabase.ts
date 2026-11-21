import { createClient } from "@supabase/supabase-js";

// Vite supplies import.meta.env in browser/Bolt; fall back to process.env in Node/test environments.
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const nodeEnv = typeof process !== "undefined" && process.env ? process.env : {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY;

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
