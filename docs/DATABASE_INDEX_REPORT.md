# DATABASE INDEX REPORT — Sunrise ERP
**Date:** 12 June 2026 · **Audit ref:** H1 (31 tables, 51 FKs, 0 indexes)

## WHAT WAS ADDED
**90 indexes**: all 51 foreign-key columns + 39 filter indexes on the columns your queries actually filter by — `status`, `store_code`, `estimate_id`/`invoice_id` (covered as FKs), `date`/`due_date`, `type`, `category`, `platform`, and `created_at` on high-volume tables. Deliberately skipped: `created_at` on tiny lookup tables (app_settings, bot_settings, chart_of_accounts) where an index is pure overhead, and `bot_settings.platform` (already unique-indexed).

## HOW THEY'RE APPLIED (two redundant paths)
1. **Startup self-healing:** new `server/indexes.ts` runs idempotent `CREATE INDEX IF NOT EXISTS` at boot — the exact pattern your codebase already used for `field_access_links(channel)`, extended to all 90. New environments get indexed automatically; failures log and never block startup.
2. **Standalone migration:** `scripts/migrations/2026-06-12-add-indexes.sql` for manual/CI application. For a busy production DB, the file's header explains switching to `CREATE INDEX CONCURRENTLY` to avoid write locks.

**Caveat to know:** `drizzle-kit push` compares the DB against `shared/schema.ts` and may propose dropping indexes it doesn't know about — review its plan before confirming, or simply let the startup pass recreate them on next boot. Mirroring all 90 into schema.ts is a clean follow-up but was kept out of this pass to avoid touching table definitions during hardening.

## BEFORE / AFTER BENCHMARK
Method: local PostgreSQL 16, schema subset at realistic 2–3-year volumes — 20,000 estimates, 300,000 estimate items, 40,000 invoices, 60,000 payments, 80,000 execution documents, 300 clients. `EXPLAIN (ANALYZE)` per query, identical data, before vs after applying the project's index set. Raw planner output preserved in docs/benchmark_results.txt.

| Query (real app pattern) | Before | After | Speedup | Plan change |
|---|---|---|---|---|
| Q1 Estimate items by estimate (Project Workspace load) | 20.58 ms | 0.15 ms | **134×** | Parallel Seq Scan → Bitmap Index Scan |
| Q2 Invoices by client+status (Client Ledger) | 2.59 ms | 0.31 ms | **8×** | Seq Scan → BitmapAnd of two indexes |
| Q3 Payments by invoice (invoice-readiness check) | 3.42 ms | 0.04 ms | **78×** | Seq Scan → Index Scan |
| Q4 Execution docs by estimate+status (WCC register) | 4.47 ms | 0.03 ms | **131×** | Seq Scan → Index Scan |
| Q5 Client outstanding join (invoices⋈payments) | 9.49 ms | 7.82 ms | 1.2× | Invoice side indexed; hash join still scans payments — honest result; improves further once query filters payments by the indexed invoice set |

These are single-query numbers. The real-world effect multiplies: Operations page load and invoice-readiness checks fire many such lookups per request, and several routes run per-row lookups in loops (see PERFORMANCE_REPORT.md) where each iteration now hits an index instead of a full scan.

## VERIFICATION
Booting the actual server against the test DB created the indexes automatically:
```
SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_%';  →  99
```
(90 new + field_access_links + drizzle/unique extras.) Startup time impact: negligible — IF NOT EXISTS checks are metadata-only after first boot.

## WRITE-SIDE COST (full disclosure)
Each index slightly slows INSERT/UPDATE on its table. At your volumes (tens of writes/minute peak) this is unmeasurable; the read-side gains dominate by orders of magnitude. Revisit only if a bulk-import path becomes slow — drop/recreate indexes around the import in that case.
