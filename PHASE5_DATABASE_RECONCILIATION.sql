-- Sunrise Media ERP - Phase 5 database reconciliation
-- Generated: 2026-06-13
--
-- Purpose:
--   Bring an existing database up to parity with the schema referenced by the
--   currently running codebase. This file is additive and idempotent.
--
-- Apply:
--   psql "$DATABASE_URL" -f PHASE5_DATABASE_RECONCILIATION.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Phase 5A Telegram delivery
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id text;

CREATE TABLE IF NOT EXISTS telegram_deliveries (
  id serial PRIMARY KEY,
  field_link_id integer,
  estimate_id integer,
  recipient_user_id integer,
  recipient_name text,
  chat_id text,
  message text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  telegram_message_id text,
  retry_count integer NOT NULL DEFAULT 0,
  sent_at timestamp,
  created_by integer,
  created_at timestamp DEFAULT now() NOT NULL
);
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS field_link_id integer;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS recipient_user_id integer;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS chat_id text;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS telegram_message_id text;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS sent_at timestamp;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS created_by integer;
ALTER TABLE telegram_deliveries ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

-- ---------------------------------------------------------------------------
-- Phase 3 audit trail, notifications, finance follow-up
-- ---------------------------------------------------------------------------
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
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_label text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS invoice_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS delivery_challan_id integer;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_value jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_value jsonb;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

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
  read_by jsonb DEFAULT '[]'::jsonb,
  resolved_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity text DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS invoice_id integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_challan_id integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS for_role text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_by jsonb DEFAULT '[]'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at timestamp;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_key ON notifications(dedupe_key);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_status text DEFAULT 'none';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_note text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS follow_up_at timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promise_date timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_export_status text DEFAULT 'not_exported';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tally_exported_at timestamp;

-- ---------------------------------------------------------------------------
-- Phase 1 / Phase 4 / Phase 5 additive execution workflow schema referenced by
-- routes.ts, storage.ts, shared/schema.ts, and server/indexes.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS parent_client_id integer REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_group_name text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type text DEFAULT 'normal';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_person text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vendor_code text;

ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS region_zone text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS mall_name text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type text;

ALTER TABLE products ADD COLUMN IF NOT EXISTS material_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS material_code_id integer;

CREATE TABLE IF NOT EXISTS client_billing_profiles (
  id serial PRIMARY KEY,
  client_id integer REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  legal_company_name text NOT NULL,
  branch_location_name text,
  gstin text NOT NULL,
  pan text,
  state text NOT NULL,
  state_code text NOT NULL,
  billing_address text NOT NULL,
  shipping_address text,
  contact_person text,
  mobile text,
  email text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp DEFAULT now()
);
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS client_id integer;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS legal_company_name text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS branch_location_name text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS pan text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS mobile text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE client_billing_profiles ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS estimate_date timestamp;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_profile_id integer REFERENCES client_billing_profiles(id) ON DELETE SET NULL;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_legal_name_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_gstin_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_state_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_state_code_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS billing_address_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS shipping_address_snapshot text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS abfrl_project_type text;

UPDATE estimates SET estimate_date = created_at WHERE estimate_date IS NULL;

ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_code text;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_code_id integer;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_description text;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS store_sort_order integer;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS row_sort_order integer;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS manual_store_name text;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS line_type text DEFAULT 'product';
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS calculation_type text DEFAULT 'fixed';
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS material_code_snapshot jsonb;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS product_snapshot jsonb;

UPDATE estimate_items
SET
  store_sort_order = COALESCE(store_sort_order, sl, id),
  row_sort_order = COALESCE(row_sort_order, sl, id)
WHERE store_sort_order IS NULL
   OR row_sort_order IS NULL;

ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'dc';
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS store_code text;

UPDATE delivery_challans
SET document_type = CASE
  WHEN lower(coalesce(document_type, '')) = 'wcc'
    OR lower(coalesce(client_format, '')) IN ('abfrl', 'ablbl', 'abfrl_multi_store', 'ablbl_multi_store')
  THEN 'wcc'
  ELSE 'dc'
END;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_id integer REFERENCES clients(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS allocated_invoices jsonb;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS estimate_id integer REFERENCES estimates(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id integer REFERENCES clients(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount real DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_amount real DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS packet_settings jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_challan_id integer REFERENCES delivery_challans(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at timestamp;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_reference text;

CREATE TABLE IF NOT EXISTS client_billing_profiles (
  id serial PRIMARY KEY,
  client_id integer REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  legal_company_name text NOT NULL,
  branch_location_name text,
  gstin text NOT NULL,
  pan text,
  state text NOT NULL,
  state_code text NOT NULL,
  billing_address text NOT NULL,
  shipping_address text,
  contact_person text,
  mobile text,
  email text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_codes (
  id serial PRIMARY KEY,
  client_id integer REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  brand_id integer REFERENCES brands(id) ON DELETE CASCADE,
  code text NOT NULL,
  product_name text,
  description text,
  hsn text,
  uom text DEFAULT 'nos',
  gst_percent real DEFAULT 18,
  default_rate real DEFAULT 0,
  category text,
  is_standard boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp DEFAULT now()
);
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS client_id integer;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS brand_id integer;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS hsn text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS uom text DEFAULT 'nos';
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS gst_percent real DEFAULT 18;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS default_rate real DEFAULT 0;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS is_standard boolean DEFAULT true;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE material_codes ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS app_settings (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb,
  updated_at timestamp DEFAULT now()
);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS key text;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value jsonb;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_key_key ON app_settings(key);

CREATE TABLE IF NOT EXISTS customer_rate_cards (
  id serial PRIMARY KEY,
  name text,
  client_id integer REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  brand_id integer REFERENCES brands(id) ON DELETE SET NULL,
  project_type text,
  effective_from timestamp,
  effective_to timestamp,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp DEFAULT now()
);
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS client_id integer;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS brand_id integer;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS project_type text;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS effective_from timestamp;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS effective_to timestamp;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE customer_rate_cards ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS customer_rate_items (
  id serial PRIMARY KEY,
  rate_card_id integer REFERENCES customer_rate_cards(id) ON DELETE CASCADE NOT NULL,
  product_id integer REFERENCES products(id) ON DELETE CASCADE,
  material_code_id integer REFERENCES material_codes(id) ON DELETE SET NULL,
  item_name text,
  description text,
  hsn text,
  uom text NOT NULL DEFAULT 'pcs',
  calculation_type text DEFAULT 'fixed',
  rate real NOT NULL DEFAULT 0,
  gst_percent real NOT NULL DEFAULT 18,
  is_standard boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now()
);
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS rate_card_id integer;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS product_id integer;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS material_code_id integer;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS hsn text;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS uom text DEFAULT 'pcs';
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS calculation_type text DEFAULT 'fixed';
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS rate real DEFAULT 0;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS gst_percent real DEFAULT 18;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS is_standard boolean DEFAULT true;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE customer_rate_items ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS project_store_status (
  id serial PRIMARY KEY,
  estimate_id integer REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
  store_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  remarks text,
  updated_by integer REFERENCES users(id),
  updated_at timestamp DEFAULT now()
);
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS updated_by integer;
ALTER TABLE project_store_status ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS execution_documents (
  id serial PRIMARY KEY,
  estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  delivery_challan_id integer REFERENCES delivery_challans(id) ON DELETE SET NULL,
  store_code text,
  document_type text NOT NULL,
  file_path text NOT NULL,
  original_file_name text,
  mime_type text,
  file_size integer,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  uploaded_by integer REFERENCES users(id),
  uploaded_via text NOT NULL DEFAULT 'erp',
  uploaded_at timestamp DEFAULT now(),
  replaced_by_document_id integer,
  deleted_at timestamp,
  deleted_by integer REFERENCES users(id),
  metadata jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS delivery_challan_id integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS document_type text;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS original_file_name text;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS file_size integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS uploaded_by integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS uploaded_via text DEFAULT 'erp';
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS uploaded_at timestamp DEFAULT now();
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS replaced_by_document_id integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS deleted_by integer;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
ALTER TABLE execution_documents ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS execution_stores (
  id serial PRIMARY KEY,
  estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  store_id integer REFERENCES stores(id) ON DELETE SET NULL,
  store_code text NOT NULL,
  store_name text,
  store_location text,
  store_city text,
  store_state text,
  store_address text,
  status text NOT NULL DEFAULT 'pending_execution',
  source text NOT NULL DEFAULT 'estimate_store_grouping',
  metadata jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_id integer;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_name text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_location text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_city text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_state text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS store_address text;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending_execution';
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS source text DEFAULT 'estimate_store_grouping';
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
ALTER TABLE execution_stores ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS field_access_links (
  id serial PRIMARY KEY,
  estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token_prefix text,
  channel text NOT NULL DEFAULT 'telegram',
  recipient_name text,
  recipient_contact text,
  allowed_store_codes jsonb,
  allowed_document_types jsonb,
  permissions jsonb,
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  revoked_by integer REFERENCES users(id),
  created_by integer REFERENCES users(id),
  last_used_at timestamp,
  use_count integer NOT NULL DEFAULT 0,
  metadata jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS estimate_id integer;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS token_prefix text;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS channel text DEFAULT 'telegram';
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS recipient_contact text;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS allowed_store_codes jsonb;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS allowed_document_types jsonb;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS permissions jsonb;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS expires_at timestamp;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS revoked_at timestamp;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS revoked_by integer;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS created_by integer;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS last_used_at timestamp;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS use_count integer DEFAULT 0;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();
ALTER TABLE field_access_links ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS field_access_links_token_hash_key ON field_access_links(token_hash);

CREATE TABLE IF NOT EXISTS bot_settings (
  id serial PRIMARY KEY,
  platform text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  bot_token text,
  bot_username text,
  webhook_url text,
  verify_token text,
  phone_number_id text,
  waba_id text,
  access_token_hint text,
  settings jsonb,
  updated_at timestamp DEFAULT now()
);
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT false;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS bot_token text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS bot_username text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS webhook_url text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS verify_token text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS phone_number_id text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS waba_id text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS access_token_hint text;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS settings jsonb;
ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS bot_settings_platform_key ON bot_settings(platform);

CREATE TABLE IF NOT EXISTS bot_upload_inbox (
  id serial PRIMARY KEY,
  source text NOT NULL,
  sender_id text NOT NULL,
  sender_name text,
  message_text text,
  media_url text,
  media_local_path text,
  media_type text,
  upload_type text,
  raw_payload jsonb,
  mapped_client_id integer REFERENCES clients(id),
  mapped_brand_id integer,
  mapped_estimate_id integer,
  mapped_dc_id integer,
  mapped_store_id integer,
  status text NOT NULL DEFAULT 'unlinked',
  mapped_at timestamp,
  mapped_by integer,
  remarks text,
  created_at timestamp DEFAULT now()
);
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS sender_id text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS sender_name text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS message_text text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS media_local_path text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS upload_type text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS raw_payload jsonb;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_client_id integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_brand_id integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_estimate_id integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_dc_id integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_store_id integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS status text DEFAULT 'unlinked';
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_at timestamp;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS mapped_by integer;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE bot_upload_inbox ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

CREATE TABLE IF NOT EXISTS webhook_logs (
  id serial PRIMARY KEY,
  platform text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound',
  event text,
  payload jsonb,
  status text NOT NULL DEFAULT 'received',
  error text,
  created_at timestamp DEFAULT now()
);
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS direction text DEFAULT 'inbound';
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS event text;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS status text DEFAULT 'received';
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now();

-- ---------------------------------------------------------------------------
-- Missing unique/index dependencies. Names match current startup index code
-- where possible; legacy names are also included where routes.ts created them.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_stores_estimate_store
  ON execution_stores(estimate_id, lower(store_code));
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_store_status_estimate_store
  ON project_store_status(estimate_id, store_code);

CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_approved_by ON attendance(approved_by);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_paid_by ON petty_cash_expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_added_by ON petty_cash_expenses(added_by);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_approved_by ON petty_cash_expenses(approved_by);
CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON uploads(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id ON invoices(estimate_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_delivery_challan_id ON invoices(delivery_challan_id);
CREATE INDEX IF NOT EXISTS idx_invoices_cancelled_by ON invoices(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON journal_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_client_billing_profiles_client_id ON client_billing_profiles(client_id);
CREATE INDEX IF NOT EXISTS idx_brands_parent_client_id ON brands(parent_client_id);
CREATE INDEX IF NOT EXISTS idx_stores_client_id ON stores(client_id);
CREATE INDEX IF NOT EXISTS idx_stores_brand_id ON stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_estimates_client_id ON estimates(client_id);
CREATE INDEX IF NOT EXISTS idx_estimates_brand_id ON estimates(brand_id);
CREATE INDEX IF NOT EXISTS idx_estimates_store_id ON estimates(store_id);
CREATE INDEX IF NOT EXISTS idx_estimates_billing_profile_id ON estimates(billing_profile_id);
CREATE INDEX IF NOT EXISTS idx_estimates_created_by ON estimates(created_by);
CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_estimate_items_product_id ON estimate_items(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_estimate_id ON delivery_challans(estimate_id);
CREATE INDEX IF NOT EXISTS idx_execution_documents_estimate_id ON execution_documents(estimate_id);
CREATE INDEX IF NOT EXISTS idx_execution_documents_delivery_challan_id ON execution_documents(delivery_challan_id);
CREATE INDEX IF NOT EXISTS idx_execution_documents_uploaded_by ON execution_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_execution_documents_deleted_by ON execution_documents(deleted_by);
CREATE INDEX IF NOT EXISTS idx_execution_stores_estimate_id ON execution_stores(estimate_id);
CREATE INDEX IF NOT EXISTS idx_execution_stores_store_id ON execution_stores(store_id);
CREATE INDEX IF NOT EXISTS idx_field_access_links_estimate_id ON field_access_links(estimate_id);
CREATE INDEX IF NOT EXISTS idx_field_access_links_revoked_by ON field_access_links(revoked_by);
CREATE INDEX IF NOT EXISTS idx_field_access_links_created_by ON field_access_links(created_by);
CREATE INDEX IF NOT EXISTS idx_material_codes_client_id ON material_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_material_codes_brand_id ON material_codes(brand_id);
CREATE INDEX IF NOT EXISTS idx_customer_rate_cards_client_id ON customer_rate_cards(client_id);
CREATE INDEX IF NOT EXISTS idx_customer_rate_cards_brand_id ON customer_rate_cards(brand_id);
CREATE INDEX IF NOT EXISTS idx_customer_rate_items_rate_card_id ON customer_rate_items(rate_card_id);
CREATE INDEX IF NOT EXISTS idx_customer_rate_items_product_id ON customer_rate_items(product_id);
CREATE INDEX IF NOT EXISTS idx_customer_rate_items_material_code_id ON customer_rate_items(material_code_id);
CREATE INDEX IF NOT EXISTS idx_project_store_status_estimate_id ON project_store_status(estimate_id);
CREATE INDEX IF NOT EXISTS idx_project_store_status_updated_by ON project_store_status(updated_by);
CREATE INDEX IF NOT EXISTS idx_staff_advances_user_id ON staff_advances(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_user_id ON payroll(user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_approved_by ON payroll(approved_by);
CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_mapped_client_id ON bot_upload_inbox(mapped_client_id);

CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_status ON petty_cash_expenses(status);
CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_created_at ON petty_cash_expenses(created_at);
CREATE INDEX IF NOT EXISTS idx_uploads_category ON uploads(category);
CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_stores_store_code ON stores(store_code);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON estimates(created_at);
CREATE INDEX IF NOT EXISTS idx_estimate_items_store_code ON estimate_items(store_code);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_status ON delivery_challans(status);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_store_code ON delivery_challans(store_code);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_created_at ON delivery_challans(created_at);
CREATE INDEX IF NOT EXISTS idx_execution_documents_status ON execution_documents(status);
CREATE INDEX IF NOT EXISTS idx_execution_documents_store_code ON execution_documents(store_code);
CREATE INDEX IF NOT EXISTS idx_execution_documents_created_at ON execution_documents(created_at);
CREATE INDEX IF NOT EXISTS idx_execution_stores_status ON execution_stores(status);
CREATE INDEX IF NOT EXISTS idx_execution_stores_store_code ON execution_stores(store_code);
CREATE INDEX IF NOT EXISTS idx_project_store_status_status ON project_store_status(status);
CREATE INDEX IF NOT EXISTS idx_project_store_status_store_code ON project_store_status(store_code);
CREATE INDEX IF NOT EXISTS idx_material_codes_category ON material_codes(category);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll(status);
CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_status ON bot_upload_inbox(status);
CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_created_at ON bot_upload_inbox(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform ON webhook_logs(platform);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_estimate_id ON audit_logs(estimate_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_resolved_at ON notifications(resolved_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_estimate_id ON telegram_deliveries(estimate_id);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_field_link_id ON telegram_deliveries(field_link_id);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_status ON telegram_deliveries(status);

-- Legacy index names created directly in routes.ts.
CREATE INDEX IF NOT EXISTS idx_execution_documents_estimate ON execution_documents(estimate_id);
CREATE INDEX IF NOT EXISTS idx_execution_documents_dc ON execution_documents(delivery_challan_id);
CREATE INDEX IF NOT EXISTS idx_execution_documents_store ON execution_documents(estimate_id, store_code);
CREATE INDEX IF NOT EXISTS idx_execution_documents_type ON execution_documents(document_type, status);
CREATE INDEX IF NOT EXISTS idx_execution_stores_estimate ON execution_stores(estimate_id);
CREATE INDEX IF NOT EXISTS idx_field_access_links_estimate ON field_access_links(estimate_id);
CREATE INDEX IF NOT EXISTS idx_field_access_links_expiry ON field_access_links(expires_at);
CREATE INDEX IF NOT EXISTS idx_field_access_links_channel ON field_access_links(channel);
CREATE INDEX IF NOT EXISTS idx_project_store_status_est ON project_store_status(estimate_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries
-- ---------------------------------------------------------------------------
-- Required tables.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'audit_logs',
    'notifications',
    'telegram_deliveries',
    'execution_documents',
    'execution_stores',
    'field_access_links',
    'client_billing_profiles',
    'material_codes',
    'app_settings',
    'customer_rate_cards',
    'customer_rate_items',
    'project_store_status',
    'bot_settings',
    'bot_upload_inbox',
    'webhook_logs'
  )
ORDER BY table_name;

-- Required columns.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('users', 'telegram_chat_id'),
    ('invoices', 'follow_up_status'),
    ('invoices', 'follow_up_note'),
    ('invoices', 'follow_up_at'),
    ('invoices', 'promise_date'),
    ('invoices', 'tally_export_status'),
    ('invoices', 'tally_exported_at'),
    ('invoices', 'delivery_challan_id'),
    ('invoices', 'line_items'),
    ('invoices', 'cancelled_by'),
    ('invoices', 'po_number'),
    ('invoices', 'po_reference'),
    ('estimates', 'estimate_date'),
    ('estimates', 'billing_profile_id'),
    ('estimate_items', 'store_sort_order'),
    ('estimate_items', 'row_sort_order'),
    ('estimate_items', 'material_code_snapshot'),
    ('delivery_challans', 'document_type'),
    ('delivery_challans', 'store_code'),
    ('stores', 'store_code'),
    ('stores', 'mall_name'),
    ('clients', 'vendor_code'),
    ('payments', 'client_id'),
    ('payments', 'allocated_invoices')
  )
ORDER BY table_name, column_name;

-- Required indexes.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_audit_logs_entity',
    'idx_audit_logs_estimate_id',
    'idx_audit_logs_invoice_id',
    'idx_audit_logs_created_at',
    'idx_notifications_resolved_at',
    'idx_notifications_type',
    'idx_telegram_deliveries_estimate_id',
    'idx_telegram_deliveries_field_link_id',
    'idx_telegram_deliveries_status',
    'idx_invoices_estimate_id',
    'idx_invoices_client_id',
    'idx_invoices_delivery_challan_id',
    'idx_execution_documents_estimate_id',
    'idx_execution_stores_estimate_store',
    'idx_field_access_links_estimate_id',
    'idx_project_store_status_estimate_store'
  )
ORDER BY indexname;
