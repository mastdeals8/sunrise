# Phase 5 Database Reconciliation Report

Date: 2026-06-13

## Scope

This reconciliation is schema-only. No business logic, UI, workflows, or feature behavior were changed.

Artifacts produced:

- `PHASE5_DATABASE_RECONCILIATION.sql`
- `DATABASE_RECONCILIATION_REPORT.md`

## Code Paths Scanned

Primary database references were verified in:

- `shared/schema.ts`
- `server/routes.ts`
- `server/storage.ts`
- `server/indexes.ts`
- `server/audit.ts`
- `server/notifications.ts`
- `server/telegram.ts`
- Existing migrations in `scripts/migrations/`
- Legacy rebuild/migration scripts in `scripts/archive/server-tools/` and `scripts/migrate-final-erp-pass.mjs`

## Missing Objects Covered

Tables covered by the reconciliation migration:

- `audit_logs`
- `notifications`
- `telegram_deliveries`
- `execution_documents`
- `execution_stores`
- `field_access_links`
- `client_billing_profiles`
- `material_codes`
- `app_settings`
- `customer_rate_cards`
- `customer_rate_items`
- `project_store_status`
- `bot_settings`
- `bot_upload_inbox`
- `webhook_logs`

Columns covered on existing core tables:

- `users.telegram_chat_id`
- Invoice fields: `estimate_id`, `client_id`, `paid_amount`, `balance_amount`, `packet_settings`, `remarks`, `follow_up_status`, `follow_up_note`, `follow_up_at`, `promise_date`, `tally_export_status`, `tally_exported_at`, `delivery_challan_id`, `line_items`, `cancel_reason`, `cancelled_at`, `cancelled_by`, `po_number`, `po_reference`
- Estimate fields: `estimate_date`, billing profile snapshot fields, `billing_profile_id`, `abfrl_project_type`
- Estimate item fields: material/store/order/snapshot fields, `manual_store_name`, `line_type`, `calculation_type`
- Delivery challan fields: `document_type`, `store_code`
- Payment fields: `client_id`, `allocated_invoices`
- Client/store/product/brand additive fields currently referenced by import/export, operations, and document workflows

Indexes covered:

- All indexes currently listed in `server/indexes.ts`
- Route-created legacy indexes for execution documents/stores and field access links
- Unique dependency indexes for `notifications.dedupe_key`, `app_settings.key`, `bot_settings.platform`, `field_access_links.token_hash`, `execution_stores(estimate_id, lower(store_code))`, and `project_store_status(estimate_id, store_code)`

Foreign keys covered:

- New tables are created with the same FK relationships used by `shared/schema.ts`
- Newly added FK columns use inline references where PostgreSQL supports `ADD COLUMN IF NOT EXISTS ... REFERENCES`
- Existing partial tables are repaired for missing columns; their indexes are repaired idempotently

## Enum / Value Dependencies

The codebase uses `text` status fields, not PostgreSQL enum types. No enum type creation is required.

Values expected by route validation and UI workflows include:

- Invoice follow-up: `none`, `promised`, `partial_promised`, `disputed`, `escalated`, `legal`
- Telegram delivery: `pending`, `sent`, `delivered`, `failed`
- Notification type: `pending_wcc`, `missing_photos`, `missing_signed_wcc`, `invoice_ready`, `payment_due`, `payment_overdue`
- Notification severity: `info`, `warning`, `critical`
- Execution document status: `active`, `replaced`, `deleted`
- Field upload channel: `telegram`, `whatsapp`, `manual`
- Tally export status: `not_exported`, `exported_xml`, `pushed_to_tally`, `failed`

These remain application-validated to avoid changing existing database behavior.

## Verification Queries

The reconciliation SQL ends with verification queries for required tables, columns, and indexes.

Applied verification result on 2026-06-13:

- Migration executed successfully against the configured `.env` `DATABASE_URL`
- Required table verification returned 15/15 tables
- Required column verification returned 24/24 tracked columns
- Required index verification returned 16/16 tracked indexes
- `npm run check` passed
- Local API verification returned `200` with no schema-error text for:
  - `GET /api/finance/dashboard`
  - `GET /api/notifications`
  - `GET /api/finance/invoices`
  - `GET /api/finance/invoices/:id`
  - `GET /api/finance/invoice-packet/:invoiceId`
  - `GET /api/finance/invoices/estimate/:estimateId`
  - `GET /api/audit-logs`
  - `GET /api/approvals/rules`
  - `GET /api/operations/telegram/deliveries`
  - `GET /api/finance/aging`
  - `GET /api/finance/collections`

Startup note: `npm run dev` reached successful database connection and schema initialization, then exited because port `5088` was already occupied by an existing local node server. Endpoint verification was performed against that already-running server.

Manual spot checks after applying:

```sql
SELECT to_regclass('public.audit_logs') AS audit_logs,
       to_regclass('public.notifications') AS notifications,
       to_regclass('public.telegram_deliveries') AS telegram_deliveries;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('users', 'telegram_chat_id'),
    ('invoices', 'follow_up_status'),
    ('invoices', 'follow_up_note'),
    ('invoices', 'follow_up_at'),
    ('invoices', 'promise_date'),
    ('delivery_challans', 'store_code'),
    ('delivery_challans', 'document_type')
  )
ORDER BY table_name, column_name;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_audit_logs_entity',
    'idx_notifications_resolved_at',
    'idx_telegram_deliveries_estimate_id',
    'idx_invoices_delivery_challan_id'
  )
ORDER BY indexname;
```

Endpoint-level verification targets after applying the SQL:

- `GET /api/finance/dashboard`
- `GET /api/finance/invoices`
- `GET /api/finance/aging`
- `GET /api/finance/collections`
- `GET /api/notifications`
- `GET /api/audit-logs`
- `GET /api/approvals/rules`
- `GET /api/operations/telegram/deliveries`

Expected result: no missing-table, missing-column, or startup schema errors.
