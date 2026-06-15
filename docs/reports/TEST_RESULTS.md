# Test Results — Sunrise Media ERP

Generated: 2026-05-25T18:54:42.863Z
Run via: `node scripts/audit-api-tests.mjs`
Target:  http://localhost:5088

## Summary

- **Total:** 36
- **Passed:** 36
- **Failed:** 0

## Results

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | Login admin/admin123 | PASS | user=admin role=admin |
| 2 | List users | PASS | 2 users |
| 3 | List clients | PASS | 4 clients |
| 4 | List brands | PASS | 6 brands |
| 5 | List stores | PASS | 4 stores |
| 6 | List products | PASS | 17 products |
| 7 | List material codes | PASS | 0 codes |
| 8 | Create normal estimate | PASS | est=QA-NORMAL-lkf4sb status=201 |
| 9 | Create ABFRL SELEX estimate (no material code) | PASS | est=QA-SELEX-lkf6mi status=201 |
| 10 | Reject ABFRL CAPEX without material code | PASS | status=400 msg=ABLBL CAPEX requires Material Code on every row. Missing on row(s): 1. |
| 11 | Create ABFRL CAPEX with material code | PASS | est=QA-CAPEX-OK-lkf7rp status=201 |
| 12 | List estimates | PASS | 63 estimates |
| 13 | List invoices | PASS | 4 invoices |
| 14 | Finance dashboard returns aggregated fields | PASS | salaryPayable=27272 totalAdvances=5000 outstanding=23085 |
| 15 | List payments | PASS | 2 payments |
| 16 | List petty cash | PASS | 1 entries |
| 17 | List advances | PASS | 1 entries |
| 18 | List payroll (this month) | PASS | 1 entries |
| 19 | List tasks | PASS | 0 tasks |
| 20 | List attendance | PASS | 2 entries |
| 21 | Telegram settings — no raw token returned | PASS | botToken=null |
| 22 | WhatsApp settings — no raw token returned | PASS | botToken=null |
| 23 | List bot inbox | PASS | 1 entries |
| 24 | List telegram webhook logs | PASS | 1 entries |
| 25 | List whatsapp webhook logs | PASS | 0 entries |
| 26 | WhatsApp verify accepts correct token | PASS | status=200 |
| 27 | WhatsApp verify rejects wrong token | PASS | status=403 |
| 28 | List customer rate cards | PASS | 7 cards |
| 29 | Create rate card | PASS | id=8 |
| 30 | Add rate card item | PASS | item=7 rate=9876 |
| 31 | Resolver returns rate card match | PASS | rate=9876 |
| 32 | Get Tally settings | PASS | enabled=false |
| 33 | Tally XML download has correct shape | PASS | len=2031 |
| 34 | Project store status upsert | PASS | status=in_progress |
| 35 | Project store status list | PASS | 1 entries |
| 36 | Sample rate-card template downloads | PASS | size=26465 bytes |

All API smoke tests pass.
