-- ==============================================================================
-- Rollback Migration: 0018_financial_numeric_precision_rollback.sql
-- Purpose: Revert financial monetary columns from NUMERIC(14, 2) back to REAL.
-- ==============================================================================

BEGIN;

-- 1. Estimates Table
ALTER TABLE estimates 
  ALTER COLUMN subtotal TYPE REAL USING subtotal::real,
  ALTER COLUMN tax_amount TYPE REAL USING tax_amount::real,
  ALTER COLUMN total_amount TYPE REAL USING total_amount::real,
  ALTER COLUMN transport_amount TYPE REAL USING transport_amount::real;

-- 2. Estimate Items Table
ALTER TABLE estimate_items
  ALTER COLUMN rate TYPE REAL USING rate::real,
  ALTER COLUMN total_price TYPE REAL USING total_price::real,
  ALTER COLUMN cgst_amount TYPE REAL USING cgst_amount::real,
  ALTER COLUMN sgst_amount TYPE REAL USING sgst_amount::real,
  ALTER COLUMN igst_amount TYPE REAL USING igst_amount::real,
  ALTER COLUMN total_amount TYPE REAL USING total_amount::real;

-- 3. Invoices Table
ALTER TABLE invoices
  ALTER COLUMN amount TYPE REAL USING amount::real,
  ALTER COLUMN tax_amount TYPE REAL USING tax_amount::real,
  ALTER COLUMN total_amount TYPE REAL USING total_amount::real,
  ALTER COLUMN paid_amount TYPE REAL USING paid_amount::real,
  ALTER COLUMN balance_amount TYPE REAL USING balance_amount::real;

-- 4. Payments Table
ALTER TABLE payments
  ALTER COLUMN amount TYPE REAL USING amount::real;

-- 5. Petty Cash Expenses Table
ALTER TABLE petty_cash_expenses
  ALTER COLUMN amount TYPE REAL USING amount::real;

COMMIT;
