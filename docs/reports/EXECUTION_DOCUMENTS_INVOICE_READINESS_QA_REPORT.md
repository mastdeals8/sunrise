# Execution Documents Invoice Readiness QA Report

Date: 2026-06-11

## Scope

Sprint only:

- Execution tab polish.
- Documents tab polish.
- Read-only invoice readiness engine.

Not included:

- New architecture.
- New pages or modules.
- Invoice generation.
- Payment, WhatsApp, or Telegram enhancements.
- Estimate numbering changes.
- WCC/DC template changes.
- Brand format changes.
- Execution ownership changes.

## Execution Tab

Execution remains inside:

```text
Estimate Register
-> Project Dashboard
-> Execution
```

Polished:

- Summary cards: Stores, Completed, Pending, WCC Generated, Signed WCC Received, Photos Uploaded.
- Store table columns: Store Code, Store Name, Photos, WCC Status, Signed WCC Status, Last Activity, Last Updated, Execution Status.
- Row actions: Open, View WCC, Edit WCC, Print WCC, Upload Signed, Upload Photos.
- Status colors: Pending, In Progress, Completed, Blocked.

No WCC/DC generation logic or templates were changed.

## Documents Tab

Documents remains inside:

```text
Estimate Register
-> Project Dashboard
-> Documents
```

Polished:

- Grouped sections: PO, Photos, WCC, Signed WCC, Transport, Extra, Delivery Challan.
- Filters: Store and Document Type.
- Row columns: File Name, Store, Type, Version, Uploaded By, Uploaded Date.
- Actions: View, Download, Replace, History, Delete.

Notes:

- Uploaded files use existing `execution_documents`.
- Generated WCC/DC records remain existing challan records and use existing view/delete paths.
- No duplicate document system was created.

## Invoice Readiness

Invoice remains inside:

```text
Estimate Register
-> Project Dashboard
-> Invoice
```

Read-only checklist:

| Rule | Source |
|---|---|
| PO Attached | Existing estimate PO fields |
| WCC Generated | Existing execution store WCC/DC stats |
| Signed WCC Received | Existing execution store signed WCC/DC stats |
| Photos Uploaded | Existing execution store photo stats |
| Execution Complete | Existing derived store completion |

No invoice generation or blocking logic was added.

## Readiness Examples

Current data has no invoice-ready project.

| Estimate | Stores | WCC Generated | Signed WCC | Photos | Completed | Ready |
|---|---:|---:|---:|---:|---:|---|
| `SM/E/26-27/202` | 20 | 0 | 0 | 0 | 0 | No |
| `SM/E/26-27/201` | 3 | 2 | 1 | 2 | 1 | No |

Ready Project example:

- Skipped because no current record satisfies all readiness checks.

Not Ready Project examples:

- `SM/E/26-27/202`
- `SM/E/26-27/201`

## QA

Commands:

```text
npm run check
node scripts/qa-execution-documents-invoice-readiness.mjs
```

Results:

| Check | Result |
|---|---|
| TypeScript check | Passed |
| Estimate Register -> Project Dashboard -> Execution | Passed |
| Estimate Register -> Project Dashboard -> Documents | Passed |
| Estimate Register -> Project Dashboard -> Invoice | Passed |
| Invoice tab is readiness-only | Passed |
| Not ready project example found | Passed |
| Ready project example | Skipped, no ready project exists in current data |

## Screenshots

Folder:

- `screenshots/execution_documents_invoice_readiness/`

Files:

- `01-estimate-register.png`
- `02-project-dashboard-execution-polished.png`
- `03-project-dashboard-documents-polished.png`
- `04-project-dashboard-invoice-readiness.png`
- `06-not-ready-project-invoice-example.png`
- `qa-result.json`

## Files Changed

- `client/src/pages/operations/components/EstimatePreview.tsx`
- `client/src/pages/operations/OperationsPage.tsx`
- `scripts/qa-execution-documents-invoice-readiness.mjs`

## Preserved

- Estimate numbering.
- Estimate calculations.
- BOQ logic.
- Brand-specific formats.
- WCC templates.
- DC templates.
- Existing document numbering.
- Current execution ownership.
- Existing WCC print and upload paths.

## Status

Complete.

