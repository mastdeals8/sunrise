/**
 * Canonical Invoice Readiness Evaluation
 *
 * Business Rule:
 * When an estimate has received its PO, automatically change its workflow status from
 * PO RECEIVED to INVOICE READY only when:
 * 1. Every store linked to the estimate has at least one valid installation photo uploaded.
 * 2. Every store linked to the estimate has a WCC generated.
 *
 * For multiple-store estimates, ALL stores must satisfy both conditions.
 * Missing photos or WCCs on any store keep the estimate in PO RECEIVED (Pending Completion).
 */

import { ScopedStore, getEstimateScopedStores } from "./storeScoping";

export interface StoreRequirementStatus {
  storeId: number | null;
  storeCode: string;
  storeName: string;
  hasPhoto: boolean;
  photoCount: number;
  hasWcc: boolean;
  wccCount: number;
  isComplete: boolean;
  missing: ("Installation Photo" | "WCC Generated")[];
}

export interface InvoiceReadinessResult {
  hasPo: boolean;
  isInvoiceReady: boolean;
  totalStores: number;
  completedStores: number;
  stores: StoreRequirementStatus[];
  incompleteStores: StoreRequirementStatus[];
  status: "invoice_ready" | "po_received" | "po_missing" | "other";
  statusText: string;
}

/** Check if an estimate has received a valid PO */
export function estimateHasPo(estimate: any): boolean {
  if (!estimate) return false;
  const poNum = String(estimate.poNumber || (estimate as any).po_number || "").trim();
  const hasValidPoNum = poNum !== "" && poNum !== "—" && poNum !== "-";
  const hasPoFile = Boolean(
    String(estimate.poFilePath || (estimate as any).po_file_path || "").trim()
  );
  const status = String(estimate.status || "").toLowerCase();
  return hasValidPoNum || hasPoFile || status === "po_received" || status === "invoice_ready";
}

/** Check if an execution document is a valid installation photo */
export function isInstallationPhotoDoc(doc: any): boolean {
  if (!doc) return false;
  const type = String(doc.documentType || doc.document_type || "").toLowerCase();
  if (type === "wcc_photo") return false;
  const isPhoto = type === "photo" || type === "installation_photo";
  if (!isPhoto) return false;

  const isDeleted =
    doc.status === "deleted" ||
    Boolean(doc.deletedAt || doc.deleted_at);
  if (isDeleted) return false;

  const src = String(doc.metadata?.source || "");
  if (src === "delivery_challans.metadata.photos" || src === "delivery_challans.photoPath") {
    return false;
  }
  return true;
}

/** Check if a delivery challan / WCC is active (not deleted) */
export function isActiveWccChallan(challan: any): boolean {
  if (!challan) return false;
  if (challan.status === "deleted") return false;
  if (challan.metadata?.deleted) return false;
  return true;
}

function matchChallanToStore(
  challan: any,
  store: { storeId: number | null; storeCode: string },
  totalStoresCount: number
): boolean {
  const challanStoreId = Number(challan.storeId || challan.metadata?.storeId || 0) || null;
  if (store.storeId != null && challanStoreId != null && store.storeId === challanStoreId) {
    return true;
  }

  const challanCode = String(challan.storeCode || challan.metadata?.storeCode || "").trim().toLowerCase();
  if (store.storeCode && challanCode && store.storeCode.toLowerCase() === challanCode) {
    return true;
  }

  if (totalStoresCount === 1) {
    return true;
  }
  return false;
}

function matchPhotoToStore(
  doc: any,
  store: { storeId: number | null; storeCode: string },
  totalStoresCount: number,
  storeChallanIds: Set<number>
): boolean {
  if (doc.deliveryChallanId && storeChallanIds.has(Number(doc.deliveryChallanId))) {
    return true;
  }

  const docStoreId = Number(doc.metadata?.storeId || doc.storeId || 0) || null;
  if (store.storeId != null && docStoreId != null && store.storeId === docStoreId) {
    return true;
  }

  const docCode = String(doc.storeCode || doc.metadata?.storeCode || "").trim().toLowerCase();
  if (store.storeCode && docCode && store.storeCode.toLowerCase() === docCode) {
    return true;
  }

  if (totalStoresCount === 1) {
    return true;
  }
  return false;
}

/**
 * Evaluate invoice readiness from canonical raw records:
 * estimate, scopedStores, challans, and execution documents.
 */
export function evaluateInvoiceReadiness(
  estimate: any,
  scopedStores: ScopedStore[] = [],
  challans: any[] = [],
  photoDocs: any[] = []
): InvoiceReadinessResult {
  const hasPo = estimateHasPo(estimate);
  if (!estimate) {
    return {
      hasPo: false,
      isInvoiceReady: false,
      totalStores: 0,
      completedStores: 0,
      stores: [],
      incompleteStores: [],
      status: "other",
      statusText: "Invalid estimate",
    };
  }

  // Derive effective stores
  let effectiveStores = scopedStores;
  if (!effectiveStores || effectiveStores.length === 0) {
    const fallbackId = estimate.storeId != null ? Number(estimate.storeId) : (estimate.store_id != null ? Number(estimate.store_id) : null);
    effectiveStores = [
      {
        storeId: fallbackId,
        storeCode: String(estimate.storeCode || estimate.store_code || "").trim(),
        storeName: String(estimate.storeName || estimate.store_name || estimate.title || "Store").trim(),
      },
    ];
  }

  const activeChallans = (challans || []).filter(isActiveWccChallan);
  const activePhotos = (photoDocs || []).filter(isInstallationPhotoDoc);
  const totalStoresCount = effectiveStores.length;

  const evaluatedStores: StoreRequirementStatus[] = effectiveStores.map((store) => {
    const matchingChallans = activeChallans.filter((c) =>
      matchChallanToStore(c, store, totalStoresCount)
    );
    const storeChallanIds = new Set<number>(matchingChallans.map((c) => Number(c.id)));
    const matchingPhotos = activePhotos.filter((p) =>
      matchPhotoToStore(p, store, totalStoresCount, storeChallanIds)
    );

    const hasPhoto = matchingPhotos.length > 0;
    const hasWcc = matchingChallans.length > 0;
    const missing: ("Installation Photo" | "WCC Generated")[] = [];
    if (!hasPhoto) missing.push("Installation Photo");
    if (!hasWcc) missing.push("WCC Generated");

    return {
      storeId: store.storeId,
      storeCode: store.storeCode,
      storeName: store.storeName || (store.storeCode ? `Store ${store.storeCode}` : "Store"),
      hasPhoto,
      photoCount: matchingPhotos.length,
      hasWcc,
      wccCount: matchingChallans.length,
      isComplete: hasPhoto && hasWcc,
      missing,
    };
  });

  const totalStores = evaluatedStores.length;
  const completedStores = evaluatedStores.filter((s) => s.isComplete).length;
  const incompleteStores = evaluatedStores.filter((s) => !s.isComplete);
  const isInvoiceReady = hasPo && totalStores > 0 && incompleteStores.length === 0;

  let status: InvoiceReadinessResult["status"] = "other";
  let statusText = "";

  if (!hasPo) {
    status = "po_missing";
    statusText = "PO Missing";
  } else if (isInvoiceReady) {
    status = "invoice_ready";
    statusText = "INVOICE READY";
  } else {
    status = "po_received";
    statusText = `PO RECEIVED · PENDING COMPLETION (${completedStores}/${totalStores} stores ready)`;
  }

  return {
    hasPo,
    isInvoiceReady,
    totalStores,
    completedStores,
    stores: evaluatedStores,
    incompleteStores,
    status,
    statusText,
  };
}

/**
 * Evaluate invoice readiness from Project Workspace store rows (ExecStoreRow[]).
 * Uses the already-aggregated per-store stats for maximum efficiency.
 */
export function evaluateInvoiceReadinessFromStoreRows(
  estimate: any,
  storeRows: any[] = []
): InvoiceReadinessResult {
  const hasPo = estimateHasPo(estimate);
  if (!estimate) {
    return {
      hasPo: false,
      isInvoiceReady: false,
      totalStores: 0,
      completedStores: 0,
      stores: [],
      incompleteStores: [],
      status: "other",
      statusText: "Invalid estimate",
    };
  }

  const evaluatedStores: StoreRequirementStatus[] = (storeRows || []).map((row) => {
    const photoCount = Number(row.stats?.photoCount ?? (Array.isArray(row.photoDocuments) ? row.photoDocuments.filter(isInstallationPhotoDoc).length : 0));
    const wccCount = Number(
      (row.stats?.wccCount ?? 0) + (row.stats?.dcCount ?? 0) ||
      (Array.isArray(row.wccRecords) ? row.wccRecords.filter(isActiveWccChallan).length : 0) +
      (Array.isArray(row.dcRecords) ? row.dcRecords.filter(isActiveWccChallan).length : 0)
    );

    const hasPhoto = photoCount > 0;
    const hasWcc = wccCount > 0;
    const missing: ("Installation Photo" | "WCC Generated")[] = [];
    if (!hasPhoto) missing.push("Installation Photo");
    if (!hasWcc) missing.push("WCC Generated");

    return {
      storeId: row.storeId != null ? Number(row.storeId) : null,
      storeCode: String(row.storeCode || "").trim(),
      storeName: String(row.storeName || (row.storeCode ? `Store ${row.storeCode}` : "Store")).trim(),
      hasPhoto,
      photoCount,
      hasWcc,
      wccCount,
      isComplete: hasPhoto && hasWcc,
      missing,
    };
  });

  const totalStores = evaluatedStores.length;
  const completedStores = evaluatedStores.filter((s) => s.isComplete).length;
  const incompleteStores = evaluatedStores.filter((s) => !s.isComplete);
  const isInvoiceReady = hasPo && totalStores > 0 && incompleteStores.length === 0;

  let status: InvoiceReadinessResult["status"] = "other";
  let statusText = "";

  if (!hasPo) {
    status = "po_missing";
    statusText = "PO Missing";
  } else if (isInvoiceReady) {
    status = "invoice_ready";
    statusText = "INVOICE READY";
  } else {
    status = "po_received";
    statusText = `PO RECEIVED · PENDING COMPLETION (${completedStores}/${totalStores} stores ready)`;
  }

  return {
    hasPo,
    isInvoiceReady,
    totalStores,
    completedStores,
    stores: evaluatedStores,
    incompleteStores,
    status,
    statusText,
  };
}
