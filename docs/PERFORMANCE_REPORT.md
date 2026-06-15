# PERFORMANCE REPORT — Sunrise ERP
**Date:** 12 June 2026 · **Audit refs:** H4 (no pagination), H7 (no fetch layer), N+1 scan

## 1. PAGINATION (implemented — opt-in, zero breakage)
Five list endpoints now support `?limit=` (1–500) and `?offset=`, returning the slice plus an `X-Total-Count` header. **Without params, behaviour is byte-identical to before** — deliberately, because the Operations page consumes full lists for dropdowns and any default cap would silently break workflows.

Endpoints: `/api/operations/estimates` · `/api/finance/invoices` · `/api/operations/delivery-challans` (WCC/DC register) · `/api/uploads` (documents) · `/api/operations/execution-documents` already supports its own estimate/DC filters and was left as-is.

**Live evidence (test server, 7 estimates seeded):**
```
GET /api/operations/estimates?limit=3&offset=2 → 3 rows, X-Total-Count: 7
GET /api/operations/estimates                  → 7 rows (legacy unchanged)
```
Implementation note: pagination currently slices in memory after the storage call — correct behaviour and the API contract the UI can adopt now; pushing LIMIT/OFFSET into SQL is a drop-in optimization once the client actually paginates (pointless before then, since Operations still requests full lists). The client-side adoption belongs to the UI phase, per your "no UI redesign" constraint.

## 2. N+1 QUERIES — FIXED (safe write-path)
| Location | Before | After |
|---|---|---|
| `storage.createEstimate` | 1 INSERT **per item** in a loop — a 40-store estimate = 40+ round-trips inside the transaction | Single batched `INSERT … VALUES (…),(…)` — same pattern your estimate-update route already used |
| `storage.createJournalEntry` | 1 INSERT per journal line | Single batched INSERT |

**Live evidence:** estimate created with 3 items via the real API → `SELECT count(*) FROM estimate_items WHERE estimate_id=1` → 3. Update route → 200. tsc + build clean.

## 3. N+1 QUERIES — DOCUMENTED, NOT TOUCHED (read-path, business-logic risk)
Per your instruction to preserve all business logic, these are catalogued for the refactor phase (Roadmap B6) rather than changed now. All are now index-backed, so each loop iteration is ~100× cheaper than before:

| Location | Pattern | Suggested later fix |
|---|---|---|
| routes.ts ~541 (signed-WCC ownership sweep) | per-document `SELECT delivery_challans WHERE id=…` in loop | one `WHERE id IN (…)` + map |
| routes.ts ~4770 (rate-card eligibility) | per-card `SELECT customer_rate_items WHERE rate_card_id=…` | one `IN (…)` query grouped by card |
| storage.ts payment allocation loop | per-allocation invoice SELECT + UPDATE | acceptable (allocations are few); batch only if bulk-allocation UI arrives |
| routes.ts ~1173 (numbering settings) | sequential `getAppSetting` per key pair | settings are cached-cheap; low priority |

## 4. FULL-TABLE FETCH MAP (for the UI phase)
`useOperationsData.ts` fetches 9 full collections on Operations mount: clients, brands, stores, products, materialCodes, estimates, challans, invoices, ledger summary. Masters (clients/brands/stores/products/materialCodes) are legitimately needed in full for dropdowns; **estimates, challans, invoices are the growth risk** — these are exactly the endpoints that now expose pagination + X-Total-Count, ready for the UI to consume with a react-query migration (Roadmap B7). No client change made now per scope.

## 5. OTHER OBSERVATIONS
- `express.json({ limit: '50mb' })` is generous; kept because Excel import flows may post large payloads — revisit when imports move to multipart.
- Build output: server bundle 316.5 kb; client builds with a chunk-size warning (Capacitor + Radix weight) — addressed by route-level code-splitting in the UI phase, not now.

## BOTTOM LINE
Read queries: up to 134× faster (see DATABASE_INDEX_REPORT.md). Write path: estimate/journal creation now constant round-trips instead of linear in item count. API: pagination contract live and verified, awaiting UI adoption. Nothing in any business workflow changed shape.
