-- ============================================================================
-- Migration: 20261015170000_enforce_document_company_integrity.sql
-- Enforces strict company ownership, prevents cross-workspace document leaks,
-- and ensures execution documents and child records auto-inherit and strictly
-- validate their parent estimate/challan company_id.
-- ============================================================================

-- 1. Function: enforce_execution_documents_company_integrity
CREATE OR REPLACE FUNCTION public.enforce_execution_documents_company_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_est_company_id bigint;
  v_dc_company_id bigint;
BEGIN
  -- Resolve or validate from parent estimate
  IF NEW.estimate_id IS NOT NULL THEN
    SELECT company_id INTO v_est_company_id FROM public.estimates WHERE id = NEW.estimate_id;
    IF v_est_company_id IS NOT NULL THEN
      IF NEW.company_id IS NULL THEN
        NEW.company_id := v_est_company_id;
      ELSIF NEW.company_id <> v_est_company_id THEN
        RAISE EXCEPTION 'Execution document company_id (%) does not match parent estimate company_id (%)', NEW.company_id, v_est_company_id;
      END IF;
    END IF;
  END IF;

  -- Resolve or validate from parent delivery challan
  IF NEW.delivery_challan_id IS NOT NULL THEN
    SELECT company_id INTO v_dc_company_id FROM public.delivery_challans WHERE id = NEW.delivery_challan_id;
    IF v_dc_company_id IS NOT NULL THEN
      IF NEW.company_id IS NULL THEN
        NEW.company_id := v_dc_company_id;
      ELSIF NEW.company_id <> v_dc_company_id THEN
        RAISE EXCEPTION 'Execution document company_id (%) does not match parent delivery challan company_id (%)', NEW.company_id, v_dc_company_id;
      END IF;
    END IF;
  END IF;

  -- Prevent transferring an existing document across companies
  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := OLD.company_id;
    ELSIF NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'Cannot transfer execution document between companies (from % to %)', OLD.company_id, NEW.company_id;
    END IF;
  END IF;

  -- Guarantee company_id is never NULL
  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id cannot be null for execution_documents';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_execution_documents_company_integrity ON public.execution_documents;
CREATE TRIGGER trg_execution_documents_company_integrity
BEFORE INSERT OR UPDATE ON public.execution_documents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_execution_documents_company_integrity();


-- 2. Function: enforce_delivery_challans_company_integrity
CREATE OR REPLACE FUNCTION public.enforce_delivery_challans_company_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_est_company_id bigint;
BEGIN
  IF NEW.estimate_id IS NOT NULL THEN
    SELECT company_id INTO v_est_company_id FROM public.estimates WHERE id = NEW.estimate_id;
    IF v_est_company_id IS NOT NULL THEN
      IF NEW.company_id IS NULL THEN
        NEW.company_id := v_est_company_id;
      ELSIF NEW.company_id <> v_est_company_id THEN
        RAISE EXCEPTION 'Delivery challan company_id (%) does not match parent estimate company_id (%)', NEW.company_id, v_est_company_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := OLD.company_id;
    ELSIF NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'Cannot transfer delivery challan between companies (from % to %)', OLD.company_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id cannot be null for delivery_challans';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_challans_company_integrity ON public.delivery_challans;
CREATE TRIGGER trg_delivery_challans_company_integrity
BEFORE INSERT OR UPDATE ON public.delivery_challans
FOR EACH ROW
EXECUTE FUNCTION public.enforce_delivery_challans_company_integrity();


-- 3. Function: enforce_invoices_company_integrity
CREATE OR REPLACE FUNCTION public.enforce_invoices_company_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_est_company_id bigint;
BEGIN
  IF NEW.estimate_id IS NOT NULL THEN
    SELECT company_id INTO v_est_company_id FROM public.estimates WHERE id = NEW.estimate_id;
    IF v_est_company_id IS NOT NULL THEN
      IF NEW.company_id IS NULL THEN
        NEW.company_id := v_est_company_id;
      ELSIF NEW.company_id <> v_est_company_id THEN
        RAISE EXCEPTION 'Invoice company_id (%) does not match parent estimate company_id (%)', NEW.company_id, v_est_company_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := OLD.company_id;
    ELSIF NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'Cannot transfer invoice between companies (from % to %)', OLD.company_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id cannot be null for invoices';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_company_integrity ON public.invoices;
CREATE TRIGGER trg_invoices_company_integrity
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_invoices_company_integrity();


-- 4. Function: enforce_invoice_packets_company_integrity
CREATE OR REPLACE FUNCTION public.enforce_invoice_packets_company_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent_company_id bigint;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT company_id INTO v_parent_company_id FROM public.estimates WHERE id = NEW.project_id;
  END IF;

  IF v_parent_company_id IS NOT NULL THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := v_parent_company_id;
    ELSIF NEW.company_id <> v_parent_company_id THEN
      RAISE EXCEPTION 'Invoice packet company_id (%) does not match parent entity company_id (%)', NEW.company_id, v_parent_company_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL THEN
    IF NEW.company_id IS NULL THEN
      NEW.company_id := OLD.company_id;
    ELSIF NEW.company_id <> OLD.company_id THEN
      RAISE EXCEPTION 'Cannot transfer invoice packet between companies (from % to %)', OLD.company_id, NEW.company_id;
    END IF;
  END IF;

  IF NEW.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id cannot be null for invoice_packets';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_packets_company_integrity ON public.invoice_packets;
CREATE TRIGGER trg_invoice_packets_company_integrity
BEFORE INSERT OR UPDATE ON public.invoice_packets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_invoice_packets_company_integrity();
