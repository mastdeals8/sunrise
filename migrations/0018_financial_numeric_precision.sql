-- ==============================================================================
-- Migration: 0018_financial_numeric_precision.sql
-- Purpose: Upgrade financial monetary columns from REAL (32-bit single precision)
--          to NUMERIC(14, 2) to eliminate floating-point truncation (e.g. 2 paise drift).
-- Safety: Non-destructive, preserves all data, reversible.
-- Status: AWAITING PRODUCTION APPROVAL (DO NOT APPLY UNTIL REVIEWED)
-- ==============================================================================

BEGIN;

-- 1. Estimates Table
ALTER TABLE estimates 
  ALTER COLUMN subtotal TYPE NUMERIC(14, 2) USING subtotal::numeric(14, 2),
  ALTER COLUMN tax_amount TYPE NUMERIC(14, 2) USING tax_amount::numeric(14, 2),
  ALTER COLUMN total_amount TYPE NUMERIC(14, 2) USING total_amount::numeric(14, 2),
  ALTER COLUMN transport_amount TYPE NUMERIC(14, 2) USING transport_amount::numeric(14, 2);

-- 2. Estimate Items Table
ALTER TABLE estimate_items
  ALTER COLUMN rate TYPE NUMERIC(14, 2) USING rate::numeric(14, 2),
  ALTER COLUMN total_price TYPE NUMERIC(14, 2) USING total_price::numeric(14, 2),
  ALTER COLUMN cgst_amount TYPE NUMERIC(14, 2) USING cgst_amount::numeric(14, 2),
  ALTER COLUMN sgst_amount TYPE NUMERIC(14, 2) USING sgst_amount::numeric(14, 2),
  ALTER COLUMN igst_amount TYPE NUMERIC(14, 2) USING igst_amount::numeric(14, 2),
  ALTER COLUMN total_amount TYPE NUMERIC(14, 2) USING total_amount::numeric(14, 2);

-- 3. Invoices Table
ALTER TABLE invoices
  ALTER COLUMN amount TYPE NUMERIC(14, 2) USING amount::numeric(14, 2),
  ALTER COLUMN tax_amount TYPE NUMERIC(14, 2) USING tax_amount::numeric(14, 2),
  ALTER COLUMN total_amount TYPE NUMERIC(14, 2) USING total_amount::numeric(14, 2),
  ALTER COLUMN paid_amount TYPE NUMERIC(14, 2) USING paid_amount::numeric(14, 2),
  ALTER COLUMN balance_amount TYPE NUMERIC(14, 2) USING balance_amount::numeric(14, 2);

-- 4. Payments Table
ALTER TABLE payments
  ALTER COLUMN amount TYPE NUMERIC(14, 2) USING amount::numeric(14, 2);

-- 5. Petty Cash Expenses Table
ALTER TABLE petty_cash_expenses
  ALTER COLUMN amount TYPE NUMERIC(14, 2) USING amount::numeric(14, 2);

COMMIT;
