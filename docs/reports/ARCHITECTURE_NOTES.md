# Architecture Notes

Living document for design decisions and gotchas that aren't obvious from the
code. Add a new section at the bottom when a non-obvious convention takes hold.

---

## Drizzle + Zod date coercion (and why every POST/PATCH used to break)

### The problem

`shared/schema.ts` uses Drizzle's `timestamp("col")` for every date/datetime
column (e.g. `invoices.date`, `payments.date`, `attendance.checkInTime`,
`pettyCashExpenses.expenseDate`, `staffAdvances.date`,
`deliveryChallans.deliveryDate`, `estimates.poDate`, `users.joiningDate`,
`tasks.dueDate`, etc).

`drizzle-zod`'s `createInsertSchema()` reflects each `timestamp()` column as
**`z.date()` with `coerce: false`**. That means:

- A `Date` instance validates fine.
- A **string** (e.g. `"2025-04-01T00:00:00.000Z"` or `"2025-04-01"`) is
  rejected with:

      Expected date, received string

### Why this kept breaking routes

Browsers serialize `Date` to ISO strings when posting JSON. Express's
`body-parser` leaves them as strings. So any route that did the naive thing:

```ts
const parsed = insertInvoiceSchema.safeParse(req.body); // ❌ Zod rejects strings
```

would fail every time, until someone manually patched the route to convert
each timestamp field to a `Date` before parsing.

The historical fix was scattered all over `server/routes.ts`:

```ts
// duplicated across ~10 routes
const parsed = insertInvoiceSchema.safeParse({
  ...req.body,
  date: req.body.date ? new Date(req.body.date) : undefined,
  dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
});
```

Every new POST/PATCH route forgot a field and broke until someone added
another bespoke `new Date(...)` line.

### The safe pattern

Use the central helper at `server/utils/dateFields.ts`. A new route only has
to list which fields are dates:

```ts
import { preprocessDateFields, nowDefault } from "./utils/dateFields";

// Plain coercion: missing fields stay missing (so optional schema fields validate)
app.post("/api/finance/invoices", ..., async (req, res) => {
  const parsed = insertInvoiceSchema.safeParse(
    preprocessDateFields(req.body, ["date", "dueDate"]),
  );
  if (!parsed.success) return res.status(400).json({ ... });
  ...
});

// With a "now" default when the field is missing entirely
app.post("/api/petty-cash", ..., async (req, res) => {
  const parsed = insertPettyCashExpenseSchema.safeParse(
    preprocessDateFields(
      { ...req.body, addedBy: req.user!.id },
      [{ field: "expenseDate", defaultTo: nowDefault }],
    ),
  );
  ...
});

// For PATCH/PUT updates (no Zod parse, just safe coercion)
app.patch("/api/operations/delivery-challans/:id", ..., async (req, res) => {
  const updates = preprocessDateFields(req.body, ["deliveryDate"]);
  ...
});
```

### Rules of thumb

1. **Any route that calls `insertXSchema.safeParse(...)`** — wrap the body in
   `preprocessDateFields` first if the schema has timestamp columns. List
   every timestamp field on that table.
2. **Any PATCH/PUT that hands `req.body` directly to `storage.updateX(...)`**
   — wrap it in `preprocessDateFields` for the same reason; otherwise
   Drizzle gets a string and the DB driver may stringify or reject it.
3. **Don't change the schema.** Don't try to fix this by adding `.coerce` to
   schema fields globally — drizzle-zod regenerates the schemas from the
   table definition, and `timestamp()` is the right Drizzle column type for
   PostgreSQL `TIMESTAMP`.
4. **Don't trust the frontend to send `Date`.** JSON has no date type. The
   wire format is always a string.

### What the helper does

`preprocessDateFields(body, fields)` returns a shallow copy of `body` where
each listed field has been coerced:

- `Date` instance → kept as-is.
- Non-empty string or number → wrapped in `new Date(...)`.
  Invalid dates are left untouched (so Zod still rejects them, which is
  what we want).
- Missing / `null` / `""` with `defaultTo` → factory invoked
  (`nowDefault` = `() => new Date()`).
- Missing / `null` / `""` with no default → left untouched (so optional
  schema fields validate as `undefined`).

### Currently using the helper

All POST/PATCH routes touching timestamp columns now route through
`preprocessDateFields`:

- `POST /api/auth/register` (`joiningDate`)
- `PUT  /api/users/:id` (`joiningDate`)
- `POST /api/attendance` (`date`, `checkInTime`, `checkOutTime`)
- `POST /api/tasks` (`dueDate`, `startDate`, `completedDate`)
- `PUT  /api/tasks/:id` (`dueDate`, `startDate`, `completedDate`)
- `POST /api/petty-cash` (`expenseDate`, defaults to now)
- `PUT  /api/petty-cash/:id` (`expenseDate`)
- `POST /api/finance/invoices` (`date`, `dueDate`)
- `POST /api/finance/payments` (`date`)
- `POST /api/finance/payments/allocate` (`date`)
- `POST /api/advances` (`date`, defaults to now)
- `POST /api/operations/delivery-challans` (`deliveryDate`, defaults to now)
- `PATCH /api/operations/delivery-challans/:id` (`deliveryDate`)
- `PATCH /api/operations/estimates/:id` (`poDate`)

If you add a new timestamp column to a table, also update the relevant
route's field list — there's no automatic linkage between schema and route.

---

## SELEX vs CAPEX (ABFRL project type)

### The rule

ABFRL ships two distinct rollout programs and a single estimate must declare
which one it belongs to:

| Project type | Material code on each row |
|--------------|---------------------------|
| `SELEX`      | optional                  |
| `CAPEX`      | **required** on every row |
| (anything else / null) | not enforced     |

### Data model

- Column: `estimates.abfrl_project_type TEXT` (additive, IF NOT EXISTS).
- Drizzle field: `abfrlProjectType: text("abfrl_project_type")` in
  `shared/schema.ts`.
- Only meaningful when `clientFormat ∈ {ABFRL, abfrl_multi_store}`. NULL for
  non-ABFRL formats.

### UI

`client/src/pages/operations/OperationsPage.tsx` exposes a SELEX/CAPEX
dropdown inside the ABFRL workflow strip (visible only when the format is
ABFRL/abfrl_multi_store). The default is SELEX. A client-side guard rejects
the submit when CAPEX is selected and any row is missing a material code.

### Server enforcement

`server/routes.ts` (POST `/api/operations/estimates`) re-checks after Zod
validation:

```ts
if (isAbfrl && parsedEstimate.data.abfrlProjectType === "CAPEX") {
  const missing = parsedItems.data.filter(r => !r.materialCode && !r.materialCodeId);
  if (missing.length) return res.status(400).json({ message: "ABFRL CAPEX requires Material Code on every row..." });
}
```

The client guard is for UX; the server rule is the source of truth.

### Not yet wired

- XLSX export header doesn't render the project type yet. Add a "Project Type"
  cell in the multi-store and single-store ABFRL branches of the Excel builder
  in `server/routes.ts`.
- HTML packet builder summaries (`EstimateSummary`, `DcSummary`) should render
  a small `SELEX` / `CAPEX` pill next to the estimate number when present.

---

## Customer-specific formats (Normal, ABFRL, Landmark, Simply Kool, …)

### Model

Three places carry a free-form `format` column. The values listed below are
just the values we know about today — the column is intentionally open-ended
so new corporate customers can be onboarded by introducing a new value rather
than altering the schema.

| Table                | Column          | Today's values                                                 |
|----------------------|-----------------|----------------------------------------------------------------|
| `clients`            | `format`        | `normal`, `ABFRL`                                              |
| `estimates`          | `client_format` | `normal`, `ABFRL`, `abfrl_multi_store`, `letter_signage`       |
| `delivery_challans`  | `client_format` | `normal`, `ABFRL`                                              |

`clients.format` is the *client default*; estimates and DCs **snapshot** the
format at creation time (so a later change to the client default doesn't
retro-rewrite history).

### Adding a new customer format

To onboard, e.g., Landmark Group with format `landmark_multi_store`:

1. **UI dropdown.** Add the option in the estimate form's "Format Style
   Setting" select (`OperationsPage.tsx`, ~ line 1876).
2. **Excel export.** Add a `format === "landmark_multi_store"` branch in the
   `/api/operations/estimates/:id/export-excel` builder in `server/routes.ts`.
   Use the existing `abfrl_multi_store` branch as the template.
3. **Print headers.** If the packet builder is used, add a render branch in
   `client/src/pages/InvoicePacket.tsx`.
4. **(Optional)** Add a workflow guide strip and any format-specific input
   fields (vendor code, signage-only flags, etc.) modeled after the ABFRL
   block in `OperationsPage.tsx`.
5. **(Optional)** Add a rate card for the new format — see "Customer-specific
   rate cards" below.

There is no need to add a column to `clients` / `estimates` / `delivery_challans`
unless the new format requires storing extra, non-shared metadata. Default to
the existing string column.

---

## Customer-specific rate cards (live)

### Why

Today every product has a single `products.rate`. Real customers negotiate
their own rates per product / per project / per period. The pricing lookup
checks a customer (and optionally brand / project type) rate card, falling
back to the default product rate when nothing matches.

### Tables

```sql
customer_rate_cards (
  id              SERIAL PRIMARY KEY,
  name            TEXT,                    -- friendly "Peter England CAPEX 2026"
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brand_id        INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  project_type    TEXT,                    -- "SELEX", "CAPEX", "rollout", …
  effective_from  TIMESTAMP,
  effective_to    TIMESTAMP,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

customer_rate_items (
  id                 SERIAL PRIMARY KEY,
  rate_card_id       INTEGER NOT NULL REFERENCES customer_rate_cards(id) ON DELETE CASCADE,
  product_id         INTEGER REFERENCES products(id) ON DELETE CASCADE,
  material_code_id   INTEGER REFERENCES material_codes(id) ON DELETE SET NULL,
  item_name          TEXT,
  description        TEXT,
  hsn                TEXT,
  uom                TEXT NOT NULL DEFAULT 'pcs',
  calculation_type   TEXT DEFAULT 'fixed',
  rate               REAL NOT NULL DEFAULT 0,
  gst_percent        REAL NOT NULL DEFAULT 18,
  is_standard        BOOLEAN NOT NULL DEFAULT TRUE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP DEFAULT NOW()
);
```

### Resolver

`GET /api/customer-rate-cards/resolve?clientId&brandId&productId&materialCodeId&projectType`
returns the most-specific active matching rate or `null`. Ranking (highest specificity wins):

1. client + brand + projectType + (product OR materialCode)
2. client + brand + product
3. client + projectType + product
4. client + product

Fall-through is `null`; the caller (estimate row) keeps using `products.rate`.

### Estimate row integration

`OperationsPage.tsx > handleProductSelectChange` and `handleMaterialCodePick`
invoke `resolveRateForRow`. The row stores a UI-only `rateSource` flag
(`"rate_card" | "default" | "manual"`) that drives the provenance pill under
the Rate column. Manual edit of the Rate cell flips the pill to "Manual".

### Authoring UI

`/customer-rate-cards` is the master. Left panel = card register with
filters; right panel = items for the selected card. Both panels expose
View / Edit / Duplicate (header + every item) / Archive / Restore. Honors
`?clientId=`, `?brandId=`, `?projectType=` query params so deep links from
the Clients & Brands registers land pre-filtered.

---

## Dashboard finance aggregation — known schema/field mismatches (fixed)

The dashboard endpoint (`GET /api/finance/dashboard`) used to silently report
zeros for these three fields because of schema drift. Fixed this pass; recorded
here as a reference for future regressions.

| Field             | Source                                                            |
|-------------------|-------------------------------------------------------------------|
| `salaryPayable`   | sum of `netSalary` from `payroll` rows where `status !== "paid"` |
| `totalAdvances`   | sum of `amount` from `staff_advances` where `isAdjusted === false` |
| `pettyCashSpent`  | sum of `amount` from `petty_cash_expenses` where `status !== "rejected"` (the dashboard prefilters to `status = "approved"` upstream; this is a defense in depth) |

If you rename a status value or change a field name in `shared/schema.ts`,
re-grep the dashboard aggregator before deploying.


---

## Project store status (per-store completion tracking)

Multi-store ABFRL rollouts need granular status per store (`PE_DEL_001`,
`PE_DEL_002`, …) since the same estimate can have some stores delivered
and others pending.

### Table

`project_store_status (estimate_id, store_code, status, remarks, updated_by, updated_at)` — unique on `(estimate_id, store_code)`.

Allowed statuses: `pending | in_progress | completed | blocked | completed_pending_photos | pending_execution | proof_received`.

### Derivation rules

The Jobs Tracker derives a default status from existing data first; the
project_store_status row, if present, overrides it.

| Condition                                       | Auto status                |
| ----------------------------------------------- | -------------------------- |
| no PO yet                                       | `pending`                  |
| PO + no DC                                      | `pending_execution`        |
| PO + DC + install photo                         | `completed`                |
| PO + DC + signed challan (no photo)             | `proof_received`           |
| PO + DC only                                    | `completed_pending_photos` |

The Client Completion Report uses these to colour status pills and to
build the WhatsApp summary.

---

## Tally export

See `TALLY_INTEGRATION.md` for the full operating procedure. Architecturally
the integration is **export-only** (no payment sync) and **per-invoice**.
The XML envelope is generated server-side and includes party ledger, sales,
CGST/SGST/IGST, and bill allocation. Settings live in `app_settings`
keyed `tally_settings`. The status column on `invoices.tally_export_status`
moves automatically to `exported_xml` on download; accounts flips it to
`pushed_to_tally` once Tally confirms the import.
