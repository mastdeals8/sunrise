export const companyAssetUrl = (filePath?: string | null, token?: string | null) => {
  const cleanPath = String(filePath || "").trim();
  if (!cleanPath) return "";

  // Rebuild Supabase company-asset URLs from their stable object key. Stored
  // signed URLs expire; the public company-assets bucket does not need them.
  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
    try {
      const parsed = new URL(cleanPath);
      const match = decodeURIComponent(parsed.pathname).match(/\/storage\/v1\/object\/(?:sign|public)\/company-assets\/(.+)$/);
      if (match?.[1]) {
        const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? `${parsed.protocol}//${parsed.host}`;
        return `${supabaseUrl}/storage/v1/object/public/company-assets/${match[1].split("/").map(encodeURIComponent).join("/")}`;
      }
    } catch { /* retain a non-Supabase absolute URL */ }
    return cleanPath;
  }

  // Supabase storage path (relative, no leading slash) — public bucket URL
  if (!cleanPath.startsWith("/")) {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
    return `${supabaseUrl}/storage/v1/object/public/company-assets/${cleanPath}`;
  }

  // Legacy Express path /uploads/company-assets/filename
  if (cleanPath.startsWith("/uploads/company-assets/")) {
    const filename = cleanPath.split("/").pop();
    if (!filename) return "";
    const isBolt = import.meta.env.VITE_BOLT_PREVIEW === "true";
    if (isBolt) {
      const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
      return `${supabaseUrl}/storage/v1/object/public/company-assets/${encodeURIComponent(filename)}`;
    }
    // SECURITY: browser requests authenticate via httpOnly session cookie.
    void token;
    return `/api/company-assets/${encodeURIComponent(filename)}`;
  }

  // Early Bolt records sometimes saved only "/logo.png". Those paths point at
  // the Vite origin and 404 in production; company assets live in this bucket.
  if (import.meta.env.VITE_BOLT_PREVIEW === "true" && /^\/[^/]+\.(png|jpe?g|webp|svg)$/i.test(cleanPath)) {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
    return `${supabaseUrl}/storage/v1/object/public/company-assets/${encodeURIComponent(cleanPath.slice(1))}`;
  }

  return cleanPath;
};
