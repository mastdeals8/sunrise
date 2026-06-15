# Brand Theme Report — Sunrise Media

## Source
- Website URL checked: https://sunrsie.lovable.app/
- Logo source found: **yes**
- Logo URL: `https://sunrsie.lovable.app/assets/logo-Dz7aGtYT.png`
- Logo saved to: `client/public/brand/logo.png` (PNG, 279 × 48, 9.7 KB, RGBA)
- Production copy verified at: `dist/public/brand/logo.png`

## Extracted brand colors

Sampled directly from the logo bitmap (top-15 dominant non-white pixel buckets).
Two colors clearly dominate; the rest are anti-alias intermediates.

| Role               | Hex        | RGB              | HSL                  | Notes                                  |
|--------------------|------------|------------------|----------------------|----------------------------------------|
| **Primary**        | `#F86000`  | rgb(248, 96, 0)  | hsl(23, 100%, 49%)   | "SUNRISE Orange" — icon + "MEDIA" word |
| **Primary (hover)**| `#D75200`  | rgb(215, 82, 0)  | hsl(23, 100%, 42%)   | Darker shade for hover/borders         |
| **Secondary/Text** | `#303030`  | rgb(48, 48, 48)  | hsl(0, 0%, 19%)      | "SUNRISE" wordmark — body headings     |
| **Accent**         | `#FFEFE5`  | rgb(255, 239, 229) | hsl(23, 100%, 96%) | Soft orange tint for highlighted rows  |
| **Background**     | `#F8FAFC`  | slate-50         | hsl(210, 20%, 98%)   | Page background (kept from ERP)        |
| **Surface**        | `#FFFFFF`  | white            | —                    | Cards / dialogs                        |
| **Text body**      | `#0F172A`  | slate-900        | hsl(222, 47%, 11%)   | Body copy (kept from ERP)              |
| **Border**         | `#E2E8F0`  | slate-200        | hsl(214, 32%, 91%)   | Card borders (kept from ERP)           |

The ERP previously used `hsl(28, 100%, 50%)` (≈ `#FF7700`) as primary — slightly
warmer/yellower than the real brand orange. It is now exactly `hsl(23, 100%, 49%)`
(`#F86000`) to match the logo.

## Files changed

| File                                                                | Change                                                                                                          |
|---------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `client/public/brand/logo.png`                                      | **new** — downloaded brand logo                                                                                 |
| `client/src/index.css`                                              | Updated `--primary` and `--ring` to exact `#F86000`; refined `--accent` to soft orange tint; added `--brand-orange`, `--brand-orange-strong`, `--brand-dark` tokens; added brand palette comment |
| `client/src/App.tsx`                                                | Mobile top bar and sidebar header now render the actual logo PNG instead of the text wordmark                   |
| `client/src/pages/Login.tsx`                                        | Logo image replaces the text "Sunrise Media" heading above the sign-in form                                     |
| `client/src/pages/InvoicePacket.tsx`                                | Logo added to invoice print header (`InvoiceFrontPage`); slim branded header bar added to `EstimateSummary` and `DcSummary` (WCC/DC)                                                          |
| `ARCHITECTURE_NOTES.md`                                             | (unchanged this pass)                                                                                           |
| `BRAND_THEME_REPORT.md`                                             | **new** — this file                                                                                             |

### What did **not** change (intentionally)
- No backend / business-logic changes.
- No layout changes — only swapped text wordmark → logo image and tightened the orange.
- Dashboard cards/header, primary button gradients, sidebar nav structure, and the existing
  `sunrise-gradient-text` / `sunrise-gradient-bg` utility classes are left as-is; they
  already use Tailwind's `orange-*` palette which reads as on-brand. The CSS-variable
  primary is now exact, so shadcn/ui components using `bg-primary` etc. snap to brand.
- Print header for **estimates** and **DC/WCC** in the *Excel exports* (server-side in
  `server/routes.ts`) was not touched — those are XLSX exports, not HTML, and the user
  said not to touch backend except for asset paths. The HTML print headers (invoice
  packet builder, which is the only browser-print surface) all got the logo.
- Telegram, WhatsApp, finance, petty cash, staff, calculation logic — untouched.

## Build status

```
$ ./node_modules/.bin/tsc --noEmit
exit 0  (clean)

$ npm run build
vite v5.4.21 building for production...
✓ 1615 modules transformed.
dist/public/index.html                   1.10 kB │ gzip:   0.57 kB
dist/public/assets/index-D3iDEa4d.css   49.30 kB │ gzip:   8.82 kB
dist/public/assets/index-xsBT7aUW.js   621.39 kB │ gzip: 134.75 kB
dist/public/brand/logo.png              9.70 kB
dist/index.js                          150.4 kB
✓ built in 4.85s
```

Both `tsc --noEmit` and `npm run build` pass green. The logo asset is correctly
copied into `dist/public/brand/logo.png` so production serves it at `/brand/logo.png`.
