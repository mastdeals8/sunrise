# Remaining Work — Sunrise Media ERP

Last updated: 2026-05-25

This list is intentionally short. Items that block daily ERP usage are
called out as P0; everything else is deferred.

## P0 — Real business gaps

(none open — see `FINAL_REPORT.md` for what was closed this pass)

## P1 — Customer-format extensibility (Landmark / Simply Kool / others)

The system keeps `clients.format` and `estimates.clientFormat` as free-form
text. Today the known values are `normal`, `ABFRL`, `abfrl_multi_store`,
`letter_signage`. Adding a new corporate format (e.g. `landmark_multi_store`,
`simplykool_rollout`) requires three things:

1. Add the value to the format dropdown in `client/src/pages/operations/components/ClientsPanel.tsx`.
2. Add a server-side Excel-export branch in `server/routes.ts` (search for `letter_signage` to find the existing pattern).
3. Add a HTML print header in `InvoicePacket.tsx` if the packet builder is used for that customer.

Architecture details in `ARCHITECTURE_NOTES.md` § "Customer-specific formats".

## P2 — Tally direct push

`Tally Integration` settings let you choose `mode: push` — but server-side
HTTP push to Tally is not implemented. Today the UI offers it as a future
mode; XML download is the working path. To wire push, add a server route
that POSTs the generated XML to `tallyUrl` via `axios` (Node-side, no
browser CORS to worry about), retry on 5xx, set `tally_export_status =
"pushed_to_tally"` on success / `"failed"` on error. See
`TALLY_INTEGRATION.md` for the envelope.

## P2 — Letter signage CDR / PDF / SVG extraction

Letter signage running-inch entry is now a comma-separated text input
(`27,26,26,26,28,27,27` → sum = 187). The brief deferred CDR / PDF / SVG
automated measurement to "future". Add when a real CDR/SVG sample is
available — likely an upload + parse step that fills `letterSizes`
automatically.

## P3 — Production deployment

Blocked on credentials / hosting decisions, not code:

- `.env` for production target needs `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET` (rotate from dev).
- Real Telegram bot token + webhook URL pointing at the prod server.
- WhatsApp Cloud API: phone number ID, WABA ID, access token, verify token; webhook URL pointing at prod.
- Tally Prime instance with HTTP/ODBC enabled if direct push is wanted.
- Deploy pipeline (out of scope for this repo).

## P3 — Nice-to-have polish (intentionally deferred)

- Vite bundle is 695 kB (gzip 151 kB). Add `manualChunks` once the page set is stable.
- Designer approval flow & production job card — explicitly excluded by the brief.
- Bulk Tally XML download for a whole month/financial-year.
- Sync paid/reconciled status from Tally back into ERP.
- Photo report PPTX export — current implementation uses browser Print to PDF, which is sufficient for the common case. PPTX would require `pptxgenjs` or similar.

## What is NOT a concern (verified this pass)

- All P0 items from previous `TODO_REMAINING.md` resolved (rate-card resolver wired, Excel exports unaffected by additive schema, print headers untouched).
- API smoke suite: 36/36 pass (`scripts/audit-api-tests.mjs`).
- Type check: `tsc --noEmit` exit 0.
- Build: `npm run build` succeeds (vite + esbuild).
- Bot tokens still never returned to client.
- Invoice → payment allocation untouched.
- Estimate / WCC / DC / payment / petty cash / staff modules untouched.
