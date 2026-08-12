type EstimateLikeItem = {
  sl?: number | null;
  id?: number | null;
  storeId?: string | number | null;
  storeSortOrder?: number | null;
  rowSortOrder?: number | null;
};

const num = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const compareEstimateItems = <T extends EstimateLikeItem>(a: T, b: T) => {
  const aStoreOrder = num(a.storeSortOrder, num(a.sl, num(a.id, 0)));
  const bStoreOrder = num(b.storeSortOrder, num(b.sl, num(b.id, 0)));
  if (aStoreOrder !== bStoreOrder) return aStoreOrder - bStoreOrder;

  const aRowOrder = num(a.rowSortOrder, num(a.sl, num(a.id, 0)));
  const bRowOrder = num(b.rowSortOrder, num(b.sl, num(b.id, 0)));
  if (aRowOrder !== bRowOrder) return aRowOrder - bRowOrder;

  const aSl = num(a.sl, num(a.id, 0));
  const bSl = num(b.sl, num(b.id, 0));
  if (aSl !== bSl) return aSl - bSl;

  return num(a.id, 0) - num(b.id, 0);
};

export const orderedEstimateItems = <T extends EstimateLikeItem>(items: T[]) =>
  [...items].sort(compareEstimateItems);

/**
 * Ordered store keys derived from storeGrouping alone (no estimate items).
 * Uses the `itemSls` array in each group to determine the first (lowest)
 * item SL per store, then sorts stores by that value. Stores without any
 * matching SL fall back to their insertion order in the grouping object.
 *
 * This is the right helper when only `estimate.storeGrouping` is available
 * (e.g. ProjectTrackerPanel, InvoicePacket). When estimate items are also
 * available, prefer `orderedStoreKeysFromItems` which respects rowSortOrder.
 */
export const orderedStoreKeysFromGrouping = (
  storeGrouping: Record<string, any> | null | undefined,
): string[] => {
  const grouping = storeGrouping || {};
  const entries = Object.entries(grouping);
  if (entries.length === 0) return [];

  const firstSlPerStore: { sid: string; sl: number; insertOrder: number }[] = [];
  entries.forEach(([sid, groupData], index) => {
    const itemSls: number[] = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
    const sls = itemSls.map(Number).filter(n => Number.isFinite(n) && n > 0);
    const minSl = sls.length ? Math.min(...sls) : Infinity;
    firstSlPerStore.push({ sid, sl: minSl, insertOrder: index });
  });

  firstSlPerStore.sort((a, b) => {
    if (a.sl !== b.sl) return a.sl - b.sl;
    return a.insertOrder - b.insertOrder;
  });

  return firstSlPerStore.map(entry => entry.sid);
};

export const orderedStoreKeysFromItems = <T extends EstimateLikeItem>(
  items: T[],
  storeGrouping: Record<string, any> | null | undefined,
) => {
  const grouping = storeGrouping || {};
  const knownKeys = new Set(Object.keys(grouping));
  const orderedKeys: string[] = [];
  const slToStore = new Map<number, string>();

  Object.entries(grouping).forEach(([sid, groupData]) => {
    const itemSls = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
    itemSls.forEach((sl: any) => {
      const parsed = Number(sl);
      if (Number.isFinite(parsed)) slToStore.set(parsed, sid);
    });
  });

  orderedEstimateItems(items).forEach(item => {
    const sid = String(item.storeId || slToStore.get(Number(item.sl)) || "");
    if (!sid || !knownKeys.has(sid) || orderedKeys.includes(sid)) return;
    orderedKeys.push(sid);
  });

  Object.keys(grouping).forEach(sid => {
    if (!orderedKeys.includes(sid)) orderedKeys.push(sid);
  });

  return orderedKeys;
};
