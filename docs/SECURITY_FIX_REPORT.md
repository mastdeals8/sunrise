# SECURITY FIX REPORT — Sunrise ERP Production Hardening
**Date:** 12 June 2026 · **Scope:** All Critical + High security issues from SYSTEM_AUDIT_REPORT.md · **Constraint honoured:** zero business-logic changes — estimates, WCC/DC, invoices, numbering, Project Workspace untouched.

## QA METHOD
Every fix was verified **live**: the actual server was booted against a local PostgreSQL 16 instance (schema applied via `drizzle-kit push`), and each control was probed over HTTP. TypeScript (`npx tsc`) and the production build (`npm run build`) both pass clean. Evidence shown per fix.

---

## FIX 1 — Authenticated file serving (audit C1, CRITICAL)
**Before:** `app.use("/uploads", express.static(uploadDir))` — every invoice, signed WCC and client document publicly downloadable.
**After:** `/uploads` is served through `authenticateBrowserRequest` (server/index.ts), which accepts the Bearer header **or** a new httpOnly session cookie. The duplicate public static registration in routes.ts was removed. Non-inline file types are forced to `Content-Disposition: attachment` + `application/octet-stream`, killing the stored-XSS vector of uploaded `.html`/`.svg` rendering in-origin.

**How browser tags keep working:** `<img src>` and `<a href>` can't send Authorization headers — that was the original reason for both the public folder and query-string tokens. Login now sets an httpOnly, SameSite=Lax session cookie (`sunrise_session`); browsers attach it automatically to same-origin requests. Existing sessions mint the cookie via the new `POST /api/auth/session-cookie` on app load; `POST /api/auth/logout` clears it.

**Role-based access:** `authenticateBrowserRequest` resolves the full user and populates `req.user`, so `requireRole` works on download routes — applied to `/api/operations/exports/:type` (admin/manager/accounts) and `/api/tally/export-xml` (admin/accounts/manager) exactly as before.

**Live evidence:**
```
anonymous  GET /uploads/test-invoice.pdf → 401
cookie     GET /uploads/test-invoice.pdf → 200
bearer     GET /uploads/test-invoice.pdf → 200
Set-Cookie flags: HttpOnly; SameSite=Lax; Path=/
```

## FIX 2 — JWT security (audit C2 + C3, CRITICAL)
- Hardcoded fallback secret removed from `server/config.ts`; startup now hard-fails if `JWT_SECRET` is missing or under 32 chars.
- `req.query.token` support deleted from `server/auth.ts`. All four client URLs that carried `?token=` (Tally XML export, estimate Excel export ×2, master-data export) now rely on the cookie; `companyAssetUrl()` no longer appends tokens (signature kept — zero call-site changes across print/preview components).

**Live evidence:**
```
boot without JWT_SECRET → "🚨 JWT_SECRET is missing… Refusing to start." (process exits)
GET /uploads/file.pdf?token=<valid JWT> → 401 (query tokens rejected)
```
**Action still required by you:** the old `.env` travelled inside earlier zips — rotate `JWT_SECRET` and the Supabase DB password before go-live. CSRF note: the cookie is only honoured on GET file/download routes; all mutating APIs still require the Bearer header, so cross-site request forgery has no mutating surface.

## FIX 3 — Security middleware (audit C4, CRITICAL)
Added in `server/index.ts`: **helmet** (CSP off for now — Vite SPA; tune later), **CORS allowlist** (cross-origin requests honoured only for origins in new `CORS_ORIGINS` env, same-origin unaffected), **global API rate limit** (600 req/min/IP), and a **strict auth limiter** (10/min/IP) on `/api/auth/login` and `/api/auth/register`.

**Live evidence:**
```
Headers present: X-Content-Type-Options: nosniff · X-Frame-Options: SAMEORIGIN · Cross-Origin-Resource-Policy: same-origin
12 consecutive bad logins: 401 ×8 then 429 429 429 429
```

## FIX 4 — Upload security (audit H2, HIGH)
The main `upload` multer (used by operations upload, import parse, **and the public field-upload link**) now has: 25MB size limit (`UPLOAD_MAX_BYTES` env-tunable), max 5 files, an extension allowlist (images, pdf, office docs, csv, txt, zip) **and** a MIME allowlist. `companyAssetUpload` gained the size limit on top of its existing image-only filter. A `scanUploadedFile()` virus-scan placeholder is in place (returns clean; TODO marker for ClamAV/VirusTotal wiring).

**Live evidence:**
```
POST /api/operations/upload  evil.exe → rejected: "File type .exe is not allowed"
POST /api/operations/upload  ok.pdf  → 201 {"filePath":"/uploads/file-…pdf"}
```

## FIX 5 — Telegram webhook validation (audit H3, HIGH)
`/api/webhook/telegram` now validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header when a secret is configured — via `TELEGRAM_WEBHOOK_SECRET` env or `botSettings.settings.webhookSecret`. **Setup step for you:** pass the same `secret_token` when calling Telegram's `setWebhook`. With no secret configured, behaviour is unchanged (backwards compatible).

**Live evidence (bot enabled):**
```
wrong secret   → 403   missing secret → 403   correct secret → 200
```

## FILES CHANGED
server/config.ts · server/auth.ts · server/index.ts · server/routes.ts · server/indexes.ts (new) · server/storage.ts · client: AuthContext.tsx, companyAssets.ts, SubmittedInvoices.tsx, EstimatePreview.tsx, EstimateBuilder.tsx, MasterDataImportExportPanel.tsx · scripts/migrations/2026-06-12-add-indexes.sql (new)

## BUSINESS-LOGIC PRESERVATION EVIDENCE
Live on the test server: created 7 estimates with items (all 201), items persisted correctly, estimate update → 200, numbering endpoint returns the real series format (`SM/E/26-27/208` — server-side, untouched), Tally/export routes unchanged except auth method, list endpoints return identical full payloads when no pagination params are sent. `npx tsc` → 0 errors; `npm run build` → success.

## RESIDUAL RISKS (documented, not fixed — out of scope per your instruction)
JWT 7-day expiry in localStorage (H6 — move to httpOnly-only with refresh later) · uploads still on local disk (H8 — confirm persistent volume on your host or wire GCS) · open first-user registration on empty DB (M5) · CSP disabled in helmet (tune in a later pass).
