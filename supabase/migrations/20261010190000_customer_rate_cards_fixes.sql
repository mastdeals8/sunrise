-- Migration: Ensure customer_rate_cards company indexing and customer_rate_items uniqueness
-- Date: 2026-10-10

CREATE INDEX IF NOT EXISTS idx_customer_rate_cards_company_id 
  ON public.customer_rate_cards (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_rate_items_card_product 
  ON public.customer_rate_items (rate_card_id, product_id) 
  WHERE product_id IS NOT NULL;
