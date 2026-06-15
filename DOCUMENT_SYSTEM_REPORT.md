# Document System Report
Generated: 2026-06-13

## Root Cause

All files in `uploads/` were deleted from disk while the database still held their paths.
When any file was requested:
1. The authenticated static handler (`express.static` with `fallthrough: false`) threw ENOENT.
2. The global error handler forwarded the raw `err.message` (containing the server filesystem
   path) as the JSON response body.
3. The document viewer iframe displayed this JSON error text on a dark background → "black screen."

## Files Verified (2026-06-13 after re-upload)

| Category | Count | Status |
|---|---|---|
| PO documents | 5 | ✅ All HTTP 200 |
| Signed WCC PDFs | Active: 3 | ✅ All HTTP 200 |
| Execution photos | Active: ~10 | ✅ All HTTP 200 |
| Company logo | 1 | ✅ HTTP 200, 9.7 KB PNG |
| Company signature stamp | 1 | ✅ HTTP 200, 24.3 KB PNG |

## File Authentication

All `/uploads/*` requests require authentication via either:
- `Authorization: Bearer <token>` header (SPA API calls)
- `session` httpOnly cookie (browser navigation)

Company assets served via `/api/company-assets/:filename` — same auth requirement.
Unauthenticated requests return HTTP 401.

## Error Handling Improvements

### Server (`server/index.ts`)
```
BEFORE: { message: "ENOENT: no such file or directory, stat '/Users/.../uploads/...' }
AFTER:  { message: "File not found" }
```
ENOENT errors are now sanitized to never expose the server filesystem path.

### Client — Document Viewer (`OperationsPage.tsx`)
Image documents with missing files now show a human-readable message:
> "File not found on server. The original file may have been deleted. Use Replace to upload a new copy."

## Logo/Signature in Estimate Documents

- `EstimateDocument.tsx` already had correct fallback: if `logoSrc` is empty, shows company
  name as text. When file path exists but file is missing, the `<img>` now has an `onError`
  handler (added in execution doc viewer) — the shared EstimateDocument already uses
  conditional rendering (`{logoSrc ? <img> : <text>}`), so a 404 will show a broken icon
  but the document remains otherwise intact.
- **Both assets confirmed loaded** (`naturalWidth > 0`) in Playwright test after re-upload.

## Recommendations

1. **Back up `uploads/` regularly.** The DB holds file paths; if the directory is cleared
   the paths become orphaned and all document viewing breaks.
2. Consider moving uploads to Supabase Storage for persistence independent of the server
   filesystem. The `.env` already has `UPLOAD_PROVIDER=local` — a future migration path.
3. The `uploads/test_export_*.xlsx` files left by the QA scripts can be cleaned up.
