/**
 * Canonical Estimate & Invoice Store Scoping
 *
 * Rules:
 * 1. Scope all stores strictly to the current estimate:
 *    - estimate.store_grouping / estimate.storeGrouping (ABFRL multi-store)
 *    - estimate_items.store_id / estimate_items.store_code
 *    - estimate.store_id (single-store estimate)
 * 2. An invoice is Store-Wise if invoice.storeId or invoice.storeCode is set.
 *    - Store-wise Invoice: packet scope = ONLY the 1 matching store.
 *    - Complete Invoice: packet scope = ALL stores belonging to the estimate.
 * 3. Never pull phantom stores from execution_stores or global stores tables.
 */

export interface ScopedStore {
  storeId: number | null;
  storeCode: string;
  storeName: string;
}

/**
 * Ordered store keys derived from storeGrouping alone.
 * Uses itemSls to sort by earliest SL, falling back to insertion order.
 */
export function orderedStoreKeysFromGrouping(
  storeGrouping: Record<string, any> | null | undefined
): string[] {
  const grouping = storeGrouping || {};
  const entries = Object.entries(grouping);
  if (entries.length === 0) return [];

  const firstSlPerStore: { sid: string; sl: number; insertOrder: number }[] = [];
  entries.forEach(([sid, groupData], index) => {
    const itemSls: number[] = Array.isArray(groupData)
      ? groupData
      : groupData?.itemSls || [];
    const sls = itemSls.map(Number).filter(n => Number.isFinite(n) && n > 0);
    const minSl = sls.length ? Math.min(...sls) : Infinity;
    firstSlPerStore.push({ sid, sl: minSl, insertOrder: index });
  });

  firstSlPerStore.sort((a, b) => {
    if (a.sl !== b.sl) return a.sl - b.sl;
    return a.insertOrder - b.insertOrder;
  });

  return firstSlPerStore.map(entry => entry.sid);
}

/**
 * Resolve all canonical stores belonging to an estimate.
 */
export function getEstimateScopedStores(
  estimate: any,
  estimateItems: any[] = [],
  allStores: any[] = [],
  challans: any[] = []
): ScopedStore[] {
  if (!estimate) return [];

  const stores: ScopedStore[] = [];
  const seenCodes = new Set<string>();
  const seenIds = new Set<number>();

  const resolveStoreMaster = (sid: number | null, scode: string | null) => {
    let master = sid ? allStores.find((s: any) => Number(s.id) === sid) : null;
    if (!master && scode) {
      master = allStores.find((s: any) => {
        const c = String(s.storeCode || (s as any).code || "").trim().toLowerCase();
        return c === scode.toLowerCase();
      });
    }
    return master;
  };

  const addStore = (sid: number | null, scode: string | null, sname?: string | null) => {
    const cleanCode = String(scode || "").trim();
    const cleanId = sid && Number.isFinite(Number(sid)) && Number(sid) > 0 ? Number(sid) : null;

    if (cleanId && seenIds.has(cleanId)) return;
    if (cleanCode && seenCodes.has(cleanCode.toLowerCase())) return;

    const master = resolveStoreMaster(cleanId, cleanCode);
    const finalId = cleanId || (master?.id ? Number(master.id) : null);
    const finalCode = cleanCode || String(master?.storeCode || (master as any)?.code || "").trim();
    const finalName =
      sname ||
      master?.name ||
      (master as any)?.storeName ||
      (finalCode ? `Store ${finalCode}` : `Store ${finalId}`);

    if (finalId) seenIds.add(finalId);
    if (finalCode) seenCodes.add(finalCode.toLowerCase());

    stores.push({
      storeId: finalId,
      storeCode: finalCode,
      storeName: finalName,
    });
  };

  // 1. estimate.store_grouping / estimate.storeGrouping (primary multi-store grouping)
  const grouping = (estimate.storeGrouping || estimate.store_grouping || null) as Record<string, any> | null;
  if (grouping && typeof grouping === "object" && Object.keys(grouping).length > 0) {
    const orderedSids = orderedStoreKeysFromGrouping(grouping);
    for (const sidStr of orderedSids) {
      const sid = Number(sidStr);
      const g = grouping[sidStr] || {};
      addStore(sid, g.storeCode || null, g.storeName || null);
    }
  }

  // 2. estimate_items (items with explicit store_id / store_code)
  if (Array.isArray(estimateItems) && estimateItems.length > 0) {
    for (const item of estimateItems) {
      const itSid = item.storeId != null ? Number(item.storeId) : item.store_id != null ? Number(item.store_id) : null;
      const itScode = String(item.storeCode || item.store_code || "").trim();
      if (itSid || itScode) {
        addStore(itSid, itScode, item.storeName || item.store_name || null);
      }
    }
  }

  // 3. estimate.store_id / storeId (single store estimate)
  const estStoreId = estimate.storeId != null ? Number(estimate.storeId) : estimate.store_id != null ? Number(estimate.store_id) : null;
  if (estStoreId) {
    addStore(estStoreId, estimate.storeCode || estimate.store_code || null, estimate.storeName || estimate.store_name || null);
  }

  // 4. Fallback for legacy estimates only (if no grouping, items, or estimate.store_id gave any stores):
  if (stores.length === 0 && Array.isArray(challans) && challans.length > 0) {
    for (const dc of challans) {
      const dcStoreCode = String(dc.storeCode || dc.metadata?.storeCode || "").trim();
      const dcStoreId = dc.storeId || dc.metadata?.storeId ? Number(dc.storeId || dc.metadata?.storeId) : null;
      if (dcStoreCode || dcStoreId) {
        addStore(dcStoreId, dcStoreCode, dc.storeName || dc.metadata?.storeName || null);
      }
    }
  }

  return stores;
}

/**
 * Check whether an invoice is scoped to an individual store (Store-wise invoice).
 */
export function isStoreWiseInvoice(invoice: any): boolean {
  if (!invoice) return false;
  const invStoreId = Number(invoice.storeId ?? invoice.store_id ?? invoice.packetSettings?.storeId ?? invoice.packet_settings?.storeId) || null;
  const invStoreCode = String(invoice.storeCode ?? invoice.store_code ?? invoice.packetSettings?.storeCode ?? invoice.packet_settings?.storeCode ?? "").trim();
  return Boolean(invStoreId || invStoreCode);
}

/**
 * Filter estimate stores down to the active invoice scope:
 * - If Store-wise: ONLY the store associated with the invoice.
 * - If Complete: ALL stores belonging to the estimate.
 */
export function getInvoiceScopedStores(
  estimateScopedStores: ScopedStore[],
  invoice: any,
  allStores: any[] = []
): ScopedStore[] {
  if (!invoice || !isStoreWiseInvoice(invoice)) {
    return estimateScopedStores;
  }

  const invStoreId = Number(invoice.storeId ?? invoice.store_id ?? invoice.packetSettings?.storeId ?? invoice.packet_settings?.storeId) || null;
  const invStoreCode = String(invoice.storeCode ?? invoice.store_code ?? invoice.packetSettings?.storeCode ?? invoice.packet_settings?.storeCode ?? "").trim().toLowerCase();

  const matched = estimateScopedStores.filter(s => {
    if (invStoreId && s.storeId && s.storeId === invStoreId) return true;
    if (invStoreCode && s.storeCode && s.storeCode.toLowerCase() === invStoreCode) return true;
    return false;
  });

  if (matched.length > 0) {
    return matched;
  }

  // Fallback if not found in estimateScopedStores
  let master = invStoreId ? allStores.find((s: any) => Number(s.id) === invStoreId) : null;
  if (!master && invStoreCode) {
    master = allStores.find((s: any) => String(s.storeCode || (s as any).code || "").trim().toLowerCase() === invStoreCode);
  }
  const finalCode = invStoreCode || String(master?.storeCode || (master as any)?.code || "").trim();
  const finalName = master?.name || (master as any)?.storeName || (finalCode ? `Store ${finalCode}` : `Store ${invStoreId}`);

  return [{
    storeId: invStoreId || (master?.id ? Number(master.id) : null),
    storeCode: finalCode,
    storeName: finalName,
  }];
}
