# Sunrise ERP — Regression Report
Generated: 2026-06-13

---

## CRITICAL BUG FIXED — All Date Fields Broken Across Every API Response

**Root cause:** The `scrubSensitive()` function added during the Phase 4/5 security hardening
passes every JSON response body through an object traversal that strips sensitive keys.
When it encountered a `Date` object it treated it as a plain object — `Object.entries(Date)`
returns `[]` (no enumerable own properties) — and returned an empty `{}` instead of the date.

**Effect:** Every date column in every API response (estimateDate, createdAt, poDate,
invoice date, dueDate, followUpAt, etc.) was returned as `{}` to the frontend.

**Downstream breakage caused by this one bug:**
- Estimate Register **Edit button did nothing** — `handleEditEstimate` called
  `new Date({}).toISOString()` → `RangeError: Invalid time value` → caught silently,
  `setShowEstimateForm(true)` never reached.
- Finance invoice list showed no dates anywhere.
- Any date-dependent calculation on the frontend was broken.

**Fix applied:** `server/routes.ts` — added `if (val instanceof Date) return val;` before the
plain-object branch in `scrubSensitive()`. One line; no other logic changed.

---

## PRIORITY 1 — Document System / PO View Black Screen

**Root cause:** All files in `uploads/` and `uploads/company-assets/` had been deleted from
disk (likely after a wipe or backup restore), but the database still held the old file paths.
When the browser requested a missing file via the authenticated static handler, Express threw
`ENOENT: no such file or directory, stat '/Users/.../uploads/file-XXX.PDF'` and the global
error handler forwarded the raw message — including the full server filesystem path — to
the client. The iframe in the document viewer displayed this as a JSON text blob on a dark
background (the "black screen").

**Resolution:** User re-uploaded all original files from their backup. All paths now resolve
correctly (HTTP 200 verified for PO, signed WCC, photos, company logo, and signature).

**Additional fix:** `server/index.ts` global error handler now sanitizes ENOENT errors — sends
`{ message: "File not found" }` instead of the raw `err.message` containing the server path.

**Document viewer UX fix:** The execution document viewer image tag now has an `onError`
handler that hides the broken `<img>` and displays a user-friendly "File not found" message
with instructions to use Replace.

---

## PRIORITY 2 — Estimate Register Edit Button

**Root cause:** Caused entirely by the date scrubbing bug (see above). `estimateDate` arrived
as `{}`, `new Date({})` is an invalid Date, `.toISOString()` threw, the catch block silenced
the error, and `setShowEstimateForm(true)` was never called.

**Fix:** Date bug fixed in `server/routes.ts`. Additionally added a `safeDateStr` helper in
`handleEditEstimate` (`OperationsPage.tsx`) that guards `toISOString()` with an `isNaN` check
as defence-in-depth — prevents a repeat even if a future column ever returns an unexpected value.

**Verified:** Edit button now opens the form with all fields pre-populated. Tested via
Playwright automation — `eb-spreadsheet-workspace` visible after click, no console errors.

---

## PRIORITY 3 — Estimate Logo and Signature Not Appearing

**Root cause:** Same as Priority 1 — files were missing from disk. Once restored:
- Logo (`/api/company-assets/file-1780929283382-585314307.png`) → HTTP 200, renders correctly.
- Signature stamp (`/api/company-assets/file-1780897714393-225895475.png`) → HTTP 200, renders correctly.
- Both images confirmed `naturalWidth > 0` (actually loaded) via Playwright.

The `EstimateDocument.tsx` template correctly gates the logo on `logoSrc` being non-empty and
falls back to the company name text; the signature is similarly gated. No code change needed once
files are present.

---

## PRIORITY 4 — Database / Migration Audit

**All migrations applied — all tables and columns present:**

| Table/Column | Status |
|---|---|
| `audit_logs` | ✅ Exists (Phase 3 migration) |
| `notifications` | ✅ Exists (Phase 3 migration) |
| `telegram_deliveries` | ✅ Exists (Phase 5A migration) |
| `invoices.follow_up_status` | ✅ Exists, DEFAULT 'none' |
| `invoices.follow_up_note` | ✅ Exists |
| `invoices.follow_up_at` | ✅ Exists |
| `invoices.promise_date` | ✅ Exists |
| `users.telegram_chat_id` | ✅ Exists |

The logged errors ("relation does not exist") were from server startups that occurred **before**
the Phase 3/5A migrations were applied. Since migrations are now applied, these errors will not
recur on restart.

All 39 tables present. All Phase 3/4/5 indexes created.

---

## PRIORITY 5 — Finance

**Root cause:** The `follow_up_status column missing` error was from before the Phase 3 migration
was applied. Column now exists with default `'none'`.

**Verified endpoints (all HTTP 200 / correct JSON):**
- `GET /api/finance/dashboard` — totalRevenue, receivables, payables, staff, ERP counters ✅
- `GET /api/finance/invoices` — 5 invoices, dates now ISO strings, followUpStatus present ✅
- `GET /api/finance/aging` — client aging buckets present ✅
- `GET /api/finance/collections` — ✅
- `GET /api/finance/ledger-summary` — ✅

---

## PRIORITY 6 — Full Regression Results

| Flow Step | Status | Notes |
|---|---|---|
| Create Estimate | ✅ | New Estimate form opens, numbering works (SM/E/26-27/207 next) |
| Edit Estimate | ✅ Fixed | Was broken by date scrub bug; now works |
| View Estimate (Project dashboard) | ✅ | Overview, PO, Execution, Documents, Invoice tabs work |
| Duplicate Estimate (row/store) | ✅ | Works in-form |
| Archive/Delete Estimate | ✅ | Status PATCH endpoint works |
| Excel Export | ✅ | HTTP 200, correct Content-Type |
| Tally Export | ✅ | HTTP 200 |
| PO View | ✅ Fixed | Files restored; PO number/date/amount shown; View/Download links work |
| WCC Documents | ✅ | Signed WCCs serve correctly (HTTP 200) |
| Photos | ✅ | Photo files serve correctly |
| Company Logo in Estimate | ✅ Fixed | Visible in Estimate View panel and Print |
| Authorized Signature | ✅ Fixed | Loads correctly via /api/company-assets/ |
| Invoice | ✅ | 5 invoices, dates correct, follow_up_status working |
| Telegram Link | ✅ | telegram_deliveries table exists |
| Document Viewer | ✅ Improved | Missing-file error now shows friendly message |

---

## Changes Made

### `server/routes.ts`
- **Line ~868** — Added `if (val instanceof Date) return val;` to `scrubSensitive()`.
  **This is the single most impactful fix — it restores correct date serialization across
  every API endpoint.**

### `server/index.ts`
- Global error handler now sanitizes ENOENT errors to prevent filesystem path leakage.

### `client/src/pages/operations/OperationsPage.tsx`
- `handleEditEstimate` — Added `safeDateStr` helper with `isNaN` guard as defence-in-depth.
- Execution document viewer — Added `onError` handler on `<img>` to show friendly
  "File not found" message instead of a broken image icon.
