-- Phase 1 Schema Migration
-- Safe, non-destructive schema changes
-- Run with: psql $DATABASE_URL -f server/migrate_phase1.sql

-- ============================================
-- 1. Add new fields to material_codes table
-- ============================================

-- Add productName field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'material_codes' AND column_name = 'product_name'
  ) THEN
    ALTER TABLE material_codes ADD COLUMN product_name TEXT;
    RAISE NOTICE 'Added product_name to material_codes';
  ELSE
    RAISE NOTICE 'product_name already exists in material_codes';
  END IF;
END $$;

-- Add category field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'material_codes' AND column_name = 'category'
  ) THEN
    ALTER TABLE material_codes ADD COLUMN category TEXT;
    RAISE NOTICE 'Added category to material_codes';
  ELSE
    RAISE NOTICE 'category already exists in material_codes';
  END IF;
END $$;

-- Add isStandard field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'material_codes' AND column_name = 'is_standard'
  ) THEN
    ALTER TABLE material_codes ADD COLUMN is_standard BOOLEAN NOT NULL DEFAULT true;
    RAISE NOTICE 'Added is_standard to material_codes';
  ELSE
    RAISE NOTICE 'is_standard already exists in material_codes';
  END IF;
END $$;

-- Make brandId nullable (if not already)
DO $$
BEGIN
  ALTER TABLE material_codes ALTER COLUMN brand_id DROP NOT NULL;
  RAISE NOTICE 'Made brand_id nullable in material_codes';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'brand_id is already nullable or error occurred: %', SQLERRM;
END $$;

-- Make clientId NOT NULL (if not already)
DO $$
BEGIN
  ALTER TABLE material_codes ALTER COLUMN client_id SET NOT NULL;
  RAISE NOTICE 'Made client_id NOT NULL in material_codes';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'client_id is already NOT NULL or error occurred: %', SQLERRM;
END $$;

-- ============================================
-- 2. Add new fields to estimate_items table
-- ============================================

-- Add manualStoreName field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'manual_store_name'
  ) THEN
    ALTER TABLE estimate_items ADD COLUMN manual_store_name TEXT;
    RAISE NOTICE 'Added manual_store_name to estimate_items';
  ELSE
    RAISE NOTICE 'manual_store_name already exists in estimate_items';
  END IF;
END $$;

-- Add lineType field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'line_type'
  ) THEN
    ALTER TABLE estimate_items ADD COLUMN line_type TEXT DEFAULT 'product';
    RAISE NOTICE 'Added line_type to estimate_items';
  ELSE
    RAISE NOTICE 'line_type already exists in estimate_items';
  END IF;
END $$;

-- Add calculationType field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'calculation_type'
  ) THEN
    ALTER TABLE estimate_items ADD COLUMN calculation_type TEXT DEFAULT 'fixed';
    RAISE NOTICE 'Added calculation_type to estimate_items';
  ELSE
    RAISE NOTICE 'calculation_type already exists in estimate_items';
  END IF;
END $$;

-- Add materialCodeSnapshot field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'material_code_snapshot'
  ) THEN
    ALTER TABLE estimate_items ADD COLUMN material_code_snapshot JSONB;
    RAISE NOTICE 'Added material_code_snapshot to estimate_items';
  ELSE
    RAISE NOTICE 'material_code_snapshot already exists in estimate_items';
  END IF;
END $$;

-- Add productSnapshot field (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimate_items' AND column_name = 'product_snapshot'
  ) THEN
    ALTER TABLE estimate_items ADD COLUMN product_snapshot JSONB;
    RAISE NOTICE 'Added product_snapshot to estimate_items';
  ELSE
    RAISE NOTICE 'product_snapshot already exists in estimate_items';
  END IF;
END $$;

-- ============================================
-- 3. Seed operational material codes
-- ============================================

-- Seed OT_PACKING000N for all ABLBL clients
INSERT INTO material_codes (
  client_id, brand_id, code, product_name, description,
  hsn, uom, gst_percent, default_rate, category, is_standard, is_active
)
SELECT
  c.id as client_id,
  NULL as brand_id,
  'OT_PACKING000N' as code,
  'Packing Charges' as product_name,
  'Packing and handling charges' as description,
  '996511' as hsn,
  'job' as uom,
  18 as gst_percent,
  0 as default_rate,
  'Operational' as category,
  true as is_standard,
  true as is_active
FROM clients c
WHERE c.format = 'ABLBL'
AND NOT EXISTS (
  SELECT 1 FROM material_codes mc
  WHERE mc.client_id = c.id
  AND mc.code = 'OT_PACKING000N'
);

-- Seed OT_INSTALLATION00N for all ABLBL clients
INSERT INTO material_codes (
  client_id, brand_id, code, product_name, description,
  hsn, uom, gst_percent, default_rate, category, is_standard, is_active
)
SELECT
  c.id as client_id,
  NULL as brand_id,
  'OT_INSTALLATION00N' as code,
  'Installation Charges' as product_name,
  'Installation and setup charges' as description,
  '995415' as hsn,
  'job' as uom,
  18 as gst_percent,
  0 as default_rate,
  'Operational' as category,
  true as is_standard,
  true as is_active
FROM clients c
WHERE c.format = 'ABLBL'
AND NOT EXISTS (
  SELECT 1 FROM material_codes mc
  WHERE mc.client_id = c.id
  AND mc.code = 'OT_INSTALLATION00N'
);

-- Seed OT_TRANSPORT001N for all ABLBL clients
INSERT INTO material_codes (
  client_id, brand_id, code, product_name, description,
  hsn, uom, gst_percent, default_rate, category, is_standard, is_active
)
SELECT
  c.id as client_id,
  NULL as brand_id,
  'OT_TRANSPORT001N' as code,
  'Transport Charges' as product_name,
  'Transportation and logistics charges' as description,
  '996511' as hsn,
  'job' as uom,
  18 as gst_percent,
  0 as default_rate,
  'Operational' as category,
  true as is_standard,
  true as is_active
FROM clients c
WHERE c.format = 'ABLBL'
AND NOT EXISTS (
  SELECT 1 FROM material_codes mc
  WHERE mc.client_id = c.id
  AND mc.code = 'OT_TRANSPORT001N'
);

-- ============================================
-- 4. Summary
-- ============================================

DO $$
DECLARE
  ablbl_count INTEGER;
  packing_count INTEGER;
  installation_count INTEGER;
  transport_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO ablbl_count FROM clients WHERE format = 'ABLBL';
  SELECT COUNT(*) INTO packing_count FROM material_codes WHERE code = 'OT_PACKING000N';
  SELECT COUNT(*) INTO installation_count FROM material_codes WHERE code = 'OT_INSTALLATION00N';
  SELECT COUNT(*) INTO transport_count FROM material_codes WHERE code = 'OT_TRANSPORT001N';

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 1 Migration Summary';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ABLBL clients found: %', ablbl_count;
  RAISE NOTICE 'OT_PACKING000N codes: %', packing_count;
  RAISE NOTICE 'OT_INSTALLATION00N codes: %', installation_count;
  RAISE NOTICE 'OT_TRANSPORT001N codes: %', transport_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
END $$;
