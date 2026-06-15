# ERP_REGRESSION_REPORT — 13 June 2026
Method: live Express server against PostgreSQL 16 with real schema; Telegram mocked at the network boundary (TELEGRAM_MOCK=1) since this environment cannot reach api.telegram.org. tsc + production build pass.

## Result: 14 / 14 checks passed

| Area | Check | Result |
|---|---|---|
| Estimates | create with items, items persisted | ✓ 201, 1 item |
| PO | attach poNumber + status | ✓ 200 |
| Project Workspace | execution-documents fetch | ✓ 200 |
| WCC | delivery-challan create | ✓ 201 |
| Signed WCC | field upload (signed_wcc) | ✓ 201 |
| Photos | field upload (photo) | ✓ 201 |
| Readiness + Invoice | invoice create after signed proof | ✓ 201 |
| Tally export | XML export, well-formed (XML-parser verified) | ✓ 200, valid ENVELOPE |
| Excel export | OOXML element order (Mac+Windows safe) + parses | ✓ valid |
| Telegram delivery | bot send (mock) | ✓ 200, status=sent |
| Revoke after send (item 4) | revoke link, then access blocked | ✓ 200 then 403 |
| Upload→execution→readiness (item 5) | full chain produced invoice | ✓ |
| Chat discovery (item 3, mock) | discover-chats endpoint | ✓ 200 |

Numbering preserved throughout (real series: SM/E/26-27/209, SM/INV/26-27/102, WCC-REG-1). No business logic, schema, or workflow regressions observed.

## Excel — Mac + Windows
Worksheet element order verified canonical (printOptions→pageMargins→pageSetup→headerFooter→…→ignoredErrors→…→drawing); file re-parses. Mac Excel (strict) satisfied; Windows Excel & LibreOffice (lenient) unaffected. Note: "verified" here = OOXML structural correctness, machine-checked. Opening in the actual desktop apps is a final human confirmation (no Excel in this environment).

## Honest scope boundary
Telegram delivery was exercised with a mocked API. Real-token send, real-phone receipt, and live chat-id discovery are covered by TELEGRAM_LIVE_TEST_RUNBOOK.md and must be run by a human with a bot token — they are NOT claimed as verified here.
