import { isServiceEstimateItem, serviceProductLabel } from "../../../../../shared/serviceProductDisplay";
import { orderedEstimateItems, orderedStoreKeysFromItems } from "./estimateOrdering";

export interface SummaryRow {
  srNo: number;
  vendorCode: string;
  activityName: string;
  storeCode: string;
  sapCode: string;
  qty: string | number;
  beforeGst: number;
  estimateNo: string;
  lineType?: string;
  storeId?: string;
}

export interface ReconciledTotals {
  materialTotal: number;
  packingTotal: number;
  installationTotal: number;
  localTransportTotal: number;
  outstationTransportTotal: number;
  otherChargesTotal: number;
  totalBeforeGst: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
}

export interface CanonicalTotals {
  grandBeforeTax: number;
  grandSgst: number;
  grandCgst: number;
  grandIgst: number;
  grandTotal: number;
}

export interface EstimateReconciliationResult {
  reconciled: boolean;
  errors: string[];
  summaryRows: SummaryRow[];
  totals: ReconciledTotals;
  canonicalTotals: CanonicalTotals;
  isIgst: boolean;
}

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

export const reconcileEstimateSummary = (
  estimate: any,
  items: any[],
  stores: any[] = [],
  products: any[] = [],
  sellerProfile?: any
): EstimateReconciliationResult => {
  const sortedItems = orderedEstimateItems(items || []);
  const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
  const hasStoreGrouping = Object.keys(storeGrouping).length > 0;
  const isIgst = Boolean(
    estimate.gstType === "IGST" ||
    (estimate.billingGstin &&
      sellerProfile?.gstin &&
      String(estimate.billingGstin).slice(0, 2) !== String(sellerProfile.gstin).slice(0, 2))
  );

  let storeKeys = orderedStoreKeysFromItems(sortedItems, storeGrouping);
  if (storeKeys.length === 0) {
    const distinctStoreIds = Array.from(
      new Set(sortedItems.map((it: any) => String(it.storeId || "")).filter(Boolean))
    );
    if (distinctStoreIds.length > 1) {
      storeKeys = distinctStoreIds;
    }
  }

  const hasAnySavedServices = sortedItems.some(isServiceEstimateItem);
  const subject = estimate.subject || estimate.title || "Estimate Work";
  const estimateNo = estimate.estimateNumber || "";
  const vendorCode = estimate.vendorCode || "";

  interface SectionCalc {
    storeName: string;
    storeCode: string;
    sapCode: string;
    materialItems: any[];
    serviceItems: any[];
    materialBase: number;
    materialSgst: number;
    materialCgst: number;
    materialIgst: number;
    packingBase: number;
    implBase: number;
    transportBase: number;
    packingPercent: number;
    implementationPercent: number;
    transportAmount: number;
    transportDescription: string;
    transportKm: number;
    transportRate: number;
    transportType?: "local" | "outstation";
  }

  const sections: SectionCalc[] = [];

  if (storeKeys.length > 0) {
    storeKeys.forEach((sidKey) => {
      const groupData = storeGrouping[sidKey] || [];
      const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
      const storeItems = sortedItems.filter((it: any) =>
        (itemSls.length > 0 && itemSls.includes(it.sl || 0)) ||
        String(it.storeId || "") === String(sidKey)
      );
      if (storeItems.length === 0) return;

      const materialItems = storeItems.filter((it: any) => !isServiceEstimateItem(it));
      const serviceItems = storeItems.filter(isServiceEstimateItem);
      const store = stores.find((s: any) => String(s.id) === String(sidKey));

      const packPct = !Array.isArray(groupData) && groupData.packingPercent !== undefined
        ? Number(groupData.packingPercent)
        : Number(estimate.packingPercent || 0);
      const implPct = !Array.isArray(groupData) && groupData.implementationPercent !== undefined
        ? Number(groupData.implementationPercent)
        : Number(estimate.implementationPercent || 0);
      const transAmt = !Array.isArray(groupData) && groupData.transportAmount !== undefined
        ? Number(groupData.transportAmount)
        : 0;

      const materialBase = materialItems.reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0);
      const materialSgst = materialItems.reduce((s: number, it: any) => s + Number(it.sgstAmount || 0), 0);
      const materialCgst = materialItems.reduce((s: number, it: any) => s + Number(it.cgstAmount || 0), 0);
      const materialIgst = materialItems.reduce((s: number, it: any) => s + Number(it.igstAmount || 0), 0);

      // If estimate uses saved service items, only saved services are counted.
      // Never synthesize or reconstruct charges from header/other stores.
      const packingBase = hasAnySavedServices
        ? serviceItems.filter((it: any) => it.lineType === "packing").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
        : materialBase * (packPct / 100);

      const implBase = hasAnySavedServices
        ? serviceItems.filter((it: any) => it.lineType === "installation").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
        : materialBase * (implPct / 100);

      const transportBase = hasAnySavedServices
        ? serviceItems.filter((it: any) => it.lineType === "transport").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
        : transAmt;

      sections.push({
        storeName: store?.name || (!Array.isArray(groupData) && groupData.storeName) || `Store ${sidKey}`,
        storeCode: store?.storeCode || storeItems.find((it: any) => it.storeCode)?.storeCode || sidKey,
        sapCode: store?.sapCode || storeItems.find((it: any) => it.sapCode)?.sapCode || "",
        materialItems,
        serviceItems,
        materialBase,
        materialSgst,
        materialCgst,
        materialIgst,
        packingBase,
        implBase,
        transportBase,
        packingPercent: packPct,
        implementationPercent: implPct,
        transportAmount: transAmt,
        transportDescription: !Array.isArray(groupData) && groupData.transportDescription ? String(groupData.transportDescription) : "",
        transportKm: !Array.isArray(groupData) && groupData.transportKm !== undefined ? Number(groupData.transportKm) : 0,
        transportRate: !Array.isArray(groupData) && groupData.transportRate !== undefined ? Number(groupData.transportRate) : 0,
        transportType: !Array.isArray(groupData) && groupData.transportType ? (groupData.transportType as "local" | "outstation") : undefined,
      });
    });
  } else {
    const targetStore = stores.find((s: any) => String(s.id) === String(estimate.storeId));
    const materialItems = sortedItems.filter((it: any) => !isServiceEstimateItem(it));
    const serviceItems = sortedItems.filter(isServiceEstimateItem);

    const packPct = Number(estimate.packingPercent || 0);
    const implPct = Number(estimate.implementationPercent || 0);
    const transAmt = Number(estimate.transportAmount || 0);

    const materialBase = materialItems.reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0);
    const materialSgst = materialItems.reduce((s: number, it: any) => s + Number(it.sgstAmount || 0), 0);
    const materialCgst = materialItems.reduce((s: number, it: any) => s + Number(it.cgstAmount || 0), 0);
    const materialIgst = materialItems.reduce((s: number, it: any) => s + Number(it.igstAmount || 0), 0);

    const packingBase = hasAnySavedServices
      ? serviceItems.filter((it: any) => it.lineType === "packing").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
      : materialBase * (packPct / 100);

    const implBase = hasAnySavedServices
      ? serviceItems.filter((it: any) => it.lineType === "installation").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
      : materialBase * (implPct / 100);

    const transportBase = hasAnySavedServices
      ? serviceItems.filter((it: any) => it.lineType === "transport").reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0)
      : transAmt;

    sections.push({
      storeName: targetStore?.name || estimate.title || "Site",
      storeCode: targetStore?.storeCode || sortedItems.find((it: any) => it.storeCode)?.storeCode || "",
      sapCode: targetStore?.sapCode || sortedItems.find((it: any) => it.sapCode)?.sapCode || "",
      materialItems,
      serviceItems,
      materialBase,
      materialSgst,
      materialCgst,
      materialIgst,
      packingBase,
      implBase,
      transportBase,
      packingPercent: packPct,
      implementationPercent: implPct,
      transportAmount: transAmt,
      transportDescription: "",
      transportKm: 0,
      transportRate: 0,
      transportType: undefined,
    });
  }

  // Build the summary rows strictly from actual saved items
  const summaryRows: SummaryRow[] = [];
  let materialTotal = 0;
  let packingTotal = 0;
  let installationTotal = 0;
  let localTransportTotal = 0;
  let outstationTransportTotal = 0;
  let otherChargesTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  sections.forEach((section) => {
    // 1. Material row (consolidated per store)
    if (section.materialBase > 0) {
      summaryRows.push({
        srNo: 0, // Assigned sequentially later
        vendorCode,
        activityName: subject,
        storeCode: section.storeCode,
        sapCode: section.sapCode,
        qty: 1,
        beforeGst: section.materialBase,
        estimateNo,
        lineType: "product",
      });
      materialTotal += section.materialBase;
      cgstTotal += section.materialCgst;
      sgstTotal += section.materialSgst;
      igstTotal += section.materialIgst;
    }

    if (hasAnySavedServices) {
      // 2. Saved service rows
      section.serviceItems.forEach((item: any) => {
        const isTransport = (item.lineType || "").toLowerCase() === "transport" || isOutstationItem(item);
        const label = serviceProductLabel(item, products);
        const isKm = isTransport && (String(item.unit || "").toLowerCase() === "km" || item.calculationType === "per_km");
        const base = Number(item.totalPrice || 0);

        summaryRows.push({
          srNo: 0,
          vendorCode,
          activityName: isTransport && item.description && item.description !== label
            ? `${label} — ${item.description}`
            : label,
          storeCode: section.storeCode,
          sapCode: section.sapCode,
          qty: isKm ? `${Number(item.quantity) || 0} KM` : (Number(item.quantity) || 1),
          beforeGst: base,
          estimateNo,
          lineType: item.lineType,
          storeId: String(item.storeId || ""),
        });

        if (item.lineType === "packing") {
          packingTotal += base;
        } else if (item.lineType === "installation") {
          installationTotal += base;
        } else if (item.lineType === "transport") {
          if (isOutstationItem(item)) {
            outstationTransportTotal += base;
          } else {
            localTransportTotal += base;
          }
        } else {
          otherChargesTotal += base;
        }

        cgstTotal += Number(item.cgstAmount || 0);
        sgstTotal += Number(item.sgstAmount || 0);
        igstTotal += Number(item.igstAmount || 0);
      });
    } else {
      // Legacy estimates without saved service line items: synthetic charges
      if (section.packingBase > 0) {
        summaryRows.push({
          srNo: 0,
          vendorCode,
          activityName: serviceProductLabel({ lineType: "packing", rate: section.packingPercent, calculationType: "percentage" }, products),
          storeCode: section.storeCode,
          sapCode: section.sapCode,
          qty: 1,
          beforeGst: section.packingBase,
          estimateNo,
          lineType: "packing",
        });
        packingTotal += section.packingBase;
        if (isIgst) igstTotal += section.packingBase * 0.18;
        else {
          cgstTotal += section.packingBase * 0.09;
          sgstTotal += section.packingBase * 0.09;
        }
      }

      if (section.implBase > 0) {
        summaryRows.push({
          srNo: 0,
          vendorCode,
          activityName: serviceProductLabel({ lineType: "installation", rate: section.implementationPercent, calculationType: "percentage" }, products),
          storeCode: section.storeCode,
          sapCode: section.sapCode,
          qty: 1,
          beforeGst: section.implBase,
          estimateNo,
          lineType: "installation",
        });
        installationTotal += section.implBase;
        if (isIgst) igstTotal += section.implBase * 0.18;
        else {
          cgstTotal += section.implBase * 0.09;
          sgstTotal += section.implBase * 0.09;
        }
      }

      if (section.transportBase > 0) {
        const isKm = (section.transportKm > 0) || section.transportType === "outstation";
        const label = serviceProductLabel({
          lineType: "transport",
          itemName: section.transportDescription,
          calculationType: isKm ? "per_km" : "fixed",
          unit: isKm ? "km" : "job",
          rate: section.transportRate,
        }, products);

        summaryRows.push({
          srNo: 0,
          vendorCode,
          activityName: section.transportDescription && section.transportDescription !== label
            ? `${label} — ${section.transportDescription}`
            : label,
          storeCode: section.storeCode,
          sapCode: section.sapCode,
          qty: section.transportKm > 0 ? `${section.transportKm} KM` : 1,
          beforeGst: section.transportBase,
          estimateNo,
          lineType: "transport",
        });

        if (isKm) {
          outstationTransportTotal += section.transportBase;
        } else {
          localTransportTotal += section.transportBase;
        }

        if (isIgst) igstTotal += section.transportBase * 0.18;
        else {
          cgstTotal += section.transportBase * 0.09;
          sgstTotal += section.transportBase * 0.09;
        }
      }
    }
  });

  // Assign sequential row numbers
  summaryRows.forEach((r, idx) => {
    r.srNo = idx + 1;
  });

  const totalBeforeGst =
    materialTotal +
    packingTotal +
    installationTotal +
    localTransportTotal +
    outstationTransportTotal +
    otherChargesTotal;

  const grandTotal = totalBeforeGst + cgstTotal + sgstTotal + igstTotal;

  // Canonical calculation matching EstimateDocument.tsx exactly:
  let canonicalBeforeTax = 0;
  let canonicalSgst = 0;
  let canonicalCgst = 0;
  let canonicalIgst = 0;

  sections.forEach((sec) => {
    const savedServiceBase = sec.serviceItems.reduce((s: number, it: any) => s + Number(it.totalPrice || 0), 0);
    const syntheticServiceBase = (hasAnySavedServices || sec.serviceItems.length > 0)
      ? 0
      : sec.packingBase + sec.implBase + sec.transportBase;

    canonicalBeforeTax += sec.materialBase + savedServiceBase + syntheticServiceBase;
    if (isIgst) {
      canonicalIgst +=
        sec.materialIgst +
        sec.serviceItems.reduce((s: number, it: any) => s + Number(it.igstAmount || 0), 0) +
        syntheticServiceBase * 0.18;
    } else {
      canonicalSgst +=
        sec.materialSgst +
        sec.serviceItems.reduce((s: number, it: any) => s + Number(it.sgstAmount || 0), 0) +
        syntheticServiceBase * 0.09;
      canonicalCgst +=
        sec.materialCgst +
        sec.serviceItems.reduce((s: number, it: any) => s + Number(it.cgstAmount || 0), 0) +
        syntheticServiceBase * 0.09;
    }
  });

  const canonicalGrandTotal = canonicalBeforeTax + canonicalSgst + canonicalCgst + canonicalIgst;

  // Reconciliation checks:
  const errors: string[] = [];
  const rowsSum = summaryRows.reduce((sum, r) => sum + r.beforeGst, 0);

  if (Math.abs(rowsSum - totalBeforeGst) > 0.01) {
    errors.push(
      `Summary rows sum (₹${rowsSum.toFixed(2)}) does not match category sum (₹${totalBeforeGst.toFixed(2)}).`
    );
  }

  if (Math.abs(totalBeforeGst - canonicalBeforeTax) > 0.01) {
    errors.push(
      `Summary total before GST (₹${totalBeforeGst.toFixed(2)}) does not match canonical estimate subtotal (₹${canonicalBeforeTax.toFixed(2)}).`
    );
  }

  // Currency rounding tolerance for grand total:
  if (Math.abs(grandTotal - canonicalGrandTotal) > 1.0) {
    errors.push(
      `Summary grand total (₹${grandTotal.toFixed(2)}) does not match canonical estimate grand total (₹${canonicalGrandTotal.toFixed(2)}).`
    );
  }

  const totals: ReconciledTotals = {
    materialTotal,
    packingTotal,
    installationTotal,
    localTransportTotal,
    outstationTransportTotal,
    otherChargesTotal,
    totalBeforeGst,
    cgst: cgstTotal,
    sgst: sgstTotal,
    igst: igstTotal,
    grandTotal,
  };

  const canonicalTotals: CanonicalTotals = {
    grandBeforeTax: canonicalBeforeTax,
    grandSgst: canonicalSgst,
    grandCgst: canonicalCgst,
    grandIgst: canonicalIgst,
    grandTotal: canonicalGrandTotal,
  };

  return {
    reconciled: errors.length === 0,
    errors,
    summaryRows,
    totals,
    canonicalTotals,
    isIgst,
  };
};
