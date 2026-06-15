# UI Ownership Audit QA Report

Date: 2026-06-11

## Scope

Audited and verified modal / workflow ownership for:

- Estimate Preview
- PO Viewer
- WCC / DC List
- WCC Preview
- WCC Editor
- Execution Document Viewer
- Project Documents Viewer

Not included:

- Telegram
- WhatsApp
- Invoice / Payment work
- Estimate logic changes
- WCC / DC template changes
- Numbering changes
- Data cleanup

## Ownership Model

### Estimate Owner

Owner state:

- `selectedEstimate`

Allowed entry:

```text
Estimate Register -> View
```

Estimate Preview must not render while PO Viewer, WCC / DC List, WCC Preview, WCC Editor, Execution Document Viewer, or standalone editor workflows are active.

### PO Owner

Owner state:

- `poViewerEstimate`
- `poWorkflowEstimate` only for upload / replace

Allowed entries:

```text
Estimate Register -> PO Received -> PO Viewer
PO Viewer -> Replace PO -> PO Upload / Replace Modal
Estimate Register -> Upload PO -> PO Upload Modal
```

PO does not route through Estimate Preview.

### Document List Owner

Owner state:

- `documentListWorkflow`

Allowed entries:

```text
Estimate Register -> WCC -> WCC List
Estimate Register -> DC -> DC List
```

WCC / DC list uses `DeliveryChallanPanel` and does not route through Estimate Preview.

### WCC Preview Owner

Owner state:

- `selectedDcForPreview`
- `showDcPreviewModal`

Allowed entries:

```text
WCC Register -> View
WCC / DC List -> View
```

Preview is opened only through `openWccPreview(dc)`.

### WCC Editor Owner

Owner state:

- `editingDcId`
- `showDcModal`

Allowed entries:

```text
WCC Register -> Edit
WCC / DC List -> Edit
Execution Store Details -> Edit WCC
```

Editor is opened only through `openDcForEdit(dc)`.

### Document Viewer Owners

Execution document viewer:

- `executionDocumentViewer`

Project Documents viewer:

- local Project Documents viewer state
- `data-qa="project-document-viewer-modal"`

Store Details document clicks close Store Details and open the parent-owned Execution Document Viewer without leaving Estimate Preview visible behind it.

## Call-Site Findings

### Estimate Register

File:

- `client/src/pages/operations/components/EstimateBuilder.tsx`

Verified:

- Estimate number / View button call `handleViewEstimateDetails(e)`.
- PO button calls `openPoViewerForEstimate(e)` when PO exists.
- PO button calls `openPoForEstimate(e)` only when PO is missing.
- WCC / DC button calls `openDocumentListForEstimate(e, "wcc" | "dc")` when documents exist.
- WCC / DC create path calls `openNewDcForEstimate(e)` only when no existing document exists.

### Operations Page

File:

- `client/src/pages/operations/OperationsPage.tsx`

Verified owner functions:

- `openPoViewerForEstimate()`
- `openDocumentListForEstimate()`
- `openWccPreview()`
- `openDcForEdit()`

Verified render guard:

```text
Estimate Preview renders only when:
!showPoModal
!poViewerEstimate
!documentListWorkflow
!executionDocumentViewer
!showDcModal
!showDcPreviewModal
!standaloneDcEditor
```

### WCC Register / List

File:

- `client/src/pages/operations/components/DeliveryChallanPanel.tsx`

Verified:

- View delegates to `onPreview(d)`.
- Edit delegates to `onEdit(d)`.
- Print delegates to `onPrint(d)`.
- Delete operates on exact WCC / DC record id.

### Execution Workspace / Store Details

File:

- `client/src/pages/operations/components/EstimatePreview.tsx`

Verified:

- Store Details document clicks call `openExecutionDocumentViewer(doc)`.
- Store Details closes before the parent document viewer opens.
- WCC edit delegates to `openDcForEdit(primaryWcc)`.

### Project Documents

File:

- `client/src/pages/ProjectDocuments.tsx`

Verified:

- Project Documents uses its own document viewer marker:
  - `data-qa="project-document-viewer-modal"`
- It does not render Estimate Preview.

## QA Commands

```text
npm run check
node scripts/qa-ownership-audit.mjs
```

## QA Results

| Check | Result |
|---|---|
| TypeScript check | Passed |
| Estimate Register -> View opens Estimate Owner only | Passed |
| Estimate Register -> PO opens PO Owner only | Passed |
| Estimate Register -> WCC opens Document List Owner only | Passed |
| WCC Register/List -> View opens WCC Preview Owner only above list | Passed |
| WCC Register/List -> Edit opens WCC Editor Owner only above list | Passed |
| Standalone WCC Register -> View opens WCC Preview Owner only | Passed |
| Standalone WCC Register -> Edit opens WCC Editor Owner only | Passed |
| Execution Workspace -> Store Details opens Store Details owner | Passed |
| Store Details -> Document opens Document Viewer Owner without Estimate Preview | Passed |
| Project Documents -> View opens Project Document Viewer | Passed |

Browser audit summary:

```json
{ "passed": 10, "failed": 0 }
```

## Overlay Proof

Estimate Register -> View:

```json
{ "estimatePreview": 1, "poViewer": 0, "documentList": 0, "wccPreviewOrEditor": 0 }
```

Estimate Register -> PO:

```json
{ "estimatePreview": 0, "poViewer": 1, "documentList": 0, "wccPreviewOrEditor": 0 }
```

Estimate Register -> WCC:

```json
{ "estimatePreview": 0, "poViewer": 0, "documentList": 1, "wccPreviewOrEditor": 0 }
```

WCC Register/List -> View:

```json
{ "estimatePreview": 0, "poViewer": 0, "documentList": 1, "wccPreviewOrEditor": 1 }
```

WCC Register/List -> Edit:

```json
{ "estimatePreview": 0, "poViewer": 0, "documentList": 1, "wccPreviewOrEditor": 1 }
```

Standalone WCC Register -> View:

```json
{ "estimatePreview": 0, "poViewer": 0, "documentList": 0, "wccPreviewOrEditor": 1 }
```

Standalone WCC Register -> Edit:

```json
{ "estimatePreview": 0, "poViewer": 0, "documentList": 0, "wccPreviewOrEditor": 1 }
```

Store Details -> Document:

```json
{ "estimatePreview": 0, "executionDocumentViewer": 1, "storeDetails": 0 }
```

Project Documents -> View:

```json
{ "estimatePreview": 0, "projectDocumentViewer": 1 }
```

## Screenshots

Folder:

- `screenshots/ownership_audit/`

Files:

- `01-estimate-register-view-owner.png`
- `02-estimate-register-po-owner.png`
- `03-estimate-register-wcc-list-owner.png`
- `04-wcc-register-preview-owner.png`
- `05-wcc-register-edit-owner.png`
- `06-standalone-wcc-register.png`
- `07-standalone-wcc-register-preview-owner.png`
- `08-standalone-wcc-register-edit-owner.png`
- `09-execution-store-details-owner.png`
- `10-store-details-document-viewer-owner.png`
- `11-project-documents-viewer-owner.png`
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

Ownership audit passed.

Current source of truth:

```text
Estimate Preview = Estimate Owner only
PO Viewer = PO Owner only
WCC / DC List = Document List Owner only
WCC Preview = WCC Preview Owner only
WCC Editor = WCC Editor Owner only
Execution Document Viewer = Execution Document Viewer Owner only
Project Documents Viewer = Project Documents Viewer owner only
```
