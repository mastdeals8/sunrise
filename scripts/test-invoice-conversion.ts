import assert from "node:assert/strict";
import { estimateItemsToInvoiceLines } from "../client/src/pages/operations/utils/invoiceConversion";

const lines = estimateItemsToInvoiceLines([
  {
    sl: 1, itemName: "Area panel", width: 120, height: 48, quantity: 2, rate: 100,
    totalPrice: 8000, cgstPercent: 9, cgstAmount: 720, sgstPercent: 9, sgstAmount: 720,
    totalAmount: 9440, storeCode: "S-A",
  },
  {
    sl: 2, itemName: "Packing", quantity: 1, rate: 500, totalPrice: 500,
    lineType: "packing", igstPercent: 18, igstAmount: 90, totalAmount: 590, storeCode: "S-A",
  },
  {
    sl: 3, itemName: "Repeated product", quantity: 1, rate: 100, totalPrice: 100, storeCode: "S-A",
  },
  {
    sl: 4, itemName: "Repeated product", quantity: 1, rate: 100, totalPrice: 200, storeCode: "S-B",
  },
]);

assert.equal(lines[0].amount, 8000);
assert.equal(lines[0].taxAmount, 1440);
assert.equal(lines[0].totalAmount, 9440);
assert.equal(lines[0].width, 120);
assert.equal(lines[0].storeCode, "S-A");
assert.equal(lines[1].lineType, "packing");
assert.equal(lines.length, 4);
assert.equal(lines[2].amount, 100);
assert.equal(lines[3].amount, 200);
console.log("invoice conversion regression checks passed");
