# SUNRISE ERP — UI/UX REVIEW
**Honesty note:** No browser/runtime available in this environment, so no screenshots — this review is derived from component code, class usage, and structure. Findings about *visual rendering* are marked as code-inferred. Your existing `scripts/audit-screenshots-*.mjs` (Playwright) can regenerate visual evidence on your machine — recommended companion step.

## FOUNDATION — what's good
- Single design system: Radix/shadcn primitives + Tailwind across all 26 pages — consistent buttons, dialogs, tables. This is better discipline than most internal ERPs.
- Brand theming was done deliberately (BRAND_THEME_REPORT.md exists from May).
- Print CSS centralized in `index.css` with per-document print components.

## PER-AREA FINDINGS

### 1. Operations (the daily-driver screen) — biggest UX risk
**Evidence:** `OperationsPage.tsx` 3,963 lines; **0 responsive (`sm:/md:/lg:`) classes in its route wrapper**; loads clients+brands+stores+products+materialCodes+estimates+challans+invoices+ledger on mount (`useOperationsData.ts`).
- Initial load fetches ~9 full collections before paint → perceived slowness will grow with data. Single `loading` boolean = all-or-nothing spinner.
- Desktop-only layout. On mobile this screen — the one field/ops staff most need — is effectively unusable (code-inferred).
- One component owning estimates, DCs, WCCs, invoices = deep tab/state nesting; workflow speed suffers because every sub-flow lives behind the same mega-screen.

### 2. Navigation
26 routes in a flat sidebar (App.tsx). Related items are scattered: invoices / submitted-invoices / pending-payments / invoice-packet / client-ledger are 5 separate top-level entries that are one mental module ("Money"). Same for clients/brands/stores/products ("Masters"). Recommend grouping into 5–6 sections: Dashboard · Sales · Projects · Money · Masters · Admin/Automation. Fewer clicks, faster orientation for new staff.

### 3. Visual hierarchy & white space
Code-inferred from component composition: dense tables with uniform font weights dominate; few summary/KPI cards above lists (Dashboard has some, list pages mostly don't). Modern ERP pattern: every list page opens with 3–4 stat chips (count, total value, overdue) before the table. Cheap to add, large perceived-quality gain. This also matches your stated preference for compact, low-scroll UI — chips compress information above the fold.

### 4. Loading / error states
Manual fetch per page (no react-query) → inconsistent states: some pages show spinners, errors mostly go to `console.error` with no user-facing toast (e.g. `useOperationsData.ts` catch blocks). Users experience silent failures as "the page is empty." A shared fetch layer fixes UX and architecture together.

### 5. Mobile usability
- `Dashboard.tsx`: 7 responsive classes — partial effort exists.
- Operations/Estimate builder: effectively fixed-width; EstimateBuilder (2,615 lines) renders wide tables with no responsive collapse pattern.
- Field staff path that *matters* on mobile is FieldProjectUpload (token link) — review that screen first on a real phone; it's the highest-traffic mobile surface.

### 6. Workflow speed
The chain estimate → PO → execution → WCC → signed WCC → invoice is complete but navigationally fragmented across screens. Missing: a single project timeline view showing where each job sits in the chain with next-action buttons. (This is the "Activity timeline" already on your Priority A list — confirmed as the right call.)

### 7. Professional appearance vs modern ERPs
What separates Sunrise visually from Zoho/Monday today (code-inferred): no global search/command palette, no notification bell, no per-record activity feed, no avatar/initials chips on assignments, minimal empty-state illustrations. None are hard; together they account for most of the "internal tool vs product" feel.

## TOP 5 UI ACTIONS (by impact/effort)
1. Group sidebar into 6 sections — 2 hrs, instant orientation gain.
2. Toast-based error surface + shared fetch layer — fixes silent failures everywhere.
3. KPI chips on Money pages (outstanding, overdue, this-month billed) — high visibility for you as owner.
4. Project timeline strip in ClientWorkspace/ProjectDocuments — one glance = job status.
5. Mobile pass on FieldProjectUpload first, Operations later.
