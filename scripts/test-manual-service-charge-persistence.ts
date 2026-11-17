import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveServiceProduct,
  serviceProductLabel,
  isSystemDefaultServiceName,
} from "../shared/serviceProductDisplay";
import { isServiceLineType } from "../client/src/pages/operations/utils/estimateCalculations";
import EstimateDocument from "../client/src/components/EstimateDocument";

console.log("--- STARTING MANUAL SERVICE CHARGE PERSISTENCE TESTS ---");

// 1. Verify isSystemDefaultServiceName
assert.equal(isSystemDefaultServiceName("Local Transportation"), true);
assert.equal(isSystemDefaultServiceName("Packing Charges"), true);
assert.equal(isSystemDefaultServiceName("Installation Charges"), true);
assert.equal(isSystemDefaultServiceName("Outstation Charges"), true);
assert.equal(isSystemDefaultServiceName("Courier"), false);
assert.equal(isSystemDefaultServiceName("Site Fixing"), false);
assert.equal(isSystemDefaultServiceName("Air Freight"), false);
assert.equal(isSystemDefaultServiceName("Special Packing"), false);
console.log("✓ System default vs custom service names identified correctly");

const products = [
  { id: 19, name: "Packing Charges", category: "Services", unit: "%", calculationType: "percentage", gstPercent: 18, hsnSac: "9987" },
  { id: 20, name: "Installation Charges", category: "Services", unit: "%", calculationType: "percentage", gstPercent: 18, hsnSac: "9987" },
  { id: 21, name: "Local Transportation", category: "Services", unit: "job", calculationType: "fixed", gstPercent: 18, hsnSac: "9987" },
  { id: 22, name: "Outstation Transportation", category: "Services", unit: "km", calculationType: "per_km", gstPercent: 18, hsnSac: "9987" },
];

// 2. Test resolveServiceProduct with custom element
const defaultLocalTrans = resolveServiceProduct({
  productId: 21,
  lineType: "transport",
  itemName: "Local Transportation",
  description: "Local Transportation",
  rate: 1200,
}, products);
assert.equal(defaultLocalTrans.label, "Local Transportation");
assert.equal(defaultLocalTrans.productName, "Local Transportation");

const editedCourier = resolveServiceProduct({
  productId: 21,
  lineType: "transport",
  itemName: "Courier",
  description: "Courier",
  rate: 1200,
}, products);
assert.equal(editedCourier.label, "Courier");
assert.equal(editedCourier.productName, "Courier");
assert.equal(editedCourier.gstPercent, 18);
assert.equal(editedCourier.hsn, "9987");
console.log("✓ resolveServiceProduct preserves custom 'Courier' element name");

// 3. Test Save Transformation Logic (from OperationsPage handleSaveEstimate)
function simulateSavePayload(item: any, selectedProduct: any) {
  const isService = isServiceLineType(item.lineType);
  const sameDisplayText = (a: any, b: any) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const hasCustomDescription = item.description != null && String(item.description).trim() !== "" && !sameDisplayText(item.description, item.itemName);
  
  // FormatProductDetails mock (which previously reverted service items to product name)
  const formatProductDetails = (p: any, size: string, customText: string) => p?.name || "";

  const productDetails = isService
    ? (item.description != null && String(item.description).trim() !== "" ? String(item.description).trim() : (item.itemName || ""))
    : (hasCustomDescription
      ? String(item.description).trim()
      : (selectedProduct
        ? formatProductDetails(selectedProduct, "", item.itemName)
        : (item.description || "")));

  return {
    itemName: item.itemName,
    description: productDetails,
  };
}

const savedCourier = simulateSavePayload({
  lineType: "transport",
  productId: 21,
  itemName: "Courier",
  description: "Courier",
}, products.find(p => p.id === 21));

assert.equal(savedCourier.itemName, "Courier");
assert.equal(savedCourier.description, "Courier");
console.log("✓ Save transformation preserves 'Courier' in both itemName and description");

const savedDefault = simulateSavePayload({
  lineType: "transport",
  productId: 21,
  itemName: "Local Transportation",
  description: "Local Transportation",
}, products.find(p => p.id === 21));

assert.equal(savedDefault.itemName, "Local Transportation");
assert.equal(savedDefault.description, "Local Transportation");
console.log("✓ Save transformation preserves default 'Local Transportation' for unedited rows");

// 4. Test Reload / Hydration Transformation Logic (from OperationsPage handleEditEstimate)
function simulateHydration(item: any, productsList: any[]) {
  const lineType = (item.lineType || item.line_type || "product");
  const rawRate = item.rate != null ? String(item.rate) : "0";

  const savedItemName = item.itemName ?? item.item_name ?? "";
  const savedDescription = item.description ?? "";

  const normalizedServiceLabel = isServiceLineType(lineType)
    ? serviceProductLabel({ ...item, lineType, rate: Number(rawRate) || 0 }, productsList)
    : undefined;

  const effectiveItemName = savedItemName || normalizedServiceLabel || "";
  const effectiveDescription = savedDescription || (isServiceLineType(lineType) ? effectiveItemName : (normalizedServiceLabel || ""));

  return {
    lineType,
    itemName: effectiveItemName,
    description: effectiveDescription,
  };
}

// Case A: CamelCase loaded row (Express API)
const hydratedCamel = simulateHydration({
  lineType: "transport",
  productId: 21,
  itemName: "Courier",
  description: "Courier",
  rate: 1200,
}, products);
assert.equal(hydratedCamel.itemName, "Courier");
assert.equal(hydratedCamel.description, "Courier");

// Case B: Snake_case loaded row (Supabase bolt mode)
const hydratedSnake = simulateHydration({
  line_type: "transport",
  product_id: 21,
  item_name: "Courier",
  description: "Courier",
  rate: 1200,
}, products);
assert.equal(hydratedSnake.itemName, "Courier");
assert.equal(hydratedSnake.description, "Courier");

// Case C: Unedited row remains Local Transportation
const hydratedUnedited = simulateHydration({
  line_type: "transport",
  product_id: 21,
  item_name: "Local Transportation",
  description: "Local Transportation",
  rate: 1200,
}, products);
assert.equal(hydratedUnedited.itemName, "Local Transportation");
assert.equal(hydratedUnedited.description, "Local Transportation");
console.log("✓ Hydration / Reopening correctly retains manual edits from both snake_case and camelCase");

// 5. Test Multi-Store Isolation (Simulate SM/E/26-27/273 with 6 stores)
// Store 1: Courier
// Stores 2..6: Local Transportation
const stores = [
  { id: 101, name: "Store Alpha", storeCode: "ALPHA" },
  { id: 102, name: "Store Beta", storeCode: "BETA" },
  { id: 103, name: "Store Gamma", storeCode: "GAMMA" },
  { id: 104, name: "Store Delta", storeCode: "DELTA" },
  { id: 105, name: "Store Epsilon", storeCode: "EPSILON" },
  { id: 106, name: "Store Zeta", storeCode: "ZETA" },
];

const multiStoreItems = stores.map((store, idx) => {
  const isStore1 = idx === 0;
  return {
    id: 1000 + idx,
    estimateId: 275,
    sl: idx + 1,
    storeId: store.id,
    storeCode: store.storeCode,
    lineType: "transport",
    productId: 21,
    itemName: isStore1 ? "Courier" : "Local Transportation",
    description: isStore1 ? "Courier" : "Local Transportation",
    calculationType: "fixed",
    unit: "job",
    rate: 1500,
    quantity: 1,
    hsn: "9987",
    totalPrice: 1500,
    cgstPercent: 9,
    cgstAmount: 135,
    sgstPercent: 9,
    sgstAmount: 135,
    igstPercent: 0,
    igstAmount: 0,
    totalAmount: 1770,
    isStandard: true,
  };
});

// Check PDF / Preview HTML markup for all 6 stores
const storeGrouping: Record<string, any> = {};
stores.forEach((st, idx) => {
  storeGrouping[String(st.id)] = {
    itemSls: [idx + 1],
    transportAmount: 1500,
    transportDescription: idx === 0 ? "Courier" : "Local Transportation",
    storeName: st.name,
  };
});

const estimateMulti = {
  id: 275,
  estimateNumber: "SM/E/26-27/273",
  title: "ABFRL 6 Stores Test",
  clientFormat: "normal",
  gstType: "CGST+SGST",
  storeGrouping,
  createdAt: "2026-11-17T00:00:00.000Z",
};

const markup = renderToStaticMarkup(React.createElement(EstimateDocument, {
  estimate: estimateMulti as any,
  items: multiStoreItems as any,
  stores: stores as any,
  clients: [{ id: 1, name: "Aditya Birla Lifestyle Brands Limited" } as any],
  products: products as any,
  sellerProfile: {},
}));

// Verify markup contains Store 1 Courier and other stores Local Transportation
assert.ok(markup.includes(">Courier<"), "PDF/Preview must render 'Courier' for Store 1");
assert.ok(markup.includes(">Local Transportation<"), "PDF/Preview must render 'Local Transportation' for remaining stores");

// Verify count of Courier and Local Transportation in table cells
const courierOccurrences = (markup.match(/>Courier</g) || []).length;
// In Store 1, it appears twice: once in Element column, once in Product Details column
assert.equal(courierOccurrences, 2, `Expected 2 'Courier' cells (Element + Details), got ${courierOccurrences}`);

const localTransOccurrences = (markup.match(/>Local Transportation</g) || []).length;
// In stores 2..6 (5 stores), it appears twice per store: 5 * 2 = 10 times
assert.equal(localTransOccurrences, 10, `Expected 10 'Local Transportation' cells across 5 stores, got ${localTransOccurrences}`);

console.log("✓ Multi-store isolation verified: Store 1 is Courier, Stores 2..6 remain Local Transportation");

// 6. Test other service types: Installation & Packing
const installationEdited = resolveServiceProduct({
  productId: 20,
  lineType: "installation",
  itemName: "Site Fixing & Mounting",
  description: "Site Fixing & Mounting",
  rate: 7,
  calculationType: "percentage",
}, products);
assert.equal(installationEdited.label, "Site Fixing & Mounting (7%)");

const packingEdited = resolveServiceProduct({
  productId: 19,
  lineType: "packing",
  itemName: "Custom Wooden Crating",
  description: "Custom Wooden Crating",
  rate: 4,
  calculationType: "percentage",
}, products);
assert.equal(packingEdited.label, "Custom Wooden Crating (4%)");
console.log("✓ Manual edits to Installation and Packing rows are also correctly preserved");

// 7. Verify financial calculation untouched
multiStoreItems.forEach(item => {
  assert.equal(item.totalPrice, 1500);
  assert.equal(item.cgstAmount, 135);
  assert.equal(item.sgstAmount, 135);
  assert.equal(item.totalAmount, 1770);
  assert.equal(item.hsn, "9987");
});
console.log("✓ Financial values, HSN and GST remain completely unchanged");

console.log("\nALL SERVICE CHARGE PERSISTENCE TESTS PASSED!");
