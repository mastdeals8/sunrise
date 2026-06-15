# WCC Duplicate Visibility And Cleanup QA Report

Date: 2026-06-11

## Scope

Fixed WCC Register duplicate visibility and performed approved duplicate WCC cleanup.

Not included:

- Estimate logic changes
- WCC template changes
- DC template changes
- Numbering changes
- Telegram / WhatsApp
- Invoice / Payment changes

## Problem

The WCC Register was suppressing duplicate WCC records by store, so the UI showed only one row per store.

Existing active WCC records before cleanup:

| ID | WCC Number | Store | Status |
|---:|---|---|---|
| 1 | `SM/DC/26-27/101` | `102293` | draft |
| 2 | `SM/DC/26-27/102` | `102293` | draft |
| 3 | `SM/DC/26-27/103` | `102293` | draft |
| 4 | `DC-776061` | `102293` | draft |
| 5 | `SM/DC/26-27/104` | `103298` | draft |

## Fixes Applied

### WCC Register Visibility

File:

- `client/src/pages/operations/components/DeliveryChallanPanel.tsx`

Changed:

- Removed store-level WCC row suppression.
- One row now equals one WCC/DC record.
- WCC Register now displays every active WCC record.

### Duplicate Detection

Duplicate key:

```text
estimate_id + store_code + document_type
```

Rule:

- Latest WCC in each group is marked `Active`.
- Older WCCs in the same group are marked `Duplicate`.

### Register Columns

WCC/DC table now shows:

- WCC/DC Number
- Estimate
- Store Code
- Store
- Status
- Created Date
- Active / Duplicate
- Actions

Actions:

- Edit
- View
- Print
- Delete

Delete operates on the exact WCC/DC record ID.

### Bulk Cleanup

Added:

```text
Delete Duplicate WCCs
```

Cleanup soft-deletes only duplicate WCC record IDs and leaves the latest WCC per estimate/store active.

### Print Button Styling

File:

- `client/src/pages/operations/components/WccDcEditor.tsx`

Fixed:

- Replaced invalid `bg-orange-650` class with valid `bg-orange-600 hover:bg-orange-500`.
- `Print Current Store` is now readable.

## Cleanup Performed

Soft-deleted duplicate WCC records:

| ID | WCC Number | Result |
|---:|---|---|
| 1 | `SM/DC/26-27/101` | deleted |
| 2 | `SM/DC/26-27/102` | deleted |
| 3 | `SM/DC/26-27/103` | deleted |

Remaining active WCC records:

| ID | WCC Number | Store | Active/Duplicate |
|---:|---|---|---|
| 4 | `DC-776061` | `102293` | Active |
| 5 | `SM/DC/26-27/104` | `103298` | Active |

## QA Results

Commands:

```text
npm run check
node scripts/qa-wcc-duplicate-cleanup.mjs
```

Results before cleanup:

| Check | Result |
|---|---|
| 5 WCC rows visible | Passed |
| Duplicate rows visible | Passed |
| Delete action available per row | Passed |

Final database verification:

```json
[
  { "id": 5, "dcNumber": "SM/DC/26-27/104", "status": "draft", "store": "103298" },
  { "id": 4, "dcNumber": "DC-776061", "status": "draft", "store": "102293" },
  { "id": 3, "dcNumber": "SM/DC/26-27/103", "status": "deleted", "deleted": true, "reason": "duplicate_wcc_cleanup" },
  { "id": 2, "dcNumber": "SM/DC/26-27/102", "status": "deleted", "deleted": true, "reason": "duplicate_wcc_cleanup" },
  { "id": 1, "dcNumber": "SM/DC/26-27/101", "status": "deleted", "deleted": true, "reason": "manual_test_cleanup" }
]
```

Note:

- ID `1` was soft-deleted through the same PATCH API during manual verification after the browser cleanup click failed to persist.
- IDs `2` and `3` were soft-deleted through the same PATCH API with `duplicate_wcc_cleanup`.

## Screenshots

Folder:

- `screenshots/wcc_duplicate_cleanup/`

Files:

- `01-before-cleanup-5-wcc-rows.png`
- `03-after-cleanup-completed-final.png`
- `qa-result.json`

## Preserved

- Existing WCC templates
- Existing DC templates
- Existing estimate numbering
- Existing WCC numbering
- Existing estimate calculations
- Existing brand formats

## Status

Complete.
