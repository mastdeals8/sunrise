import type { EstimateItemInput } from "../types";

export const buildStoreGrouping = (
  items: EstimateItemInput[],
  storeOverrides: Record<string, any>,
  defaultPacking: string,
  defaultImplementation: string,
) => {
  const storeGrouping: Record<string, {
    itemSls: number[];
    packingPercent?: number;
    implementationPercent?: number;
    transportType?: "local" | "outstation";
    transportAmount?: number;
    transportKm?: number;
    transportRate?: number;
    transportDescription?: string | null;
    storeName?: string | null;
    storeLocation?: string | null;
    storeCity?: string | null;
    storeState?: string | null;
    storeAddress?: string | null;
  }> = {};

  items.forEach(item => {
    const sid = String(item.storeId || "");
    if (!sid) return;
    if (!storeGrouping[sid]) {
      const ov = storeOverrides[sid] || {};
      storeGrouping[sid] = {
        itemSls: [],
        packingPercent: ov.packingPercent !== undefined ? Number(ov.packingPercent) : Number(defaultPacking) || 0,
        implementationPercent: ov.implementationPercent !== undefined ? Number(ov.implementationPercent) : Number(defaultImplementation) || 0,
        transportType: ov.transportType === "outstation" ? "outstation" : "local",
        transportAmount: ov.transportType === "outstation"
          ? (Number(ov.transportKm) || 0) * (Number(ov.transportRate) || 0)
          : (ov.transportAmount !== undefined ? Number(ov.transportAmount) : 0),
        transportKm: ov.transportKm !== undefined ? Number(ov.transportKm) : 0,
        transportRate: ov.transportRate !== undefined ? Number(ov.transportRate) : 0,
        transportDescription: ov.transportDescription || null,
        storeName: ov.storeName || null,
        storeLocation: ov.storeLocation || null,
        storeCity: ov.storeCity || null,
        storeState: ov.storeState || null,
        storeAddress: ov.storeAddress || null,
      };
    }
    storeGrouping[sid].itemSls.push(item.sl);
  });

  return storeGrouping;
};
