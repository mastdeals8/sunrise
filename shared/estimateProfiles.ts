export interface EstimateFormatProfile {
  code: string;
  name: string;
  description?: string;
  storeMode: "single" | "multi" | "none";
  storeRequired: boolean;
  storeCodeRequired: boolean;
  materialCodeMode: "required" | "optional" | "hidden";
  defaultProjectType?: string | null;
  dcDocumentType: "dc" | "wcc";
  printLayout: "retail_single_store" | "abfrl_grouped" | "standard";
  numberingPrefix?: string | null;
  isActive: boolean;
}

export const ESTIMATE_FORMAT_PROFILES: Record<string, EstimateFormatProfile> = {
  RETAIL_SINGLE_STORE: {
    code: "RETAIL_SINGLE_STORE",
    name: "Retail Store (Single Store)",
    description: "One store per estimate. Store selection and store code required. Clean single-site presentation.",
    storeMode: "single",
    storeRequired: true,
    storeCodeRequired: true,
    materialCodeMode: "hidden",
    dcDocumentType: "dc",
    printLayout: "retail_single_store",
    isActive: true,
  },
  ABLBL: {
    code: "ABLBL",
    name: "ABFRL Project (Multi-Store Grouping)",
    description: "ABFRL multi-store execution rollout with store grouping, CAPEX/SELEX validation, and WCC certificates.",
    storeMode: "multi",
    storeRequired: true,
    storeCodeRequired: true,
    materialCodeMode: "optional",
    dcDocumentType: "wcc",
    printLayout: "abfrl_grouped",
    isActive: true,
  },
  normal: {
    code: "normal",
    name: "Standard / Corporate Estimate",
    description: "Standard estimate format without mandatory store scoping.",
    storeMode: "none",
    storeRequired: false,
    storeCodeRequired: false,
    materialCodeMode: "hidden",
    dcDocumentType: "dc",
    printLayout: "standard",
    isActive: true,
  },
};

export const ALL_ESTIMATE_FORMAT_PROFILES: EstimateFormatProfile[] = Object.values(ESTIMATE_FORMAT_PROFILES);

export function getEstimateFormatProfile(code: unknown): EstimateFormatProfile {
  const norm = String(code ?? "").trim();
  if (["abfrl", "ablbl", "abfrl_multi_store", "ablbl_multi_store"].includes(norm.toLowerCase())) {
    return ESTIMATE_FORMAT_PROFILES.ABLBL;
  }
  if (norm.toUpperCase() === "RETAIL_SINGLE_STORE") {
    return ESTIMATE_FORMAT_PROFILES.RETAIL_SINGLE_STORE;
  }
  return ESTIMATE_FORMAT_PROFILES[norm] || ESTIMATE_FORMAT_PROFILES.normal;
}

export function isRetailSingleStoreFormat(code: unknown): boolean {
  return getEstimateFormatProfile(code).code === "RETAIL_SINGLE_STORE";
}

export function isMultiStoreFormat(code: unknown): boolean {
  return getEstimateFormatProfile(code).storeMode === "multi";
}

export function isStoreRequiredForFormat(code: unknown): boolean {
  return getEstimateFormatProfile(code).storeRequired;
}

export function isStoreCodeRequiredForFormat(code: unknown): boolean {
  return getEstimateFormatProfile(code).storeCodeRequired;
}

export function normalizeFormatProfileCode(code: unknown): string {
  return getEstimateFormatProfile(code).code;
}

export function resolveCustomerFormatProfile(
  estimate?: { formatProfileCode?: string | null; clientFormat?: string | null; clientId?: number | null } | null,
  client?: { id?: number; name?: string | null; clientGroupName?: string | null; defaultFormatProfileCode?: string | null; format?: string | null } | null
): EstimateFormatProfile {
  const clientName = String(client?.name || "").toLowerCase();
  const clientGroup = String(client?.clientGroupName || "").toLowerCase();

  // 1. ABFRL Customer -> existing ABFRL custom format
  const isClientAbfrl =
    clientName.includes("aditya birla") ||
    clientName.includes("abfrl") ||
    clientName.includes("ablbl") ||
    clientGroup.includes("abfrl") ||
    clientGroup.includes("ablbl") ||
    ["abfrl", "ablbl", "abfrl_multi_store", "ablbl_multi_store"].includes(String(client?.defaultFormatProfileCode ?? "").trim().toLowerCase()) ||
    ["abfrl", "ablbl", "abfrl_multi_store", "ablbl_multi_store"].includes(String(client?.format ?? "").trim().toLowerCase());

  const isEstAbfrl =
    ["abfrl", "ablbl", "abfrl_multi_store", "ablbl_multi_store"].includes(String(estimate?.formatProfileCode ?? "").trim().toLowerCase()) ||
    ["abfrl", "ablbl", "abfrl_multi_store", "ablbl_multi_store"].includes(String(estimate?.clientFormat ?? "").trim().toLowerCase());

  if (isClientAbfrl || isEstAbfrl) {
    return ESTIMATE_FORMAT_PROFILES.ABLBL;
  }

  // 2. Wakefit and other retail customers -> existing Retail Store format
  const isClientRetail =
    clientName.includes("wakefit") ||
    clientGroup.includes("wakefit") ||
    isRetailSingleStoreFormat(client?.defaultFormatProfileCode) ||
    isRetailSingleStoreFormat(client?.format);

  const isEstRetail =
    isRetailSingleStoreFormat(estimate?.formatProfileCode) ||
    isRetailSingleStoreFormat(estimate?.clientFormat);

  if (isClientRetail || isEstRetail) {
    return ESTIMATE_FORMAT_PROFILES.RETAIL_SINGLE_STORE;
  }

  // 3. Other customers -> their configured format profile or existing default format
  const explicitClientProfile = client?.defaultFormatProfileCode || client?.format;
  if (explicitClientProfile && explicitClientProfile !== "normal") {
    return getEstimateFormatProfile(explicitClientProfile);
  }

  const explicitEstProfile = estimate?.formatProfileCode || estimate?.clientFormat;
  if (explicitEstProfile && explicitEstProfile !== "normal") {
    return getEstimateFormatProfile(explicitEstProfile);
  }

  return ESTIMATE_FORMAT_PROFILES.normal;
}
