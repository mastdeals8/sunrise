-- =========================================================================
-- SUNRISE MEDIA ERP — MASTER PROJECT COSTING & PROFITABILITY MIGRATION
-- Migration: 0015_master_project_costing.sql
-- Strictly Additive: Creates 4 isolated tables with RLS and company scoping
-- =========================================================================

-- 1. Master Projects (Multi-estimate, multi-store project rollouts)
CREATE TABLE IF NOT EXISTS master_projects (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    brand_id INTEGER REFERENCES brands(id),
    manager_id INTEGER REFERENCES users(id),
    project_code TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    start_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    target_completion_date TIMESTAMP WITHOUT TIME ZONE,
    actual_completion_date TIMESTAMP WITHOUT TIME ZONE,
    target_budget REAL DEFAULT 0,
    budget_revenue REAL DEFAULT 0,
    budget_cost REAL DEFAULT 0,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_master_project_code_company UNIQUE (company_id, project_code)
);

CREATE INDEX IF NOT EXISTS idx_master_projects_company ON master_projects(company_id);
CREATE INDEX IF NOT EXISTS idx_master_projects_client ON master_projects(client_id);
CREATE INDEX IF NOT EXISTS idx_master_projects_status ON master_projects(status);

ALTER TABLE master_projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'master_projects' AND policyname = 'rls_master_projects'
    ) THEN
        CREATE POLICY rls_master_projects ON master_projects
            FOR ALL TO authenticated
            USING (user_has_company_access(company_id))
            WITH CHECK (user_has_company_access(company_id));
    END IF;
END $$;


-- 2. Project Estimates (Junction bridge: strictly single active project per estimate)
CREATE TABLE IF NOT EXISTS project_estimates (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    project_id INTEGER NOT NULL REFERENCES master_projects(id) ON DELETE CASCADE,
    estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE RESTRICT,
    linked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    linked_by INTEGER REFERENCES users(id),
    notes TEXT,
    CONSTRAINT uq_project_estimate_single UNIQUE (company_id, estimate_id)
);

CREATE INDEX IF NOT EXISTS idx_project_estimates_project ON project_estimates(project_id);
CREATE INDEX IF NOT EXISTS idx_project_estimates_estimate ON project_estimates(estimate_id);

ALTER TABLE project_estimates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'project_estimates' AND policyname = 'rls_project_estimates'
    ) THEN
        CREATE POLICY rls_project_estimates ON project_estimates
            FOR ALL TO authenticated
            USING (user_has_company_access(company_id))
            WITH CHECK (user_has_company_access(company_id));
    END IF;
END $$;


-- 3. Project Cost Allocations (Polymorphic source-linked costing engine)
CREATE TABLE IF NOT EXISTS project_cost_allocations (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    project_id INTEGER NOT NULL REFERENCES master_projects(id) ON DELETE RESTRICT,
    estimate_id INTEGER REFERENCES estimates(id) ON DELETE RESTRICT,
    store_id INTEGER REFERENCES stores(id) ON DELETE RESTRICT,
    store_code TEXT,
    source_type TEXT NOT NULL,
    source_id INTEGER,
    source_reference TEXT,
    source_line_id INTEGER,
    cost_category TEXT NOT NULL,
    description TEXT DEFAULT '',
    base_amount REAL NOT NULL,
    gst_rate REAL DEFAULT 0,
    gst_amount REAL DEFAULT 0,
    total_amount REAL NOT NULL,
    is_recoverable_gst BOOLEAN NOT NULL DEFAULT TRUE,
    ineligible_gst_amount REAL DEFAULT 0,
    recognised_cost REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    allocation_notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    reversal_reason TEXT,
    reversed_at TIMESTAMP WITHOUT TIME ZONE,
    reversed_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cost_alloc_project ON project_cost_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_alloc_estimate ON project_cost_allocations(estimate_id);
CREATE INDEX IF NOT EXISTS idx_cost_alloc_store ON project_cost_allocations(store_id);
CREATE INDEX IF NOT EXISTS idx_cost_alloc_source ON project_cost_allocations(source_type, source_id);

ALTER TABLE project_cost_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'project_cost_allocations' AND policyname = 'rls_project_cost_allocations'
    ) THEN
        CREATE POLICY rls_project_cost_allocations ON project_cost_allocations
            FOR ALL TO authenticated
            USING (user_has_company_access(company_id))
            WITH CHECK (user_has_company_access(company_id));
    END IF;
END $$;


-- 4. Contractor Work Orders (Open commitment tracker)
CREATE TABLE IF NOT EXISTS contractor_work_orders (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    project_id INTEGER NOT NULL REFERENCES master_projects(id) ON DELETE RESTRICT,
    estimate_id INTEGER REFERENCES estimates(id) ON DELETE RESTRICT,
    store_id INTEGER REFERENCES stores(id) ON DELETE RESTRICT,
    wo_number TEXT NOT NULL,
    contractor_name TEXT NOT NULL,
    contractor_gstin TEXT,
    scope_of_work TEXT NOT NULL,
    work_category TEXT NOT NULL,
    committed_amount REAL NOT NULL,
    billed_amount REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'issued',
    issue_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    expected_completion TIMESTAMP WITHOUT TIME ZONE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contractor_wo_company UNIQUE (company_id, wo_number)
);

CREATE INDEX IF NOT EXISTS idx_contractor_wo_project ON contractor_work_orders(project_id);

ALTER TABLE contractor_work_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'contractor_work_orders' AND policyname = 'rls_contractor_work_orders'
    ) THEN
        CREATE POLICY rls_contractor_work_orders ON contractor_work_orders
            FOR ALL TO authenticated
            USING (user_has_company_access(company_id))
            WITH CHECK (user_has_company_access(company_id));
    END IF;
END $$;
