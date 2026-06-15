# FINAL_ROLE_AUDIT — 13 June 2026

## Roles in system
admin, manager, accounts, production, installer, designer, sales/staff.

## Permission distribution (requireRole across all mutating endpoints)
- admin-only: 10 endpoints (user delete, approval rules, settings, sensitive config)
- admin+manager: 21
- admin+manager+accounts: 23 (finance-heavy)
- admin+accounts: 8 (pure finance)
- admin+manager+production: 6 (field links, execution)
- admin+manager+production+installer: 4 (execution document upload/replace/delete)
- plus designer/accounts combinations for estimate-adjacent actions

## Workflow verification by role (intent vs. enforcement)
| Workflow step | Allowed roles | Verified |
|---|---|---|
| Create/edit estimate | admin, manager, (designer/accounts on some) | ✓ |
| Approve estimate/PO | manager, admin (configurable chain) | ✓ designer blocked 403 (Phase 3) |
| Generate/revoke field link | admin, manager, production | ✓ |
| Upload signed WCC (field) | token-scoped, no login | ✓ by design |
| Replace/delete execution doc | admin, manager, production, installer | ✓ soft-delete + audit |
| Create invoice | admin, accounts, manager | ✓ |
| Record payment | admin, accounts, manager | ✓ |
| Tally export | admin, accounts, manager | ✓ blocked anonymously |
| Telegram send | admin, manager, production | ✓ |
| User management | view: admin/manager; create/delete: admin | ✓ |

## Three-role spotlight (per brief)
- **Admin:** full access incl. user/role/settings/approval-rule management. Correct.
- **Manager:** operational + most finance reads/writes + approvals + field links; cannot delete users or edit approval rules. Correct separation.
- **Execution user (production/installer):** field links, execution documents (upload/replace/soft-delete), workspace — NOT finance, NOT user management. Correct least-privilege.

## Findings
- No mutating endpoint found without an auth guard. The only role-free mutations are intentional: authenticated file upload, import-parse, petty-cash self-entry (addedBy forced server-side), and the token-scoped field upload.
- Approval chain is role-checked but advisory (enforce:false) — documented; flip to blocking when desired.
- No privilege-escalation path found: role is set only by admin via user management; register after first user requires admin.

## Verdict: role model is sound and least-privilege. No changes required.
