import { isAblblFormat } from "./textFormat";
import type { ScopedStore } from "./storeScoping";

export interface StoreTransportRequirement {
  storeId: number | null;
  storeCode: string;
  storeName: string;
  transportMode: "outstation" | "local" | "none";
  transportDetails?: string;
  transportAmount?: number;
  status: "Uploaded" | "Pending" | "Not Applicable";
  invoiceDoc?: any;
}

export interface TransportComplianceSummary {
  isAblbl: boolean;
  hasOutstation: boolean;
  requirements: StoreTransportRequirement[];
  pendingCount: number;
  uploadedCount: number;
}

/**
 * Check whether a project/client is an Aditya Birla Lifestyle Brands Limited project.
 */
export function isAblblProject(clientOrEstimate: any, invoiceOrClient?: any): boolean {
  if (!clientOrEstimate && !invoiceOrClient) return false;

  const format =
    clientOrEstimate?.clientFormat ||
    clientOrEstimate?.client_format ||
    clientOrEstimate?.formatProfileCode ||
    clientOrEstimate?.format_profile_code ||
    invoiceOrClient?.clientFormat ||
    invoiceOrClient?.client_format ||
    invoiceOrClient?.formatProfileCode ||
    invoiceOrClient?.format_profile_code;

  if (isAblblFormat(format)) return true;

  const nameToCheck = (
    String(
      clientOrEstimate?.partyName ||
      clientOrEstimate?.party_name ||
      clientOrEstimate?.name ||
      clientOrEstimate?.clientName ||
      clientOrEstimate?.client_name ||
      ""
    ) +
    " " +
    String(
      invoiceOrClient?.partyName ||
      invoiceOrClient?.party_name ||
      invoiceOrClient?.name ||
      invoiceOrClient?.clientName ||
      invoiceOrClient?.client_name ||
      ""
    )
  ).toLowerCase();

  return (
    nameToCheck.includes("aditya birla") ||
    nameToCheck.includes("ablbl") ||
    nameToCheck.includes("abfrl") ||
    String(format || "").toLowerCase().includes("ablbl") ||
    String(format || "").toLowerCase().includes("abfrl")
  );
}

/**
 * Check whether an execution document is a verified supplier transport invoice,
 * NOT an ordinary LR copy, courier slip, or dispatch receipt.
 */
export function isVerifiedTransportInvoice(doc: any): boolean {
  if (!doc) return false;
  if (doc.status === "deleted" || doc.status === "replaced") return false;

  const docType = String(doc.documentType || doc.document_type || "").trim().toLowerCase();
  const category = String(doc.metadata?.documentCategory || doc.metadata?.category || "").trim().toLowerCase();

  return docType === "transport_invoice" || category === "transport_invoice";
}

/**
 * Derive transport mode and details for a given store from store grouping and estimate items.
 */
export function getStoreTransportMode(
  storeId: number | null,
  storeCode: string | null,
  estimate: any,
  estimateItems: any[] = []
): { mode: "outstation" | "local" | "none"; details: string; amount: number } {
  const sidKey = storeId ? String(storeId) : null;
  const grouping = (estimate?.storeGrouping || estimate?.store_grouping || {}) as Record<string, any>;
  const groupData = sidKey && grouping[sidKey] ? grouping[sidKey] : null;

  // 1. Check storeGrouping overrides
  if (groupData && !Array.isArray(groupData)) {
    const isExplicitOutstation = groupData.transportType === "outstation" || Number(groupData.transportKm || 0) > 0;
    const isExplicitLocal = groupData.transportType === "local";
    const transAmt = Number(groupData.transportAmount || 0);

    if (isExplicitOutstation) {
      const km = Number(groupData.transportKm || 0);
      const rate = Number(groupData.transportRate || 0);
      const desc = groupData.transportDescription ? String(groupData.transportDescription) : "";
      const kmPart = km > 0 ? `${km} KM` : "";
      const ratePart = rate > 0 ? `@ ₹${rate}/KM` : "";
      const details = [kmPart, ratePart, desc].filter(Boolean).join(" ");
      return {
        mode: "outstation",
        details: details || "Outstation Transportation",
        amount: transAmt || (km * rate),
      };
    }

    if (isExplicitLocal && transAmt > 0) {
      return {
        mode: "local",
        details: groupData.transportDescription || "Local Transportation",
        amount: transAmt,
      };
    }
  }

  // 2. Check estimateItems for transport lines for this store
  const cleanCode = String(storeCode || "").trim().toLowerCase();
  const storeItems = (estimateItems || []).filter((it: any) => {
    const itSid = it.storeId != null ? Number(it.storeId) : it.store_id != null ? Number(it.store_id) : null;
    const itScode = String(it.storeCode || it.store_code || "").trim().toLowerCase();
    if (storeId && itSid && itSid === storeId) return true;
    if (cleanCode && itScode && itScode === cleanCode) return true;
    // If single store estimate with no store IDs on items, consider all items
    if (!storeId && !cleanCode) return true;
    return false;
  });

  const transportLines = storeItems.filter((it: any) => String(it.lineType || it.line_type || "").toLowerCase() === "transport");

  for (const line of transportLines) {
    const unit = String(line.unit || "").toLowerCase();
    const calcType = String(line.calculationType || line.calculation_type || "").toLowerCase();
    const name = String(line.itemName || line.item_name || "").toLowerCase();
    const desc = String(line.description || "").toLowerCase();
    const rate = Number(line.rate || 0);
    const qty = Number(line.quantity || 0);
    const amt = Number(line.totalPrice || line.total_price || line.amount || 0);

    const isKm = unit === "km" || calcType === "per_km" || name.includes("outstation") || desc.includes("outstation");

    if (isKm) {
      const details = line.description || `${qty > 0 ? `${qty} KM ` : ""}${rate > 0 ? `@ ₹${rate}/KM` : ""}`.trim() || "Outstation Transportation";
      return {
        mode: "outstation",
        details,
        amount: amt || (qty * rate),
      };
    }

    return {
      mode: "local",
      details: line.description || line.itemName || line.item_name || "Local Transportation",
      amount: amt,
    };
  }

  // 3. Fallback to estimate-level transport settings if no store-specific items/grouping
  if (!storeId && !storeCode) {
    const isEstOutstation = estimate?.transportType === "outstation" || Number(estimate?.transportKm || 0) > 0;
    if (isEstOutstation) {
      return {
        mode: "outstation",
        details: estimate.transportDescription || "Outstation Transportation",
        amount: Number(estimate.transportAmount || 0),
      };
    }
    if (Number(estimate?.transportAmount || 0) > 0) {
      return {
        mode: "local",
        details: estimate.transportDescription || "Local Transportation",
        amount: Number(estimate.transportAmount || 0),
      };
    }
  }

  return { mode: "none", details: "", amount: 0 };
}

/**
 * Complete evaluation of transport invoice compliance for all scoped stores of an estimate/invoice.
 */
export function evaluateTransportCompliance(
  estimate: any,
  estimateItems: any[] = [],
  executionDocuments: any[] = [],
  scopedStores: ScopedStore[] = [],
  clientOrParty?: any
): TransportComplianceSummary {
  const isAblbl = isAblblProject(estimate, clientOrParty);

  if (!isAblbl || !estimate) {
    return {
      isAblbl,
      hasOutstation: false,
      requirements: [],
      pendingCount: 0,
      uploadedCount: 0,
    };
  }

  const activeDocs = (executionDocuments || []).filter(
    (d: any) => d.status !== "deleted" && d.status !== "replaced"
  );

  const transportInvoices = activeDocs.filter(isVerifiedTransportInvoice);

  // If scopedStores is empty (e.g. single store or project-level), create a virtual store context
  const storesToEvaluate: ScopedStore[] = scopedStores.length > 0
    ? scopedStores
    : [{
        storeId: estimate.storeId != null ? Number(estimate.storeId) : estimate.store_id != null ? Number(estimate.store_id) : null,
        storeCode: String(estimate.storeCode || estimate.store_code || "").trim(),
        storeName: estimate.storeName || estimate.store_name || estimate.title || "Project",
      }];

  const requirements: StoreTransportRequirement[] = [];

  for (const st of storesToEvaluate) {
    const { mode, details, amount } = getStoreTransportMode(st.storeId, st.storeCode, estimate, estimateItems);

    if (mode !== "outstation") {
      requirements.push({
        storeId: st.storeId,
        storeCode: st.storeCode,
        storeName: st.storeName,
        transportMode: mode,
        transportDetails: details,
        transportAmount: amount,
        status: "Not Applicable",
      });
      continue;
    }

    // Match transport invoice for this store
    const cleanSc = st.storeCode ? st.storeCode.toLowerCase() : "";
    const matchingDoc = transportInvoices.find((d: any) => {
      const docSc = String(d.storeCode || d.store_code || d.metadata?.storeCode || "").trim().toLowerCase();
      const docSid = d.storeId || d.store_id || d.metadata?.storeId ? Number(d.storeId || d.store_id || d.metadata?.storeId) : null;

      if (cleanSc && docSc && cleanSc === docSc) return true;
      if (st.storeId && docSid && st.storeId === docSid) return true;

      // If project has only 1 store and doc is not tagged with a different store
      if (storesToEvaluate.length === 1 && !docSc && !docSid) return true;

      return false;
    });

    requirements.push({
      storeId: st.storeId,
      storeCode: st.storeCode,
      storeName: st.storeName,
      transportMode: "outstation",
      transportDetails: details,
      transportAmount: amount,
      status: matchingDoc ? "Uploaded" : "Pending",
      invoiceDoc: matchingDoc || undefined,
    });
  }

  const outstationReqs = requirements.filter(r => r.transportMode === "outstation");
  const pendingCount = outstationReqs.filter(r => r.status === "Pending").length;
  const uploadedCount = outstationReqs.filter(r => r.status === "Uploaded").length;

  return {
    isAblbl: true,
    hasOutstation: outstationReqs.length > 0,
    requirements,
    pendingCount,
    uploadedCount,
  };
}
