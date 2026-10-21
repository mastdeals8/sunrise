import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EstimateDocument from "../client/src/components/EstimateDocument";
import { exportEstimateToExcel } from "../client/src/pages/operations/utils/exportHelpers";
import { resolveServiceProduct, serviceProductLabel } from "../shared/serviceProductDisplay";

const products = [
  { id: 19, name: "Packing Charges", calculationType: "percentage", unit: "percentage", rate: 4, gstPercent: 18, hsnSac: "9987" },
  { id: 20, name: "Installation Charges", calculationType: "percentage", unit: "percentage", rate: 7, gstPercent: 18, hsnSac: "9987" },
  { id: 21, name: "Local Transportation", calculationType: "fixed", unit: "job", rate: 1000, gstPercent: 18, hsnSac: "9987" },
  { id: 22, name: "Outstation Charges", calculationType: "per_km", unit: "km", rate: 18, gstPercent: 18, hsnSac: "9987" },
];

const reportedEstimateRows = [
  { estimateNumber: "SM/E/26-27/214", productId: 22, lineType: "transport", itemName: "Outstation Charges", calculationType: "fixed", unit: "km", rate: 15, hsn: "9987" },
  { estimateNumber: "SM/E/26-27/215", productId: 22, lineType: "transport", itemName: "Outstation Charges", calculationType: "fixed", unit: "km", rate: 15, hsn: "9987" },
  { estimateNumber: "SM/E/26-27/216", productId: 22, lineType: "transport", itemName: "Outstation Charges", calculationType: "fixed", unit: "km", rate: 15, hsn: "9987" },
];

for (const row of reportedEstimateRows) {
  const resolved = resolveServiceProduct(row, products);
  assert.equal(resolved.label, "Outstation Transportation (₹15/KM)", row.estimateNumber);
  assert.equal(resolved.calculationType, "per_km", `${row.estimateNumber} must use Product Master calculation type`);
  assert.equal(resolved.rate, 15, `${row.estimateNumber} must retain its historical estimate rate`);
  assert.equal(resolved.hsn, "9987", `${row.estimateNumber} must retain its HSN snapshot`);
}

assert.equal(serviceProductLabel({ productId: 21, lineType: "transport", itemName: "wrong saved name", rate: 1000 }, products), "Local Transportation");
assert.equal(serviceProductLabel({ productId: 19, lineType: "packing", rate: 4 }, products), "Packing Charges (4%)");
assert.equal(serviceProductLabel({ productId: 20, lineType: "installation", rate: 7 }, products), "Installation Charges (7%)");

const expectedOutstationLabel = "Outstation Transportation (₹15/KM)";
const estimate = {
  id: 214,
  estimateNumber: "SM/E/26-27/214",
  clientId: 1,
  brandId: 1,
  storeId: 1,
  title: "Regression Estimate",
  subtotal: 11745,
  taxAmount: 2114.1,
  totalAmount: 13859.1,
  status: "draft",
  clientFormat: "normal",
  gstType: "CGST+SGST",
  storeGrouping: null,
  createdAt: "2026-08-06T00:00:00.000Z",
} as any;
const outstationItem = {
  id: 6919,
  estimateId: 214,
  productId: 22,
  lineType: "transport",
  itemName: "Outstation Charges",
  description: "Outstation Charges (Per KM)",
  calculationType: "fixed",
  unit: "km",
  rate: 15,
  quantity: 783,
  hsn: "9987",
  totalPrice: 11745,
  totalAmount: 13859.1,
  cgstPercent: 9,
  cgstAmount: 1057.05,
  sgstPercent: 9,
  sgstAmount: 1057.05,
  igstPercent: 0,
  igstAmount: 0,
  sl: 1,
  isStandard: true,
} as any;

const pdfAndPreviewMarkup = renderToStaticMarkup(React.createElement(EstimateDocument, {
  estimate,
  items: [outstationItem],
  stores: [{ id: 1, name: "Test Store", storeCode: "TEST" } as any],
  clients: [{ id: 1, name: "Test Client" } as any],
  products: products as any,
  sellerProfile: {},
}));
assert.ok(pdfAndPreviewMarkup.includes(expectedOutstationLabel), "Estimate preview / browser PDF renderer label");
assert.ok(pdfAndPreviewMarkup.includes("783 KM"), "Estimate preview / browser PDF must display saved 783 KM quantity");
assert.ok(pdfAndPreviewMarkup.includes("₹15/KM"), "Estimate preview / browser PDF must display rate per KM");
assert.ok(pdfAndPreviewMarkup.includes("Outstation Charges (Per KM)"), "Estimate preview / browser PDF must display product details description");

let downloadedWorkbook: Blob | null = null;
const runtime = globalThis as any;
runtime.document = {
  createElement: () => ({ href: "", download: "", click: () => undefined }),
};
runtime.URL.createObjectURL = (blob: Blob) => {
  downloadedWorkbook = blob;
  return "blob:service-export-regression";
};
runtime.URL.revokeObjectURL = () => undefined;

await exportEstimateToExcel(
  estimate,
  [outstationItem],
  "Test Client",
  {},
  [{ id: 1, name: "Test Store", storeCode: "TEST" }],
  products,
);
assert.ok(downloadedWorkbook, "Excel exporter must produce a workbook");
const XLSX = (await import("xlsx-js-style")).default;
let workbook = XLSX.read(await downloadedWorkbook.arrayBuffer(), { type: "array" });
let worksheet = workbook.Sheets[workbook.SheetNames[0]];
let workbookText = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]).flat().join("\n");
assert.ok(workbookText.includes(expectedOutstationLabel), "Excel renderer label");
assert.ok(workbookText.includes("783 KM"), "Excel renderer must include 783 KM quantity");
assert.ok(workbookText.includes("₹15/KM"), "Excel renderer must include rate per KM");
assert.ok(workbookText.includes("Outstation Charges (Per KM)"), "Excel renderer must include item description");

// ── Test custom route description and 550 KM @ ₹18/KM ──────────────────────
const customRouteItem = {
  id: 6920,
  estimateId: 215,
  productId: 22,
  lineType: "transport",
  itemName: "Outstation Transportation (₹18/KM)",
  description: "Outstation Transportation — Pune to Nagpur",
  calculationType: "per_km",
  unit: "km",
  rate: 18,
  quantity: 550,
  hsn: "9987",
  totalPrice: 9900,
  totalAmount: 11682,
  cgstPercent: 9,
  cgstAmount: 891,
  sgstPercent: 9,
  sgstAmount: 891,
  igstPercent: 0,
  igstAmount: 0,
  sl: 1,
  isStandard: true,
} as any;

const customEstimate = {
  ...estimate,
  id: 215,
  estimateNumber: "SM/E/26-27/215",
  subtotal: 9900,
  taxAmount: 1782,
  totalAmount: 11682,
};

const customMarkup = renderToStaticMarkup(React.createElement(EstimateDocument, {
  estimate: customEstimate,
  items: [customRouteItem],
  stores: [{ id: 1, name: "Nagpur Store", storeCode: "NGP01" } as any],
  clients: [{ id: 1, name: "Test Client" } as any],
  products: products as any,
  sellerProfile: {},
}));

assert.ok(customMarkup.includes("550 KM"), "View/PDF must show 550 KM");
assert.ok(customMarkup.includes("₹18/KM"), "View/PDF must show ₹18/KM rate");
assert.ok(customMarkup.includes("9,900.00"), "View/PDF must show ₹9,900 amount");
assert.ok(customMarkup.includes("Outstation Transportation — Pune to Nagpur"), "View/PDF must show custom route description");

downloadedWorkbook = null;
await exportEstimateToExcel(
  customEstimate,
  [customRouteItem],
  "Test Client",
  {},
  [{ id: 1, name: "Nagpur Store", storeCode: "NGP01" }],
  products,
);
assert.ok(downloadedWorkbook, "Excel exporter must produce a workbook for custom route");
workbook = XLSX.read(await downloadedWorkbook.arrayBuffer(), { type: "array" });
worksheet = workbook.Sheets[workbook.SheetNames[0]];
workbookText = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]).flat().join("\n");
assert.ok(workbookText.includes("550 KM"), "Excel must include 550 KM quantity");
assert.ok(workbookText.includes("₹18/KM"), "Excel must include ₹18/KM rate");
assert.ok(workbookText.includes("9900"), "Excel must include 9900 amount");
assert.ok(workbookText.includes("Outstation Transportation — Pune to Nagpur"), "Excel must include custom route description");

// ── Test synthetic storeGrouping transportation row ────────────────────────
const materialItem = {
  id: 6921,
  estimateId: 216,
  itemName: "Vinyl Print",
  description: "Star Flex Vinyl",
  calculationType: "sqft",
  unit: "sqft",
  rate: 50,
  quantity: 1,
  width: 10,
  height: 5,
  totalSize: 50,
  hsn: "4911",
  totalPrice: 2500,
  totalAmount: 2950,
  cgstPercent: 9,
  cgstAmount: 225,
  sgstPercent: 9,
  sgstAmount: 225,
  igstPercent: 0,
  igstAmount: 0,
  sl: 1,
  isStandard: true,
} as any;

const syntheticEstimate = {
  ...estimate,
  id: 216,
  estimateNumber: "SM/E/26-27/216",
  subtotal: 8260,
  taxAmount: 1486.8,
  totalAmount: 9746.8,
  storeGrouping: {
    "1": {
      itemSls: [1],
      transportAmount: 5760,
      transportKm: 320,
      transportRate: 18,
      transportType: "outstation",
      transportDescription: "Outstation Transportation — Pune to Kolhapur",
    },
  },
};

const syntheticMarkup = renderToStaticMarkup(React.createElement(EstimateDocument, {
  estimate: syntheticEstimate,
  items: [materialItem],
  stores: [{ id: 1, name: "Kolhapur Store", storeCode: "KLP01" } as any],
  clients: [{ id: 1, name: "Test Client" } as any],
  products: products as any,
  sellerProfile: {},
}));

assert.ok(syntheticMarkup.includes("320 KM"), "Synthetic storeGrouping row must show 320 KM");
assert.ok(syntheticMarkup.includes("₹18/KM"), "Synthetic storeGrouping row must show ₹18/KM rate");
assert.ok(syntheticMarkup.includes("Outstation Transportation — Pune to Kolhapur"), "Synthetic storeGrouping row must show route description");

downloadedWorkbook = null;
await exportEstimateToExcel(
  syntheticEstimate,
  [materialItem],
  "Test Client",
  {},
  [{ id: 1, name: "Kolhapur Store", storeCode: "KLP01" }],
  products,
);
assert.ok(downloadedWorkbook, "Excel exporter must produce a workbook for synthetic storeGrouping");
workbook = XLSX.read(await downloadedWorkbook.arrayBuffer(), { type: "array" });
worksheet = workbook.Sheets[workbook.SheetNames[0]];
workbookText = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]).flat().join("\n");
assert.ok(workbookText.includes("320 KM"), "Excel synthetic storeGrouping row must include 320 KM");
assert.ok(workbookText.includes("₹18/KM"), "Excel synthetic storeGrouping row must include ₹18/KM rate");
assert.ok(workbookText.includes("Outstation Transportation — Pune to Kolhapur"), "Excel synthetic storeGrouping row must include route description");

// ── Test that reopening/hydrating an estimate preserves custom route description ──
const rawLoadedItem = {
  ...customRouteItem,
  description: "Outstation Transportation — Pune to Nagpur",
  itemName: "Outstation Transportation (₹18/KM)",
};
const lineType = rawLoadedItem.lineType;
const isServiceLineType = (lt: string) => ["packing", "installation", "transport"].includes(lt);
const normalizedServiceLabel = isServiceLineType(lineType)
  ? serviceProductLabel({ ...rawLoadedItem, lineType, rate: rawLoadedItem.rate }, products)
  : undefined;
const hydratedDescription = rawLoadedItem.description || normalizedServiceLabel || "";
assert.equal(hydratedDescription, "Outstation Transportation — Pune to Nagpur", "Reopened estimate must preserve custom route description");

console.log("PASS service product display regression: UI/preview/PDF/Excel shared labels, KM quantities, rates and route descriptions are consistent.");
