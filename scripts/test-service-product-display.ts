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
const workbook = XLSX.read(await downloadedWorkbook.arrayBuffer(), { type: "array" });
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const workbookText = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]).flat().join("\n");
assert.ok(workbookText.includes(expectedOutstationLabel), "Excel renderer label");

console.log("PASS service product display regression: UI/preview/PDF/Excel shared labels are consistent.");
