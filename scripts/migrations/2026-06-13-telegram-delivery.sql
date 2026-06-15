-- Phase 5A: Telegram bot delivery. PURELY ADDITIVE. Idempotent.
-- Apply: psql $DATABASE_URL -f scripts/migrations/2026-06-13-telegram-delivery.sql
-- Touches nothing in field_access_links, execution, readiness, estimate/WCC/invoice/PO/numbering/documents.

ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id text;

CREATE TABLE IF NOT EXISTS telegram_deliveries (
  id                  serial PRIMARY KEY,
  field_link_id       integer,
  estimate_id         integer,
  recipient_user_id   integer,
  recipient_name      text,
  chat_id             text,
  message             text,
  status              text NOT NULL DEFAULT 'pending',  -- pending | sent | delivered | failed
  error               text,
  telegram_message_id text,
  retry_count         integer NOT NULL DEFAULT 0,
  sent_at             timestamp,
  created_by          integer,
  created_at          timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_estimate_id ON telegram_deliveries(estimate_id);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_field_link_id ON telegram_deliveries(field_link_id);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_status ON telegram_deliveries(status);
