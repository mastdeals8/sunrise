# Project Dashboard ERP Flow QA Report

Date: 2026-06-11

## Scope

Re-engineered the estimate lifecycle entry point into one ERP project flow:

```text
Estimate Register
-> Project Dashboard
-> Overview / PO / Execution / Documents / Invoice
```

This is a UI/workflow ownership refactor. It does not replace estimate generation, WCC/DC templates, numbering, or execution document storage.

Not changed:

- Estimate numbering
- Estimate calculations
- BOQ logic
- Brand-specific formats
- WCC templates
- DC templates
- Existing WCC print renderer
- Existing WCC upload/update APIs
- Existing execution documents model
- Existing field upload APIs

## Architecture

### Project Dashboard Owner

Owner:

- `selectedEstimate`
- `projectDashboardInitialTab`

Dashboard tabs:

- Overview
- PO
- Execution
- Documents
- Invoice

Primary flow:

```text
Estimate Register
-> Project Dashboard
-> PO
-> Execution
-> Documents
-> Invoice
```

### Register Routing

Estimate Register actions now converge into the same Project Dashboard:

| Register Action | Result |
|---|---|
| Project | Opens Project Dashboard -> Overview |
| PO Received | Opens Project Dashboard -> PO |
| Upload PO | Opens existing PO upload modal, then returns to Project Dashboard -> PO |
| WCC / DC | Opens Project Dashboard -> Execution |
| Invoice | Existing invoice editor remains available from the Invoice tab |

Standalone PO Viewer and standalone WCC/DC List are no longer the primary estimate-register lifecycle flow.

### Existing Workflow Reuse

PO tab:

- Uses existing estimate PO fields.
- Uses existing PO replace modal.
- Does not create a new PO entity.

Execution tab:

- Uses existing execution store API.
- Uses existing WCC/DC records.
- Store Details uses existing upload/update handlers.
- View/Edit/Print WCC still route into existing WCC preview/editor/print logic.

Documents tab:

- Uses existing PO path, WCC/DC files, signed WCC/DC files, photo proof, transport receipts, and extra docs.
- Does not create another document system.

Invoice tab:

- Shows readiness from existing PO/execution/signed-WCC/invoice data.
- Uses existing invoice editor callback.
- Does not change invoice numbering or invoice persistence.

Field upload:

- Existing secure field upload route remains:

```text
/field/:token
```

- Existing API remains:

```text
GET /api/field/:token
POST /api/field/:token/upload
```

- Uploads continue attaching through `execution_documents` and legacy WCC owner sync where applicable.

## Files Changed

- `client/src/pages/operations/OperationsPage.tsx`
- `client/src/pages/operations/components/EstimateBuilder.tsx`
- `client/src/pages/operations/components/EstimatePreview.tsx`
- `scripts/qa-project-dashboard-flow.mjs`

## QA Commands

```text
npm run check
node scripts/qa-project-dashboard-flow.mjs
```

## QA Results

| Check | Result |
|---|---|
| TypeScript check | Passed |
| Estimate Register -> Project opens Project Dashboard | Passed |
| Project Dashboard PO tab shows PO controls | Passed |
| Project Dashboard Execution tab shows store workflow | Passed |
| Project Dashboard Documents tab shows project files | Passed |
| Project Dashboard Invoice tab shows readiness | Passed |
| Estimate Register -> PO opens Project Dashboard, not standalone PO Viewer | Passed |
| Estimate Register -> WCC opens Project Dashboard Execution, not standalone list | Passed |

Browser smoke summary:

```json
{ "passed": 7, "failed": 0 }
```

## Screenshots

Folder:

- `screenshots/project_dashboard_flow/`

Files:

- `01-estimate-register.png`
- `02-project-dashboard-overview.png`
- `03-project-dashboard-po-tab.png`
- `04-project-dashboard-execution-tab.png`
- `05-project-dashboard-documents-tab.png`
- `06-project-dashboard-invoice-tab.png`
- `07-register-po-opens-dashboard-po.png`
- `08-register-wcc-opens-dashboard-execution.png`
- `qa-result.json`

## Compatibility Notes

- WCC Register still works as a standalone compatibility page.
- Project Documents still works as a standalone compatibility page.
- Existing PO upload modal remains the replace/upload mechanism.
- Existing WCC editor and WCC preview remain the only WCC editing/printing mechanisms.
- Existing field upload page remains upload-only and does not expose pricing, admin, invoice, or estimate-builder data.

## Remaining Risks

1. The Project Dashboard now owns the lifecycle, but some legacy standalone pages still exist for compatibility and should be gradually demoted in navigation.
2. Invoice readiness is currently a UI-derived indicator. A server-side readiness endpoint should be added before hard-blocking invoice generation.
3. Field links already exist, but project-dashboard link management needs a fuller list/revoke/history UI.
4. Safari print verification remains a separate manual QA item.

## Status

Project Dashboard ERP flow is implemented and verified for current records.

Current lifecycle:

```text
Estimate Register -> Project Dashboard -> Overview / PO / Execution / Documents / Invoice
```
