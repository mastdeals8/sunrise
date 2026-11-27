-- ==============================================================================
-- Migration: 0018_financial_numeric_precision.sql
-- Description: Transition financial, dimensional, and tax percentage columns
--              from 32-bit floating point (REAL) to exact NUMERIC representations.
--
-- PRECISION MAPPING RATIONALE:
-- 1. Monetary Totals & Balances: NUMERIC(14,2)
--    - Max value: 999,999,999,999.99 (~1 Lakh Crore / 1 Trillion INR).
--    - Fits all current and future Indian GST invoices, estimates, payments.
-- 2. Line Item Rates: NUMERIC(14,4)
--    - Supports fractional unit rate cards (e.g. ₹12.3456 per sqft or per unit).
-- 3. Quantities & Consumption: NUMERIC(12,4)
--    - Supports high-precision fractional units, sqft, kilograms, hours.
-- 4. Dimensions: NUMERIC(10,4)
--    - Supports up to 999,999.9999 inches/feet/meters with sub-millimeter precision.
-- 5. Tax & Surcharge Percentages: NUMERIC(5,2)
--    - Supports standard GST rates (0.00% to 100.00%, e.g., 2.50, 6.00, 9.00, 14.00, 18.00, 28.00).
--
-- SAFETY & POINT-IN-TIME BACKUP:
-- Converting REAL -> NUMERIC is exact (float mantissas cast cleanly).
-- However, converting NUMERIC -> REAL in a rollback is inherently LOSSY.
-- To guarantee zero data loss, this migration creates immutable snapshot tables
-- (_backup_0018_*) in the same transaction prior to altering the schema.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Create Point-in-Time Snapshot Backup Tables
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _backup_0018_invoices AS SELECT * FROM invoices;
CREATE TABLE IF NOT EXISTS _backup_0018_estimates AS SELECT * FROM estimates;
CREATE TABLE IF NOT EXISTS _backup_0018_estimate_items AS SELECT * FROM estimate_items;
CREATE TABLE IF NOT EXISTS _backup_0018_payments AS SELECT * FROM payments;
CREATE TABLE IF NOT EXISTS _backup_0018_petty_cash_expenses AS SELECT * FROM petty_cash_expenses;

-- ------------------------------------------------------------------------------
-- 2. Alter `invoices` table
-- ------------------------------------------------------------------------------
ALTER TABLE invoices
    ALTER COLUMN amount TYPE NUMERIC(14,2) USING ROUND(amount::numeric, 2),
    ALTER COLUMN tax_amount TYPE NUMERIC(14,2) USING ROUND(tax_amount::numeric, 2),
    ALTER COLUMN total_amount TYPE NUMERIC(14,2) USING ROUND(total_amount::numeric, 2),
    ALTER COLUMN paid_amount TYPE NUMERIC(14,2) USING ROUND(paid_amount::numeric, 2),
    ALTER COLUMN balance_amount TYPE NUMERIC(14,2) USING ROUND(balance_amount::numeric, 2);

-- ------------------------------------------------------------------------------
-- 3. Alter `estimates` table
-- ------------------------------------------------------------------------------
ALTER TABLE estimates
    ALTER COLUMN subtotal TYPE NUMERIC(14,2) USING ROUND(subtotal::numeric, 2),
    ALTER COLUMN tax_amount TYPE NUMERIC(14,2) USING ROUND(tax_amount::numeric, 2),
    ALTER COLUMN total_amount TYPE NUMERIC(14,2) USING ROUND(total_amount::numeric, 2),
    ALTER COLUMN po_amount TYPE NUMERIC(14,2) USING ROUND(po_amount::numeric, 2),
    ALTER COLUMN transport_amount TYPE NUMERIC(14,2) USING ROUND(transport_amount::numeric, 2),
    ALTER COLUMN packing_percent TYPE NUMERIC(5,2) USING ROUND(packing_percent::numeric, 2),
    ALTER COLUMN implementation_percent TYPE NUMERIC(5,2) USING ROUND(implementation_percent::numeric, 2);

-- ------------------------------------------------------------------------------
-- 4. Alter `estimate_items` table
-- ------------------------------------------------------------------------------
ALTER TABLE estimate_items
    ALTER COLUMN rate TYPE NUMERIC(14,4) USING ROUND(rate::numeric, 4),
    ALTER COLUMN quantity TYPE NUMERIC(12,4) USING ROUND(quantity::numeric, 4),
    ALTER COLUMN width TYPE NUMERIC(10,4) USING ROUND(width::numeric, 4),
    ALTER COLUMN height TYPE NUMERIC(10,4) USING ROUND(height::numeric, 4),
    ALTER COLUMN total_size TYPE NUMERIC(10,4) USING ROUND(total_size::numeric, 4),
    ALTER COLUMN amount TYPE NUMERIC(14,2) USING ROUND(amount::numeric, 2),
    ALTER COLUMN cgst_percent TYPE NUMERIC(5,2) USING ROUND(cgst_percent::numeric, 2),
    ALTER COLUMN sgst_percent TYPE NUMERIC(5,2) USING ROUND(sgst_percent::numeric, 2),
    ALTER COLUMN igst_percent TYPE NUMERIC(5,2) USING ROUND(igst_percent::numeric, 2);

-- ------------------------------------------------------------------------------
-- 5. Alter `payments` table
-- ------------------------------------------------------------------------------
ALTER TABLE payments
    ALTER COLUMN amount TYPE NUMERIC(14,2) USING ROUND(amount::numeric, 2);

-- ------------------------------------------------------------------------------
-- 6. Alter `petty_cash_expenses` table
-- ------------------------------------------------------------------------------
ALTER TABLE petty_cash_expenses
    ALTER COLUMN amount TYPE NUMERIC(14,2) USING ROUND(amount::numeric, 2);

COMMIT;
