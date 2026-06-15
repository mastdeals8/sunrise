# Execution Workflow Production Readiness QA Report

Date: 2026-06-11

## Scope

Full pre-Telegram workflow QA on actual records:

- Open Estimate
- Open Execution
- Open Store
- Upload Photos
- Edit / Save WCC
- View / Print WCC
- Upload / View / Replace / Delete / Restore Signed WCC
- Reopen Store
- Verify derived status updates

Not included:

- Telegram
- WhatsApp
- Invoice readiness
- Payment workflow
- Duplicate legacy WCC cleanup
- Estimate Builder redesign
- WCC/DC template redesign

## Test Record

| Field | Value |
|---|---|
| Estimate | `SM/E/26-27/201` |
| Estimate ID | `2` |
| Store | `103298` - Laxmi Road, Pune |
| WCC / DC ID | `5` |
| WCC Number | `SM/DC/26-27/104` |

This store was selected because it has a single WCC record, avoiding the known legacy duplicate WCC cluster on store `102293`.

## Fixes Applied During QA

### 1. Store Details WCC Actions Were No-Ops

Finding:

- `View WCC`, `Edit WCC`, and `Print WCC` were visible in Store Details.
- `Edit WCC` closed Store Details but did not open the WCC editor.

Root cause:

- `EstimatePreview` expected `openDcForEdit`, `printDc`, `setSelectedDcForPreview`, and `setShowDcPreviewModal` props.
- `OperationsPage` was not passing these callbacks into `EstimatePreview`.

Fix:

- Passed existing WCC callbacks from `OperationsPage` to `EstimatePreview`.
- Kept all existing WCC editor/preview/print logic unchanged.
- Added a guard so `openDcForEdit()` seeds the target WCC into selected challan state before opening the editor.

Files changed:

- `client/src/pages/operations/OperationsPage.tsx`
- `client/src/pages/operations/components/EstimatePreview.tsx`

### 2. Signed WCC Replace/Delete Did Not Sync Legacy WCC Field

Finding:

- Replacing a signed WCC through `execution_documents` created a new active document.
- Legacy `delivery_challans.signed_challan_path` still pointed to the old file.
- Old WCC/Register flows and new Execution Documents could disagree.

Root cause:

- `execution_documents` replace/delete APIs updated only the unified document table.
- The legacy owning WCC/DC file fields were not synchronized.

Fix:

- Replace now updates the owner field for signed WCC/DC and supported single-owner DC files.
- Delete soft-deletes the execution document and clears the legacy owner field only if it still points to that same file.
- Startup reconciliation repairs active signed WCC/DC owner mismatches and suppresses stale active signed records.
- Version replacement now uses max version in the chain + 1.

Files changed:

- `server/routes.ts`

### 3. WCC Preview Print Was Blank

Finding:

- WCC preview screen displayed correctly.
- Chromium print media/PDF was blank.

Root cause:

- Global estimate print CSS hid all non-estimate modal children under `.operations-print-root.has-estimate-preview`.
- The WCC preview modal was rendered while estimate preview state existed, so `.wcc-modal-backdrop` was forced to `display: none` during print.

Fix:

- Excluded `.wcc-modal-backdrop` from the global estimate print hide rule.
- Wrapped single-store preview print output in `.wcc-print-page`, matching the existing editor/all-store print path.

Files changed:

- `client/src/index.css`
- `client/src/pages/operations/components/WccDcEditor.tsx`

## QA Results

| Flow | Result |
|---|---|
| Open Estimate Register | Passed |
| Open `SM/E/26-27/201` | Passed |
| Open Execution workspace | Passed |
| Open store `103298` | Passed |
| Store navigation from Execution table | Passed |
| Edit WCC from Store Details | Passed after callback wiring fix |
| Save & Close WCC | Passed |
| Duplicate modal check on WCC edit | Passed; editor opens as one active modal |
| View WCC from Store Details | Passed |
| Chromium WCC print | Passed after print CSS fix |
| Chromium WCC PDF page count | Passed; 1 page |
| View signed WCC | Passed via active execution document and legacy WCC owner path |
| Replace signed WCC | Passed via `execution_documents` replace API |
| Version history | Passed; replace created version 3 before delete/restore cycle |
| Delete signed WCC | Passed; active signed proof removed and legacy field cleared |
| Restore/upload signed WCC | Passed; active signed proof recreated and store returned to completed |
| Upload photo from Store Details | Passed; photo count increased from 2 to 3 |
| Reopen store and verify status | Passed; final status `completed` |
| `npm run check` | Passed |

## Final Data Verification

Final store `103298` status from `GET /api/operations/execution-stores?estimateId=2`:

| Metric | Value |
|---|---:|
| Status | `completed` |
| WCC count | 1 |
| DC count | 0 |
| Photo count | 3 |
| Signed WCC count | 1 |
| Document count | 4 |

Final active documents for store `103298`:

| Type | Count |
|---|---:|
| Photo | 3 |
| Signed WCC | 1 |

Final signed WCC owner check:

- Active `execution_documents` signed WCC path matches `delivery_challans.signed_challan_path`.
- Latest active signed WCC document: `id 17`
- Final store status: `completed`

## Print QA

Chromium:

- WCC preview print media is visible and nonblank.
- Generated PDF: `screenshots/execution_production_readiness/08-wcc-print-chromium.pdf`
- PDF size: 2.8 MB
- PDF page count marker: 1 page

Safari / WebKit:

- Local Playwright WebKit executable is not installed:
  - `/Users/Kunal/Library/Caches/ms-playwright/webkit-2287/pw_run.sh` missing
- True Safari Mac print dialog verification remains pending and must be run on a machine with Safari/WebKit available.

Firefox:

- Local Playwright Firefox executable is not installed.
- Firefox was not part of the requested browser matrix, but availability was checked and blocked by missing local binary.

## Screenshots / Evidence

Folder:

- `screenshots/execution_production_readiness/`

Key files:

- `01-open-estimate-register.png`
- `02-open-estimate-preview.png`
- `03-open-execution-workspace.png`
- `04-open-store-103298-details.png`
- `05-edit-wcc-editor-open.png`
- `06-wcc-save-close-return.png`
- `07-view-wcc-preview.png`
- `08-wcc-print-media-preview.png`
- `08-wcc-print-chromium.pdf`
- `09-store-before-document-cycle.png`
- `14-store-after-signed-wcc-restore.png`
- `15-store-photo-upload-complete.png`
- `document-lifecycle-result.json`

## Remaining Risks / Gaps

1. Safari print must still be manually verified on Safari Mac.
2. Existing legacy duplicate WCC records remain for store `102293`; cleanup was intentionally not performed.
3. Signed WCC restore via legacy WCC upload starts a new document chain after delete. This is acceptable for current compatibility, but future UX may want an explicit "restore as next version" action.
4. Store Details document viewer button targeting needs better UI affordances before mobile field workflow; current desktop UI works but is dense.
5. Version history includes historical duplicate/stale rows from earlier broken runs; no destructive cleanup was performed.

## Production Readiness Decision

Execution workflow is production-ready for internal ERP users in Chromium after the fixes above, except for Safari print sign-off.

Do not start Telegram until Safari print QA is completed or formally accepted as a manual follow-up.
