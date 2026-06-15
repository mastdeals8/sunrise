// System service products — the four service rows the Estimate Builder's
// Packing / Installation / Local Transport / Outstation buttons resolve to.
// They live in the regular `products` table under category "Services"; this
// module is the single source of truth for which names are reserved.
//
// System services may be edited (rate, HSN, GST%, calc type, description)
// and deactivated (isActive=false) — but they must not be deleted, because
// the Estimate Builder buttons look them up by these exact names.

export const SYSTEM_SERVICE_CATEGORY = "Services" as const;

export const SYSTEM_SERVICE_NAMES = [
  "Packing Charges",
  "Installation Charges",
  "Local Transportation",
  "Outstation Charges",
] as const;

export type SystemServiceName = typeof SYSTEM_SERVICE_NAMES[number];

const nameSet = new Set<string>(SYSTEM_SERVICE_NAMES.map(n => n.toLowerCase()));
const catKey = (v: unknown) => String(v ?? "").trim().toLowerCase();
const nameKey = (v: unknown) => String(v ?? "").trim().toLowerCase();

export const isSystemServiceProduct = (
  product: { name?: string | null; category?: string | null } | null | undefined,
): boolean => {
  if (!product) return false;
  if (catKey(product.category) !== SYSTEM_SERVICE_CATEGORY.toLowerCase()) return false;
  return nameSet.has(nameKey(product.name));
};
