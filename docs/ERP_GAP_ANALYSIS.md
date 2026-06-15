# SUNRISE ERP — GAP ANALYSIS vs ERPNext · Odoo · Zoho Projects · Zoho Books · Monday.com
**Scope note:** comparison targets the subset relevant to a signage/branding execution business — not full manufacturing/HR suites. ✅ = present in Sunrise, ⚠️ = partial, ❌ = missing.

## SALES
| Capability | ERPNext | Odoo | Zoho Books | Sunrise | Gap |
|---|---|---|---|---|---|
| Estimates/quotations with line items | ✅ | ✅ | ✅ | ✅ | — |
| Customer rate cards / price lists | ✅ | ✅ | ✅ | ✅ | — |
| Estimate versioning/revisions | ✅ | ✅ | ✅ | ⚠️ | No revision history table; edits overwrite |
| Quote → client-facing share link | ✅ | ✅ | ✅ | ❌ | Clients can't view/accept estimates online |
| Sales pipeline / lead stages (CRM) | ✅ | ✅ | — | ❌ | No leads table; clients only exist post-win |

## PROJECTS / EXECUTION
| Capability | Zoho Projects | Monday | Sunrise | Gap |
|---|---|---|---|---|
| Project workspace per job | ✅ | ✅ | ✅ | — |
| Multi-store execution tracking | — | ⚠️ | ✅ | **Sunrise is ahead** — store-level status is your differentiator |
| Field upload links (no-login) | — | ⚠️ | ✅ | Ahead (fieldAccessLinks) |
| Gantt / dependencies | ✅ | ✅ | ❌ | Probably unnecessary for signage jobs — skip |
| Task assignment + due-date views | ✅ | ✅ | ⚠️ | tasks table exists; no calendar/board view |

## DOCUMENTS
| Capability | ERPNext | Odoo | Sunrise | Gap |
|---|---|---|---|---|
| Document attach per record | ✅ | ✅ | ✅ | — |
| Version history | ✅ | ✅ | ❌ | Re-upload replaces; no versions |
| E-sign / signed-copy tracking | ⚠️ | ✅ | ✅ | Signed WCC flow exists — adequate |

## FINANCE
| Capability | Zoho Books | ERPNext | Sunrise | Gap |
|---|---|---|---|---|
| Invoices + payments + ledger | ✅ | ✅ | ✅ | — |
| **Receivables aging (30/60/90)** | ✅ | ✅ | ❌ | Biggest finance gap — accounts teams live in this report |
| Credit notes | ✅ | ✅ | ❌ | No credit-note type; corrections currently manual |
| Recurring invoices | ✅ | ✅ | ❌ | Likely low value for project-based billing — skip |
| GST reports (GSTR-1 summary) | ✅ (IN) | ⚠️ | ⚠️ | GST profiles exist; no GSTR-style export |
| Tally export | ⚠️ | ❌ | ✅ | Ahead of most — verify end-to-end import |
| Payment reminders to clients | ✅ | ✅ | ❌ | Ties into notifications gap |
| Bank reconciliation | ✅ | ✅ | ❌ | Heavy feature; Tally already does this — skip |

## REPORTING
| Capability | All competitors | Sunrise | Gap |
|---|---|---|---|
| Management/KPI dashboard | ✅ | ⚠️ | Dashboard.tsx exists; depth unknown vs revenue/outstanding/job-margin KPIs |
| Job profitability (estimate vs actual cost) | ✅ ERPNext/Odoo | ❌ | Petty cash + payroll data exists but isn't joined to jobs for margin |
| Export any list to Excel | ✅ | ⚠️ | Import/export page exists; per-screen export coverage partial |

## APPROVALS
| Capability | ERPNext | Odoo | Sunrise | Gap |
|---|---|---|---|---|
| Approval chains (estimate > ₹X needs admin) | ✅ | ✅ | ❌ | Status fields exist but no enforced approval gates with audit trail |

## NOTIFICATIONS
| Capability | All | Sunrise | Gap |
|---|---|---|---|
| In-app notifications | ✅ | ❌ | No table, no UI |
| Email notifications | ✅ | ❌ | No mail integration at all |
| Telegram/WhatsApp push on events | ⚠️ rare | ⚠️ | Bot plumbing exists — **cheap win**: wire workflow events → Telegram sends |

## MOBILE
| Capability | All | Sunrise | Gap |
|---|---|---|---|
| Responsive web | ✅ | ⚠️ | Dashboard partially responsive; Operations effectively desktop-only |
| Native app | ⚠️ | ⚠️ | Capacitor wired but dormant |

## AUTOMATION
| Capability | Odoo/Monday | Sunrise | Gap |
|---|---|---|---|
| Rule engine (when X then Y) | ✅ | ❌ | Skip generic engine; hard-code the 5–6 automations you actually need |
| Scheduled jobs (daily outstanding digest) | ✅ | ❌ | No cron/scheduler in server |

## VERDICT
Sunrise already **beats** generic ERPs on its niche: store-level execution, field uploads, WCC/signed-WCC, Tally export. It **trails** on the boring-but-expected layer: aging, credit notes, approvals, notifications, audit trail, job profitability. Close those six and it's competitive with Zoho Books + Zoho Projects combined for your use case — without per-user fees.
