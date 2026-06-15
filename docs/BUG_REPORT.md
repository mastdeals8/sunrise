# BUG_REPORT — Phase 3 Operational Validation — 12 June 2026
Every module audited from code + live probes. Findings by severity. Fixed-now items were low-risk; the rest are documented with evidence (no risky changes during stabilization).

## Fixed this phase
1. **[High] Non-atomic payment posting** (storage.ts createPayment) — payment+journal could persist while invoice-balance update failed → money recorded, invoice still unpaid. Now wrapped in a transaction. Verified.
2. **[High] Excel "needs repair" on Mac** (routes.ts export) — `<drawing>` emitted before `<printOptions>/<pageMargins>/<pageSetup>/<headerFooter>`, violating OOXML CT_Worksheet order. Strict (Mac Excel) flagged it; lenient (Windows/LibreOffice) auto-fixed silently. Added `normalizeWorksheetXmlOrder()` applied to both logo-bearing exports. Reproduced and verified fixed on a real export.
3. **[Med] Float drift in balances** — paid/balance now rounded to paise.

## Documented, not changed (stability-first)
4. **[Med] Money columns are float (`real`)** — see FINANCE_COMPLETION_REPORT. Needs a dedicated typed-migration pass, not a stabilization edit.
5. **[Med] createPaymentWithAllocations loops per-invoice** without a wrapping transaction (same atomicity class as #1, allocation path). Lower frequency; flagged for the same future txn treatment — left untouched to avoid touching the multi-allocation accounting path mid-stabilization.
6. **[Low] Dev-mode unmatched `/api/*` returns 200+HTML** (SPA fallback) — masks client bugs and tripped my own Phase 2 testing. A JSON 404 for unmatched API paths is a clean future fix.
7. **[Low] `enforce:false` on approvals** — approvals recorded but not yet blocking (intentional; see APPROVAL_WORKFLOW_REPORT).

## Verified working (no bugs found)
Estimates (create/edit/items/numbering), Projects/Execution chain, Documents, WCC create + duplicate-prevention, Invoices (readiness gate correctly blocks until signed proof), Client Ledger, Petty Cash (self-scoped create is intentional), Material Codes, Rate Cards (incl. the now-optimized eligibility lookup), Staff, Tally XML export, field-link/Telegram uploads (token-scoped). Permission coverage audited across all core entities — appropriate role gates present; the only role-free mutating routes (file upload, import parse, petty-cash self-entry) are intentionally so.

## Data consistency
- Invoice balance/status transitions correct across partial→paid (verified).
- WCC duplicate prevention active (findActiveDuplicateWcc).
- Invoice line items snapshotted at generation (editing estimate later won't mutate billed invoices) — good existing design, confirmed.
