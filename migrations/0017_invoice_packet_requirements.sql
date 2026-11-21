-- Migration: 0017_invoice_packet_requirements.sql
-- Description: Company-scoped brand/client invoice packet requirements and overrides

CREATE TABLE IF NOT EXISTS public.invoice_packet_requirements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT 1 REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_invoice BOOLEAN NOT NULL DEFAULT true,
  estimate BOOLEAN NOT NULL DEFAULT true,
  purchase_order BOOLEAN NOT NULL DEFAULT true,
  installation_photos BOOLEAN NOT NULL DEFAULT true,
  generated_wcc BOOLEAN NOT NULL DEFAULT false,
  signed_wcc BOOLEAN NOT NULL DEFAULT true,
  transport_receipt BOOLEAN NOT NULL DEFAULT true,
  other_docs BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Unique indexes enforcing one config per scope within each company
CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ipr_brand_client
  ON public.invoice_packet_requirements (company_id, brand_id, client_id)
  WHERE brand_id IS NOT NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ipr_brand_only
  ON public.invoice_packet_requirements (company_id, brand_id)
  WHERE brand_id IS NOT NULL AND client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ipr_client_only
  ON public.invoice_packet_requirements (company_id, client_id)
  WHERE brand_id IS NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uniq_ipr_company_default
  ON public.invoice_packet_requirements (company_id)
  WHERE brand_id IS NULL AND client_id IS NULL;

-- Enable RLS
ALTER TABLE public.invoice_packet_requirements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_packet_requirements' AND policyname = 'rls_select_invoice_packet_requirements'
  ) THEN
    CREATE POLICY rls_select_invoice_packet_requirements ON public.invoice_packet_requirements
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_packet_requirements' AND policyname = 'rls_all_invoice_packet_requirements'
  ) THEN
    CREATE POLICY rls_all_invoice_packet_requirements ON public.invoice_packet_requirements
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
