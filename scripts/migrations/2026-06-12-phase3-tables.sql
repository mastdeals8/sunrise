-- Phase 3: audit logs, notifications, invoice follow-up columns.
-- Idempotent. Apply with: psql $DATABASE_URL -f this-file
-- (drizzle-kit push in this repo version fails to introspect DBs containing
--  startup-created indexes — apply Phase 3 DDL via this file instead.)
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  user_id integer,
  user_name text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id integer,
  entity_label text,
  estimate_id integer,
  invoice_id integer,
  delivery_challan_id integer,
  old_value jsonb,
  new_value jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  severity text DEFAULT 'info',
  estimate_id integer,
  invoice_id integer,
  delivery_challan_id integer,
  dedupe_key text UNIQUE,
  for_role text,
  read_by jsonb DEFAULT '[]',
  resolved_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_status text DEFAULT 'none';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_note text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_at timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promise_date timestamp;
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_estimate_id ON audit_logs(estimate_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_resolved_at ON notifications(resolved_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
