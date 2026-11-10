import { isAblblFormat } from "../../../../../shared/textFormat";

export interface MissingChargeCategory {
  key: "packing" | "installation" | "local_transport" | "outstation_transport";
  label: string;
}

export interface StoreMissingCharges {
  storeId: string;
  storeName: string;
  storeCode: string;
  sapCode?: string;
  missingCharges: string[];
  missingCategories: MissingChargeCategory[];
  hasPacking: boolean;
  hasInstallation: boolean;
  hasLocalTransport: boolean;
  hasOutstationTransport: boolean;
  transportMode: "local" | "outstation";
}

export interface AbfrlChargeValidationResult {
  isAbfrl: boolean;
  valid: boolean;
  missingStores: StoreMissingCharges[];
  totalStoresChecked: number;
}

export interface ValidateAbfrlChargesParams {
  items: any[];
  stores: any[];
  storeOverrides?: Record<string, any>;
  defaultStoreId?: string | number | null;
  format?: string | null;
}

const isNonZero = (val: any) => {
  if (val == null || val === "") return false;
  const num = Number(val);
  return !isNaN(num) && num > 0;
};

const isOutstationItem = (item: any) => {
  const normUnit = String(item.unit || "").toLowerCase().trim();
  const calcType = String(item.calculationType || "").toLowerCase().trim();
  const name = String(item.itemName || "").toLowerCase();
  const desc = String(item.description || "").toLowerCase();
  const transType = String(item.transportType || "").toLowerCase();
  return (
    normUnit === "km" ||
    calcType === "per_km" ||
    name.includes("outstation") ||
    desc.includes("outstation") ||
    transType === "outstation"
  );
};

export const validateAbfrlEstimateCharges = (
  params: ValidateAbfrlChargesParams
): AbfrlChargeValidationResult => {
  const { items, stores = [], storeOverrides = {}, defaultStoreId, format } = params;

  if (!isAblblFormat(format)) {
    return {
      isAbfrl: false,
      valid: true,
      missingStores: [],
      totalStoresChecked: 0,
    };
  }

  // Find all distinct store IDs from items
  const distinctItemStoreIds = Array.from(
    new Set(items.map((it: any) => String(it.storeId || "")).filter(Boolean))
  );

  const storeIds: string[] =
    distinctItemStoreIds.length > 0
      ? distinctItemStoreIds
      : defaultStoreId
        ? [String(defaultStoreId)]
        : items.length > 0
          ? [""]
          : [];

  const missingStores: StoreMissingCharges[] = [];

  storeIds.forEach((sid) => {
    const store = stores.find((s: any) => String(s.id) === sid) ||
      (defaultStoreId ? stores.find((s: any) => String(s.id) === String(defaultStoreId)) : null);

    const override = storeOverrides[sid] || {};
    const storeRows = sid
      ? items.filter((it: any) => String(it.storeId || "") === sid)
      : items;

    // If this store block has no rows, skip it
    if (storeRows.length === 0) return;

    const storeName =
      store?.name ||
      override.storeName ||
      (sid ? `Store ${sid}` : "Store");
    const storeCode =
      store?.storeCode ||
      override.storeCode ||
      storeRows.find((it: any) => it.storeCode)?.storeCode ||
      "";
    const sapCode =
      store?.sapCode ||
      override.sapCode ||
      storeRows.find((it: any) => it.sapCode)?.sapCode ||
      "";

    const packingRows = storeRows.filter(
      (r: any) => String(r.lineType || "").toLowerCase() === "packing"
    );
    const installRows = storeRows.filter(
      (r: any) => String(r.lineType || "").toLowerCase() === "installation"
    );
    const transportRows = storeRows.filter(
      (r: any) => String(r.lineType || "").toLowerCase() === "transport"
    );

    const hasPacking = packingRows.some(
      (r: any) => isNonZero(r.totalPrice) || isNonZero(r.amount) || isNonZero(r.rate)
    );
    const hasInstallation = installRows.some(
      (r: any) => isNonZero(r.totalPrice) || isNonZero(r.amount) || isNonZero(r.rate)
    );

    const hasLocalTransport = transportRows.some(
      (r: any) => !isOutstationItem(r) && (isNonZero(r.totalPrice) || isNonZero(r.amount) || isNonZero(r.rate))
    );
    const hasOutstationTransport = transportRows.some(
      (r: any) => isOutstationItem(r) && (isNonZero(r.totalPrice) || isNonZero(r.amount) || isNonZero(r.rate))
    );

    // Transportation Rule: Local OR Outstation, or both satisfies transport requirement
    const hasAnyTransport = hasLocalTransport || hasOutstationTransport;

    const expectedMode: "local" | "outstation" =
      override.transportType === "outstation" ? "outstation" : "local";

    const missingCharges: string[] = [];
    const missingCategories: MissingChargeCategory[] = [];

    if (!hasPacking) {
      missingCharges.push("Packing Charges");
      missingCategories.push({ key: "packing", label: "Packing Charges" });
    }

    if (!hasInstallation) {
      missingCharges.push("Installation Charges");
      missingCategories.push({ key: "installation", label: "Installation Charges" });
    }

    if (!hasAnyTransport) {
      const transportLabel =
        expectedMode === "outstation" ? "Outstation Transportation" : "Local Transportation";
      missingCharges.push(transportLabel);
      missingCategories.push({
        key: expectedMode === "outstation" ? "outstation_transport" : "local_transport",
        label: transportLabel,
      });
    }

    if (missingCharges.length > 0) {
      missingStores.push({
        storeId: sid,
        storeName,
        storeCode,
        sapCode,
        missingCharges,
        missingCategories,
        hasPacking,
        hasInstallation,
        hasLocalTransport,
        hasOutstationTransport,
        transportMode: expectedMode,
      });
    }
  });

  return {
    isAbfrl: true,
    valid: missingStores.length === 0,
    missingStores,
    totalStoresChecked: storeIds.length,
  };
};
