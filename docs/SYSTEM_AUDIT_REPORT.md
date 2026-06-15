# SUNRISE ERP — SYSTEM AUDIT REPORT
**Date:** 12 June 2026 · **Method:** Static code analysis (full codebase). No live runtime/DB access — runtime-only claims are explicitly marked UNVERIFIED rather than guessed. Evidence = file:line references.

**Stack:** React 18 + TS + Vite + Tailwind/Radix · Express + Drizzle + Neon Postgres · Capacitor (mobile) · Telegram/WhatsApp bots · Tally XML export

---

## CRITICAL ISSUES

### C1. Entire `/uploads` folder is publicly accessible without authentication
**Evidence:** `server/routes.ts:808` → `app.use("/uploads", express.static(uploadDir))` and `server/index.ts:15`.
Every uploaded invoice, signed WCC, PO, receipt, and client document is downloadable by **anyone on the internet** who has/guesses the URL. Filenames are predictable (`file-<timestamp>-<random>.pdf`). For an ERP holding client financial documents this is a data breach waiting to happen.
**Fix:** Serve uploads through an authenticated route that checks JWT + role before streaming the file.

### C2. Hardcoded JWT secret fallback
**Evidence:** `server/config.ts:11` → `JWT_SECRET: process.env.JWT_SECRET || 'development-jwt-secret-please-change-in-production-...'`.
If the env var is ever missing in production, every token is forgeable with a publicly visible string (it's in the code). DATABASE_URL correctly hard-fails (`config.ts:3-6`); JWT_SECRET must do the same.

### C3. JWT accepted via URL query string
**Evidence:** `server/auth.ts:21-23` → `req.query.token` fallback.
Tokens in URLs leak into server logs, browser history, and proxy logs. If this exists only for file/print links, it should be replaced by short-lived signed URLs, not the 7-day master token.

### C4. No rate limiting, no helmet, no CORS policy anywhere
**Evidence:** zero matches for `helmet`, `rateLimit`, `cors` in `server/`.
`/api/auth/login` is brute-forceable without limit. No security headers are set.

### C5. Live secrets shipped inside the project
**Evidence:** `.env` in repo root containing DATABASE_URL, JWT_SECRET, SESSION_SECRET.
Already flagged during cleanup; `.gitignore` now added, but **rotate the JWT_SECRET and DB password** since this zip has been moved around.

---

## HIGH ISSUES

### H1. Zero database indexes
**Evidence:** `shared/schema.ts` — 31 tables, 51 foreign-key references, **0 `index()` definitions**.
Every FK join (estimates→clients, invoices→estimates, payments→invoices, executionStores→executionDocuments…) is an unindexed scan. Fine at 100 rows; will degrade visibly within months of real usage. UNVERIFIED at runtime, but structurally certain.

### H2. Default upload handler has no file-type filter and no size limit
**Evidence:** `server/routes.ts:781` → `const upload = multer({ storage: uploadStorage })` — bare config. Only `companyAssetUpload` (routes.ts:793-800) has `fileFilter`.
Anyone with a valid token (or via the public `/api/field/:token/upload` link) can upload arbitrarily large files of any type, including `.html`/`.svg` (stored-XSS when served from C1's public static route) — the two issues compound.

### H3. Public field-upload and Telegram webhook endpoints lack hardening
**Evidence:** `/api/field/:token/upload` (routes.ts) is unauthenticated by design (OK) but inherits H2's unrestricted multer. `/api/webhook/telegram` (routes.ts, comment says "no token validation needed") accepts any POST — anyone can inject fake bot messages into `botUploadInbox` and `webhookLogs`, polluting the inbox or filling the DB. Telegram supports a `secret_token` header check; it's not implemented.

### H4. No pagination on list endpoints
**Evidence:** `useOperationsData.ts` fetches `/api/finance/invoices`, clients, estimates, challans, products, material codes **in full** on every Operations page load; `server/storage.ts` has only 22 limit/offset mentions across 1,009 lines, mostly unrelated.
Combined with H1, the Operations page will slow linearly with business growth.

### H5. Monolith files
**Evidence:** `server/routes.ts` = 5,369 lines (127 endpoints). `OperationsPage.tsx` = 3,963 lines. `EstimateBuilder.tsx` = 2,615. `EstimatePreview.tsx` = 2,389.
Not a runtime bug, but the #1 driver of regression risk — every change touches a giant shared file. Your QA-report history (32 reports) shows repeated regressions consistent with this.

### H6. Token in localStorage with 7-day life, no refresh/revocation
**Evidence:** `AuthContext.tsx:24,71` + `auth.ts:69` (`expiresIn: "7d"`).
Any XSS (see H2 vector) yields a week-long valid token with no server-side kill switch. Acceptable short-term; should move to httpOnly cookie + shorter expiry later.

### H7. No data-fetching layer (no react-query/SWR)
**Evidence:** 0 `useQuery` matches; manual `useState` + `fetch` per page (`useOperationsData.ts`).
Consequences: no caching, no deduping, full refetch on every mount, inconsistent loading/error states across 26 pages.

### H8. Uploads on local disk only
**Evidence:** `multer.diskStorage` → `uploads/` folder; `@google-cloud/storage` is in package.json but unused in routes.
On most hosts (Render/Railway/Fly/containers) the disk is ephemeral — **all signed WCCs and documents are lost on redeploy**. UNVERIFIED for your specific host; critical if containerized.

---

## MEDIUM ISSUES

### M1. No audit log table
**Evidence:** 0 matches for "audit" in `shared/schema.ts`. For an ERP with invoices and payments, "who changed what when" is a compliance expectation. `webhookLogs` exists but only for bots.

### M2. No notifications system
**Evidence:** 0 matches for "notif" in schema. All workflow handoffs (estimate→approval→PO→execution→WCC→invoice) rely on users manually checking screens.

### M3. No aging report
**Evidence:** 0 matches for "aging" in routes. `pendingPayments` page exists, but no 30/60/90-day receivables bucketing — a core Zoho Books/Tally feature your accounts team will expect.

### M4. 122 generic `status(500)` handlers
**Evidence:** `routes.ts`. try/catch coverage is good (157 blocks), but errors return generic messages with no error IDs and no structured server-side logging (0 console.error in routes — errors may be swallowed silently depending on handler bodies; worth a pass).

### M5. Open first-user registration
**Evidence:** routes.ts register handler — "First-user signup is open; after that, only admins". Correct logic, but on a fresh/restored DB whoever hits register first becomes admin. Combined with no rate limiting, a wiped DB = race to admin. Low likelihood, high impact.

### M6. Capacitor (iOS+Android+9 plugins) in main package.json
Inflates install/build for the web app. If the mobile shell is dormant, split it out.

### M7. Two parallel upload-serving registrations
**Evidence:** `/uploads` static is registered in both `server/index.ts:15` and `server/routes.ts:808` — redundant; one wins, the other is dead code. Sign of drift.

---

## LOW ISSUES

- **L1.** `server/` contains one-off scripts (`backup_db.js`, `rebuild_db.js`, `seed_db.js`, `migrate_phase1.*`, `verify_phase1.mjs`) mixed with runtime code — move to `scripts/`.
- **L2.** `package.json` name is `"rest-express"` (template default), version 1.0.0.
- **L3.** `backups/` holds two stale 16KB JSON DB backups from May — delete or move out of repo.
- **L4.** No `npm test` script, no tests at all; QA is manual screenshot scripts in `scripts/`.
- **L5.** `tsconfig` strictness and `npm run check` status UNVERIFIED here (no node_modules); run `tsc` before release.

---

## WORKFLOW READINESS (items 12–16 of audit scope)

| Workflow | Status | Notes |
|---|---|---|
| Print (estimates/WCC/invoice packet) | ✅ Implemented | `@media print` + window.print across 7 files; browser-print based — consistent PDF output across devices UNVERIFIED |
| Invoice lifecycle | ✅ Implemented | invoices, payments, packet settings, submitted/pending pages, ledger summary endpoints present |
| Project workflows | ✅ Implemented | estimates→executionDocuments→executionStores→projectStoreStatus chain in schema |
| Telegram | ⚠️ Partially ready | Webhook + inbox + settings exist; **no webhook secret (H3)**, no outbound notification triggers (M2) |
| Finance | ⚠️ Mostly ready | Ledger, payments, petty cash, payroll, advances present; **no aging (M3)**, Tally export present (23 refs) but end-to-end Tally import UNVERIFIED |

---

## PRODUCTION READINESS SCORES (Phase 5)

| Area | Score | Why |
|---|---|---|
| Architecture | 62/100 | Sound stack, clean schema relationships; monoliths (H5), no fetch layer (H7), mixed scripts (L1) |
| UI/UX | 70/100 | Consistent Radix/shadcn base, complete workflows; see UI_UX_REVIEW.md |
| Performance | 55/100 | No indexes (H1), no pagination (H4), full-table fetches; fine today, degrades with data |
| Security | **34/100** | C1–C5 + H2/H3/H6 — this is the gap between "works" and "production" |
| ERP Completeness | 66/100 | Core quote-to-cash done; missing audit logs, notifications, aging, approvals engine (see GAP analysis) |
| **Overall** | **57/100** | The earlier "~96% production ready" reflected *feature completion*, not production hardening. Features ≈ 90%+; security/scale ≈ 40%. |

**Bottom line:** the build is functionally impressive and the workflows are genuinely complete. But C1 alone (public client documents) means it should not be exposed to the public internet for real client data until the Critical block is fixed — realistically 1–2 days of focused work.
