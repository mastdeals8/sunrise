// Shared type definitions for the Operations module.
// Extracted verbatim from the original Operations.tsx so behavior is unchanged.

export interface Client {
  id: number;
  name: string;
  email: string | null;
  mobile: string | null;
  city: string | null;
  address: string | null;
  gstNumber: string | null;
  format: string; // normal, ABFRL
  isActive: boolean;
  clientGroupName?: string | null;
  clientType?: string | null;
  pan?: string | null;
  primaryContactPerson?: string | null;
  paymentTerms?: string | null;
  vendorCode?: string | null;
}

export interface Brand {
  id: number;
  name: string;
  parentClientId?: number | null;
  parentBrand: string | null;
  isActive: boolean;
}

export interface Store {
  id: number;
  name: string;
  clientId: number;
  brandId: number;
  location: string | null;
  address: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  isActive: boolean;
  storeCode?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  regionZone?: string | null;
  contact?: string | null;
}

export interface Product {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  rate: number;
  description: string | null;
  hsnSac: string | null;
  materialCode?: string | null;
  materialCodeId?: number | null;
  isStandard: boolean;
  calculationType: string; // sqft, running_inch, fixed, percentage, manual
  gstPercent: number;
  defaultSpecification: string | null;
  warranty: string | null;
  isActive: boolean;
}

export interface Estimate {
  id: number;
  estimateNumber: string;
  estimateDate?: string | null;
  clientId: number;
  brandId: number;
  storeId: number;
  title: string;
  description: string | null;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: string; // draft, sent, approved, rejected, awaiting_po, po_received
  clientFormat: string; // normal, ABFRL
  subject: string | null;
  billingTo: string | null;
  shippingTo: string | null;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  vendorCode: string | null;
  gstType: string; // CGST+SGST, IGST
  packingPercent: number | null;
  implementationPercent: number | null;
  transportAmount: number | null;
  storeGrouping: any | null;
  poNumber: string | null;
  poDate: string | null;
  poAmount: number | null;
  poFilePath: string | null;
  poRemarks: string | null;
  createdAt: string;

  // Multi-GST snaps
  billingProfileId?: number | null;
  billingLegalNameSnapshot?: string | null;
  billingGstinSnapshot?: string | null;
  billingStateSnapshot?: string | null;
  billingStateCodeSnapshot?: string | null;
  billingAddressSnapshot?: string | null;
  shippingAddressSnapshot?: string | null;
  abfrlProjectType?: string | null;
}

export interface EstimateItem {
  id: number;
  estimateId: number;
  productId: number | null;
  itemName: string;
  description: string | null;
  quantity: number;
  unit: string;
  rate: number;
  totalPrice: number;
  sl: number | null;
  isStandard: boolean | null;
  hsn: string | null;
  materialCode?: string | null;
  materialCodeId?: number | null;
  width: number | null;
  height: number | null;
  totalSize: number | null;
  cgstPercent: number | null;
  cgstAmount: number | null;
  sgstPercent: number | null;
  sgstAmount: number | null;
  igstPercent: number | null;
  igstAmount: number | null;
  totalAmount: number | null;
  storeCode?: string | null;
  lineType?: "product" | "packing" | "installation" | "transport" | "manual" | string | null;
  calculationType?: string | null;
}

export interface DeliveryChallan {
  id: number;
  dcNumber: string;
  estimateId: number;
  deliveryDate: string;
  status: string;
  documentType?: string | null;
  items: any;
  deliveredBy: string | null;
  receivedBy: string | null;
  remarks: string | null;
  signedChallanPath: string | null;
  photoPath: string | null;
  transportReceiptPath: string | null;
  extraDocPath: string | null;
  clientFormat: string;
  metadata: any | null;
}

export interface WccPhoto {
  path: string;
  widthPct: number;             // legacy — kept for backwards compat
  objectFit: 'cover' | 'contain';
  objectPosition: string;       // legacy — kept for backwards compat
  caption: string;
  // Free-positioning + resize fields (percentages of the picture frame).
  // Newer WCCs use these; older ones fall back to a layout grid.
  xPct?: number;   // 0..100 — left within frame
  yPct?: number;   // 0..100 — top within frame
  wPct?: number;   // 5..100 — width within frame
  hPct?: number;   // 5..100 — height within frame
  z?: number;      // stacking order
}

export interface MaterialCodeRow {
  id: number;
  clientId: number | null;
  brandId: number | null;
  code: string;
  productName: string | null;
  description: string | null;
  hsn: string | null;
  uom: string | null;
  gstPercent: number | null;
  defaultRate: number | null;
  category: string | null;
  isStandard: boolean;
  isActive: boolean;
}

export interface EstimateItemInput {
  sl: number;
  productId: string;
  isStandard: boolean;
  hsn: string;
  materialCode: string;
  materialCodeId?: number | null;
  materialDescription?: string;
  itemName: string;
  width: string;
  height: string;
  quantity: string;
  unit: string;
  calculationType: string;
  rate: string;
  amount: string;
  cgstPercent: string;
  cgstAmount: string;
  sgstPercent: string;
  sgstAmount: string;
  igstPercent: string;
  igstAmount: string;
  totalAmount: string;
  storeId: string;
  storeSortOrder?: number | null;
  rowSortOrder?: number | null;
  description?: string;
  lineType?: "product" | "packing" | "installation" | "transport";
  storeCode?: string | null;
  // UI-only — tracks where the rate value came from so the row can render a
  // small "Customer Rate Card / Product Default / Manual Override" pill. Not
  // persisted to the DB. Defaults to "default" until the row is touched.
  rateSource?: "rate_card" | "default" | "manual" | "";
  // Letter signage helper — running-inch breakdown ("27,26,26,26,28,27,27")
  // typed into the row. The total updates `width` automatically when set.
  letterSizes?: string;
}

export type OpTab =
  | "clients"
  | "brands"
  | "stores"
  | "products"
  | "estimates"
  | "projects"
  | "challans"
  | "master_data"
  | "invoices_ledger"
  | "project_tracker";
