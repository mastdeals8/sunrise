# Sprint 1 Execution Workspace QA Report

Date: 2026-06-11

## Scope

Sprint 1 only:

- Created additive `execution_stores` table.
- Backfilled execution stores from existing estimate store grouping.
- Added read-only `GET /api/operations/execution-stores`.
- Added read-only Execution workspace inside Estimate Preview.
- Displayed store-level status, WCC count, DC count, photo count, and signed WCC status.

Not included:

- Telegram
- WhatsApp
- Invoice readiness
- Payment workflow
- WCC/DC template changes
- Estimate Builder changes
- Duplicate WCC cleanup
- New numbering systems

## Database Changes

### `execution_stores`

Created additive table:

- `id`
- `estimate_id`
- `store_id`
- `store_code`
- `store_name`
- `store_location`
- `store_city`
- `store_state`
- `store_address`
- `status`
- `source`
- `metadata`
- `created_at`
- `updated_at`

Indexes created:

- `idx_execution_stores_estimate_store`
- `idx_execution_stores_estimate`
- `idx_execution_stores_status`

Unique rule:

```text
estimate_id
+ lower(store_code)
```

This is scoped only to `execution_stores`. Existing WCC/DC duplicate records were not cleaned or removed.

## Backfill Rules

Primary source:

- `estimates.store_grouping`

Fallback sources:

- `delivery_challans.metadata.storeCode`
- `delivery_challans.store_code`
- `estimates.store_id` only when no store grouping exists

Rejected fallback:

- Estimate item fallback rows are not created when official `store_grouping` exists.
- A temporary fallback row with no WCC/document activity was removed from `execution_stores` during QA correction.

## Migration Verification

Current `execution_stores` counts:

| Estimate ID | Stores |
|---:|---:|
| 2 | 3 |
| 3 | 20 |

Status counts:

| Status | Count |
|---|---:|
| documents_generated | 2 |
| pending_execution | 21 |

Sample rows:

| Estimate ID | Store Code | Store Name | Status | Source |
|---:|---|---|---|---|
| 2 | 101387 | Vaglo-Mg Rd-Goa, Panaji | pending_execution | estimate_store_grouping |
| 2 | 102293 | ICC Mall Pune | documents_generated | estimate_store_grouping |
| 2 | 103298 | Laxmi Road, Pune | documents_generated | estimate_store_grouping |
| 3 | 101073 | Singhad Rd, Pune | pending_execution | estimate_store_grouping |
| 3 | 102293 | ICC Mall Pune | pending_execution | estimate_store_grouping |

Existing Phase 1 data remains unchanged:

| Table | Verification |
|---|---|
| `delivery_challans` | 5 active `wcc` records remain |
| `execution_documents` | 10 active photos, 1 active PO |

## API Verification

Endpoint:

```text
GET /api/operations/execution-stores?estimateId=:id
```

Results:

| Estimate | Expected Stores | API Rows | Result |
|---|---:|---:|---|
| SM/E/26-27/201 | 3 | 3 | Passed |
| SM/E/26-27/202 | 20 | 20 | Passed |

Performance after removing per-request backfill:

| Estimate ID | Response |
|---:|---:|
| 2 | 821 ms |
| 3 | 200 ms |

## UI / Navigation Flow

Navigation:

```text
Sales
-> Estimate Register
-> View Estimate
-> Estimate Preview modal
-> Execution section
```

Execution workspace is read-only and shows:

- Store Code
- Store Name
- Status
- Photo Count
- DC Count
- WCC Count
- Signed WCC Status
- Visible linked WCC/photo records

No create/edit/delete workflow was added in Sprint 1.

## Screenshots

- `screenshots/sprint1_execution_workspace/01-estimate-execution-workspace-populated.png`
- `screenshots/sprint1_execution_workspace/02-estimate-execution-workspace-pending.png`
- `screenshots/sprint1_execution_workspace/screenshot-result.json`

Screenshot DOM checks:

| Check | Result |
|---|---|
| Execution section visible for `SM/E/26-27/201` | Passed |
| Documents Generated status visible | Passed |
| Stores 3 visible | Passed |
| Photo/WCC/Signed WCC visibility | Passed |
| Execution section visible for `SM/E/26-27/202` | Passed |
| Pending Execution visible | Passed |
| Stores 20 visible | Passed |

## QA Results

Passed:

- `npm run check`
- Startup migration created `execution_stores`
- Backfill is idempotent
- Store counts match official estimate store grouping
- Existing WCC/DC records were not removed
- Existing estimate numbering was not changed
- Existing WCC/DC templates were not changed
- Existing invoice behavior was not changed
- Read-only Execution section renders inside Estimate Preview
- Store-level WCC/photo/signed WCC visibility works from existing data

Known existing data condition:

- `SM/E/26-27/201` still has 5 active WCC records for 2 stores.
- This is legacy duplicate WCC data from before server-side duplicate prevention.
- Duplicate cleanup was intentionally not performed.

## Sprint 1 Status

Complete.
