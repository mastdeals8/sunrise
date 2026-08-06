import assert from "node:assert/strict";
import { projectStoresFromCanonicalRecords } from "../client/src/pages/operations/components/ProjectWorkspace";

// Regression for SM/E/26-27/212: the WCC exists in delivery_challans while
// execution_stores has no row. The estimate grouping must still establish the
// Project Workspace and Upload Photos store scope.
const estimate = {
  id: 21,
  estimateNumber: "SM/E/26-27/212",
  storeGrouping: { "73": [1] },
  storeId: null,
} as any;
const masterStores = [{
  id: 73,
  storeCode: "101076",
  name: "Shagun, Pune",
  city: "Pune",
  state: "Maharashtra",
}] as any[];
const challans = [{
  id: 42,
  estimateId: 21,
  documentType: "wcc",
  clientFormat: "ABFRL",
  status: "draft",
  metadata: { storeId: 73, storeCode: "101076", storeName: "Shagun, Pune" },
}] as any[];

const rows = projectStoresFromCanonicalRecords(
  estimate,
  [{ sl: 1 }],
  masterStores,
  challans,
  [{ id: 9, estimateId: 21, storeCode: "101076", documentType: "photo", filePath: "photos/1.jpg" }],
  [], // The historical regression: no execution_stores rows exist.
);

assert.equal(rows.length, 1, "Project Workspace derives store scope from the estimate, not execution_stores");
assert.equal(rows[0].storeCode, "101076");
assert.equal(rows[0].stats.wccCount, 1, "delivery_challans is the WCC source of truth");
assert.equal(rows[0].stats.photoCount, 1);
assert.equal(rows[0].wccRecords[0].id, 42);

// ProjectUploadModal receives this exact `data.stores` projection.
const uploadStores = rows.map(({ storeCode, storeName }) => ({ storeCode, storeName }));
assert.deepEqual(uploadStores, [{ storeCode: "101076", storeName: "Shagun, Pune" }]);

console.log("PASS project store scope regression: WCC and Upload Photos use estimate-derived stores.");
