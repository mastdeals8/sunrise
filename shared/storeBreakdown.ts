export interface StoreBreakdownItem {
  storeId: number;
  storeName: string;
  storeCode: string;
  itemCount: number;
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxAmount: number;
  totalAmount: number;
  items: any[];
  existingInvoice?: any;
}

export function computeStoreBreakdown(
  estimate: any,
  items: any[] = [],
  stores: any[] = [],
  existingInvoices: any[] = []
): StoreBreakdownItem[] {
  if (!estimate) return [];

  const grouping = estimate.storeGrouping || estimate.store_grouping || null;
  const groupSids = grouping && typeof grouping === "object" ? Object.keys(grouping) : [];
  const result: StoreBreakdownItem[] = [];

  const getStoreMaster = (sid: number | string) => {
    return stores.find(s => String(s.id) === String(sid));
  };

  const findExistingInvoice = (sid: number, scode: string) => {
    return existingInvoices.find(inv => {
      const invEstId = Number(inv.estimateId ?? inv.estimate_id);
      const curEstId = Number(estimate.id);
      if (invEstId !== curEstId) return false;

      const invStoreId = Number(inv.storeId ?? inv.store_id);
      if (invStoreId && invStoreId === sid) return true;

      const invStoreCode = String(inv.storeCode ?? inv.store_code ?? "").trim();
      if (scode && invStoreCode && invStoreCode.toLowerCase() === scode.toLowerCase()) return true;

      return false;
    });
  };

  const createItemBreakdown = (
    sid: number,
    sName: string,
    sCode: string,
    storeItems: any[]
  ): StoreBreakdownItem => {
    const subtotal = storeItems.reduce((acc, it) => acc + (Number(it.totalPrice ?? it.total_price) || 0), 0);
    const cgst = storeItems.reduce((acc, it) => acc + (Number(it.cgstAmount ?? it.cgst_amount) || 0), 0);
    const sgst = storeItems.reduce((acc, it) => acc + (Number(it.sgstAmount ?? it.sgst_amount) || 0), 0);
    const igst = storeItems.reduce((acc, it) => acc + (Number(it.igstAmount ?? it.igst_amount) || 0), 0);
    const taxAmount = +(cgst + sgst + igst).toFixed(2);
    const totalAmount = +(subtotal + taxAmount).toFixed(2);

    return {
      storeId: sid,
      storeName: sName || `Store ${sid}`,
      storeCode: sCode || "",
      itemCount: storeItems.length,
      subtotal: +subtotal.toFixed(2),
      cgstAmount: +cgst.toFixed(2),
      sgstAmount: +sgst.toFixed(2),
      igstAmount: +igst.toFixed(2),
      taxAmount,
      totalAmount,
      items: storeItems,
      existingInvoice: findExistingInvoice(sid, sCode),
    };
  };

  if (groupSids.length > 0) {
    // Mode 1: ABFRL multi-store grouping
    for (const sidStr of groupSids) {
      const sid = Number(sidStr);
      const g = grouping[sidStr] || {};
      const sls = new Set(Array.isArray(g.itemSls) ? g.itemSls.map(Number) : []);
      const storeItems = items.filter(it => {
        const itSl = it.sl != null ? Number(it.sl) : null;
        const itSid = it.storeId != null ? Number(it.storeId) : it.store_id != null ? Number(it.store_id) : null;
        return (itSl != null && sls.has(itSl)) || (itSid != null && itSid === sid);
      });
      const sMaster = getStoreMaster(sid);
      const sName = g.storeName || sMaster?.name || sMaster?.store_name || `Store ${sid}`;
      const sCode = sMaster?.storeCode || sMaster?.store_code || g.storeCode || "";

      result.push(createItemBreakdown(sid, sName, sCode, storeItems));
    }
  } else {
    // Mode 2: Items have explicit store_id
    const itemStoreIds = Array.from(
      new Set(
        items
          .map(it => (it.storeId != null ? Number(it.storeId) : it.store_id != null ? Number(it.store_id) : null))
          .filter((id): id is number => id != null && !isNaN(id) && id > 0)
      )
    );

    if (itemStoreIds.length > 0) {
      for (const sid of itemStoreIds) {
        const storeItems = items.filter(it => {
          const itSid = it.storeId != null ? Number(it.storeId) : it.store_id != null ? Number(it.store_id) : null;
          return itSid === sid;
        });
        const sMaster = getStoreMaster(sid);
        const sName = sMaster?.name || sMaster?.store_name || storeItems[0]?.storeName || storeItems[0]?.store_name || `Store ${sid}`;
        const sCode = sMaster?.storeCode || sMaster?.store_code || storeItems[0]?.storeCode || storeItems[0]?.store_code || "";

        result.push(createItemBreakdown(sid, sName, sCode, storeItems));
      }
    } else if (estimate.storeId || estimate.store_id) {
      // Mode 3: Single store at estimate level (e.g. Wakefit RETAIL_SINGLE_STORE)
      const sid = Number(estimate.storeId || estimate.store_id);
      const sMaster = getStoreMaster(sid);
      const sName = sMaster?.name || sMaster?.store_name || estimate.storeName || estimate.store_name || `Store ${sid}`;
      const sCode = sMaster?.storeCode || sMaster?.store_code || estimate.storeCode || estimate.store_code || "";

      result.push(createItemBreakdown(sid, sName, sCode, items));
    }
  }

  return result;
}
