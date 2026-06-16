import { sql } from "drizzle-orm";

/**
 * Production hardening (audit issue H1): index every foreign-key column plus
 * common filter columns (status, store_code, dates, type).
 *
 * Pattern follows the existing startup index creation already used for
 * field_access_links in routes.ts — idempotent CREATE INDEX IF NOT EXISTS at
 * boot, so indexes self-heal even if a migration is missed on a new
 * environment. A standalone SQL copy lives at
 * scripts/migrations/2026-06-12-add-indexes.sql for manual/CI application.
 */
export const ensureIndexes = async (db: { execute: (q: any) => Promise<any> }) => {
  const statements = [
    sql`CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON attendance(user_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_attendance_approved_by ON attendance(approved_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)`,
    sql`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_paid_by ON petty_cash_expenses(paid_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_added_by ON petty_cash_expenses(added_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_approved_by ON petty_cash_expenses(approved_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON uploads(uploaded_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id ON invoices(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_delivery_challan_id ON invoices(delivery_challan_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_cancelled_by ON invoices(cancelled_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by ON journal_entries(created_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_journal_entry_id ON journal_entry_lines(journal_entry_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_id ON journal_entry_lines(account_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payments_client_id ON payments(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_client_billing_profiles_client_id ON client_billing_profiles(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_brands_parent_client_id ON brands(parent_client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_stores_client_id ON stores(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_stores_brand_id ON stores(brand_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_client_id ON estimates(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_brand_id ON estimates(brand_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_store_id ON estimates(store_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_billing_profile_id ON estimates(billing_profile_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_created_by ON estimates(created_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id ON estimate_items(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimate_items_product_id ON estimate_items(product_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_delivery_challans_estimate_id ON delivery_challans(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_estimate_id ON execution_documents(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_delivery_challan_id ON execution_documents(delivery_challan_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_uploaded_by ON execution_documents(uploaded_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_deleted_by ON execution_documents(deleted_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_estimate_id ON execution_stores(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_store_id ON execution_stores(store_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_estimate_id ON field_access_links(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_revoked_by ON field_access_links(revoked_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_created_by ON field_access_links(created_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_material_codes_client_id ON material_codes(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_material_codes_brand_id ON material_codes(brand_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_customer_rate_cards_client_id ON customer_rate_cards(client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_customer_rate_cards_brand_id ON customer_rate_cards(brand_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_customer_rate_items_rate_card_id ON customer_rate_items(rate_card_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_customer_rate_items_product_id ON customer_rate_items(product_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_customer_rate_items_material_code_id ON customer_rate_items(material_code_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_project_store_status_estimate_id ON project_store_status(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_project_store_status_updated_by ON project_store_status(updated_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_staff_advances_user_id ON staff_advances(user_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payroll_user_id ON payroll(user_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payroll_approved_by ON payroll(approved_by)`,
    sql`CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_mapped_client_id ON bot_upload_inbox(mapped_client_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_status ON petty_cash_expenses(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_petty_cash_expenses_created_at ON petty_cash_expenses(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_uploads_category ON uploads(category)`,
    sql`CREATE INDEX IF NOT EXISTS idx_uploads_created_at ON uploads(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_stores_store_code ON stores(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON estimates(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_estimate_items_store_code ON estimate_items(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_delivery_challans_status ON delivery_challans(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_delivery_challans_store_code ON delivery_challans(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_delivery_challans_created_at ON delivery_challans(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_status ON execution_documents(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_store_code ON execution_documents(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_created_at ON execution_documents(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_status ON execution_stores(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_store_code ON execution_stores(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_project_store_status_status ON project_store_status(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_project_store_status_store_code ON project_store_status(store_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_material_codes_category ON material_codes(category)`,
    sql`CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_status ON bot_upload_inbox(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_bot_upload_inbox_created_at ON bot_upload_inbox(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform ON webhook_logs(platform)`,
    sql`CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at)`,
    // Phase 3 tables
    sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_estimate_id ON audit_logs(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_notifications_resolved_at ON notifications(resolved_at)`,
    sql`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`,
    sql`CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_estimate_id ON telegram_deliveries(estimate_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_field_link_id ON telegram_deliveries(field_link_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_status ON telegram_deliveries(status)`,
  ];
  await Promise.all(
    statements.map((stmt) =>
      db.execute(stmt).catch((err: any) => {
        console.error("[indexes] failed:", err?.message);
      })
    )
  );
};
