# UI Workflow Stabilization QA Report

Date: 2026-06-11

## Scope

Fixed navigation ownership for current Estimate Register document actions.

Not included:

- Telegram
- WhatsApp
- Invoice readiness
- Payment changes
- Estimate Builder redesign
- Estimate numbering changes
- Brand format changes
- WCC / DC template changes
- Execution data migration or cleanup

## Root-Cause Trace

Incorrect flow before this fix:

```text
Estimate Register -> PO button -> handleViewEstimateDetails(e) -> selectedEstimate -> Estimate Preview / Visual Changeover
Estimate Register -> WCC/DC button with existing docs -> handleViewEstimateDetails(e) -> selectedEstimate -> Estimate Preview / Visual Changeover
```

Root cause:

- The PO action in `EstimateBuilder` called `handleViewEstimateDetails(e)` for both existing PO and upload PO.
- The WCC/DC action in `EstimateBuilder` called `handleViewEstimateDetails(e)` whenever a document already existed.
- `handleViewEstimateDetails()` owns Estimate Preview by setting `selectedEstimate`.
- Therefore PO/WCC/DC were still routed through Visual Changeover even after modal stacking was improved.

## Ownership Refactor

Estimate Preview is now owned only by:

```text
Estimate Register -> View
```

PO is now owned by standalone PO workflow state:

```text
Estimate Register -> PO -> PO Viewer
PO Viewer -> Replace PO -> PO Upload / Replace Modal
```

WCC/DC are now owned by standalone document-list workflow state:

```text
Estimate Register -> WCC -> WCC List
Estimate Register -> DC -> DC List
```

The standalone WCC/DC list reuses:

- Existing `DeliveryChallanPanel`
- Existing WCC preview logic
- Existing WCC edit logic
- Existing WCC print logic
- Existing upload/delete paths

## Code Changes

### Estimate Register Actions

File:

- `client/src/pages/operations/components/EstimateBuilder.tsx`

Changed:

- Existing PO now calls `openPoViewerForEstimate(e)`.
- Missing PO now calls `openPoForEstimate(e)`.
- Existing WCC/DC now calls `openDocumentListForEstimate(e, "wcc" | "dc")`.
- New WCC/DC still uses the existing WCC/DC creation logic.
- `handleViewEstimateDetails(e)` remains only for the View action.

### Operations Ownership

File:

- `client/src/pages/operations/OperationsPage.tsx`

Added standalone state:

- `poWorkflowEstimate`
- `poViewerEstimate`
- `documentListWorkflow`
- `standaloneDcEditor`

Added standalone overlays:

- PO Viewer: `data-qa="po-viewer-modal"`
- WCC/DC List: `data-qa="document-list-modal"`

Estimate Preview render guard now prevents Visual Changeover from rendering while PO or WCC/DC workflows are active.

## QA Results

Commands:

```text
npm run check
node scripts/qa-ui-workflow-stabilization.mjs
```

Results:

| Check | Result |
|---|---|
| TypeScript check | Passed |
| Estimate register opens | Passed |
| Estimate Register -> PO opens PO Viewer directly | Passed |
| Escape closes PO Viewer | Passed |
| Estimate Register -> WCC opens WCC List directly | Passed |
| Escape closes WCC List | Passed |
| Estimate Register -> View opens Estimate Preview | Passed |
| Escape closes Estimate Preview | Passed |
| WCC Edit from standalone list opens WCC editor only | Passed |
| Escape closes WCC editor | Passed |

## Overlay Verification

PO click:

```json
{ "estimate": 0, "po": 0, "poViewer": 1, "docList": 0, "wcc": 0, "internal": 0 }
```

WCC click:

```json
{ "estimate": 0, "po": 0, "poViewer": 0, "docList": 1, "wcc": 0, "internal": 0 }
```

View click:

```json
{ "estimate": 1, "po": 0, "poViewer": 0, "docList": 0, "wcc": 0, "internal": 0 }
```

WCC Edit from standalone list:

```json
{ "estimate": 0, "po": 0, "poViewer": 0, "docList": 1, "wcc": 1, "internal": 0 }
```

## Screenshots

Folder:

- `screenshots/ui_workflow_stabilization/`

Current proof files:

- `01-estimate-register.png`
- `02-po-opens-directly.png`
- `03-wcc-list-opens-directly.png`
- `04-view-opens-estimate-preview.png`
- `05-wcc-edit-from-standalone-list.png`
- `qa-result.json`

## DC Verification Note

Current database snapshot has no active normal DC records:

```json
{ "total": 5, "normal": 0 }
```

Because there is no real normal DC estimate row in the current data, a live screenshot of:

```text
Estimate Register -> DC List
```

cannot be produced without creating new DC data. The DC path is implemented through the same standalone `openDocumentListForEstimate(e, "dc")` ownership path used by WCC, but no sample DC record exists to click in the current database.

No sample data was created and no duplicate cleanup was performed.

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
- Existing Project Documents

## Status

Navigation ownership fixed for real current records:

```text
View -> Estimate Preview
PO -> PO Viewer
WCC -> WCC List
```

DC standalone ownership is implemented and awaits a real normal DC record for screenshot proof.
