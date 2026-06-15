# Sprint 2 Execution Operational QA Report

Date: 2026-06-11

## Scope

Sprint 2 only:

- Converted the Execution workspace from read-only to operational.
- Added store-level details from the Execution workspace.
- Added per-store actions using existing WCC logic.
- Added document replace, soft delete, and version history for `execution_documents`.
- Added the same document actions to the existing Project Documents viewer.
- Kept derived execution status read-only.

Not included:

- Telegram
- WhatsApp
- Invoice readiness
- Payment workflow
- New WCC generation logic
- Duplicate WCC cleanup
- Estimate Builder changes
- WCC/DC template changes
- Estimate calculations or numbering changes

## Backend Changes

### `execution_documents` APIs

Added:

```text
GET /api/operations/execution-documents/:id/versions
POST /api/operations/execution-documents/:id/replace
DELETE /api/operations/execution-documents/:id
```

Behaviour:

- Replace marks the old document as `replaced`.
- Replace creates a new active document with incremented `version`.
- Replace preserves the same estimate, store, delivery challan, and document type ownership.
- Delete is soft delete only: `status = deleted`, `deleted_at`, `deleted_by`.
- Version history is read from the root document chain.

Legacy fields were not removed or rewritten:

- `estimates.poFilePath`
- `delivery_challans.photoPath`
- `delivery_challans.signedChallanPath`
- `delivery_challans.metadata.photos`

### Execution Status

Execution status is derived from current data:

| Data Condition | Status |
|---|---|
| No photos / WCC / signed proof | `pending` |
| Photos only | `photos_uploaded` |
| WCC or DC exists | `wcc_generated` |
| Signed WCC/DC exists without generated doc link | `signed_wcc_received` |
| Generated doc plus signed proof | `completed` |

No manual status editing was added.

## Frontend Changes

### Estimate Preview -> Execution Workspace

The Execution table now includes a `Details` action per store.

Clicking a store opens Store Details with:

- Photos
- Delivery Challan
- WCC
- Signed WCC
- Documents
- Activity

Per-store actions:

- View Photos
- Upload Photos
- View WCC
- Edit WCC
- Print WCC
- Upload Signed WCC
- View Documents

WCC actions reuse existing callbacks:

- Existing WCC preview path
- Existing WCC edit path
- Existing WCC print path
- Existing signed-WCC upload field patch path

No new WCC generation logic was created.

### Document Viewer

Added to Execution document viewer:

- History
- Replace
- Delete
- Open
- Download

Added the same actions to the existing Project Documents viewer so the old page keeps working during transition.

## Verification Snapshot

Authenticated API checks:

| Check | Result |
|---|---|
| `GET /api/operations/execution-stores?estimateId=2` | 3 stores |
| Store statuses for estimate 2 | `pending`, `wcc_generated`, `wcc_generated` |
| Active execution docs for estimate 2 | 11 |
| Version API for first document | 1 version |

Existing data condition remains:

- `SM/E/26-27/201` still has duplicate WCC rows from legacy data.
- Duplicate cleanup was intentionally not performed.

## Screenshots

- `screenshots/sprint2_execution_operational/01-execution-workspace-actions.png`
- `screenshots/sprint2_execution_operational/02-store-details-modal-populated.png`
- `screenshots/sprint2_execution_operational/03-execution-document-viewer-actions.png`
- `screenshots/sprint2_execution_operational/04-project-documents-version-actions.png`
- `screenshots/sprint2_execution_operational/03-document-viewer-result.json`

Screenshot evidence confirms:

- Execution workspace shows store-level Details actions.
- Store Details opens for populated store `102293`.
- Photos, WCC, Documents, and Activity are visible.
- WCC action buttons are visible.
- Document viewer shows History, Replace, Delete, and Download.
- Project Documents viewer also shows History, Replace, Delete, and Download.

## Navigation Flow

```text
Sales
-> Estimate Register
-> View Estimate
-> Execution section
-> Details
-> Store Details
-> Photos / WCC / Documents / Activity
```

Document flow:

```text
Store Details
-> Documents
-> View
-> Document Viewer
-> History / Replace / Delete / Download
```

WCC flow:

```text
Store Details
-> WCC
-> View WCC / Edit WCC / Print WCC / Upload Signed WCC
```

## QA Results

Passed:

- `npm run check`
- Store Details opens from Execution workspace.
- Store details display the required sections.
- WCC buttons reuse existing WCC preview/edit/print/upload flows.
- Project Documents remains available.
- Document viewer has Replace, Delete, and Version History actions.
- Delete is soft delete.
- Replace creates a new version instead of overwriting the old document.
- Execution statuses are derived, not manually edited.

Not changed:

- Estimate Builder
- Estimate calculations
- Brand-specific formats
- WCC templates
- DC templates
- Existing numbering
- Existing WCC Register
- Existing Project Documents route

## Remaining Gaps Before Telegram Integration

1. Build mobile-friendly field upload route.
2. Add signed, expiring field access links.
3. Map field uploads directly to estimate + store + document type.
4. Add upload-only permissions for field users.
5. Add document replacement/version history UX for mobile.
6. Add activity log table for richer audit trail.
7. Add duplicate WCC cleanup plan after user approval.
8. Add invoice readiness rules after execution requirements are finalized.

## Sprint 2 Status

Complete.
