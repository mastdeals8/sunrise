# FINAL_MONEY_AUDIT — 13 June 2026 (AUDIT ONLY — no migration, as instructed)

## Every float-based monetary field (real / doublePrecision)
All monetary columns use Postgres `real` (32-bit float). Inventory:

| Table | Float money columns |
|---|---|
| users | basic_salary, daily_wage, advance_balance |
| petty_cash_expenses | amount |
| invoices | amount, tax_amount, total_amount, paid_amount, balance_amount |
| payments | amount |
| products | rate, gst_percent |
| estimates | subtotal, tax_amount, total_amount, transport_amount, po_amount |
| estimate_items | rate, total_price, total_size, cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, total_amount |
| material_codes | gst_percent, default_rate |
| customer_rate_items | rate, gst_percent |
| staff_advances | amount |
| payroll | basic_salary, daily_wage, advances_paid, net_salary |

**Total: 38 float monetary fields across 11 tables.**

## Calculation review (current mitigations)
- **Invoice totals / payment allocation:** payment+balance update is atomic (transaction) and **paise-rounded** (`Math.round(x*100)/100`) — Phase 3. Status transitions (unpaid→partial→paid) verified correct.
- **Estimate / GST (CGST/SGST/IGST):** an `r2()` rounding helper (`Math.round(n*100)/100`) is applied at aggregation; GST split is exact halves of taxAmount.
- **Tally export:** amounts emitted via `.toFixed(2)` — string-formatted to 2 dp, so float artifacts don't reach Tally.
- **Petty cash / ledger balances:** sums of float; no rounding helper at every aggregation point — low individual amounts, but the textbook drift risk exists.
- **TDS:** no TDS field or calculation exists in the schema/code (searched — none found). If TDS is needed it's a future feature, not a float-precision issue.

## Risk assessment
- **Practical risk today: LOW.** Rounding at calc/output boundaries (r2, toFixed(2), paise-rounding on payments) prevents the common "₹0.01 off" symptoms in the paths that matter (invoices, payments, GST, Tally).
- **Theoretical risk: REAL.** 32-bit float cannot exactly represent many decimal rupee values; long chains of additions (e.g. large multi-store estimates, payroll aggregates) can still drift sub-paise before rounding.

## Recommendation (NOT executed — audit only per instructions)
Migrate all 38 columns to `numeric(14,2)` (or `numeric(14,4)` for percent/rate precision) in a **dedicated, tested pass**: column-type migration + verify every read/write/serializer + re-run the full financial regression. This touches finance-critical paths and must not be bundled into a hardening sprint. Until then, the existing rounding mitigations hold for production use.
