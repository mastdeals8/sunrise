# Post-Estimate Workflow Stabilization QA Report

Date: 2026-06-11

## Scope

This report covers the execution workflow after estimate creation:

- PO visibility and estimate-level PO ownership
- WCC register, edit, duplicate suppression, print fixes already applied
- Store-level execution readiness
- Project document handling
- Telegram and WhatsApp execution workflow design
- Invoice readiness

The Estimate remains the source of truth for PO data. No duplicate PO workflow was added.

## Verification Summary

- TypeScript check: `npm run check` passed.
- Data audit was performed through authenticated API calls.
- Existing WCC root-cause screenshots are available under `screenshots/wcc_root_cause/`.
- Current post-estimate smoke screenshots are available under `screenshots/post_estimate_workflow/`.

## Current Data Snapshot

Authenticated API audit returned:

- Estimates: 2
- Stores: 538
- Delivery challan / WCC records: 5
- Active WCC records: 5
- Unique active WCC register rows after store-level duplicate suppression: 2
- Estimates with PO attached: 1

Estimate readiness:

| Estimate | Status | PO | Stores | DC | WCC | Signed WCC |
|---|---|---:|---:|---:|---:|---:|
| SM/E/26-27/202 | draft | No | 20 | 0 | 0 | 0 |
| SM/E/26-27/201 | po_received | Yes | 3 | 0 | 5 | 0 |

The difference between 5 active WCC records and 2 visible WCC rows is caused by duplicate store WCC records. The register now intentionally shows one row per estimate/store WCC key.

## Fixes Applied

### WCC Edit Immediate-Close Bug

Root cause:

- `openDcForEdit()` previously cleared `selectedEstimate` while the editor rendered only when `showDcModal && selectedEstimate` was true.
- The editor opened, then immediately unmounted because its required estimate context was removed.

Fix:

- Preserve selected estimate context when opening WCC for edit.
- `openDcForEdit()` now loads estimate context, sets the active WCC values, closes preview state, and opens only the WCC editor.

Acceptance status:

- Static flow is correct: `Edit` -> `openDcForEdit(dc)` -> `loadEstimateContextForDc(dc)` -> `setSelectedEstimate(est)` -> `setShowDcModal(true)`.
- Previous Playwright verification showed the editor stayed open with photo inputs and Save & Close visible.

### WCC Register Count / Duplicate Rows

Root cause:

- Database contains duplicate WCC records for the same estimate/store.
- Register badge counted raw records while the table displayed deduped rows.

Fix:

- `DeliveryChallanPanel` now filters deleted records, suppresses duplicate WCC rows by `estimateId + storeCode/storeId`, and uses the same deduped list for counts and rows.

Current result:

- Raw active WCC records: 5
- Visible unique WCC rows: 2

Remaining risk:

- This is UI-level suppression. Server/database uniqueness enforcement is still recommended for `estimateId + storeId/storeCode + WCC type`.

### WCC Print Blank Page

Root cause:

- Hidden modal/export wrappers were still affecting print layout.
- Printable DOM exceeded one A4 page, causing a second blank page.

Fix:

- Dedicated WCC print classes were added.
- Print CSS uses the WCC modal shell as the print root and hides non-print siblings/wrappers.

Evidence:

- `screenshots/wcc_root_cause/09-print-current-final2.pdf` was verified as exactly 1 page using strict `/Type /Page` counting.

### PO Management Cleanup

Implemented:

- Estimate-level PO status now shows `PO Missing` or `PO Received`.
- If PO exists, users can see PO number, PO date, file name, amount, and actions.
- Actions available from the estimate view: View PO, Download PO, Replace PO.
- Existing PO upload modal is reused for replacement. No duplicate PO module/storage was created.
- Project Documents accordion was added under Estimate Preview with PO, DC, WCC, Invoice, and Files sections.

Small follow-up fix applied in this pass:

- PO document count now treats `poFilePath` as an attached PO even if `poNumber` is missing.

Known data limitation:

- The current schema does not store actual PO upload timestamp or uploaded-by user. The UI truthfully shows missing uploader metadata instead of inventing it. `poDate` is the PO date, not necessarily the upload date.

## Current Architecture

### WCC Register

Component:

- `client/src/pages/operations/components/DeliveryChallanPanel.tsx`

Responsibilities:

- Shows one row per active document.
- Suppresses duplicate WCC rows at UI level.
- Displays WCC number, estimate number, store code, store name, photo count, signed WCC status, draft/completed status, created date.
- Provides Edit, Preview, Print, Signed WCC upload, Photos upload, Delete.

### WCC Editor / Preview / Print

Component:

- `client/src/pages/operations/components/WccDcEditor.tsx`

Responsibilities:

- Edit existing WCC via PATCH.
- Store navigation within editor.
- Current-store and all-store print modes.
- Shared WCC renderer for preview and print.

### Estimate PO Ownership

Components:

- `client/src/pages/operations/components/EstimateBuilder.tsx`
- `client/src/pages/operations/components/EstimatePreview.tsx`
- `client/src/pages/operations/components/PoUploadModal.tsx`

Source fields:

- `poNumber`
- `poDate`
- `poAmount`
- `poFilePath`
- `poRemarks`

## Store-Level Execution Structure

Existing pieces:

- Estimates support store grouping.
- WCC records carry store metadata.
- `project_store_status` table exists.
- Project tracker has basic per-store/status support.

Required stabilization:

- Promote store execution to a first-class project screen:
  - Store row
  - Photos
  - DC
  - WCC
  - Signed WCC
  - Status
  - Actions: Upload Photos, Generate Challan, Generate WCC, Upload Signed WCC, View Documents, Replace Documents, Delete Documents

Recommended model:

- Keep estimate as project header.
- Keep PO on estimate.
- Keep DC/WCC per store.
- Use `project_store_status` for execution status overrides.
- Do not duplicate uploaded documents; link existing file paths to the relevant estimate/DC/WCC/store record.

## Document Management

Existing:

- `ProjectDocuments` page aggregates PO, signed DC/WCC, photos, transport receipts, extra docs, and direct uploads.
- Current actions: View and Download.
- Estimate Preview now has project document sections.

Missing:

- Replace and Delete controls on the global Project Documents page.
- PDF multi-page inline preview.
- Full-screen image preview.
- Store-scoped document drill-down.

Recommended implementation:

- Add one reusable `DocumentViewer` component:
  - PDF iframe/object preview
  - image preview
  - full-screen mode
  - download
- Add one reusable `DocumentActions` component:
  - View
  - Download
  - Replace
  - Delete
- Route replacement/deletion to the owning record:
  - PO -> estimate PATCH
  - Signed WCC/DC -> delivery challan PATCH
  - Photos -> WCC metadata/photos or `photoPath`

## Project Status Model

Requested workflow:

`ESTIMATE_CREATED -> PO_RECEIVED -> EXECUTION_STARTED -> PHOTO_UPLOADED -> WCC_GENERATED -> SIGNED_WCC_RECEIVED -> INVOICE_READY -> INVOICED -> PAYMENT_PENDING -> PAYMENT_RECEIVED`

Current status support:

- Estimate status supports draft/sent/approved/awaiting_po/po_received.
- Store status table exists but uses simpler values.
- Invoice/payment status exists separately.

Recommended approach:

- Derive project status from existing records where possible.
- Store final override/status in `project_store_status` only when manual status is needed.
- Avoid adding duplicate status fields until derivation gaps are clear.

Derived examples:

- `PO_RECEIVED`: estimate has PO number or PO file path.
- `WCC_GENERATED`: active WCC exists for store.
- `SIGNED_WCC_RECEIVED`: WCC has signed file.
- `INVOICE_READY`: all required stores have signed WCC/DC and PO exists.
- `INVOICED`: invoice exists for estimate.
- `PAYMENT_RECEIVED`: linked invoice is paid.

## Telegram / WhatsApp Workflow Design

Existing pieces:

- Telegram settings page exists.
- WhatsApp settings page exists.
- Webhook endpoints exist.
- Bot upload inbox exists.
- Inbound media can be captured as unlinked uploads.

Missing for the requested smart execution flow:

- Project deep-link route, for example `/project/SME-26-001`.
- Short-lived or role-limited field access token.
- Mobile-first project/store upload screen.
- Telegram button generator for `OPEN PROJECT`.
- WhatsApp share action.
- Automatic mapping from opened project/store to uploaded document type.

Recommended flow:

1. Back-office opens estimate/project.
2. System generates secure project link.
3. User shares link to Telegram or WhatsApp.
4. Field staff opens link.
5. Mobile project page shows stores only.
6. Staff selects store.
7. Staff uploads:
   - Photos
   - Delivery Challan
   - Signed WCC
8. Store status updates automatically.

Security recommendation:

- Do not bypass login permanently.
- Use signed, expiring field links with limited permissions:
  - estimate id
  - allowed store ids
  - expiry
  - upload-only permissions

Target mobile flow:

`Open Link -> Select Store -> Upload Photos -> Upload Challan -> Upload Signed WCC -> Done`

This can realistically fit within 60-120 seconds if the field screen avoids desktop navigation, search, and estimate-level controls.

## Invoice Readiness

Already available:

- Estimate record
- PO fields and file path
- Store grouping
- WCC/DC records
- Signed WCC file path
- Invoice module and invoice packet flow

Current blocker in sample data:

- Estimate `SM/E/26-27/201` has PO and WCCs but no signed WCCs.
- Estimate `SM/E/26-27/202` has 20 stores but no PO/WCC/DC yet.

Invoice readiness rule recommended:

- Estimate has PO.
- Every required store has WCC/DC as applicable.
- Every required WCC/DC has signed proof where the client requires it.
- No active duplicate WCC rows for the same estimate/store/type.

## Remaining Critical Work

1. Add server-side WCC uniqueness enforcement.
2. Build store-level execution master screen.
3. Add reusable document preview/download/replace/delete controls.
4. Add secure field project deep links.
5. Build mobile-first field upload route.
6. Connect Telegram button/share generation to field links.
7. Connect WhatsApp share generation to field links.
8. Add derived project/store status computation.
9. Add invoice-readiness indicator at estimate/project level.
10. Run full browser print QA on Safari Mac, Chrome Mac, and Chrome Windows.

## Notes On Print QA

WCC current-store print was fixed and verified by generated PDF page count.

Still pending:

- Full Safari Mac manual print dialog verification.
- Chrome Mac verification.
- Chrome Windows verification.
- Estimate Print audit.
- Delivery Challan Print audit.
- Uploaded Signed WCC print audit.

These require real browser print engines and should be handled as a separate QA pass with screenshots/PDF outputs per browser.

