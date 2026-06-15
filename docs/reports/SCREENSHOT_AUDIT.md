# Screenshot Audit — Full ERP

---

## Final ratecard / Tally / Jobs pass (2026-05-25)

Captured: 2026-05-25
Folder:   `screenshots/final_ratecard_erp_pass/`
Manifest: `screenshots/final_ratecard_erp_pass/manifest.json`
Tool:     Puppeteer + headless Chrome, via `scripts/audit-screenshots-final-pass.mjs`
Count:    18/18 captured

Focused on the pieces added in the final pass.

| # | Slug                          | Route                          | Notes |
|---|-------------------------------|--------------------------------|-------|
| 1 | dashboard-counters            | /                              | Dashboard with new counters (Jobs in progress, Stores done/pending, Tally pending) |
| 2 | clients-with-actions          | /operations#clients            | Clients register with View/Edit/Archive |
| 3 | brands-with-actions           | /operations#brands             | Brands register with View/Edit/Archive + RC deep link |
| 4 | stores-list                   | /operations#stores             | Stores list |
| 5 | products-list                 | /operations#products           | Products & rates |
| 6 | material-codes                | /material-codes                | Material Codes master |
| 7 | import-export-templates       | /operations#master_data        | Import / Export with downloadable templates |
| 8 | customer-rate-cards           | /customer-rate-cards           | Rate Cards list |
| 9 | rate-cards-with-resolver      | /customer-rate-cards           | Resolver widget expanded |
| 10| estimates-list                | /operations#estimates          | Estimate register |
| 11| tally-settings                | /automation/tally              | Tally Integration settings |
| 12| submitted-invoices-tally      | /submitted-invoices            | Submitted Invoices with Tally column |
| 13| jobs-tracker                  | /jobs                          | Job Status Tracker |
| 14| jobs-tracker-store-detail     | /jobs                          | Job Tracker — store-level row expanded |
| 15| completion-report             | /jobs                          | Client Completion Report modal |
| 16| pending-payments              | /pending-payments              | Pending Payments |
| 17| petty-cash                    | /petty-cash                    | Petty Cash |
| 18| staff-master                  | /staff                         | Staff master |

### States not captured by the script

These require manual action and aren't part of the headless capture:

- **Estimate row with Rate Card pill**: open Operations → Estimates → New, pick an ABFRL client with a configured rate card → product picker triggers the resolver → pill flips to "Rate Card" under the Rate input.
- **Letter signage running-inch entry**: pick a letter-signage product on an estimate row; the amber input below Width appears.
- **WhatsApp summary copy**: Jobs → Client Report → "Copy WhatsApp" places a formatted summary on the clipboard.

To re-run captures:

```
npm run dev          # → http://localhost:5088
node scripts/audit-screenshots.mjs               # 50 standard screens
node scripts/audit-screenshots-final-pass.mjs    # 18 pass-specific screens
```

---

## Final-correction pass (2026-05-24, third pass)

Captured: 2026-05-24
Folder:   `screenshots/final_correction_audit/`
Zip:      `screenshots/final_correction_audit.zip` (~1.0 MB)
Manifest: `screenshots/final_correction_audit/manifest.json`
Tool:     Puppeteer + headless Chrome, via `scripts/audit-screenshots-final.mjs`

This pass corrects 3 misnamed screenshots from the second pass:
- previous `20-invoice-builder.png` actually showed the WCC editor (wrong);
- previous `22-record-payment-modal.png` actually showed the Pending Payments
  list (modal hadn't opened);
- previous `18-wcc-editor.png` showed the Standard DC, not ABFRL.

| # | File | Route | Captured | What the screen proves | Issue |
|---|------|-------|----------|------------------------|-------|
| 1 | 01-invoice-builder.png | `/operations#invoices_ledger` | yes | Real **Invoice Builder** sub-tab: "How to create an invoice" steps + list of estimates with `Create Invoice` button per row. Sidebar shows Invoicing → Invoice Builder highlighted. | none |
| 2 | 02-record-payment-modal.png | `/operations#invoices_ledger` (modal) | yes | **Record Customer Payment** modal actually open: Client / Amount / Method (Bank Transfer/NEFT default) / Payment Date / Remarks / UTR Ref + Record Payment button. | none |
| 3 | 03-abfrl-wcc-editor.png | `/operations#challans` (modal) | yes | WCC editor with an ABFRL DC selected — header "WORK COMPLETION CERTIFICATE (CHALLAN)" already matches Part B written spec; PROJECT / JOB TITEL block present, Visual Brief section present, "Below Section Need To Filled By Store Only" present, Store Code/Name/City/State block present. Bottom checklist legend (WINDOW / IN STORE / NSO / REPAIRING / MATERIAL TRANSFER) NOT YET present — Part B pass will add it once reference PDFs are placed. | minor — checklist legend missing |
| 4 | 04-abfrl-wcc-print-preview.png | `/operations#challans` (modal, @media print) | yes | WCC editor rendered in print media — what the PDF would look like. | same as #3 |
| 5 | 05-petty-cash-detail.png | `/petty-cash` | yes | Petty Cash page with add/edit form region visible (category, amount, vendor, expense date, proof upload). | none |
| 6 | 06-staff-attendance.png | `/staff` (Touch Shift Console tab) | yes | Staff Attendance default tab: Select Staff Member + Register Shift Clock side-by-side. | none |
| 7 | 07-staff-salary-advances.png | `/staff` (Advances tab) | yes | Salary / Advances Ledger tab. | none |
| 8 | 08-customer-rate-cards-resolver.png | `/customer-rate-cards` | yes | Customer Rate Cards page upgraded from dead placeholder → "Coming next: client-specific rates" banner + live "Try the resolver" widget marked LIVE. New nav placement: Masters → Customer Rate Cards. | none |
| 9 | 09-abfrl-per-store-totals.png | `/operations?new=1#estimates` | yes | New **Per-Store Totals** panel: shows Material / Packing% / Installation% / Transport / Store Total per attached store (2 stores visible). Above it, the Duplicate Store toolbar and the rows-with-store-assignment grid. | none |

### How to re-run

```
PORT=5088 npm run dev
node scripts/audit-screenshots-final.mjs
cd screenshots && zip -qr final_correction_audit.zip final_correction_audit
```

### Part B status (ABFRL WCC reference-PDF match)

**Paused.** Waiting on the four reference PDFs to be placed at:

```
reference-docs/wcc/
  AKOLA_challan.pdf
  Aundh Chalan.pdf
  Aundh Chalan -1.pdf
  Black Vinyl - Chalan.pdf
```

Once placed, Part B will: tighten the A4 outer/inner border thickness to match, add the WINDOW / IN STORE / NSO / REPAIRING SERVICES / MATERIAL TRANSFER checklist legend at the bottom, allow upload of one large image or a montage grid in the Visual Brief area, and add the @media print CSS to render exactly like the reference.

---

## Corrected workflow audit (2026-05-24, second pass)

Captured: 2026-05-24
Folder:   `screenshots/full_app_audit_corrected/`
Zip:      `screenshots/full_app_audit_corrected.zip` (~3.5 MB)
Manifest: `screenshots/full_app_audit_corrected/manifest.json`
Tool:     Puppeteer + headless Chrome, via `scripts/audit-screenshots-corrected.mjs`
Viewport: 1440 × 900, full-page (auto-extended).

The first pass (`screenshots/full_app_audit/`) repeated base landing pages.
This corrected pass DRIVES the workflows — opens the New Estimate form via
`?new=1`, switches client format dropdowns, toggles project type SELEX/CAPEX,
opens the View / PO Upload / WCC modals, navigates to the Invoice Packet
Builder, and triggers @media print so PDF-style previews are captured.

| # | File | Route | Captured | What the screen proves | Issue |
|---|------|-------|----------|------------------------|-------|
| 1 | 01-new-estimate-step1-customer.png | `/operations?new=1#estimates` | yes | Sidebar shows the new ERP grouping (Masters, Sales & Estimates → **New Estimate / Estimate Register / Estimate Templates / Product Calculator**, Projects & Production, Delivery & Documents, Invoicing, Finance, Staff, Automation, Admin). New Estimate form auto-opened. 6-step strip visible: Customer → Store/Site → Items → Store Totals → Preview → Export/Print. | none |
| 2 | 02-estimate-format-normal.png | `/operations?new=1#estimates` | yes | Normal format selected. Blue "Normal Estimate Workflow" strip. No Material Code column. | none |
| 3 | 03-estimate-format-letter.png | `/operations?new=1#estimates` | yes | Letter Signage format. Dimension headers swap to "Letter Height" / "No. of Letters". | none |
| 4 | 04-estimate-format-abfrl-selex.png | `/operations?new=1#estimates` | yes | ABFRL Multi-Store + **SELEX** project type. Purple workflow strip. Project Type pill = SELEX. Material Code column visible (optional for SELEX). | none |
| 5 | 05-estimate-format-abfrl-capex.png | `/operations?new=1#estimates` | yes | ABFRL Multi-Store + **CAPEX**. Project Type pill = "CAPEX (material code REQUIRED per row)". Duplicate-store toolbar visible. | none |
| 6 | 06-estimate-add-store-picker.png | `/operations?new=1#estimates` | yes | ABFRL row-level Store Code picker (per-row store attachment). | none |
| 7 | 07-estimate-abfrl-store-1-rows.png | `/operations?new=1#estimates` | yes | Row attached to Store 1. | none |
| 8 | 08-estimate-abfrl-store-2-rows.png | `/operations?new=1#estimates` | yes | Row attached to Store 2 in the same estimate (multi-store grouping). | none |
| 9 | 09-estimate-material-code-dropdown.png | `/operations?new=1#estimates` | yes | Material Code dropdown in an ABFRL row. | none |
| 10 | 10-estimate-row-actions.png | `/operations?new=1#estimates` | yes | Per-row Duplicate (copy icon) + Delete (trash icon) in the right-most column. | none |
| 11 | 11-estimate-store-duplicate-toolbar.png | `/operations?new=1#estimates` | yes | Top-of-table "DUPLICATE STORE — From → To — Copy rows / Clear source" toolbar. | none |
| 12 | 12-estimate-view-modal.png | `/operations#estimates` | yes | Estimate View modal (Interactive Workflow Console) opened from register's View action. | none |
| 13 | 13-estimate-excel-export-button.png | `/operations#estimates` | yes | View modal shows Excel Export (.XLSX), Print/PDF Export, and Estimate/Excel/PDF/Clean Data preview tabs. Inline `View` and `Excel` actions visible on register rows behind the modal. | none |
| 14 | 14-estimate-print-preview.png | `/operations#estimates` | yes | Same modal rendered in `@media print` — what the PDF would look like. | none |
| 15 | 15-estimate-view-page.png | `/operations#estimates` | yes | Estimate View page with totals, linked DC list, payment state. | none |
| 16 | 16-po-upload-modal.png | `/operations#estimates` | yes | PO Upload modal: PO number / date / amount / file upload / remarks. | none |
| 17 | 17-linked-documents.png | `/operations#estimates` | yes | Linked Documents region scrolled into view inside the View modal. | none |
| 18 | 18-wcc-editor.png | `/operations#estimates` | yes | WCC / Dispatch Builder with live A4 preview on right, photo gallery, format selector. | none |
| 19 | 19-wcc-print-preview.png | `/operations#estimates` | yes | WCC editor under @media print. | none |
| 20 | 20-invoice-builder.png | `/operations#invoices_ledger` | yes | Invoice Builder tab (Packets / Ledger / Clients sub-tabs). | none |
| 21 | 21-invoice-packet-builder.png | `/invoice-packet` | yes | Invoice Packet Builder with a packet selected — branded headers on invoice / estimate / DC summaries. | none |
| 22 | 22-record-payment-modal.png | `/pending-payments` | yes | Record Payment modal: amount, method, date, invoice allocation. | none |

### How to re-run

```
# Make sure dev server is up:
PORT=5088 npm run dev

# Capture the 22 corrected workflow screenshots:
node scripts/audit-screenshots-corrected.mjs

# Re-zip:
cd screenshots && zip -qr full_app_audit_corrected.zip full_app_audit_corrected
```

---

## First-pass full-app audit (original 50-screen capture)

Captured: 2026-05-24
Folder:    `screenshots/full_app_audit/`
Zip:       `screenshots/full_app_audit.zip` (~6.6 MB)
Manifest:  `screenshots/full_app_audit/manifest.json`
Tool:      Puppeteer + headless Chrome, via `scripts/audit-screenshots.mjs`
Viewport:  1440 × 900, full-page (auto-extended).

`status` legend:
- **captured** — page rendered fully, screenshot is canonical for that screen.
- **captured-base-state** — base route rendered. The deeper state requested in the task description (modal open, dropdown expanded, tab switched, etc.) requires a manual click and is not in the captured PNG. The page is in its default landing state in the file.

| # | File | Screen | Route / hash | Status | Notes / manual step (if any) |
|---|------|--------|--------------|--------|------------------------------|
| 1 | 01-login.png | Login | `/login` | captured | Sign In / Register tabs, logo, ERP tagline. |
| 2 | 02-dashboard.png | Dashboard | `/` | captured | Counters, pipeline, task completion, staff. |
| 3 | 03-sidebar.png | Sidebar expanded | `/` | captured | All sections opened via script. |
| 4 | 04-admin-users.png | Admin Users | `/admin` | captured | |
| 5 | 05-roles.png | Roles | `/admin/roles` | captured | |
| 6 | 06-settings.png | Settings | `/admin/settings` | captured | |
| 7 | 07-clients.png | Clients | `/operations#clients` | captured | 3 clients listed (ABFRL, Apollo, QA Test). |
| 8 | 08-client-billing-profiles.png | Client GST Profiles | `/operations#clients` | captured-base-state | Click "Manage GST Profiles" on a client row to open the dialog. |
| 9 | 09-brands.png | Brands | `/operations#brands` | captured | |
| 10 | 10-stores.png | Stores | `/operations#stores` | captured | |
| 11 | 11-products.png | Products & Rates | `/operations#products` | captured | |
| 12 | 12-material-codes.png | Material Codes | `/material-codes` | captured | |
| 13 | 13-import-export.png | Import / Export | `/operations#master_data` | captured | |
| 14 | 14-all-estimates.png | All Estimates | `/operations#estimates` | captured | 32+ estimates. Mix of NORMAL and ABFRL. |
| 15 | 15-new-estimate-normal.png | New Estimate — Normal | `/operations#estimates` | captured-base-state | Click "New Estimate", set format = "Sunrise Normal Standard". |
| 16 | 16-new-estimate-letter.png | New Estimate — Letter Signage | `/operations#estimates` | captured-base-state | Click "New Estimate", set format = "Letter Signage". |
| 17 | 17-new-estimate-abfrl-selex.png | New Estimate — ABFRL SELEX | `/operations#estimates` | captured-base-state | Click "New Estimate", set format = "ABFRL Multi-Store Grouped", set **Project Type** dropdown = SELEX. |
| 18 | 18-new-estimate-abfrl-capex.png | New Estimate — ABFRL CAPEX | `/operations#estimates` | captured-base-state | Same as #17 but **Project Type** = CAPEX. UI gives missing-material-code warning at submit. |
| 19 | 19-abfrl-store-1.png | ABFRL multi-store: Store 1 | `/operations#estimates` | captured-base-state | Inside an ABFRL estimate, set Store column = first store on one row. |
| 20 | 20-abfrl-store-2.png | ABFRL multi-store: Store 2 | `/operations#estimates` | captured-base-state | Same, second store on another row. |
| 21 | 21-product-material-dropdown.png | Product / Material dropdown | `/operations#estimates` | captured-base-state | Open a row's product or material code dropdown. |
| 22 | 22-estimate-preview.png | Estimate Preview | `/operations#estimates` | captured-base-state | Click "Details & Workflows" → Preview. |
| 23 | 23-excel-export.png | Excel export | `/operations#estimates` | captured-base-state | Click Export Excel on an estimate (download). |
| 24 | 24-print-pdf-preview.png | Print / PDF preview | `/operations#estimates` | captured-base-state | Click Print Preview on an estimate. |
| 25 | 25-po-upload-modal.png | PO Upload modal | `/operations#estimates` | captured-base-state | Click PO Upload on an estimate. |
| 26 | 26-linked-documents.png | Linked Documents | `/operations#estimates` | captured-base-state | Expand the linked-docs region on an estimate row. |
| 27 | 27-project-tracker.png | Project Tracker | `/operations#project_tracker` | captured | |
| 28 | 28-project-documents.png | Project Documents | `/project-documents` | captured | |
| 29 | 29-delivery-challans.png | Delivery Challans | `/operations#challans` | captured | 16 DCs visible. |
| 30 | 30-abfrl-wcc-editor.png | ABFRL WCC editor | `/operations#challans` | captured-base-state | Open a WCC for edit. |
| 31 | 31-abfrl-wcc-print.png | ABFRL WCC print | `/operations#challans` | captured-base-state | Open Print/View on a WCC row. |
| 32 | 32-normal-dc.png | Normal DC | `/operations#challans` | captured-base-state | Open a non-ABFRL DC. |
| 33 | 33-invoice-builder.png | Invoice Builder | `/operations#invoices_ledger` | captured | |
| 34 | 34-invoice-packet-builder.png | Invoice Packet Builder | `/invoice-packet` | captured | Packet preview area, all sections branded. |
| 35 | 35-submitted-invoices.png | Submitted Invoices | `/submitted-invoices` | captured | |
| 36 | 36-client-ledger.png | Client Ledger | `/client-ledger` | captured | |
| 37 | 37-pending-payments.png | Pending Payments | `/pending-payments` | captured | |
| 38 | 38-record-payment-modal.png | Record Payment modal | `/pending-payments` | captured-base-state | Click "Record Payment" on an invoice. |
| 39 | 39-payment-ledger.png | Payment Ledger | `/finance` | captured | |
| 40 | 40-petty-cash.png | Petty Cash | `/petty-cash` | captured | |
| 41 | 41-expense-ledger.png | Expense visibility (Finance) | `/finance` | captured | Same page as #39, captured for traceability. |
| 42 | 42-salary-payables.png | Salary Payables (Finance) | `/finance` | captured | Same page as #39. |
| 43 | 43-staff-master.png | Staff master | `/staff` | captured | |
| 44 | 44-attendance.png | Attendance | `/staff` | captured-base-state | Switch to the Attendance tab on the Staff page. |
| 45 | 45-salary-advances.png | Salary / Advances | `/staff` | captured-base-state | Switch to the Advances tab. |
| 46 | 46-tasks.png | Tasks | `/tasks` | captured | |
| 47 | 47-telegram-settings.png | Telegram Bot Settings | `/automation/telegram` | captured | Token shown masked. |
| 48 | 48-whatsapp-settings.png | WhatsApp API Settings | `/automation/whatsapp` | captured | Token shown masked. |
| 49 | 49-bot-inbox.png | Bot Upload Inbox | `/automation/inbox` | captured | |
| 50 | 50-webhook-logs.png | Webhook logs | `/automation/inbox` | captured-base-state | Switch to logs tab if not default. |

## How to re-run

```
# 1. Make sure dev server is up:
PORT=5088 npm run dev

# 2. Capture all 50 screenshots:
node scripts/audit-screenshots.mjs

# 3. (optional) Rebuild the zip:
cd screenshots && zip -qr full_app_audit.zip full_app_audit
```

## Known issues found from screenshot review

None. All 50 captured screens render their default state correctly. The
"captured-base-state" rows are placeholders for screens that require an
interactive sub-state (modal, tab switch, dropdown) that the headless audit
doesn't drive; the underlying pages render fine.
