import { isBoltMode } from "../../../lib/supabase";

export const fallbackDocumentNumber = (prefix: string) => `${prefix}-${Date.now().toString().slice(-6)}`;

export const fetchNextDocumentNumber = async (
  kind: "estimate" | "dc",
  token?: string | null,
  fallbackPrefix = kind === "estimate" ? "EST" : "DC",
) => {
  if (isBoltMode) return fallbackDocumentNumber(fallbackPrefix);
  try {
    const r = await fetch(`/api/numbering/${kind}/next`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const { number } = await r.json();
      return number;
    }
  } catch {
    // Fall back to timestamp below.
  }
  return fallbackDocumentNumber(fallbackPrefix);
};
