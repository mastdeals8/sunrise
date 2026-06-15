# APPROVAL_WORKFLOW_REPORT — Phase 3 — 12 June 2026

## Design
Approvals are recorded as immutable audit-trail entries (action `approve`/`reject`) — the permanent who/when record — and, for estimates, also move the record through its **existing** status vocabulary (`approved`/`rejected`) so current UI filters keep working. No new status strings, no numbering/template changes.

## Role chains (configurable)
Stored in app_settings key `approval_rules`, editable by admins via `PUT /api/approvals/rules`:
```
estimate → roles: [manager, admin]
po       → roles: [admin, manager]
invoice  → roles: [accounts, admin]
enforce  → false   (gate is advisory until you flip this)
```
`enforce:false` means approval is *recorded and permission-checked* but not yet *blocking* downstream actions — deliberate, so turning approvals on doesn't freeze an in-flight pipeline. Flip to true (and wire the gate into estimate→PO→invoice transitions) when your team is ready; that wiring is a small, isolated follow-up.

## Endpoints
- `POST /api/approvals/:kind/:id/:decision` — kind ∈ estimate|po|invoice, decision ∈ approve|reject
- `GET /api/approvals/:kind/:id` — approval history (from audit log)
- `GET|PUT /api/approvals/rules` — view/update chains (PUT is admin-only)

## Verified live
- Admin approved estimate → status became `approved`, history row recorded with username/role.
- Designer (not in chain) → **403** "requires role: manager/admin".
- PO approval (recorded in trail; PO data already lives on the estimate) → 200.
- Invoice approval → 200.

## Honest limitations
- PO "approval" is a trail entry only — there's no separate PO entity in this ERP (PO = poNumber/poFilePath on the estimate), so there's nothing to status-flip. This is correct for the current data model.
- Multi-step chains (e.g. manager→then→admin) aren't modelled; it's single-decision-per-role. Sufficient for current team size; expandable later.
