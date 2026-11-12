-- Migration 0016: Project Costing Database Hardening
-- Hardening for archived estimate relinking, cross-company ownership, financial precision (NUMERIC), source integrity, and accounting constraints.

-- ============================================================================
-- 1. FINANCIAL PRECISION: Convert monetary columns from REAL to NUMERIC(14, 2)
-- ============================================================================

-- master_projects monetary columns
ALTER TABLE master_projects 
    ALTER COLUMN target_budget TYPE NUMERIC(14, 2) USING target_budget::NUMERIC(14, 2),
    ALTER COLUMN budget_revenue TYPE NUMERIC(14, 2) USING budget_revenue::NUMERIC(14, 2),
    ALTER COLUMN budget_cost TYPE NUMERIC(14, 2) USING budget_cost::NUMERIC(14, 2);

-- project_cost_allocations monetary columns
ALTER TABLE project_cost_allocations
    ALTER COLUMN base_amount TYPE NUMERIC(14, 2) USING base_amount::NUMERIC(14, 2),
    ALTER COLUMN gst_rate TYPE NUMERIC(5, 2) USING gst_rate::NUMERIC(5, 2),
    ALTER COLUMN gst_amount TYPE NUMERIC(14, 2) USING gst_amount::NUMERIC(14, 2),
    ALTER COLUMN total_amount TYPE NUMERIC(14, 2) USING total_amount::NUMERIC(14, 2),
    ALTER COLUMN ineligible_gst_amount TYPE NUMERIC(14, 2) USING ineligible_gst_amount::NUMERIC(14, 2),
    ALTER COLUMN recognised_cost TYPE NUMERIC(14, 2) USING recognised_cost::NUMERIC(14, 2);

-- contractor_work_orders monetary columns & approved variation amount
ALTER TABLE contractor_work_orders
    ALTER COLUMN committed_amount TYPE NUMERIC(14, 2) USING committed_amount::NUMERIC(14, 2),
    ALTER COLUMN billed_amount TYPE NUMERIC(14, 2) USING billed_amount::NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS approved_variation_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00;

-- ============================================================================
-- 2. ARCHIVED ESTIMATE RELINKING & AUDIT PRESERVATION
-- ============================================================================

-- Drop the unconditional unique constraint from migration 0015
ALTER TABLE project_estimates DROP CONSTRAINT IF EXISTS uq_project_estimate_single;

-- Add status and unlinking audit columns to project_estimates
ALTER TABLE project_estimates 
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS unlinked_at TIMESTAMP WITHOUT TIME ZONE,
    ADD COLUMN IF NOT EXISTS unlinked_by INTEGER REFERENCES users(id);

-- Create partial unique index: only ONE active project link per estimate per company
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_project_estimate 
ON project_estimates (company_id, estimate_id) 
WHERE status = 'active';

-- Trigger function: Synchronize project_estimates status when master_projects status changes
CREATE OR REPLACE FUNCTION fn_sync_project_estimate_status()
RETURNS TRIGGER AS $$
BEGIN
    -- If project is being archived, archive all its active estimate links
    IF NEW.status = 'archived' AND (OLD.status IS NULL OR OLD.status != 'archived') THEN
        UPDATE project_estimates
        SET status = 'archived'
        WHERE project_id = NEW.id AND status = 'active';
    END IF;

    -- If project is being unarchived, ensure its estimates aren't currently active on another project before activating
    IF NEW.status != 'archived' AND OLD.status = 'archived' THEN
        IF EXISTS (
            SELECT 1
            FROM project_estimates pe1
            JOIN project_estimates pe2 ON pe1.estimate_id = pe2.estimate_id AND pe1.company_id = pe2.company_id
            WHERE pe1.project_id = NEW.id
              AND pe2.project_id != NEW.id
              AND pe2.status = 'active'
        ) THEN
            RAISE EXCEPTION 'Cannot unarchive Master Project (ID: %): One or more linked estimates are currently active in another Master Project.', NEW.id;
        END IF;

        UPDATE project_estimates
        SET status = 'active'
        WHERE project_id = NEW.id AND status = 'archived';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_project_estimate_status ON master_projects;
CREATE TRIGGER trg_sync_project_estimate_status
    AFTER UPDATE OF status ON master_projects
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_project_estimate_status();

-- Trigger function: Guard project_estimates insertions against archived projects
CREATE OR REPLACE FUNCTION fn_guard_project_estimate_link()
RETURNS TRIGGER AS $$
DECLARE
    v_proj_status TEXT;
BEGIN
    IF NEW.status = 'active' THEN
        SELECT status INTO v_proj_status FROM master_projects WHERE id = NEW.project_id;
        IF v_proj_status = 'archived' THEN
            RAISE EXCEPTION 'Cannot link estimate to archived Master Project (ID: %). Unarchive the project first.', NEW.project_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_project_estimate_link ON project_estimates;
CREATE TRIGGER trg_guard_project_estimate_link
    BEFORE INSERT OR UPDATE OF status, project_id ON project_estimates
    FOR EACH ROW
    EXECUTE FUNCTION fn_guard_project_estimate_link();

-- ============================================================================
-- 3. CROSS-COMPANY OWNERSHIP & INTEGRITY SAFEGUARDS
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_validate_project_costing_ownership()
RETURNS TRIGGER AS $$
DECLARE
    v_client_company_id INTEGER;
    v_brand_company_id INTEGER;
    v_proj_company_id INTEGER;
    v_proj_client_id INTEGER;
    v_est_company_id INTEGER;
    v_est_client_id INTEGER;
    v_store_company_id INTEGER;
BEGIN
    -- Table: master_projects
    IF TG_TABLE_NAME = 'master_projects' THEN
        SELECT company_id INTO v_client_company_id FROM clients WHERE id = NEW.client_id;
        IF v_client_company_id IS NULL OR v_client_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company violation: Client (ID: %) belongs to company %, not project company %', NEW.client_id, v_client_company_id, NEW.company_id;
        END IF;

        IF NEW.brand_id IS NOT NULL THEN
            SELECT company_id INTO v_brand_company_id FROM brands WHERE id = NEW.brand_id;
            IF v_brand_company_id IS NOT NULL AND v_brand_company_id != NEW.company_id THEN
                RAISE EXCEPTION 'Cross-company violation: Brand (ID: %) belongs to company %, not project company %', NEW.brand_id, v_brand_company_id, NEW.company_id;
            END IF;
        END IF;
    END IF;

    -- Table: project_estimates
    IF TG_TABLE_NAME = 'project_estimates' THEN
        SELECT company_id, client_id INTO v_proj_company_id, v_proj_client_id FROM master_projects WHERE id = NEW.project_id;
        IF v_proj_company_id IS NULL OR v_proj_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company violation: Master Project (ID: %) belongs to company %, not %', NEW.project_id, v_proj_company_id, NEW.company_id;
        END IF;

        SELECT company_id, client_id INTO v_est_company_id, v_est_client_id FROM estimates WHERE id = NEW.estimate_id;
        IF v_est_company_id IS NULL OR v_est_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company violation: Estimate (ID: %) belongs to company %, not %', NEW.estimate_id, v_est_company_id, NEW.company_id;
        END IF;

        IF v_est_client_id != v_proj_client_id THEN
            RAISE EXCEPTION 'Cross-client violation: Estimate (ID: %) belongs to Client %, but Master Project belongs to Client %', NEW.estimate_id, v_est_client_id, v_proj_client_id;
        END IF;
    END IF;

    -- Table: project_cost_allocations
    IF TG_TABLE_NAME = 'project_cost_allocations' THEN
        SELECT company_id INTO v_proj_company_id FROM master_projects WHERE id = NEW.project_id;
        IF v_proj_company_id IS NULL OR v_proj_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company violation: Master Project (ID: %) belongs to company %, not allocation company %', NEW.project_id, v_proj_company_id, NEW.company_id;
        END IF;

        IF NEW.estimate_id IS NOT NULL THEN
            SELECT company_id INTO v_est_company_id FROM estimates WHERE id = NEW.estimate_id;
            IF v_est_company_id IS NULL OR v_est_company_id != NEW.company_id THEN
                RAISE EXCEPTION 'Cross-company violation: Estimate (ID: %) belongs to company %, not allocation company %', NEW.estimate_id, v_est_company_id, NEW.company_id;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM project_estimates 
                WHERE project_id = NEW.project_id AND estimate_id = NEW.estimate_id AND company_id = NEW.company_id
            ) THEN
                RAISE EXCEPTION 'Cross-project violation: Estimate (ID: %) is not linked to Master Project (ID: %)', NEW.estimate_id, NEW.project_id;
            END IF;
        END IF;

        IF NEW.store_id IS NOT NULL THEN
            SELECT company_id INTO v_store_company_id FROM stores WHERE id = NEW.store_id;
            IF v_store_company_id IS NULL OR v_store_company_id != NEW.company_id THEN
                RAISE EXCEPTION 'Cross-company violation: Store (ID: %) belongs to company %, not allocation company %', NEW.store_id, v_store_company_id, NEW.company_id;
            END IF;
        END IF;
    END IF;

    -- Table: contractor_work_orders
    IF TG_TABLE_NAME = 'contractor_work_orders' THEN
        SELECT company_id INTO v_proj_company_id FROM master_projects WHERE id = NEW.project_id;
        IF v_proj_company_id IS NULL OR v_proj_company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company violation: Master Project (ID: %) belongs to company %, not work order company %', NEW.project_id, v_proj_company_id, NEW.company_id;
        END IF;

        IF NEW.estimate_id IS NOT NULL THEN
            SELECT company_id INTO v_est_company_id FROM estimates WHERE id = NEW.estimate_id;
            IF v_est_company_id IS NULL OR v_est_company_id != NEW.company_id THEN
                RAISE EXCEPTION 'Cross-company violation: Estimate (ID: %) belongs to company %, not work order company %', NEW.estimate_id, v_est_company_id, NEW.company_id;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM project_estimates 
                WHERE project_id = NEW.project_id AND estimate_id = NEW.estimate_id AND company_id = NEW.company_id
            ) THEN
                RAISE EXCEPTION 'Cross-project violation: Estimate (ID: %) is not linked to Master Project (ID: %)', NEW.estimate_id, NEW.project_id;
            END IF;
        END IF;

        IF NEW.store_id IS NOT NULL THEN
            SELECT company_id INTO v_store_company_id FROM stores WHERE id = NEW.store_id;
            IF v_store_company_id IS NULL OR v_store_company_id != NEW.company_id THEN
                RAISE EXCEPTION 'Cross-company violation: Store (ID: %) belongs to company %, not work order company %', NEW.store_id, v_store_company_id, NEW.company_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_val_master_projects ON master_projects;
CREATE TRIGGER trg_val_master_projects
    BEFORE INSERT OR UPDATE OF company_id, client_id, brand_id ON master_projects
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_project_costing_ownership();

DROP TRIGGER IF EXISTS trg_val_project_estimates ON project_estimates;
CREATE TRIGGER trg_val_project_estimates
    BEFORE INSERT OR UPDATE OF company_id, project_id, estimate_id ON project_estimates
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_project_costing_ownership();

DROP TRIGGER IF EXISTS trg_val_project_cost_allocations ON project_cost_allocations;
CREATE TRIGGER trg_val_project_cost_allocations
    BEFORE INSERT OR UPDATE OF company_id, project_id, estimate_id, store_id ON project_cost_allocations
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_project_costing_ownership();

DROP TRIGGER IF EXISTS trg_val_contractor_work_orders ON contractor_work_orders;
CREATE TRIGGER trg_val_contractor_work_orders
    BEFORE INSERT OR UPDATE OF company_id, project_id, estimate_id, store_id ON contractor_work_orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_project_costing_ownership();

-- ============================================================================
-- 4. SOURCE ALLOCATION INTEGRITY
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_validate_cost_allocation_source()
RETURNS TRIGGER AS $$
DECLARE
    v_inv RECORD;
    v_exp RECORD;
    v_wo RECORD;
    v_allocated_sum NUMERIC(14, 2);
    v_max_base NUMERIC(14, 2);
BEGIN
    -- 1. Source: purchase_invoice
    IF NEW.source_type = 'purchase_invoice' THEN
        IF NEW.source_id IS NULL THEN
            RAISE EXCEPTION 'Missing source_id for purchase_invoice cost allocation';
        END IF;

        SELECT company_id, type, status, amount, total_amount INTO v_inv
        FROM invoices WHERE id = NEW.source_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source purchase invoice #% not found in invoices table', NEW.source_id;
        END IF;

        IF v_inv.company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company source violation: Purchase invoice % belongs to company %, not allocation company %', NEW.source_id, v_inv.company_id, NEW.company_id;
        END IF;

        IF v_inv.status = 'cancelled' AND NEW.status = 'active' THEN
            RAISE EXCEPTION 'Cannot activate cost allocation from cancelled purchase invoice #%', NEW.source_id;
        END IF;

        -- Validate over-allocation limit
        IF NEW.status = 'active' THEN
            SELECT COALESCE(SUM(base_amount), 0) INTO v_allocated_sum
            FROM project_cost_allocations
            WHERE source_type = 'purchase_invoice'
              AND source_id = NEW.source_id
              AND status = 'active'
              AND id != COALESCE(NEW.id, 0);

            v_max_base := COALESCE(v_inv.amount, v_inv.total_amount, 0);
            IF (v_allocated_sum + NEW.base_amount) > (v_max_base + 0.05) THEN
                RAISE EXCEPTION 'Over-allocation violation: Total allocated base (%) exceeds purchase invoice base amount (%)', (v_allocated_sum + NEW.base_amount), v_max_base;
            END IF;
        END IF;
    END IF;

    -- 2. Source: petty_cash
    IF NEW.source_type = 'petty_cash' THEN
        IF NEW.source_id IS NULL THEN
            RAISE EXCEPTION 'Missing source_id for petty_cash cost allocation';
        END IF;

        SELECT company_id, amount, status INTO v_exp
        FROM petty_cash_expenses WHERE id = NEW.source_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source petty cash expense #% not found in petty_cash_expenses table', NEW.source_id;
        END IF;

        IF v_exp.company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company source violation: Petty cash expense % belongs to company %, not allocation company %', NEW.source_id, v_exp.company_id, NEW.company_id;
        END IF;

        IF v_exp.status != 'approved' AND NEW.status = 'active' THEN
            RAISE EXCEPTION 'Cannot activate cost allocation for unapproved petty cash expense #% (status: %)', NEW.source_id, v_exp.status;
        END IF;
    END IF;

    -- 3. Source: contractor_bill
    IF NEW.source_type = 'contractor_bill' THEN
        IF NEW.source_id IS NULL THEN
            RAISE EXCEPTION 'Missing source_id for contractor_bill cost allocation';
        END IF;

        SELECT company_id, project_id, status INTO v_wo
        FROM contractor_work_orders WHERE id = NEW.source_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source contractor work order #% not found', NEW.source_id;
        END IF;

        IF v_wo.company_id != NEW.company_id THEN
            RAISE EXCEPTION 'Cross-company source violation: Work order % belongs to company %, not allocation company %', NEW.source_id, v_wo.company_id, NEW.company_id;
        END IF;

        IF v_wo.project_id != NEW.project_id THEN
            RAISE EXCEPTION 'Cross-project source violation: Work order % belongs to project %, not allocation project %', NEW.source_id, v_wo.project_id, NEW.project_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_val_cost_allocation_source ON project_cost_allocations;
CREATE TRIGGER trg_val_cost_allocation_source
    BEFORE INSERT OR UPDATE OF source_type, source_id, base_amount, status, company_id, project_id ON project_cost_allocations
    FOR EACH ROW
    EXECUTE FUNCTION fn_validate_cost_allocation_source();

-- Prevent duplicate active allocations for the same petty cash expense
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_petty_cash_allocation 
ON project_cost_allocations (source_id) 
WHERE source_type = 'petty_cash' AND status = 'active';

-- ============================================================================
-- 5. ACCOUNTING & STATUS CHECKS
-- ============================================================================

-- project_estimates status check
ALTER TABLE project_estimates
    ADD CONSTRAINT chk_pe_status CHECK (status IN ('active', 'archived', 'unlinked'));

-- master_projects checks
ALTER TABLE master_projects
    ADD CONSTRAINT chk_mp_target_budget CHECK (target_budget >= 0),
    ADD CONSTRAINT chk_mp_budget_revenue CHECK (budget_revenue >= 0),
    ADD CONSTRAINT chk_mp_budget_cost CHECK (budget_cost >= 0),
    ADD CONSTRAINT chk_mp_status CHECK (status IN ('active', 'completed', 'on_hold', 'archived'));

-- project_cost_allocations checks
ALTER TABLE project_cost_allocations
    ADD CONSTRAINT chk_pca_base_amount CHECK (base_amount > 0),
    ADD CONSTRAINT chk_pca_gst_rate CHECK (gst_rate >= 0),
    ADD CONSTRAINT chk_pca_gst_amount CHECK (gst_amount >= 0),
    ADD CONSTRAINT chk_pca_total_amount CHECK (total_amount >= base_amount),
    ADD CONSTRAINT chk_pca_ineligible_gst CHECK (ineligible_gst_amount >= 0),
    ADD CONSTRAINT chk_pca_recognised_cost CHECK (recognised_cost >= 0),
    ADD CONSTRAINT chk_pca_status CHECK (status IN ('active', 'reversed')),
    ADD CONSTRAINT chk_pca_source_type CHECK (source_type IN ('purchase_invoice', 'petty_cash', 'contractor_bill', 'transport', 'direct', 'manual')),
    ADD CONSTRAINT chk_pca_total_calc CHECK (ABS(total_amount - (base_amount + gst_amount)) <= 0.05),
    ADD CONSTRAINT chk_pca_recognised_calc CHECK (
        (is_recoverable_gst = TRUE AND ABS(recognised_cost - (base_amount + ineligible_gst_amount)) <= 0.05) OR
        (is_recoverable_gst = FALSE AND ABS(recognised_cost - total_amount) <= 0.05)
    );

-- contractor_work_orders checks
ALTER TABLE contractor_work_orders
    ADD CONSTRAINT chk_cwo_committed_amount CHECK (committed_amount >= 0),
    ADD CONSTRAINT chk_cwo_billed_amount CHECK (billed_amount >= 0),
    ADD CONSTRAINT chk_cwo_variation_amount CHECK (approved_variation_amount >= 0),
    ADD CONSTRAINT chk_cwo_billing_limit CHECK (billed_amount <= (committed_amount + approved_variation_amount + 0.05)),
    ADD CONSTRAINT chk_cwo_status CHECK (status IN ('draft', 'issued', 'in_progress', 'partially_billed', 'fully_billed', 'completed', 'cancelled'));

