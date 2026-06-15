# ERP_GAP_REPORT — Phase 3 — 12 June 2026
Status after Phase 3 builds. ✅ done this phase · ⬛ pre-existing · ⬜ deferred (out of scope).

## Closed this phase
- ✅ **Audit logs** — every create/update/delete API-wide (generic middleware) + rich old→new diffs on estimates and invoice follow-ups. Captures who/when/old/new and links to project (estimateId), invoice, WCC (deliveryChallanId). Verified live.
- ✅ **Notifications** — all six required types (pending WCC, missing photos, missing signed WCC, invoice ready, payment due, payment overdue), state-derived with dedupe + auto-resolve, bell UI. Verified: overdue + pending-WCC fired correctly.
- ✅ **Approval workflow** — estimate / PO / invoice approve+reject, role-based chains (configurable in app_settings), history from audit trail. Verified: admin approved, designer correctly blocked (403).
- ✅ **AR aging** (0-30/31-60/61-90/90+ per client) · **customer outstanding** · **collections working-list** · **payment follow-up status** (promise date, notes, status). All verified live.
- ✅ **Excel Mac repair warning** — root-caused and fixed (see UI_UX_AUDIT_REPORT § Excel).

## Still open (matches your "don't build yet" list — documented only)
- ⬜ Management/KPI dashboard (explicitly excluded this phase)
- ⬜ Credit notes / estimate revision history (Zoho-parity finance; future)
- ⬜ Outbound Telegram/WhatsApp push (hook point left in notifications.ts; excluded)
- ⬜ Job profitability (estimate-vs-actual cost) — data exists, not yet joined
- ⬜ Scheduled digest/escalation cron — notifications derive on-read for now

## Competitive position (unchanged from Phase 2 baseline, now stronger on finance)
Sunrise now matches Zoho Books on the finance essentials it previously lacked (aging, outstanding, follow-up) and adds an audit trail most SME ERPs charge extra for. Still ahead on niche execution (store-level WCC, field links). The remaining gaps are all explicitly deferred features, not stability holes.
