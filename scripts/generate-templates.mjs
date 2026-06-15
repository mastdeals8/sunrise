#!/usr/bin/env node
/**
 * Generates downloadable .xlsx sample import templates into
 * client/public/templates/. Each template has 3 sheets:
 *
 *   1. Template   — header row + sample row (the row users edit)
 *   2. Instructions — required vs optional, validation hints
 *   3. Example    — fully filled-in 2-row example for reference
 *
 * Idempotent: re-running overwrites the files. Safe to wire into npm scripts
 * or to run by hand:  node scripts/generate-templates.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, "..", "client", "public", "templates");
mkdirSync(outDir, { recursive: true });

/**
 * @typedef {{ name: string, required: boolean, example: string, note?: string }} Column
 * @typedef {{ file: string, title: string, columns: Column[], examples?: Record<string,string>[] }} Template
 */

/** @type {Template[]} */
const templates = [
  {
    file: "CLIENTS_TEMPLATE",
    title: "Clients",
    columns: [
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd", note: "Unique" },
      { name: "client_type", required: false, example: "corporate", note: "corporate / normal / walk_in" },
      { name: "client_format", required: false, example: "ABFRL", note: "normal / ABFRL / letter_signage" },
      { name: "pan", required: false, example: "AAACA1234F" },
      { name: "primary_contact_person", required: false, example: "Rohan Sharma" },
      { name: "mobile", required: false, example: "9876543210" },
      { name: "email", required: false, example: "rohan@abfrl.com" },
      { name: "payment_terms", required: false, example: "30 Days Net" },
      { name: "vendor_code", required: false, example: "1310329", note: "Auto-fills onto every new estimate for this client" },
      { name: "active", required: false, example: "Yes", note: "Yes / No" },
      { name: "notes", required: false, example: "Created from import" },
    ],
    examples: [
      { client_name: "Apollo Clinics", client_type: "corporate", client_format: "normal", pan: "AAACA9988R", primary_contact_person: "S. Iyer", mobile: "9876500001", email: "vendors@apollo.com", payment_terms: "45 Days Net", vendor_code: "AP-VEN-001", active: "Yes", notes: "" },
      { client_name: "Walk-in / Cash", client_type: "walk_in", client_format: "normal", pan: "", primary_contact_person: "", mobile: "", email: "", payment_terms: "Immediate", vendor_code: "", active: "Yes", notes: "Counter sales" },
    ],
  },
  {
    file: "CLIENT_GST_PROFILES_TEMPLATE",
    title: "Client GST Billing Profiles",
    columns: [
      { name: "client_name", required: true, example: "Aditya Birla Lifestyle Brands Limited", note: "Must already exist in Clients master" },
      { name: "legal_company_name", required: true, example: "Aditya Birla Lifestyle Brands Limited" },
      { name: "branch_name", required: false, example: "Maharashtra" },
      { name: "gstin", required: true, example: "27AABCA1234F1Z5" },
      { name: "pan", required: false, example: "AABCA1234F" },
      { name: "state", required: true, example: "Maharashtra" },
      { name: "state_code", required: true, example: "27" },
      { name: "billing_address", required: true, example: "Piramal Agastya, Kurla, Mumbai - 400070" },
      { name: "shipping_address", required: false, example: "Same as billing" },
      { name: "contact_person", required: false, example: "Accounts Dept" },
      { name: "mobile", required: false, example: "9876500099" },
      { name: "email", required: false, example: "accounts@ablbl.com" },
      { name: "default_for_state", required: false, example: "Yes" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
    examples: [
      { client_name: "Aditya Birla Lifestyle Brands Limited", legal_company_name: "Aditya Birla Lifestyle Brands Limited", branch_name: "Maharashtra", gstin: "27AABCA1234F1Z5", pan: "AABCA1234F", state: "Maharashtra", state_code: "27", billing_address: "Piramal Agastya Corporate Park, Kurla, Mumbai - 400070", shipping_address: "Piramal Agastya Corporate Park, Kurla, Mumbai - 400070", contact_person: "Accounts Dept", mobile: "", email: "accounts@ablbl.com", default_for_state: "Yes", active: "Yes", notes: "ABLBL sample" },
      { client_name: "Aditya Birla Lifestyle Brands Limited", legal_company_name: "Aditya Birla Lifestyle Brands Limited", branch_name: "Gujarat", gstin: "24AABCA1234F1Z5", pan: "AABCA1234F", state: "Gujarat", state_code: "24", billing_address: "ABLBL Gujarat GST registered address", shipping_address: "ABLBL Gujarat GST registered address", contact_person: "Accounts Dept", mobile: "", email: "accounts@ablbl.com", default_for_state: "Yes", active: "Yes", notes: "ABLBL sample" },
      { client_name: "Aditya Birla Lifestyle Brands Limited", legal_company_name: "Aditya Birla Lifestyle Brands Limited", branch_name: "Delhi", gstin: "07AABCA1234F1Z5", pan: "AABCA1234F", state: "Delhi", state_code: "07", billing_address: "ABLBL Delhi GST registered address", shipping_address: "ABLBL Delhi GST registered address", contact_person: "Accounts Dept", mobile: "", email: "accounts@ablbl.com", default_for_state: "Yes", active: "Yes", notes: "ABLBL sample" },
      { client_name: "Aditya Birla Lifestyle Brands Limited", legal_company_name: "Aditya Birla Lifestyle Brands Limited", branch_name: "Karnataka", gstin: "29AABCA1234F1Z5", pan: "AABCA1234F", state: "Karnataka", state_code: "29", billing_address: "ABLBL Karnataka GST registered address", shipping_address: "ABLBL Karnataka GST registered address", contact_person: "Accounts Dept", mobile: "", email: "accounts@ablbl.com", default_for_state: "Yes", active: "Yes", notes: "ABLBL sample" },
    ],
  },
  {
    file: "ABLBL_GST_IMPORT_FORMAT",
    title: "ABLBL GST Import Format",
    columns: [
      { name: "State c", required: false, example: "27", note: "Optional. If blank, importer uses first 2 digits of GSTIN" },
      { name: "States/UT", required: true, example: "Maharashtra" },
      { name: "GST No.", required: true, example: "27AABCA1234F1Z5" },
      { name: "Address As per GST RC", required: true, example: "Piramal Agastya Corporate Park, Kurla, Mumbai - 400070" },
      { name: "Company Name / Legal Name", required: true, example: "Aditya Birla Lifestyle Brands Limited" },
    ],
    examples: [
      { "State c": "27", "States/UT": "Maharashtra", "GST No.": "27AABCA1234F1Z5", "Address As per GST RC": "Piramal Agastya Corporate Park, Kurla, Mumbai - 400070", "Company Name / Legal Name": "Aditya Birla Lifestyle Brands Limited" },
      { "State c": "24", "States/UT": "Gujarat", "GST No.": "24AABCA1234F1Z5", "Address As per GST RC": "ABLBL Gujarat GST registered address", "Company Name / Legal Name": "Aditya Birla Lifestyle Brands Limited" },
      { "State c": "07", "States/UT": "Delhi", "GST No.": "07AABCA1234F1Z5", "Address As per GST RC": "ABLBL Delhi GST registered address", "Company Name / Legal Name": "Aditya Birla Lifestyle Brands Limited" },
      { "State c": "29", "States/UT": "Karnataka", "GST No.": "29AABCA1234F1Z5", "Address As per GST RC": "ABLBL Karnataka GST registered address", "Company Name / Legal Name": "Aditya Birla Lifestyle Brands Limited" },
    ],
  },
  {
    file: "BRANDS_TEMPLATE",
    title: "Brands",
    columns: [
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd", note: "Parent client (must already exist). Brands are matched by brand_name + this client" },
      { name: "brand_name", required: true, example: "Peter England", note: "Unique under client" },
      { name: "brand_code", required: false, example: "PE" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
    examples: [
      { client_name: "Aditya Birla Fashion Retail Ltd", brand_name: "Allen Solly", brand_code: "AS", active: "Yes", notes: "" },
      { client_name: "Apollo Clinics", brand_name: "Apollo", brand_code: "APL", active: "Yes", notes: "" },
    ],
  },
  {
    file: "STORES_TEMPLATE",
    title: "Stores / Sites",
    columns: [
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd" },
      { name: "brand_name", required: true, example: "Peter England" },
      { name: "store_code", required: true, example: "PE_DEL_001", note: "Unique per client+brand" },
      { name: "store_name", required: true, example: "Peter England DLF Promenade" },
      { name: "mall_name", required: false, example: "DLF Promenade" },
      { name: "city", required: false, example: "New Delhi" },
      { name: "state", required: false, example: "Delhi" },
      { name: "state_code", required: false, example: "07" },
      { name: "region_zone", required: false, example: "NORTH" },
      { name: "full_address", required: false, example: "Shop F-12, DLF Promenade, Vasant Kunj, ND-110070" },
      { name: "contact_person", required: false, example: "Store Manager" },
      { name: "contact_number", required: false, example: "9876500001" },
      { name: "store_type", required: false, example: "EBO", note: "EBO / MBO / SIS / pop-up" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
  },
  {
    file: "PRODUCTS_TEMPLATE",
    title: "Products & Rates",
    columns: [
      { name: "product_name", required: true, example: "ACP Front Lit Letter Signage", note: "Unique" },
      { name: "category", required: false, example: "Signage" },
      { name: "sub_category", required: false, example: "Front Lit" },
      { name: "hsn_sac", required: false, example: "998391" },
      { name: "standard_non_standard", required: false, example: "standard", note: "standard / non_standard" },
      { name: "uom", required: false, example: "sqft" },
      { name: "calculation_type", required: false, example: "sqft", note: "sqft / running_inch / fixed / percentage / manual" },
      { name: "default_specification", required: false, example: "3mm ACP, 3mm acrylic face, LED module" },
      { name: "default_rate", required: false, example: "1850" },
      { name: "gst_percent", required: false, example: "18" },
      { name: "warranty", required: false, example: "12 months" },
      { name: "linked_material_code", required: false, example: "ABFRL-SIG-001", note: "Optional material code reference" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
  },
  {
    file: "MATERIAL_CODES_TEMPLATE",
    title: "Material Codes",
    columns: [
      { name: "client_name", required: false, example: "Aditya Birla Fashion Retail Ltd", note: "Empty = global" },
      { name: "brand_name", required: false, example: "Peter England" },
      { name: "material_code", required: true, example: "ABFRL-SIG-001", note: "Unique per client+brand" },
      { name: "material_description", required: false, example: "3mm ACP Front Lit Letter Signage" },
      { name: "hsn_sac", required: false, example: "998391" },
      { name: "gst_percent", required: false, example: "18" },
      { name: "uom", required: false, example: "nos" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "Used in ABFRL CAPEX rollouts" },
    ],
  },
  {
    file: "CUSTOMER_RATE_CARDS_TEMPLATE",
    title: "Customer Rate Cards (header)",
    columns: [
      { name: "rate_card_name", required: true, example: "Peter England CAPEX 2026", note: "Friendly name" },
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd" },
      { name: "brand_name", required: false, example: "Peter England" },
      { name: "project_type", required: false, example: "CAPEX", note: "SELEX / CAPEX / normal / letter_signage / custom" },
      { name: "effective_from", required: false, example: "2026-04-01" },
      { name: "effective_to", required: false, example: "" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "FY26 corporate negotiated rates" },
    ],
  },
  {
    file: "CUSTOMER_RATE_CARD_ITEMS_TEMPLATE",
    title: "Customer Rate Card Items",
    columns: [
      { name: "rate_card_name", required: true, example: "Peter England CAPEX 2026", note: "Must already exist" },
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd" },
      { name: "brand_name", required: false, example: "Peter England" },
      { name: "project_type", required: false, example: "CAPEX" },
      { name: "product_name", required: false, example: "ACP Front Lit Letter Signage", note: "Either product_name OR material_code required" },
      { name: "material_code", required: false, example: "ABFRL-SIG-001" },
      { name: "item_name", required: false, example: "Peter England Storefront Letter Signage" },
      { name: "description_specification", required: false, example: "3mm ACP, 5mm acrylic, white LED 100lm/w" },
      { name: "hsn_sac", required: false, example: "998391" },
      { name: "uom", required: false, example: "sqft" },
      { name: "calculation_type", required: false, example: "sqft" },
      { name: "rate", required: true, example: "1750" },
      { name: "gst_percent", required: false, example: "18" },
      { name: "standard_non_standard", required: false, example: "standard" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
  },
  {
    file: "STAFF_TEMPLATE",
    title: "Staff",
    columns: [
      { name: "staff_name", required: true, example: "Anil Kumar" },
      { name: "mobile", required: false, example: "9876500011" },
      { name: "email", required: false, example: "anil@sunrise.com" },
      { name: "department", required: false, example: "Production" },
      { name: "role", required: false, example: "Installer" },
      { name: "joining_date", required: false, example: "2024-06-01" },
      { name: "salary", required: false, example: "22000" },
      { name: "active", required: false, example: "Yes" },
      { name: "notes", required: false, example: "" },
    ],
  },
  {
    file: "OPENING_OUTSTANDING_TEMPLATE",
    title: "Opening Invoice Ledger / Outstanding",
    columns: [
      { name: "client_name", required: true, example: "Aditya Birla Fashion Retail Ltd" },
      { name: "invoice_no", required: true, example: "INV-OPEN-001" },
      { name: "invoice_date", required: true, example: "2026-03-15" },
      { name: "due_date", required: false, example: "2026-04-14" },
      { name: "invoice_amount", required: true, example: "118000" },
      { name: "paid_amount", required: false, example: "59000" },
      { name: "balance_amount", required: false, example: "59000", note: "Auto-calculated as invoice_amount - paid_amount if blank" },
      { name: "gstin", required: false, example: "27AABCA1234F1Z5" },
      { name: "po_no", required: false, example: "PO-ABFRL-2026-001" },
      { name: "remarks", required: false, example: "Opening balance migration" },
    ],
  },
];

function buildSheet(t /** @type {Template} */) {
  const headers = t.columns.map(c => c.name);
  const sampleRow = t.columns.map(c => c.example);

  /* Sheet 1: Template — header row + 1 editable sample row */
  const ws1 = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  // Mark required headers with red font via cell style hint (xlsx CE doesn't render colors;
  // we add a comment instead).
  for (let i = 0; i < t.columns.length; i++) {
    const col = t.columns[i];
    const ref = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!ws1[ref]) continue;
    if (col.required) {
      ws1[ref].c = [{ a: "Sunrise ERP", t: `REQUIRED${col.note ? " — " + col.note : ""}` }];
    } else if (col.note) {
      ws1[ref].c = [{ a: "Sunrise ERP", t: col.note }];
    }
  }
  // Auto width
  ws1["!cols"] = headers.map(h => ({ wch: Math.max(14, Math.min(40, h.length + 4)) }));

  /* Sheet 2: Instructions */
  const instr = [
    ["Field", "Required", "Example", "Notes"],
    ...t.columns.map(c => [c.name, c.required ? "YES" : "no", c.example, c.note || ""]),
    [],
    ["How to use", "", "", ""],
    ["1. Fill the 'Template' sheet from row 2 onwards (overwrite the sample row).", "", "", ""],
    ["2. Save as .xlsx and upload via Import / Export in Sunrise ERP.", "", "", ""],
    ["3. Columns marked YES are required — rows with missing required fields will be flagged.", "", "", ""],
    ["4. The importer matches column names (case + underscore tolerant).", "", "", ""],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instr);
  ws2["!cols"] = [{ wch: 32 }, { wch: 10 }, { wch: 30 }, { wch: 60 }];

  /* Sheet 3: Example — extra filled rows */
  const exampleRows = (t.examples || []).map(ex => t.columns.map(c => ex[c.name] ?? c.example));
  const ws3 = XLSX.utils.aoa_to_sheet([headers, ...(exampleRows.length ? exampleRows : [sampleRow])]);
  ws3["!cols"] = ws1["!cols"];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Template");
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");
  XLSX.utils.book_append_sheet(wb, ws3, "Example");
  return wb;
}

for (const t of templates) {
  const wb = buildSheet(t);
  const filePath = path.join(outDir, `${t.file}.xlsx`);
  XLSX.writeFile(wb, filePath);
  console.log("✓", path.relative(process.cwd(), filePath));
}

console.log(`\nGenerated ${templates.length} templates into ${path.relative(process.cwd(), outDir)}/`);
