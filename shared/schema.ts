import { pgTable, text, serial, integer, boolean, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==========================================
// 1. Staff & User Management (Furnili Pattern)
// ==========================================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("staff"), // admin, manager, staff, accounts, sales
  phone: text("phone"),
  telegramChatId: text("telegram_chat_id"), // Phase 5A: ERP→Telegram bot delivery
  // Staff fields
  employeeId: text("employee_id").unique(),
  department: text("department"),
  designation: text("designation"),
  joiningDate: timestamp("joining_date"),
  basicSalary: real("basic_salary").default(0),
  allowances: real("allowances").default(0),
  profilePhotoUrl: text("profile_photo_url"),
  bankAccountNumber: text("bank_account_number"),
  ifscCode: text("ifsc_code"),
  address: text("address"),
  dailyWage: real("daily_wage").default(0),
  advanceBalance: real("advance_balance").default(0),
  emergencyContact: text("emergency_contact"),
  emergencyContactPhone: text("emergency_contact_phone"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 2. Attendance & Payroll (Furnili Pattern)
// ==========================================
export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  date: timestamp("date").notNull(),
  checkInTime: timestamp("check_in_time"),
  checkOutTime: timestamp("check_out_time"),
  workingHours: real("working_hours").default(0),
  overtimeHours: real("overtime_hours").default(0),
  status: text("status").notNull().default("present"), // present, absent, half_day, leave, overtime, late, on_leave
  leaveType: text("leave_type"), // sick, casual, emergency
  notes: text("notes"),
  approvedBy: integer("approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 3. Tasks & Kanban Board (Furnili Pattern)
// ==========================================
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled
  priority: text("priority").notNull().default("medium"), // low, medium, high, critical
  dueDate: timestamp("due_date"),
  startDate: timestamp("start_date"),
  completedDate: timestamp("completed_date"),
  tags: text("tags").array().default([]),
  assignedTo: integer("assigned_to").references(() => users.id),
  assignedBy: integer("assigned_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 4. Petty Cash (Furnili Pattern)
// ==========================================
export const pettyCashExpenses = pgTable("petty_cash_expenses", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // food, transport, office_supplies, utilities, other
  amount: real("amount").notNull(),
  vendor: text("vendor"),
  description: text("description"),
  paidBy: integer("paid_by").references(() => users.id),
  receiptImageUrl: text("receipt_image_url"),
  extractedData: jsonb("extracted_data"), // OCR data
  expenseDate: timestamp("expense_date").notNull(),
  addedBy: integer("added_by").references(() => users.id).notNull(),
  approvedBy: integer("approved_by").references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 5. Uploads & Media Files (Furnili Pattern)
// ==========================================
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").default(0),
  mimeType: text("mime_type"),
  category: text("category").default("general"), // receipts, documents, profile, avatars
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 6. Chart of Accounts (Anzen Pattern)
// ==========================================
export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g., "111000" for cash, "411000" for revenue
  name: text("name").notNull(),
  accountType: text("account_type").notNull(), // asset, liability, equity, revenue, expense
  normalBalance: text("normal_balance").notNull().default("debit"), // debit, credit
  isActive: boolean("is_active").notNull().default(true),
  isHeader: boolean("is_header").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 7. Invoices (Anzen Pattern)
// ==========================================
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(), // e.g. INV/2026/001
  type: text("type").notNull(), // sales, purchase
  partyName: text("party_name").notNull(), // client or vendor name
  amount: real("amount").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  date: timestamp("date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  status: text("status").notNull().default("unpaid"), // unpaid, paid, partial, overdue
  createdAt: timestamp("created_at").defaultNow(),
  
  // Extended Invoicing columns
  estimateId: integer("estimate_id").references(() => estimates.id),
  clientId: integer("client_id").references(() => clients.id),
  paidAmount: real("paid_amount").default(0),
  balanceAmount: real("balance_amount").default(0),
  packetSettings: jsonb("packet_settings"),
  remarks: text("remarks"),

  // Phase 3: payment follow-up / collections tracking (additive)
  followUpStatus: text("follow_up_status").default("none"), // none | promised | partial_promised | disputed | escalated | legal
  followUpNote: text("follow_up_note"),
  followUpAt: timestamp("follow_up_at"),          // last follow-up contact
  promiseDate: timestamp("promise_date"),          // client's promised payment date

  // Tally export tracking (additive)
  tallyExportStatus: text("tally_export_status").default("not_exported"), // not_exported | exported_xml | pushed_to_tally | failed
  tallyExportedAt: timestamp("tally_exported_at"),

  // Delivery challan / WCC linkage. Workflow = Estimate -> DC/WCC -> Invoice -> Payment.
  deliveryChallanId: integer("delivery_challan_id").references(() => deliveryChallans.id, { onDelete: "set null" }),

  // Snapshot of line items at invoice generation time (decoupled from the
  // estimate so editing the estimate later doesn't mutate billed invoices).
  // Stored as JSONB array of { itemName, description, hsn, quantity, unit,
  // rate, taxPercent, amount, taxAmount, totalAmount, ... }.
  lineItems: jsonb("line_items"),

  // Cancellation metadata (status="cancelled").
  cancelReason: text("cancel_reason"),
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),

  // PO traceability on the invoice itself (also lives on the estimate).
  poNumber: text("po_number"),
  poReference: text("po_reference"),

  // Project Workspace v2: transport cost line on the invoice
  transportCost: real("transport_cost").default(0),
});

// ==========================================
// 8. Journal Entry & Lines (Anzen Ledger Pattern)
// ==========================================
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  entryNumber: text("entry_number").notNull().unique(), // e.g. JV/2026/001
  entryDate: timestamp("entry_date").notNull(),
  sourceModule: text("source_module"), // invoices, petty_cash, manual
  referenceNumber: text("reference_number"),
  description: text("description"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const journalEntryLines = pgTable("journal_entry_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntries.id).notNull(),
  accountId: integer("account_id").references(() => chartOfAccounts.id).notNull(),
  debit: real("debit").notNull().default(0),
  credit: real("credit").notNull().default(0),
  description: text("description"),
  lineNumber: integer("line_number").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 9. Payments & Vouchers (Anzen Pattern)
// ==========================================
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").notNull().unique(), // e.g., PV/2026/001, RV/2026/001
  type: text("type").notNull(), // receipt (customer payment), payment (supplier expense)
  partyName: text("party_name").notNull(),
  date: timestamp("date").notNull(),
  amount: real("amount").notNull().default(0),
  method: text("method").notNull().default("bank_transfer"), // bank_transfer, cash, cheque, upi
  description: text("description"),
  invoiceId: integer("invoice_id").references(() => invoices.id), // linked invoice if any
  details: jsonb("details"), // generic allocations or meta
  createdAt: timestamp("created_at").defaultNow(),
  
  // Extended payments columns
  clientId: integer("client_id").references(() => clients.id),
  allocatedInvoices: jsonb("allocated_invoices"),
});

// ==========================================
// 10. Clients (Sunrise Custom)
// ==========================================
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  email: text("email"),
  mobile: text("mobile"),
  city: text("city"),
  address: text("address"),
  gstNumber: text("gst_number"),
  format: text("format").notNull().default("normal"), // VALIDATION: Only "normal" or "ABLBL" allowed. Enforce in API layer.
  isActive: boolean("is_active").notNull().default(true),
  clientGroupName: text("client_group_name"),
  clientType: text("client_type").default("normal"), // corporate / normal / walk_in
  pan: text("pan"),
  primaryContactPerson: text("primary_contact_person"),
  paymentTerms: text("payment_terms"),
  // Vendor code assigned to Sunrise by the customer (appears top-right on
  // estimates / invoices). Auto-fills into new estimates when the client is
  // picked, so the user doesn't have to retype it every time.
  vendorCode: text("vendor_code"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 10b. Client Billing Profiles (Sunrise Custom)
// ==========================================
export const clientBillingProfiles = pgTable("client_billing_profiles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  legalCompanyName: text("legal_company_name").notNull(),
  branchLocationName: text("branch_location_name"),
  gstin: text("gstin").notNull(),
  pan: text("pan"),
  state: text("state").notNull(),
  stateCode: text("state_code").notNull(),
  billingAddress: text("billing_address").notNull(),
  shippingAddress: text("shipping_address"),
  contactPerson: text("contact_person"),
  mobile: text("mobile"),
  email: text("email"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 11. Brands (Sunrise Custom)
// ==========================================
export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentClientId: integer("parent_client_id").references(() => clients.id, { onDelete: 'set null' }),
  parentBrand: text("parent_brand"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 12. Stores/Sites (Sunrise Custom)
// ==========================================
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: 'cascade' }).notNull(),
  location: text("location"),
  address: text("address"),
  contactPerson: text("contact_person"),
  contactPhone: text("contact_phone"),
  isActive: boolean("is_active").notNull().default(true),
  storeCode: text("store_code"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"),
  regionZone: text("region_zone"),
  contact: text("contact"),
  mallName: text("mall_name"),
  storeType: text("store_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 13. Products/Rates (Sunrise Custom)
// ==========================================
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category"),
  unit: text("unit").notNull().default("pcs"), // UOM: sqft / running_inch / nos / job / km / percentage / manual
  rate: real("rate").notNull().default(0),
  description: text("description"),
  hsnSac: text("hsn_sac"),
  materialCode: text("material_code"),
  isStandard: boolean("is_standard").notNull().default(true),
  calculationType: text("calculation_type").notNull().default("fixed"), // sqft, running_inch, fixed, percentage, manual
  gstPercent: real("gst_percent").notNull().default(18),
  defaultSpecification: text("default_specification"),
  warranty: text("warranty"),
  isActive: boolean("is_active").notNull().default(true),
  // DEPRECATED: Products should not link to material codes. Hidden from UI. Keep for data preservation.
  materialCodeId: integer("material_code_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 14. Estimates (Sunrise Custom)
// ==========================================
export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull().unique(),
  // estimateDate: explicit document date the user picks. Defaults to today on
  // create. Used in preview/PDF/Excel as the "Estimate Date" header.
  // Falls back to createdAt for legacy rows (backfilled by additive migration).
  estimateDate: timestamp("estimate_date"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: 'cascade' }).notNull(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: 'cascade' }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  subtotal: real("subtotal").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft, sent, approved, rejected, awaiting_po, po_received
  clientFormat: text("client_format").notNull().default("normal"), // VALIDATION: Only "normal" or "ABLBL" allowed. Enforce in API layer.
  subject: text("subject"),
  billingTo: text("billing_to"),
  shippingTo: text("shipping_to"),
  gstin: text("gstin"),
  pan: text("pan"),
  stateCode: text("state_code"),
  vendorCode: text("vendor_code"),
  gstType: text("gst_type").notNull().default("CGST+SGST"), // CGST+SGST, IGST
  // DEPRECATED: Use line items instead. Hidden from UI. Keep for data preservation.
  packingPercent: real("packing_percent").default(0),
  // DEPRECATED: Use line items instead. Hidden from UI. Keep for data preservation.
  implementationPercent: real("implementation_percent").default(0),
  // DEPRECATED: Use line items instead. Hidden from UI. Keep for data preservation.
  transportAmount: real("transport_amount").default(0),
  storeGrouping: jsonb("store_grouping"),

  // Multi-GST snaps
  billingProfileId: integer("billing_profile_id").references(() => clientBillingProfiles.id, { onDelete: 'set null' }),
  billingLegalNameSnapshot: text("billing_legal_name_snapshot"),
  billingGstinSnapshot: text("billing_gstin_snapshot"),
  billingStateSnapshot: text("billing_state_snapshot"),
  billingStateCodeSnapshot: text("billing_state_code_snapshot"),
  billingAddressSnapshot: text("billing_address_snapshot"),
  shippingAddressSnapshot: text("shipping_address_snapshot"),

  // PO upload fields
  poNumber: text("po_number"),
  poDate: timestamp("po_date"),
  poAmount: real("po_amount"),
  poFilePath: text("po_file_path"),
  poRemarks: text("po_remarks"),

  // DEPRECATED: Legacy field. Hidden from UI. Keep for data preservation.
  // ABFRL project type: "SELEX" (no material code required) | "CAPEX" (material code REQUIRED per row)
  // NULL for non-ABFRL estimates. See ARCHITECTURE_NOTES.md "SELEX vs CAPEX".
  abfrlProjectType: text("abfrl_project_type"),

  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 15. Estimate Items (Sunrise Custom)
// ==========================================
export const estimateItems = pgTable("estimate_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
  productId: integer("product_id").references(() => products.id),
  itemName: text("item_name").notNull(),
  description: text("description"),
  quantity: real("quantity").notNull().default(1),
  unit: text("unit").notNull().default("pcs"),
  rate: real("rate").notNull().default(0),
  totalPrice: real("total_price").notNull().default(0),

  sl: integer("sl"),
  isStandard: boolean("is_standard").default(true),
  hsn: text("hsn"),
  materialCode: text("material_code"),
  // Snapshot fields for Material Code linkage (additive)
  materialCodeId: integer("material_code_id"),
  materialDescription: text("material_description"),
  width: real("width"),
  height: real("height"),
  totalSize: real("total_size"), // calculated sqft, running_inch, nos

  cgstPercent: real("cgst_percent").default(9),
  cgstAmount: real("cgst_amount").default(0),
  sgstPercent: real("sgst_percent").default(9),
  sgstAmount: real("sgst_amount").default(0),
  igstPercent: real("igst_percent").default(0),
  igstAmount: real("igst_amount").default(0),
  totalAmount: real("total_amount").default(0),
  storeCode: text("store_code"),
  storeSortOrder: integer("store_sort_order"),
  rowSortOrder: integer("row_sort_order"),

  // New fields for Normal vs ABLBL workflow
  manualStoreName: text("manual_store_name"), // For Normal estimates (manual store/site entry)
  lineType: text("line_type").default("product"), // material | product | packing | installation | transport | manual
  calculationType: text("calculation_type").default("fixed"), // sqft | running_inch | fixed | percentage | manual

  // Snapshot fields for decoupling from master data changes
  materialCodeSnapshot: jsonb("material_code_snapshot"), // Full material code data at estimate creation
  productSnapshot: jsonb("product_snapshot"), // Full product data at estimate creation
});

// ==========================================
// 16. Delivery Challans / WCC (Sunrise Custom)
// ==========================================
export const deliveryChallans = pgTable("delivery_challans", {
  id: serial("id").primaryKey(),
  dcNumber: text("dc_number").notNull().unique(),
  estimateId: integer("estimate_id").references(() => estimates.id).notNull(),
  deliveryDate: timestamp("delivery_date").defaultNow(),
  status: text("status").notNull().default("draft"),
  documentType: text("document_type").notNull().default("dc"), // dc | wcc
  items: jsonb("items"),
  deliveredBy: text("delivered_by"),
  receivedBy: text("received_by"),
  remarks: text("remarks"),
  signedChallanPath: text("signed_challan_path"),
  photoPath: text("photo_path"),
  transportReceiptPath: text("transport_receipt_path"),
  extraDocPath: text("extra_doc_path"),
  clientFormat: text("client_format").notNull().default("normal"), // normal, ABFRL
  metadata: jsonb("metadata"), // WCC meta
  storeCode: text("store_code"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Unified execution document registry (Phase 1 additive).
// Legacy file fields on estimates / delivery_challans remain in place during
// migration; this table gives documents one queryable ownership layer.
export const executionDocuments = pgTable("execution_documents", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }).notNull(),
  deliveryChallanId: integer("delivery_challan_id").references(() => deliveryChallans.id, { onDelete: "set null" }),
  storeCode: text("store_code"),
  documentType: text("document_type").notNull(), // po | photo | dc | wcc | signed_wcc | signed_dc | transport_receipt | extra | field_upload
  filePath: text("file_path").notNull(),
  originalFileName: text("original_file_name"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  status: text("status").notNull().default("active"), // active | replaced | deleted
  version: integer("version").notNull().default(1),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedVia: text("uploaded_via").notNull().default("erp"), // erp | telegram | whatsapp | field_link | migration
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  replacedByDocumentId: integer("replaced_by_document_id"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Store-level execution workspace rows (Sprint 1 additive).
// Estimate remains the master record; these rows snapshot the stores that need
// post-PO execution tracking for a given estimate.
export const executionStores = pgTable("execution_stores", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }).notNull(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
  storeCode: text("store_code").notNull(),
  storeName: text("store_name"),
  storeLocation: text("store_location"),
  storeCity: text("store_city"),
  storeState: text("store_state"),
  storeAddress: text("store_address"),
  status: text("status").notNull().default("pending_execution"),
  source: text("source").notNull().default("estimate_store_grouping"),
  billingReady: boolean("billing_ready").notNull().default(false),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Secure upload-only links for field staff. The raw token is never stored;
// only tokenHash is persisted. Estimate remains the project reference.
export const fieldAccessLinks = pgTable("field_access_links", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix"),
  channel: text("channel").notNull().default("telegram"), // telegram | whatsapp | manual
  recipientName: text("recipient_name"),
  recipientContact: text("recipient_contact"),
  allowedStoreCodes: jsonb("allowed_store_codes"),
  allowedDocumentTypes: jsonb("allowed_document_types"),
  permissions: jsonb("permissions"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedBy: integer("revoked_by").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  lastUsedAt: timestamp("last_used_at"),
  useCount: integer("use_count").notNull().default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 16b. Material Code Master (Sunrise Custom — additive)
// ==========================================
export const materialCodes = pgTable("material_codes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: 'cascade' }), // Nullable: brand-specific codes have brandId, common operational codes (OT_*) have NULL
  code: text("code").notNull(),
  productName: text("product_name"), // Product name (can differ from description)
  description: text("description"),
  hsn: text("hsn"),
  uom: text("uom").default("nos"),
  gstPercent: real("gst_percent").default(18),
  defaultRate: real("default_rate").default(0),
  category: text("category"), // Material group/category
  isStandard: boolean("is_standard").notNull().default(true), // Standard/Non-Standard flag
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 16c. App Settings (single-row config — additive)
// ==========================================
export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 16d. Customer-specific Rate Cards (additive — UI/integration TODO)
// One card per client / brand / project type / effective-date window.
// Rates default to product's rate when no card matches.
// See ARCHITECTURE_NOTES.md "Customer-specific rate cards".
// ==========================================
export const customerRateCards = pgTable("customer_rate_cards", {
  id: serial("id").primaryKey(),
  name: text("name"), // Friendly name e.g. "Peter England CAPEX 2026"
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  brandId: integer("brand_id").references(() => brands.id, { onDelete: "set null" }),
  projectType: text("project_type"), // e.g. "SELEX", "CAPEX", "rollout"
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const customerRateItems = pgTable("customer_rate_items", {
  id: serial("id").primaryKey(),
  rateCardId: integer("rate_card_id").references(() => customerRateCards.id, { onDelete: "cascade" }).notNull(),
  productId: integer("product_id").references(() => products.id, { onDelete: "cascade" }),
  materialCodeId: integer("material_code_id").references(() => materialCodes.id, { onDelete: "set null" }),
  itemName: text("item_name"),
  description: text("description"),
  hsn: text("hsn"),
  uom: text("uom").notNull().default("pcs"),
  calculationType: text("calculation_type").default("fixed"),
  rate: real("rate").notNull().default(0),
  gstPercent: real("gst_percent").notNull().default(18),
  isStandard: boolean("is_standard").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Project tracker store-level override (additive)
export const projectStoreStatus = pgTable("project_store_status", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").references(() => estimates.id, { onDelete: "cascade" }).notNull(),
  storeCode: text("store_code").notNull(),
  status: text("status").notNull().default("pending"), // pending / in_progress / completed / blocked
  remarks: text("remarks"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 17. Staff Advances (Sunrise Custom / Furnili Pattern)
// ==========================================
export const staffAdvances = pgTable("staff_advances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  amount: real("amount").notNull(),
  date: timestamp("date").notNull().defaultNow(),
  paymentMode: text("payment_mode").notNull().default("cash"), // cash, bank_transfer, upi
  reason: text("reason"),
  proofUrl: text("proof_url"),
  isAdjusted: boolean("is_adjusted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 18. Payroll / Monthly Salaries (Sunrise Custom / Furnili Pattern)
// ==========================================
export const payroll = pgTable("payroll", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  month: integer("month").notNull(), // 1-12
  year: integer("year").notNull(),
  basicSalary: real("basic_salary").notNull().default(0),
  dailyWage: real("daily_wage").default(0),
  presentDays: real("present_days").notNull().default(0),
  halfDays: real("half_days").notNull().default(0),
  absentDays: real("absent_days").notNull().default(0),
  overtimePay: real("overtime_pay").default(0),
  advancesPaid: real("advances_paid").default(0),
  deductions: real("deductions").default(0),
  netSalary: real("net_salary").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft, approved, paid
  approvedBy: integer("approved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 19. Bot Settings (Telegram + WhatsApp)
// ==========================================
export const botSettings = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull().unique(), // "telegram" | "whatsapp"
  enabled: boolean("enabled").notNull().default(false),
  botToken: text("bot_token"), // stored but never returned to client
  botUsername: text("bot_username"),
  webhookUrl: text("webhook_url"),
  verifyToken: text("verify_token"), // WhatsApp webhook verify token
  phoneNumberId: text("phone_number_id"), // WhatsApp
  wabaId: text("waba_id"), // WhatsApp Business Account ID
  accessTokenHint: text("access_token_hint"), // last 4 chars only, never full token
  settings: jsonb("settings"), // extra config
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==========================================
// 20. Bot Upload Inbox
// ==========================================
export const botUploadInbox = pgTable("bot_upload_inbox", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // "telegram" | "whatsapp"
  senderId: text("sender_id").notNull(), // telegram chat_id or whatsapp from number
  senderName: text("sender_name"),
  messageText: text("message_text"),
  mediaUrl: text("media_url"),
  mediaLocalPath: text("media_local_path"),
  mediaType: text("media_type"), // "photo" | "document" | "video"
  uploadType: text("upload_type"), // "po" | "photo" | "signed_challan" | "transport" | "wcc" | "extra"
  rawPayload: jsonb("raw_payload"),
  // Mapping
  mappedClientId: integer("mapped_client_id").references(() => clients.id),
  mappedBrandId: integer("mapped_brand_id"),
  mappedEstimateId: integer("mapped_estimate_id"),
  mappedDcId: integer("mapped_dc_id"),
  mappedStoreId: integer("mapped_store_id"),
  status: text("status").notNull().default("unlinked"), // "unlinked" | "mapped" | "ignored"
  mappedAt: timestamp("mapped_at"),
  mappedBy: integer("mapped_by"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==========================================
// 21. Webhook Logs
// ==========================================
export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  direction: text("direction").notNull().default("inbound"), // "inbound" | "outbound"
  event: text("event"),
  payload: jsonb("payload"),
  status: text("status").notNull().default("received"), // "received" | "processed" | "error"
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBotSettingSchema = createInsertSchema(botSettings).omit({ id: true, updatedAt: true });
export const insertBotUploadInboxSchema = createInsertSchema(botUploadInbox).omit({ id: true, createdAt: true });
export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({ id: true, createdAt: true });
export const insertFieldAccessLinkSchema = createInsertSchema(fieldAccessLinks).omit({ id: true, createdAt: true, updatedAt: true });

export type BotSetting = typeof botSettings.$inferSelect;
export type BotUploadInboxItem = typeof botUploadInbox.$inferSelect;
export type WebhookLog = typeof webhookLogs.$inferSelect;
export type FieldAccessLink = typeof fieldAccessLinks.$inferSelect;

// ==========================================
// Drizzle Insert & Select Schemas / Types
// ==========================================
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPettyCashExpenseSchema = createInsertSchema(pettyCashExpenses).omit({ id: true, createdAt: true });
export const insertUploadSchema = createInsertSchema(uploads).omit({ id: true, createdAt: true });
export const insertChartOfAccountSchema = createInsertSchema(chartOfAccounts).omit({ id: true, createdAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });
export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true });
export const insertJournalEntryLineSchema = createInsertSchema(journalEntryLines).omit({ id: true, createdAt: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true });
export const insertClientBillingProfileSchema = createInsertSchema(clientBillingProfiles).omit({ id: true, createdAt: true });
export const insertBrandSchema = createInsertSchema(brands).omit({ id: true, createdAt: true });
export const insertStoreSchema = createInsertSchema(stores).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
// ─── Phase 3: Audit Logs ─────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(), // create | update | delete | approve | status_change
  entityType: text("entity_type").notNull(), // estimate | invoice | delivery_challan | payment | execution_document | ...
  entityId: integer("entity_id"),
  entityLabel: text("entity_label"), // human-readable: estimate number, invoice number...
  estimateId: integer("estimate_id"), // project link
  invoiceId: integer("invoice_id"),
  deliveryChallanId: integer("delivery_challan_id"), // WCC link
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Phase 3: Notifications ──────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // pending_wcc | missing_photos | missing_signed_wcc | invoice_ready | payment_due | payment_overdue
  title: text("title").notNull(),
  message: text("message"),
  severity: text("severity").default("info"), // info | warning | critical
  estimateId: integer("estimate_id"),
  invoiceId: integer("invoice_id"),
  deliveryChallanId: integer("delivery_challan_id"),
  dedupeKey: text("dedupe_key").unique(), // e.g. "payment_overdue:invoice:42"
  forRole: text("for_role"), // admin | manager | accounts | null = all
  readBy: jsonb("read_by").default([]), // array of user ids
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Phase 5A: Telegram delivery log ─────────────────────────────────────────
export const telegramDeliveries = pgTable("telegram_deliveries", {
  id: serial("id").primaryKey(),
  fieldLinkId: integer("field_link_id"),
  estimateId: integer("estimate_id"),
  recipientUserId: integer("recipient_user_id"),
  recipientName: text("recipient_name"),
  chatId: text("chat_id"),
  message: text("message"),
  status: text("status").notNull().default("pending"), // pending | sent | delivered | failed
  error: text("error"),
  telegramMessageId: text("telegram_message_id"),
  retryCount: integer("retry_count").notNull().default(0),
  sentAt: timestamp("sent_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type TelegramDelivery = typeof telegramDeliveries.$inferSelect;
export const insertTelegramDeliverySchema = createInsertSchema(telegramDeliveries).omit({ id: true, createdAt: true });

export type AuditLog = typeof auditLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true, createdAt: true });
export const insertEstimateItemSchema = createInsertSchema(estimateItems).omit({ id: true });
export const insertDeliveryChallanSchema = createInsertSchema(deliveryChallans).omit({ id: true, createdAt: true });
export const insertExecutionDocumentSchema = createInsertSchema(executionDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertExecutionStoreSchema = createInsertSchema(executionStores).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStaffAdvanceSchema = createInsertSchema(staffAdvances).omit({ id: true, createdAt: true });
export const insertPayrollSchema = createInsertSchema(payroll).omit({ id: true, createdAt: true });
export const insertMaterialCodeSchema = createInsertSchema(materialCodes).omit({ id: true, createdAt: true });
export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true, updatedAt: true });
export const insertCustomerRateCardSchema = createInsertSchema(customerRateCards).omit({ id: true, createdAt: true });
export const insertCustomerRateItemSchema = createInsertSchema(customerRateItems).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type PettyCashExpense = typeof pettyCashExpenses.$inferSelect;
export type InsertPettyCashExpense = z.infer<typeof insertPettyCashExpenseSchema>;

export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = z.infer<typeof insertUploadSchema>;

export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;
export type InsertChartOfAccount = z.infer<typeof insertChartOfAccountSchema>;

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;

export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;

export type JournalEntryLine = typeof journalEntryLines.$inferSelect;
export type InsertJournalEntryLine = z.infer<typeof insertJournalEntryLineSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

export type ClientBillingProfile = typeof clientBillingProfiles.$inferSelect;
export type InsertClientBillingProfile = z.infer<typeof insertClientBillingProfileSchema>;

export type Brand = typeof brands.$inferSelect;
export type InsertBrand = z.infer<typeof insertBrandSchema>;

export type Store = typeof stores.$inferSelect;
export type InsertStore = z.infer<typeof insertStoreSchema>;

export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;

export type EstimateItem = typeof estimateItems.$inferSelect;
export type InsertEstimateItem = z.infer<typeof insertEstimateItemSchema>;

export type DeliveryChallan = typeof deliveryChallans.$inferSelect;
export type InsertDeliveryChallan = z.infer<typeof insertDeliveryChallanSchema>;

export type ExecutionDocument = typeof executionDocuments.$inferSelect;
export type InsertExecutionDocument = z.infer<typeof insertExecutionDocumentSchema>;

export type ExecutionStore = typeof executionStores.$inferSelect;
export type InsertExecutionStore = z.infer<typeof insertExecutionStoreSchema>;

export type StaffAdvance = typeof staffAdvances.$inferSelect;
export type InsertStaffAdvance = z.infer<typeof insertStaffAdvanceSchema>;

export type Payroll = typeof payroll.$inferSelect;
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;

export type MaterialCode = typeof materialCodes.$inferSelect;
export type InsertMaterialCode = z.infer<typeof insertMaterialCodeSchema>;

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

export type CustomerRateCard = typeof customerRateCards.$inferSelect;
export type InsertCustomerRateCard = z.infer<typeof insertCustomerRateCardSchema>;

export type CustomerRateItem = typeof customerRateItems.$inferSelect;
export type InsertCustomerRateItem = z.infer<typeof insertCustomerRateItemSchema>;

export const insertProjectStoreStatusSchema = createInsertSchema(projectStoreStatus).omit({ id: true, updatedAt: true });
export type ProjectStoreStatus = typeof projectStoreStatus.$inferSelect;
export type InsertProjectStoreStatus = z.infer<typeof insertProjectStoreStatusSchema>;
