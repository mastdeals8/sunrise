import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (import.meta.env.VITE_BOLT_PREVIEW === "true" && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    "⚠️  Supabase env vars missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
    "in Bolt → Settings → Environment Variables (Secrets)."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key"
);

// True when running as pure Vite frontend (Bolt preview / Bolt hosting).
// False when running under Express (npm run dev:full / production).
export const isBoltMode = import.meta.env.VITE_BOLT_PREVIEW === "true";

export const hasSupabaseConfig =
  Boolean(supabaseUrl) && Boolean(supabaseAnonKey) &&
  supabaseUrl !== "https://placeholder.supabase.co";
