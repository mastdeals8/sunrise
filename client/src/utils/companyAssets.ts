export const companyAssetUrl = (filePath?: string | null, token?: string | null) => {
  const cleanPath = String(filePath || "").trim();
  if (!cleanPath) return "";

  // Full URL — return as-is
  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
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

  return cleanPath;
};
