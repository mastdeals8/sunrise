# Dependency stabilization audit — 2026-08-11

Scope: Bolt-first client deployed with Supabase Edge Functions. The legacy
`server/` path is not part of the Bolt runtime. No dependency is upgraded
solely because it is deprecated or appears in `npm outdated`.

Commands run: `npm audit`, `npm audit --omit=dev`, `npm outdated`, and
`npm ls --depth=0`.

`npm audit` reports 25 findings (3 critical, 9 high, 12 moderate, 1 low).
The production-only report has 19 findings. Most critical findings are a
transitive `request` chain from an unused direct package, not Sunrise's Bolt
application. The lockfile also contains some stale transitive advisory paths;
`npm ls` resolves current `glob` 10/13, `rimraf` 6, and `tar` 7 rather than
the deprecated versions mentioned by the installer.

| Package / chain | Direct? | Current | Recommended | Reason | Security impact in Bolt production | Breaking / Bolt risk | Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `postcss` | Direct | 8.5.19 | 8.5.26 | Patch fixes source-map path disclosure and moves its nested `nanoid` to `^3.3.17`. | Build-time only; relevant when processing untrusted CSS/source maps. | Low; compatible with Vite 5, Tailwind 3/4, and Bolt build. | PATCH |
| `node-telegram-bot-api` → `request` / `uuid` / `form-data` / `qs` / `tough-cookie` | Direct root, vulnerable packages transitive | 0.66.0 | Remove unused package | `server/telegram.ts` uses native `fetch`; no source imports this package or its types. | Not reachable from Bolt; removal deletes the critical legacy chain. | Low; source import audit is clean. | REMOVE UNUSED |
| `@types/node-telegram-bot-api` | Direct | 0.64.15 | Remove with unused package | No source uses its declarations. | None. | Low. | REMOVE UNUSED |
| `nanoid` | Direct | 5.1.11 (lockfile) | 5.1.16 | Fixed patch for the non-secure-generator infinite loop advisory. | Affected only when callers supply invalid custom sizes; patch removes the direct finding. | Low; same major/minor API and already used by Vite's legacy server only. | PATCH |
| `recharts` | Direct | 2.15.4 | 2.15.4 | No source import and no npm advisory. Version 3 changes APIs and peer expectations. | None identified. | High migration risk; React/chart regression risk. | KEEP / MAJOR MIGRATION LATER |
| `drizzle-orm` | Direct | 0.39.3 | 0.45.2 | Advisory affects improperly escaped dynamic SQL identifiers. Used only by legacy server paths, not Bolt. | Not in Bolt runtime; still a legacy-server risk if dynamic identifiers are introduced. | High: 0.x minor is a breaking migration; coordinate `drizzle-kit` and test migrations. | MAJOR MIGRATION |
| `drizzle-kit` / `@esbuild-kit/*` | Direct / transitive dev tooling | 0.30.6 / 2.6.5 | 0.31.10 | Fix requires a coordinated tooling migration. | Dev-time only; not Bolt production. | Medium-high migration risk. | MAJOR MIGRATION |
| `vite` / `esbuild` | Direct / transitive | 5.4.21 / nested | 8.2.1 required by audit | Advisory is the development-server cross-origin issue. | Not reachable in deployed Bolt static build. | High: Vite 8 upgrade also changes plugin compatibility. | MAJOR MIGRATION |
| `fabric` | Direct | 6.9.1 | 7.4.0 | Advisories concern SVG serialization. No current source import was found. | Not reachable from current Bolt bundle. | High major migration; preserve PDF/canvas workflows until separately tested. | MAJOR MIGRATION |
| `@mapbox/node-pre-gyp` / `tar` / `brace-expansion` | Transitive / stale lockfile path | Not in current `npm ls` resolved tree | Lockfile cleanup only | `npm audit` still reports this nested path; current resolution uses `tar` 7 and `glob` 10/13. | Not shown as current Bolt runtime dependency. | Do not override transitive versions blindly. | KEEP; re-audit after install |
| `request`, `uuid` 3/8, `har-validator`, `whatwg-encoding`, `abab`, `domexception` | Transitive | Via unused Telegram or Fabric/jsdom chains | No standalone upgrade | Deprecated warnings do not justify direct dependencies or overrides. | Telegram chain removed; Fabric/jsdom is not bundled. | Overrides could break consumers. | KEEP TRANSITIVE / REMOVE TELEGRAM CHAIN |
| `glob`, `rimraf`, `inflight`, `npmlog`, `are-we-there-yet`, `gauge` | Transitive | Current resolution has supported `glob`/`rimraf`; old warning paths are lockfile/tooling descendants | No standalone upgrade | Not direct Sunrise runtime APIs. | No identified Bolt exposure. | Transitive override risk. | KEEP |
| `@supabase/supabase-js` | Direct | 2.110.3 | 2.112.3 available | No audit finding; current caret range already permits it. | No security need. | Low but unnecessary client behavior churn. | KEEP |
| React 18 / Vite 5 / PDF and Excel packages | Direct | Current locked versions | No change | Outside the identified safe security remediation. | No audit-driven need. | High UI/document-generation regression surface. | KEEP |

## Safe implementation approved by this audit

1. Pin PostCSS to `8.5.26`.
2. Pin Nano ID to `5.1.16`.
3. Remove the unused Telegram SDK and its unused type package. This does not
   alter Sunrise's Telegram implementation, which uses the native Fetch API.

No React, Vite, Supabase, Recharts, PDF, Excel, Estimate Builder, WCC,
Invoice Packet, schema, or application workflow changes are included.
