-- ==============================================================================
-- SUNRISE MEDIA ERP — COMPANY BRANDING & SETTINGS PERSISTENCE
-- Migration: 20261012220000_company_branding_and_settings_persistence.sql
-- ==============================================================================

-- 1. Add company-specific branding columns to public.companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS signature_path text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS seal_path text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS footer_bg_color text DEFAULT '#f59e0b';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS footer_text_color text DEFAULT '#ffffff';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS header_bg_color text DEFAULT '#ffffff';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS header_text_color text DEFAULT '#1e293b';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS footer_alignment text DEFAULT 'center';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS branding_options jsonb DEFAULT '{}'::jsonb;

-- 2. Backfill Company 1 with default brand assets and colors if unset
UPDATE public.companies
SET
  signature_path = COALESCE(signature_path, signature_stamp_path),
  seal_path = COALESCE(seal_path, signature_stamp_path),
  footer_bg_color = COALESCE(footer_bg_color, '#f59e0b'),
  footer_text_color = COALESCE(footer_text_color, '#ffffff'),
  header_bg_color = COALESCE(header_bg_color, '#ffffff'),
  header_text_color = COALESCE(header_text_color, '#1e293b'),
  footer_alignment = COALESCE(footer_alignment, 'center'),
  branding_options = COALESCE(branding_options, '{}'::jsonb)
WHERE id = 1;

-- 3. Ensure other companies have valid default styling values
UPDATE public.companies
SET
  footer_bg_color = COALESCE(footer_bg_color, '#f59e0b'),
  footer_text_color = COALESCE(footer_text_color, '#ffffff'),
  header_bg_color = COALESCE(header_bg_color, '#ffffff'),
  header_text_color = COALESCE(header_text_color, '#1e293b'),
  footer_alignment = COALESCE(footer_alignment, 'center'),
  branding_options = COALESCE(branding_options, '{}'::jsonb)
WHERE id != 1;

-- 4. Verify and ensure company-assets storage policies exist
DO $$
BEGIN
  -- Insert bucket if not existing
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('company-assets', 'company-assets', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

  -- Ensure storage policy for update
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Auth update company-assets'
  ) THEN
    CREATE POLICY "Auth update company-assets"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'company-assets')
      WITH CHECK (bucket_id = 'company-assets');
  END IF;
END $$;
