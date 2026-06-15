# UI Consistency Pass QA Report

Date: 2026-06-11

## Scope

UI consistency pass only.

Checked:

- Estimate Register
- Project Dashboard
- WCC Register
- PO tab
- Execution tab
- Documents tab
- Invoice tab
- Store Details modal
- Project Documents viewer
- Escape-to-close behavior

Not included:

- New features
- Telegram / WhatsApp work
- Estimate logic changes
- WCC / DC template changes
- Numbering changes
- Data cleanup

## Fixes Applied

### Duplicate Workflows Removed

Removed obsolete standalone estimate-register overlays:

- Standalone PO Viewer overlay
- Standalone estimate-scoped WCC/DC List overlay

Current register ownership:

```text
Estimate Register -> Project Dashboard
Estimate Register -> PO -> Project Dashboard / PO tab
Estimate Register -> WCC/DC -> Project Dashboard / Execution tab
```

Compatibility pages remain:

- WCC Register
- Project Documents

### Dashboard Consistency

Project Dashboard remains the owner for estimate lifecycle tabs:

- Overview
- PO
- Execution
- Documents
- Invoice

Removed Telegram field-link controls from the dashboard UI for this pass. Existing field upload APIs/routes were not removed.

### Compact Buttons / Modals

Updated PO upload/replace modal to match the compact modal pattern:

- Dark compact header
- Smaller form controls
- Smaller action buttons
- Consistent rounded radius
- Footer action bar

WCC Register action buttons remain compact and table-scoped.

### Escape Behavior

Fixed Store Details Escape bubbling.

Before:

```text
Escape on Store Details could also close Project Dashboard
```

After:

```text
Escape closes Store Details only
Second Escape closes Project Dashboard
```

## QA Commands

```text
npm run check
node scripts/qa-ui-consistency-pass.mjs
```

## QA Results

| Check | Result |
|---|---|
| TypeScript check | Passed |
| Estimate Register visible | Passed |
| Project opens one dashboard and no legacy overlay | Passed |
| PO tab visible and compact | Passed |
| Execution tab visible | Passed |
| Store Details opens as top internal modal | Passed |
| Escape closes topmost Store Details only | Passed |
| Documents tab visible | Passed |
| Invoice tab visible | Passed |
| Escape closes Project Dashboard | Passed |
| Register PO opens dashboard, not old PO viewer | Passed |
| Register WCC opens dashboard, not old document list | Passed |
| WCC Register visible | Passed |
| WCC Register View opens only WCC modal | Passed |
| Escape closes WCC Preview | Passed |
| Project Documents opens its own viewer only | Passed |

Browser smoke summary:

```json
{ "passed": 15, "failed": 0 }
```

## Overlay Verification

Project Dashboard:

```json
{
  "dashboard": 1,
  "oldPoViewer": 0,
  "oldDocList": 0,
  "wccModal": 0
}
```

Register PO:

```json
{
  "dashboard": 1,
  "oldPoViewer": 0
}
```

Register WCC:

```json
{
  "dashboard": 1,
  "oldDocList": 0
}
```

Store Details:

```json
{
  "dashboard": 1,
  "storeDetails": 1
}
```

After Escape on Store Details:

```json
{
  "dashboard": 1,
  "storeDetails": 0
}
```

WCC Register Preview:

```json
{
  "dashboard": 0,
  "wccModal": 1,
  "oldDocList": 0
}
```

Project Documents Viewer:

```json
{
  "dashboard": 0,
  "projectDocViewer": 1
}
```

## Screenshots

Folder:

- `screenshots/ui_consistency_pass/`

Files:

- `01-estimate-register.png`
- `02-project-dashboard-overview.png`
- `03-po-tab.png`
- `04-execution-tab.png`
- `05-store-details-modal.png`
- `06-documents-tab.png`
- `07-invoice-tab.png`
- `08-register-po-to-dashboard.png`
- `09-register-wcc-to-dashboard.png`
- `10-wcc-register.png`
- `11-wcc-preview-modal.png`
- `12-project-documents.png`
- `13-project-document-viewer.png`
- `qa-result.json`

## Preserved

- Estimate numbering
- Estimate calculations
- BOQ logic
- Brand-specific formats
- WCC templates
- DC templates
- Existing document numbering
- Current execution data
- Existing WCC Register
- Existing Project Documents route

## Status

Complete.
