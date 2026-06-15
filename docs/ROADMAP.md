# SUNRISE ERP — IMPROVEMENT ROADMAP
Ordering principle: security debt blocks go-live regardless of features, so it precedes the Priority A feature list you specified. Effort estimates assume focused sessions in this codebase.

## PRIORITY 0 — SECURITY GATE (before real client data goes live) — ~2 days
| # | Item | Ref | Effort |
|---|---|---|---|
| 0.1 | Authenticated file serving (kill public `/uploads`) | C1 | 3–4 h |
| 0.2 | Hard-fail on missing JWT_SECRET; rotate leaked secrets | C2/C5 | 30 min |
| 0.3 | Remove query-string token; signed short-lived URLs for print/download | C3 | 2 h |
| 0.4 | helmet + express-rate-limit (login: 5/min) + CORS allowlist | C4 | 1 h |
| 0.5 | Multer: size limit (e.g. 25MB) + extension/mimetype allowlist on ALL upload routes | H2 | 1 h |
| 0.6 | Telegram webhook secret_token validation | H3 | 30 min |
| 0.7 | DB indexes on all 51 FK columns + common filters (status, date) | H1 | 2 h |
| 0.8 | Decide upload storage: persistent volume or activate @google-cloud/storage | H8 | 2–6 h |

## PRIORITY A — MUST HAVE — ~2–3 weeks
| # | Item | Notes | Effort |
|---|---|---|---|
| A1 | **Audit logs** | `audit_logs` table + middleware on mutating routes (user, action, entity, before/after JSON). Foundation for A2/A3. | 1 d |
| A2 | **Activity timeline** | Per-project feed rendered from audit logs — comes nearly free after A1 | 1 d |
| A3 | **Notifications** | `notifications` table + bell UI + event hooks (estimate approved, WCC signed, payment received, invoice overdue) | 2 d |
| A4 | **Telegram integration (outbound)** | Same event hooks → Telegram sends to mapped users; inbound inbox already exists | 1 d |
| A5 | **Approval workflows** | Approval gates on estimate/PO/invoice with threshold rules (e.g. >₹X needs admin), recorded in audit log | 2 d |
| A6 | **Payment + collection tracking** | Payments table exists — add follow-up fields (promise date, contact log) + collections screen | 1–2 d |
| A7 | **Aging report** | 0/30/60/90 buckets from invoices+payments; one SQL view + one page | 1 d |
| A8 | **Tally export verification** | End-to-end test: export XML → import into a real Tally instance → fix mismatches | 1 d |
| A9 | **Permissions refinement** | Move from hardcoded role arrays (71 scattered `requireRole` calls) to a permission matrix table editable in Roles page | 2 d |

## PRIORITY B — IMPORTANT — following month
| # | Item | Notes |
|---|---|---|
| B1 | Management/KPI dashboard | Revenue, outstanding, jobs by stage, top debtors — depends on A7 |
| B2 | WhatsApp integration | Plumbing exists (webhook + settings page); mirror A4's event hooks |
| B3 | Escalations | "Invoice overdue 15d → notify admin" — scheduled job (node-cron) + rules on top of A3 |
| B4 | Mobile optimization | FieldProjectUpload first, then Operations split into responsive sub-pages |
| B5 | Automation engine (scoped) | Not a generic engine — config table for the 5–6 real rules (auto-reminder, auto-escalate, auto-notify) |
| B6 | Refactor monoliths | routes.ts → domain routers; OperationsPage → sub-routes. Do alongside B4, not before A-items (don't refactor and feature simultaneously) |
| B7 | react-query migration | Page-by-page during B4/B6 |
| B8 | Credit notes + estimate revisions | From gap analysis — accounts will ask eventually |

## PRIORITY C — FUTURE
- AI features: estimate drafting from client brief (Anthropic SDK already in deps), auto-categorize petty cash, WCC photo validation
- Forecasting: cash-flow projection from invoice due dates + historical collection lag
- Advanced analytics: job profitability (join petty cash + payroll + materials to projects), client lifetime value
- Job costing/margin module (prerequisite for real profitability analytics)
- Client portal: estimate view/accept link, invoice + payment status self-service

## SEQUENCE SUMMARY
**Week 1:** P0 complete → safe to go live. **Weeks 2–4:** A1→A2→A3→A4 (they chain), then A5–A9 in parallel pairs. **Month 2:** B-items, refactor last. C only when A+B are stable in daily use.
