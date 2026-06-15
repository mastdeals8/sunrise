export const companyAssetUrl = (filePath?: string | null, token?: string | null) => {
  const cleanPath = String(filePath || "").trim();
  if (!cleanPath) return "";

  if (!cleanPath.startsWith("/uploads/company-assets/")) {
    return cleanPath;
  }

  const filename = cleanPath.split("/").pop();
  if (!filename) return "";

  // SECURITY: tokens removed from URLs (audit C3). Browser requests for these
  // assets authenticate via the httpOnly session cookie set at login.
  // `token` param kept for call-site compatibility but intentionally unused.
  void token;
  return `/api/company-assets/${encodeURIComponent(filename)}`;
};

