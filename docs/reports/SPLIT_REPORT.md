# OperationsPage.tsx — Component Split Report

**Date:** 2026-05-24  
**Sessions:** 5 + 6  
**Status:** tsc --noEmit: 0 errors | npm run build: pass

---

## Line Count

| File | Lines | Notes |
|---|---|---|
| `OperationsPage.tsx` (original) | 6333 | Session 5 start |
| `OperationsPage.tsx` (after session 5 pass 1) | 5004 | −1329 lines (−21%) |
| `OperationsPage.tsx` (after session 6 pass 2) | 4589 | −415 lines (−8%) |
| **Total reduction** | **−1744 lines** | **−28% from original** |

---

## Components Extracted

### Session 5 — Pass 1

| Component | File | Approx Lines | Description |
|---|---|---|---|
| ClientsPanel | `components/ClientsPanel.tsx` | ~215 | Client create form + directory table + "Manage GST Profiles" button |
| BrandsPanel | `components/BrandsPanel.tsx` | ~110 | Brand create form + registry table |
| StoresPanel | `components/StoresPanel.tsx` | ~220 | Store create form (all extended fields) + sites table |
| ProductsPanel | `components/ProductsPanel.tsx` | ~230 | Product create form + catalog table with material code linkage |
| MasterDataImportExportPanel | `components/MasterDataImportExportPanel.tsx` | ~280 | Type selector, drag-drop importer, column mapper, preview table, import stats, exports panel |
| InvoiceLedgerPanel | `components/InvoiceLedgerPanel.tsx` | ~295 | 3 sub-tabs: Invoice Builder, Invoice Ledger, Client-Wise Outstanding + statement drawer |
| ProjectTrackerPanel | `components/ProjectTrackerPanel.tsx` | ~160 | 5-stage pipeline cards per estimate with ABFRL store rows |

**Also extracted:**  
`utils/importFieldsMap.ts` — static field-mapping config moved out of the component body (was ~70 lines of inline `const`).

### Session 6 — Pass 2

| Component | File | Approx Lines | Description |
|---|---|---|---|
| BillingProfilesDialog | `components/BillingProfilesDialog.tsx` | ~310 | Full CRUD modal for Multi-GST billing profiles per client (list, add, edit, delete) |
| PoUploadModal | `components/PoUploadModal.tsx` | ~110 | PO number, date, amount, file upload, remarks form modal |
| DeliveryChallanPanel | `components/DeliveryChallanPanel.tsx` | ~90 | Challans tab list view — table with DC metadata and Print/View button |

---

## Components NOT Extracted (and why)

| Target | Reason not extracted |
|---|---|
| `EstimateBuilderPanel` | ~1800 lines; heavily coupled to 20+ state variables, product select, material code pick, ABFRL multi-store grouping logic, GST calculations, and billing profile selector. Safe but very large scope — deferred. |
| `EstimatePreview` / `EstimateExports` | Embedded in `selectedEstimate` overlay; heavily uses `window._sunriseEstimateHelpers` IIFE pattern (render functions mounted on window). Extracting requires refactoring the window-based pattern first. Deferred. |
| `WccEditor` / DC Canvas IIFE | 745-line IIFE (`renderA4ChallanCanvas`) with closure over clients/brands/stores and all DC/WCC state. Includes both DC creation dialog and preview modal. Extracting requires breaking the IIFE pattern and threading many props. Deferred. |
| `ProjectDocumentsPanel` | Not found in codebase — likely a deferred/planned feature. Skipped. |
| `PacketBuilder` modal | ~110 lines modal for invoice generation from estimate. Stable inline; low extraction gain. Not prioritised. |
| `RecordPayment` modal | ~100 lines modal for recording payments with invoice allocation. Stable inline; low extraction gain. Not prioritised. |

---

## Architecture

- **State ownership:** All `useState` calls remain in `OperationsPage`. Panels receive state values, setters, and handler functions as typed props.
- **No behavior changes:** All existing features, APIs, hash/deep links, ABFRL logic, PO upload, WCC editor, Excel export, and billing profile logic are unchanged.
- **TypeScript:** 0 errors throughout. Each component has a fully typed props interface.
- **importFieldsMap:** Lives in `utils/importFieldsMap.ts` — used by both OperationsPage and `MasterDataImportExportPanel`.

---

## Build Status

| Check | Result |
|---|---|
| `./node_modules/.bin/tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ Pass |
| Vite chunk size warning | Pre-existing (587 kB gzipped 127 kB) — not introduced here |

---

## Remaining Risks

- OperationsPage.tsx is 4589 lines — bulk is estimate builder, estimate preview overlay, DC/WCC canvas IIFE, and inline PacketBuilder/RecordPayment modals.
- The `window._sunriseEstimateHelpers` IIFE pattern in the estimate preview will need refactoring before the preview/exports can be extracted cleanly.
- DC/WCC IIFE uses a complex `renderA4ChallanCanvas` local function with closures — needs IIFE-to-component refactor before extraction.
- Chunk size (~587 kB) is pre-existing — not changed by this session.
