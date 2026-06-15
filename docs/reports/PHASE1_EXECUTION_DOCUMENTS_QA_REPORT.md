# Phase 1 Execution Documents QA Report

Date: 2026-06-11

## Scope

Phase 1 only:

- Added `document_type` support to `delivery_challans`
- Added API-level WCC duplicate prevention
- Created `execution_documents`
- Backfilled `execution_documents` from existing Estimate / WCC / DC fields
- Added read-only Document Viewer through Project Documents

Not included:

- Telegram
- WhatsApp
- Execution tab
- Invoice readiness
- Duplicate WCC cleanup
- Removing legacy fields

## Database Changes

### `delivery_challans`

Added:

- `document_type text NOT NULL DEFAULT 'dc'`

Backfill rule:

- ABLBL / ABFRL formats became `wcc`
- Other rows remain `dc`

Current verification:

| document_type | count |
|---|---:|
| wcc | 5 |

### `execution_documents`

Created additive table:

- `id`
- `estimate_id`
- `delivery_challan_id`
- `store_code`
- `document_type`
- `file_path`
- `original_file_name`
- `mime_type`
- `file_size`
- `status`
- `version`
- `uploaded_by`
- `uploaded_via`
- `uploaded_at`
- `replaced_by_document_id`
- `deleted_at`
- `deleted_by`
- `metadata`
- `created_at`
- `updated_at`

Indexes created:

- `idx_execution_documents_estimate`
- `idx_execution_documents_dc`
- `idx_execution_documents_store`
- `idx_execution_documents_type`

## Backfill Verification

Current `execution_documents` counts:

| document_type | status | count |
|---|---|---:|
| photo | active | 10 |
| po | active | 1 |

Sample mapped records:

- PO from `estimates.poFilePath` for `SM/E/26-27/201`
- Photo records from WCC `metadata.photos[]`
- Store codes preserved for WCC photo records
- Upload source marked as `migration`

Legacy fields were not removed:

- `estimates.poFilePath`
- `delivery_challans.photoPath`
- `delivery_challans.signedChallanPath`
- `delivery_challans.transportReceiptPath`
- `delivery_challans.extraDocPath`
- `delivery_challans.metadata.photos`

## WCC Duplicate Prevention

API-level guard added to:

- `POST /api/operations/delivery-challans`
- `PATCH /api/operations/delivery-challans/:id`

Rule:

```text
estimate_id
+ store_code / metadata.storeCode / metadata.storeId
+ document_type = wcc
+ active record
```

Verification test:

- Attempted to POST a duplicate WCC using an existing WCC payload and new number.
- API returned existing WCC instead of creating a new record.
- Before count: 5
- After count: 5
- Response: `WCC already exists for this store`
- `duplicatePrevented: true`

No duplicate cleanup was performed.

## Document Viewer

Read-only viewer added to Project Documents.

Reads from:

- `GET /api/operations/execution-documents`

Fallback:

- Existing Project Documents page still has legacy aggregation fallback if the new endpoint returns no documents.

Actions available:

- View
- Open in new tab
- Download

Not implemented yet:

- Replace
- Delete
- Version management UI

## Screenshots

- `screenshots/phase1_execution_documents/01-project-documents-execution-docs.png`
- `screenshots/phase1_execution_documents/02-document-viewer-read-only.png`
- `screenshots/phase1_execution_documents/screenshot-result.json`

## QA Results

Passed:

- `npm run check`
- API returns `documentType` on delivery challans
- API returns `execution_documents`
- Startup migration is idempotent
- Backfill did not remove legacy fields
- Duplicate WCC POST did not create a new record
- Project Documents renders execution documents
- Read-only Document Viewer opens for a photo record

Known existing data condition:

- There are still 5 active WCC records for 2 visible register rows.
- Duplicate WCC cleanup was intentionally not performed in Phase 1.

## Phase 1 Status

Complete.

