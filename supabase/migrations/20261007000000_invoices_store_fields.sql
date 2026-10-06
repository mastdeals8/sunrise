-- Migration: 20261007000000_invoices_store_fields.sql
-- Description: Add store_id, store_code, store_name to invoices table for Store-wise Invoice generation.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS store_id integer REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store_code text,
  ADD COLUMN IF NOT EXISTS store_name text;

CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id_store_id ON public.invoices(estimate_id, store_id);
CREATE INDEX IF NOT EXISTS idx_invoices_estimate_id_store_code ON public.invoices(estimate_id, store_code);
