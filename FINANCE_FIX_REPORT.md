# Finance Fix Report
Generated: 2026-06-13

## Root Cause of Finance Issues

Both reported finance issues traced back to the same two root causes:

### 1. `follow_up_status column missing`
The Phase 3 migration (`2026-06-12-phase3-tables.sql`) adds this column. It was not yet
applied at the time the log error was captured. **Column now present; error will not recur.**

### 2. Invoice dates returned as `{}`
The `scrubSensitive` middleware converted all `Date` objects to `{}`. Finance lists, aging
reports, and AR views all depend on `invoice.date` and `invoice.dueDate` for calculations
and display. **Fixed in `server/routes.ts` — dates now return as ISO strings.**

---

## Finance Endpoints — All Verified (2026-06-13)

| Endpoint | HTTP | Result |
|---|---|---|
| `GET /api/finance/dashboard` | 200 | totalRevenue: 53480.1, receivables correct |
| `GET /api/finance/invoices` | 200 | 5 invoices, dates ISO strings, followUpStatus present |
| `GET /api/finance/aging` | 200 | Client aging buckets with current/30/60/90 day splits |
| `GET /api/finance/collections` | 200 | Collection data present |
| `GET /api/finance/ledger-summary` | 200 | Ledger data |
| `GET /api/finance/ledger/:id` | 200 | Account ledger lines |

---

## Sample Invoice Record (after fix)

```json
{
  "id": 5,
  "invoiceNumber": "SM/INV/26-27/105",
  "type": "sales",
  "date": "2026-06-12T06:53:11.596Z",
  "dueDate": "2026-07-12T06:53:11.596Z",
  "followUpStatus": "none",
  "totalAmount": 2360
}
```

All date fields are proper ISO strings. `followUpStatus` is `"none"` (correct default).

---

## No Code Changes Needed in Finance Module

The Finance page (`client/src/pages/Finance.tsx`) and related components did not need
code changes. The issues were entirely in the shared data layer (date serialization bug
and missing migration column).
