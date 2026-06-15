# HARDENING PHASE 2 REPORT — 12 June 2026
All verified live (server booted on PostgreSQL 16, HTTP probes). tsc + production build clean.

## Security completion
- **Cookie-first auth:** httpOnly session cookie is now a valid primary credential on all API routes (`authenticateToken` accepts it; SameSite=Lax keeps cross-site mutations CSRF-safe). Client restores sessions from cookie alone if localStorage is empty. "Bearer null" junk headers no longer defeat cookie sessions. *Honest status:* localStorage is still written at login because every page builds Bearer headers manually — full removal lands with the react-query fetch-layer migration (Roadmap B7); the server no longer requires it.
- **Upload routes reviewed (all 4 multer + 1 base64):** all share the hardened filter/limits; receipt metadata route now sanitizes filenames with `path.basename()`.
- **No public document access remains:** `/uploads` authenticated (verified 401 anon); import-template downloads now require auth too.
- **Export route roles verified:** master-data exports (admin/manager/accounts), Tally XML (admin/accounts/manager) — enforced and probed. Estimate Excel export intentionally stays any-authenticated, matching estimate view permissions.
- **Field links verified scoped:** estimateId always derived server-side from the token; store-code and document-type allowlists enforced (403s probed); token stored hashed, shown once.
- **Security tests added:** `scripts/security-tests.mjs` — 17 automated probes, runnable against any environment.

## Pagination adoption
Server: `?q=` search + `?limit/?offset` + `X-Total-Count` on estimates, invoices, delivery-challans (WCC register), uploads — search verified live (`?q=E2E` found the test estimate). Client: shared `Pager`/`usePagedList` added to **Estimate register, WCC/DC register, Invoice Ledger, Submitted Invoices, Project Documents** (25 rows/page). *Design note:* registers paginate at the render layer while full lists stay loaded — the registers' per-row linked-doc lookups, the workflow logic, and client-computed filters (e.g. "overdue", filtered-set totals) depend on full lists; server-driven fetching would have broken existing filters, which was prohibited. DOM cost drops ~98% on large registers either way. Client Ledger is an aggregated per-client summary (rows = number of clients) — pagination not meaningful there.

## Codebase cleanup
- 9 one-off DB scripts moved out of `server/` to `scripts/archive/server-tools/` (none imported by runtime — verified).
- `formatCurrency` consolidated from 8 page-local copies to `client/src/utils/format.ts` (6 replaced; 2 left where output differs — changing them would alter UI).
- Dead-code scan: `pages/Operations.tsx` is a live re-export shim (kept); `focused-routes` in use (kept); no "estimate-preview ownership" dead code found — the signed-doc ownership sync is active business logic (and was optimized, see perf report).
- Large-file splitting deferred — per "only when safe": routes.ts/OperationsPage refactor belongs to Roadmap B6, not a hardening pass.

## UI pass (light, code-level — no browser in this environment)
All page tables already use overflow-x-auto wrappers (verified by scan) — no fixes needed. Pagers standardize register footers. Deeper visual polish (spacing/alignment/mobile) honestly requires running the UI — recommend a screenshot pass with your existing Playwright scripts; I did not make blind visual changes.

## ERP validation — full workflow E2E (live)
Estimate `SM/E/26-27/208` (201) → PO attach via PATCH (200, readiness shows poAttached:true) → Project Workspace fetch (200) → WCC create (201) → field-access link (201, scoped) → field uploads: photo (201) + signed WCC (201) → documents list shows both → **readiness gate correctly returned 409 while incomplete** → invoice `SM/INV/26-27/101` (201, real series) → Tally XML export (200, valid ENVELOPE). Numbering and templates untouched throughout.
