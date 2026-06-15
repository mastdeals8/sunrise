// Thin wrappers that render the existing OperationsPage in single-panel
// "focus" mode. These give each Bolt-style sidebar item a dedicated URL
// (/clients, /brands, /estimates, /delivery-challans, …) without
// extracting the underlying panels from OperationsPage — see the
// `focusTab` prop in operations/OperationsPage.tsx.

import React from "react";
import OperationsPage from "./operations/OperationsPage";

export const ClientsRoute: React.FC = () => (
  <OperationsPage
    focusTab="clients"
    focusTitle="Clients"
    focusSubtitle="Corporate accounts, contacts, and GST profiles"
  />
);

export const BrandsRoute: React.FC = () => (
  <OperationsPage
    focusTab="brands"
    focusTitle="Brands"
    focusSubtitle="Sub-brands grouped under each corporate client"
  />
);

export const StoresRoute: React.FC = () => (
  <OperationsPage
    focusTab="stores"
    focusTitle="Stores / Sites"
    focusSubtitle="Locations where signage is delivered & installed"
  />
);

export const ProductsRoute: React.FC = () => (
  <OperationsPage
    focusTab="products"
    focusTitle="Products & Rates"
    focusSubtitle="Catalog of signage SKUs with default rates and GST"
  />
);

export const EstimatesRoute: React.FC = () => (
  <OperationsPage
    focusTab="estimates"
    focusTitle="Estimate Register"
    focusSubtitle="Create and maintain estimates before they become projects"
  />
);

export const ProjectsRoute: React.FC = () => (
  <OperationsPage
    focusTab="projects"
    focusTitle="Projects"
    focusSubtitle="Project workspace for PO, execution, documents, and invoice readiness"
  />
);

export const DeliveryChallansRoute: React.FC = () => (
  <OperationsPage
    focusTab="challans"
    focusTitle="WCC Audit Register"
    focusSubtitle="Search, history, reprint, and audit view for WCC/DC records"
  />
);

export const InvoicesRoute: React.FC = () => (
  <OperationsPage
    focusTab="invoices_ledger"
    focusTitle="Invoices"
    focusSubtitle="Generate tax invoices against delivered estimates"
  />
);

export const ImportExportRoute: React.FC = () => (
  <OperationsPage
    focusTab="master_data"
    focusTitle="Import / Export"
    focusSubtitle="Bulk import master data via Excel / CSV templates"
  />
);

export const ProjectTrackerRoute: React.FC = () => (
  <OperationsPage
    focusTab="project_tracker"
    focusTitle="Project Tracker"
    focusSubtitle="Per-store progress on delivered estimates"
  />
);
