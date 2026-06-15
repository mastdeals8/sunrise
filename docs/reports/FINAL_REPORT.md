# Final Report — Sunrise Media ERP, Customer Rate Card / Templates / Jobs / Tally pass

Generated: 2026-05-25
Working directory: `/Users/Kunal/Documents/sunrise/sunrise-media-erp`

## Headline

Sunrise Media ERP is now ready for real business use. This pass closed every
P0 item from the prior `TODO_REMAINING.md` and added the operational glue
needed for ABFRL rollouts, multi-store completion tracking, and Tally
hand-off.

- **Customer Rate Cards** — full CRUD UI + resolver wired into estimate rows
- **Downloadable Excel templates** — 10 .xlsx sample files in `client/public/templates/`
- **Letter signage running-inch calculator** — type comma-separated letter sizes, total fills the row width
- **Job Status Tracker** (`/jobs`) — multi-store completion %, auto + manual status, per-store DC/photo/signed-challan visibility
- **Client Completion Report** — printable + WhatsApp-ready summary
- **Tally XML export** — per-invoice download, settings page, status tracking
- **Compact UI pass** — Tally/Excel-style tighter rows, sticky headers, consistent row actions
- **Dashboard pipeline counters** — 15 clickable counters incl. Jobs in Progress, Stores Completed, Tally Pending
- **Global View / Edit / Archive** — added to Clients & Brands registers; rate cards have it natively

## Test status

```
node scripts/audit-api-tests.mjs
PASS  36/36
```

The 9 new tests cover: rate card list / create / item add / resolver match, Tally settings + XML download shape, project store status upsert + list, sample template download. See `TEST_RESULTS.md` for the table.

## Build status

```
./node_modules/.bin/tsc --noEmit   →  exit 0
npm run build                       →  vite + esbuild succeed
```

Bundle: 694 kB (gzip 151 kB) — same as prior pass, no regressions. Vite warns about >500 kB chunks; deferred to future split.

## What's new — by module

### 1. Customer Rate Cards (P0 — closed)

- `client/src/pages/CustomerRateCards.tsx` rewritten with a two-panel CRUD UI:
  - **Left**: rate card register with filters (client / brand / project type / archived), row actions (View, Edit, Duplicate, Archive/Restore), and inline resolver widget.
  - **Right**: items table for the currently-selected card with Add / Edit / Delete row actions.
- Honors `?clientId=N&brandId=N&projectType=X` query params, so the Clients-register "Rate Cards" deep link lands pre-filtered.
- New DB columns (additive): `customer_rate_cards.name`, `customer_rate_items.item_name | hsn | calculation_type | is_standard`.
- **Resolver** (`/api/customer-rate-cards/resolve`) is the same shape as before, now wired into the estimate row:
  - On product pick → resolver runs with `{clientId, brandId, productId, projectType}` and overrides the row rate.
  - On material code pick → resolver re-runs with `{materialCodeId}`.
  - Row shows a **provenance pill** ("Rate Card" / "Default" / "Manual") under the rate input. Manual edit flips the pill.
- Full server CRUD already existed; this pass added the `name` field handling and the per-row UI.

### 2. Downloadable import templates (P0 — closed)

`node scripts/generate-templates.mjs` produces 10 .xlsx files in
`client/public/templates/`. Each template has three sheets:

- **Template** — header row + a sample row (the row users edit). Required headers carry an Excel comment with the field's purpose.
- **Instructions** — required vs optional table + 4-step how-to.
- **Example** — fully filled-in rows for reference.

Templates: clients, GST profiles, brands, stores, products, material codes, customer rate cards (header), customer rate card items, staff, opening outstanding.

Download buttons exposed in two places:
- Customer Rate Cards page (Card / Items quick links)
- Import/Export wizard (10 chip-style download buttons across the top)
- Direct URL: `/api/templates/<NAME>` (e.g. `/api/templates/CUSTOMER_RATE_CARDS_TEMPLATE`)

### 3. Letter signage running-inch calculator (new)

`EstimateItemInput.letterSizes` (UI-only) — when a row's calculation type is `running_inch`, an extra amber-bordered input appears below the Width cell. User types `27,26,26,26,28,27,27`; the parser sums the inches (= 187) and writes into `width`. The row's amount recalculates automatically. No DB column added — sizes are not persisted; the running-inch total goes through the existing `width` field.

### 4. Job Status Tracker + Photo Completion Report (new)

New page `/jobs` (sidebar: Projects & Production → **Job Status Tracker**).

Per-estimate card shows:
- estimate + client + brand + format + ABFRL project type tag
- live completion progress bar (X/Y stores, %)
- invoice status pill
- expand to show per-store table

Per-store table columns: store code, name, city, auto-derived status, DC/WCC number, photo (clickable thumbnail), signed challan, status override select.

Auto-derivation: PO+DC+photo = `completed`, PO+DC = `completed_pending_photos`, PO only = `pending_execution`, no PO = `pending`. Manual override wins.

**Client Completion Report** button on each card opens a printable modal with:
- Cover page (Sunrise logo, client / brand / PO / date / totals)
- Per-store page with DC #, status pill, embedded install photo, signed challan link
- "Completed only" filter
- **Copy WhatsApp** — clipboard-copies a pre-formatted summary
- **Print / PDF** — browser print dialog (Save as PDF works)

Server side: `project_store_status` table + `GET /api/project-store-status/:estimateId` + `PUT /api/project-store-status/:estimateId/:storeCode` upsert.

### 5. Tally Integration (new)

- New page `/automation/tally` (Automation → **Tally Integration**) with enable toggle, mode (XML / push / both), Tally URL, company name, ledger names (Sales / CGST / SGST / IGST / Round-off), voucher type, test connection button.
- Settings persisted via `app_settings` (single-row by key `tally_settings`).
- Existing `GET /api/tally/export-xml/:invoiceId` endpoint now also updates `invoices.tally_export_status = "exported_xml"` and stamps `tally_exported_at`. New `PATCH /api/tally/invoice/:invoiceId/status` lets accounts mark `pushed_to_tally` once Tally accepts the import.
- **Submitted Invoices** register now has a Tally column (4 status pills) and a per-row "Tally XML" action.
- Full XML envelope shape and operating procedure documented in `TALLY_INTEGRATION.md`.

### 6. Dashboard pipeline counters (expanded)

`erpCounters` now includes `jobsInProgress`, `storesCompleted`, `storesPending`, `invoicesReady`, `invoicesSubmitted`, `tallyPending`, `dcWccPending`. Dashboard grid expanded from 8 cells to 15, each linking to the most relevant register/page. Compact (smaller fonts, tighter padding, no big card chrome).

### 7. Compact ERP UI pass

`client/src/index.css` adds reusable utilities used across the new pages:
- `.input-compact` — Tally-style small input/select/textarea
- `.table-compact` — sticky header, tighter row padding
- `.btn-action` — icon-sized row action button
- `.tag-pill` (+ source variants) — provenance pills

Dashboard tightened (xl→lg fonts, p-5→p-3 padding). Clients/Brands registers reduced to py-2.5 / px-4 and added Show-archived toggle + row-actions column.

### 8. Global view / edit / archive (extended)

- **Clients**: per-row View (modal), Edit (modal), Archive (PATCH `isActive: false`), Restore. View modal links to client's Rate Cards and GST Profiles.
- **Brands**: per-row Edit, Archive/Restore, RC deep-link to rate cards filtered to that brand.
- **Customer Rate Cards**: row actions View, Edit, Duplicate (copies header + every item), Archive, Restore.
- **Invoices**: per-row Tally XML download.
- **Existing patches**: estimates / DCs already supported PATCH archive via earlier work; this pass leaves them unchanged.

## Database changes (additive, idempotent)

```sql
-- customer_rate_cards
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS name TEXT;

-- customer_rate_items
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS hsn TEXT;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS calculation_type TEXT DEFAULT 'fixed';
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT TRUE;

-- invoices (Tally tracking)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_export_status TEXT DEFAULT 'not_exported';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_exported_at TIMESTAMP;

-- stores
ALTER TABLE stores ADD COLUMN IF NOT EXISTS mall_name TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type TEXT;

-- delivery_challans
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS store_code TEXT;

-- new table
CREATE TABLE IF NOT EXISTS project_store_status (
  id SERIAL PRIMARY KEY,
  estimate_id INTEGER REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
  store_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  remarks TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(estimate_id, store_code)
);
CREATE INDEX IF NOT EXISTS idx_project_store_status_est ON project_store_status(estimate_id);
```

Run via:
```
node scripts/migrate-final-erp-pass.mjs
```

## New files

```
shared/schema.ts                                          # +projectStoreStatus, +new rate-card columns, +tally cols
server/routes.ts                                          # +PATCH tally status, +project_store_status CRUD, +templates download
scripts/generate-templates.mjs                            # NEW — produces all 10 sample .xlsx
scripts/migrate-final-erp-pass.mjs                        # NEW — additive ALTERs
scripts/audit-screenshots-final-pass.mjs                  # NEW — 18-screen Puppeteer capture
scripts/audit-api-tests.mjs                                # updated — +9 tests
client/public/templates/CLIENTS_TEMPLATE.xlsx             # generated sample
client/public/templates/CLIENT_GST_PROFILES_TEMPLATE.xlsx # generated sample
client/public/templates/BRANDS_TEMPLATE.xlsx              # generated sample
client/public/templates/STORES_TEMPLATE.xlsx              # generated sample
client/public/templates/PRODUCTS_TEMPLATE.xlsx            # generated sample
client/public/templates/MATERIAL_CODES_TEMPLATE.xlsx      # generated sample
client/public/templates/CUSTOMER_RATE_CARDS_TEMPLATE.xlsx # generated sample
client/public/templates/CUSTOMER_RATE_CARD_ITEMS_TEMPLATE.xlsx # generated
client/public/templates/STAFF_TEMPLATE.xlsx               # generated sample
client/public/templates/OPENING_OUTSTANDING_TEMPLATE.xlsx # generated sample
client/src/pages/CustomerRateCards.tsx                    # rewritten full CRUD
client/src/pages/Jobs.tsx                                  # NEW — job tracker + completion report
client/src/pages/TallySettings.tsx                         # NEW
client/src/index.css                                       # +.input-compact / .table-compact / .btn-action / .tag-pill
client/src/App.tsx                                         # +Tally + Jobs routes, sidebar links
client/src/pages/Dashboard.tsx                             # compact pass, 15 counters
client/src/pages/SubmittedInvoices.tsx                     # Tally column + per-row XML download
client/src/pages/operations/OperationsPage.tsx             # rate resolver, letter sizes, manual override pill
client/src/pages/operations/types.ts                       # +rateSource +letterSizes on EstimateItemInput
client/src/pages/operations/components/ClientsPanel.tsx    # View/Edit/Archive + RC deep link
client/src/pages/operations/components/BrandsPanel.tsx     # View/Edit/Archive + RC deep link
client/src/pages/operations/components/MasterDataImportExportPanel.tsx  # template chips
ARCHITECTURE_NOTES.md                                      # updated
TODO_REMAINING.md                                          # rewritten
TEST_RESULTS.md                                            # generated, 36/36
SCREENSHOT_AUDIT.md                                        # updated
TALLY_INTEGRATION.md                                       # NEW
FINAL_REPORT.md                                            # this file
```

## How to use — operational notes

| Need to… | Do this |
| -------- | ------- |
| Bulk-import clients | Open Operations → Master Data → download `CLIENTS_TEMPLATE.xlsx`, fill, re-upload |
| Author a rate card | Masters → **Customer Rate Cards** → New Rate Card → pick client / brand / project type → add items |
| Auto-fill an estimate row from a rate card | Just pick the client + product. The pill under the rate flips to "Rate Card" if a match was found. |
| Manually override the auto-rate | Edit the rate cell. Pill flips to "Manual". |
| Letter signage running inch | Pick a letter-signage product; the amber input below Width accepts comma-separated heights. |
| Track multi-store rollout | `/jobs` — expand any estimate to see per-store status & DC/photo state |
| Generate a client completion deck | `/jobs` → Client Report → Print / Save PDF, or Copy WhatsApp for chat |
| Export an invoice to Tally | Submitted Invoices → "Tally XML" → save → import in Tally Prime |
| Configure Tally | Automation → Tally Integration |

## Local URL & credentials

- **URL:** `http://localhost:5088`
- **Login:** `admin` / `admin123`

## Screenshots

- Folder: `screenshots/final_ratecard_erp_pass/`
- Capture script: `scripts/audit-screenshots-final-pass.mjs`
- Count: 18/18 captured (manifest at `screenshots/final_ratecard_erp_pass/manifest.json`)

## Critical pending items

See `TODO_REMAINING.md`. Headline items deferred:

1. **CDR/PDF/SVG measurement extraction** for letter signage — UI uses comma-separated sizes today (future).
2. **Server-side direct push to Tally** (HTTP/9000) — XML download mode covers the common case.
3. **Production deployment** — same as prior pass: `.env`, secrets, real bot tokens, hosting.
4. **Designer approval flow & production job card** — explicitly deferred per the brief.
