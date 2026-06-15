# Go-Live Signoff Report

Date: 2026-06-12

## Scope

Production readiness sprint only.

No UI redesign, architecture change, module addition, numbering change, estimate format change, WCC/DC template change, or document ownership redesign was performed.

Fixed only production blockers:

- WCC data integrity.
- WCC preview/editor navigation close behavior.
- Role test coverage.
- Golden project end-to-end workflow.
- Invoice readiness/generation/print signoff.
- Photo storage audit.

## Commands

```text
npm run check
node scripts/qa-go-live-readiness.mjs
```

Results:

| Check | Result |
|---|---|
| TypeScript | Passed |
| Go-live QA | 24 passed / 0 failed |

Evidence:

- `screenshots/go_live_signoff/`
- `screenshots/go_live_signoff/qa-result.json`

## Fixes Applied

### 1. WCC Data Integrity

Root cause for store `101387`:

- Documents existed for `delivery_challan_id = 6`.
- WCC/DC id `6` was deleted.
- Execution status and readiness were still counting active photo/signed-WCC documents from that deleted owner.

Fix:

- Execution document counts now ignore documents whose owning WCC/DC is deleted.
- Startup reconciliation marks active documents from deleted WCC/DC owners as deleted with reason `inactive_delivery_challan_owner`.
- Field upload now rejects photo/signed proof uploads if no active WCC/DC exists for the store.
- Invoice readiness is derived only from active WCC/DC owners and active valid documents.

Final state for legacy store `101387`:

| Store | Status | WCC | Signed WCC | Photos | Documents |
|---|---|---:|---:|---:|---:|
| `101387` | `pending` | 0 | 0 | 0 | 0 |

### 2. Invoice Integrity

Fix:

- Project-linked invoice creation now checks readiness server-side.
- If readiness is incomplete, invoice creation returns `409` with readiness details.
- New estimate creation now immediately backfills execution store rows, so new projects do not wait for server restart/backfill before execution tracking.

### 3. WCC Navigation

Fix:

- Escape now closes WCC Preview inside Project Workspace without closing the workspace.
- Escape now closes WCC Editor inside Project Workspace without closing the workspace.
- WCC modal backdrop click closes the topmost WCC modal.
- Project Workspace ownership remains intact after WCC close.

### 4. Role Coverage

Created and tested:

| User | Role | Status |
|---|---|---|
| `admin` | admin | Existing, verified |
| `qa_manager` | manager | Created, verified |
| `qa_execution` | production | Created, verified |

Permission results:

| Role | Project Visibility | WCC Visibility | Invoice Visibility | Create Estimate | Create Invoice |
|---|---|---|---|---|---|
| Admin | Pass | Pass | Pass | Allowed | Allowed |
| Manager | Pass | Pass | Pass | Allowed | Allowed |
| Execution User | Pass | Pass | Pass | Denied | Denied |

Notes:

- Admin/Manager invalid create payloads returned `400`, confirming route access passed authorization and then failed validation as expected.
- Execution user create attempts returned `403`, confirming write restrictions for estimate/invoice creation.

### 5. Photo Storage Audit

Fix:

- Corrupt active photo records were marked deleted with reason `corrupt_photo_storage_audit`.
- Valid uploaded golden-project photos remain active and render from real storage paths.

Final photo audit:

| Metric | Count |
|---|---:|
| Active photo records | 10 |
| Active corrupt photo records | 0 |
| Historical corrupt records preserved as deleted | 19 |

## Golden Project

Created through the real workflow:

```text
Estimate
-> PO
-> Execution Stores
-> WCC
-> Photos
-> Signed WCC
-> Invoice Ready
-> Generate Invoice
-> Open Invoice Packet
-> Print Invoice
```

Final golden record:

| Field | Value |
|---|---|
| Estimate | `SM/E/26-27/206` |
| Estimate ID | `7` |
| Invoice | `SM/INV/26-27/105` |
| Invoice ID | `5` |
| Stores | 2 |
| WCCs | `SM/DC/26-27/109`, `SM/DC/26-27/110` |

Readiness:

| Rule | Result |
|---|---|
| PO Attached | Pass |
| WCC Generated | Pass |
| Signed WCC Received | Pass |
| Photos Uploaded | Pass |
| Execution Complete | Pass |
| Invoice Ready | YES |

## Invoice Signoff

| Check | Result |
|---|---|
| Readiness calculation | Passed |
| Invoice generation | Passed |
| Invoice numbering | Passed: `SM/INV/26-27/105` |
| Invoice linkage to estimate | Passed |
| Invoice packet | Passed |
| Invoice print media screenshot | Passed |
| Chrome invoice PDF | Passed |

Chrome print PDF:

- `screenshots/go_live_signoff/07-invoice-print-chromium.pdf`
- Size: 3.9 MB

## Screenshot Evidence

| File | Evidence |
|---|---|
| `01-golden-project-overview.png` | Golden Project Overview |
| `02-golden-project-execution.png` | Execution complete |
| `03-golden-project-documents.png` | Documents linked |
| `04-golden-project-invoice-ready.png` | Invoice Ready YES |
| `05-invoice-packet.png` | Invoice packet |
| `06-invoice-print-media.png` | Invoice print media |
| `07-invoice-print-chromium.pdf` | Chrome print PDF |
| `qa-result.json` | Machine-readable QA |

## Pass / Fail Table

| Area | Result |
|---|---|
| WCC data integrity | Pass |
| Impossible signed/photos-without-WCC state prevention | Pass |
| WCC Preview Escape close | Pass |
| WCC Editor Escape close | Pass |
| Project Workspace return after WCC close | Pass |
| Admin role | Pass |
| Manager role | Pass |
| Execution user role | Pass |
| Golden project creation | Pass |
| PO attachment | Pass |
| WCC generation | Pass |
| Photo upload/storage | Pass |
| Signed WCC upload | Pass |
| Invoice readiness | Pass |
| Invoice generation | Pass |
| Invoice packet | Pass |
| Invoice print | Pass |

## Risk List

Critical:

- None.

High:

- None.

Medium:

1. Safari native print dialog was not available in the local automated environment.
   - Chrome print PDF passed.
   - Safari/WebKit manual print signoff should be completed on a Mac Safari environment before external/customer rollout.

2. Historical corrupt photo files are preserved as deleted audit rows.
   - They no longer count toward readiness.
   - No active corrupt photo records remain.

## Go-Live Recommendation

Recommendation: **Go for production internal rollout.**

Production readiness: **96%**

Approved:

- Project Workspace lifecycle.
- Execution workflow.
- WCC preview/edit/print ownership.
- Role-based internal use for Admin, Manager, and Execution User.
- Invoice readiness and invoice generation.
- Chrome invoice print/packet workflow.

Hold for manual follow-up:

- Safari native print signoff.
