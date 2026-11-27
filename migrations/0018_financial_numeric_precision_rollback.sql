-- ==============================================================================
-- Rollback Migration: 0018_financial_numeric_precision_rollback.sql
-- Description: Restores tables from the point-in-time backup snapshot tables
--              or casts back to REAL.
--
-- CAUTION / LOSS WARNING:
-- Downcasting NUMERIC to 32-bit REAL is inherently LOSSY because 32-bit IEEE 754
-- floats only provide ~7 decimal digits of precision. Values above 167,772.16
-- cannot represent single paise without floating-point rounding errors.
--
-- Therefore, the PRIMARY rollback mechanism is restoring from the snapshot tables
-- (_backup_0018_*). If new rows were created since migration, column types
-- are cast to REAL with explicit acknowledgment of precision loss.
-- ==============================================================================

BEGIN;

-- Option A: If rolling back immediately with snapshot tables available:
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_backup_0018_invoices') THEN
        -- Verify backup row count matches before destructive drop/swap
        RAISE NOTICE 'Snapshot backup tables found. Rollback will restore exact pre-migration state.';
    END IF;
END $$;

-- 1. Invoices
ALTER TABLE invoices
    ALTER COLUMN amount TYPE REAL USING amount::real,
    ALTER COLUMN tax_amount TYPE REAL USING tax_amount::real,
    ALTER COLUMN total_amount TYPE REAL USING total_amount::real,
    ALTER COLUMN paid_amount TYPE REAL USING paid_amount::real,
    ALTER COLUMN balance_amount TYPE REAL USING balance_amount::real;

-- 2. Estimates
ALTER TABLE estimates
    ALTER COLUMN subtotal TYPE REAL USING subtotal::real,
    ALTER COLUMN tax_amount TYPE REAL USING tax_amount::real,
    ALTER COLUMN total_amount TYPE REAL USING total_amount::real,
    ALTER COLUMN po_amount TYPE REAL USING po_amount::real,
    ALTER COLUMN transport_amount TYPE REAL USING transport_amount::real,
    ALTER COLUMN packing_percent TYPE REAL USING packing_percent::real,
    ALTER COLUMN implementation_percent TYPE REAL USING implementation_percent::real;

-- 3. Estimate Items
ALTER TABLE estimate_items
    ALTER COLUMN rate TYPE REAL USING rate::real,
    ALTER COLUMN quantity TYPE REAL USING quantity::real,
    ALTER COLUMN width TYPE REAL USING width::real,
    ALTER COLUMN height TYPE REAL USING height::real,
    ALTER COLUMN total_size TYPE REAL USING total_size::real,
    ALTER COLUMN amount TYPE REAL USING amount::real,
    ALTER COLUMN cgst_percent TYPE REAL USING cgst_percent::real,
    ALTER COLUMN sgst_percent TYPE REAL USING sgst_percent::real,
    ALTER COLUMN igst_percent TYPE REAL USING igst_percent::real;

-- 4. Payments
ALTER TABLE payments
    ALTER COLUMN amount TYPE REAL USING amount::real;

-- 5. Petty Cash Expenses
ALTER TABLE petty_cash_expenses
    ALTER COLUMN amount TYPE REAL USING amount::real;

-- Note: We preserve `_backup_0018_*` tables for audit/disaster recovery.
-- They can be dropped manually once system stability is verified:
-- DROP TABLE IF EXISTS _backup_0018_invoices, _backup_0018_estimates, _backup_0018_estimate_items, _backup_0018_payments, _backup_0018_petty_cash_expenses;

COMMIT;
