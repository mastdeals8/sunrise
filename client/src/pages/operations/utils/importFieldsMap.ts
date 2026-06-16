// Field map drives the import wizard's destination columns.
// Business-data fields (names/codes/GSTIN) are PRIMARY. Internal IDs are
// optional reference-only fields — used only when present + valid + from
// the same export. The matcher in `importMatching.ts` ignores blank IDs.

export type ImportFieldDef = { label: string; key: string; required?: boolean; reference?: boolean; synonyms?: string[] };

export const importFieldsMap: Record<string, ImportFieldDef[]> = {
  clients: [
    { label: "Company / Client Name", key: "name", required: true, synonyms: ["client_name", "client name", "company", "company name"] },
    { label: "GSTIN Registration", key: "gstNumber", synonyms: ["gstin", "gst_no", "gst number", "gst no"] },
    { label: "Company PAN", key: "pan" },
    { label: "Email", key: "email" },
    { label: "Mobile", key: "mobile" },
    { label: "City", key: "city" },
    { label: "Complete Address", key: "address" },
    { label: "Group / Parent Company", key: "clientGroupName", synonyms: ["group", "parent_company"] },
    { label: "Client Type (corporate/normal/walk_in)", key: "clientType" },
    { label: "Primary Contact Person", key: "primaryContactPerson", synonyms: ["contact_person", "primary contact"] },
    { label: "Payment Terms", key: "paymentTerms" },
    { label: "Vendor Code (assigned by client)", key: "vendorCode", synonyms: ["vendor_code", "vendor code", "vendor no", "vendor no."] },
    { label: "Internal Client ID (optional, reference only)", key: "id", reference: true, synonyms: ["client_id"] },
  ],
  billing_profiles: [
    { label: "Client Name (for auto lookup)", key: "clientName", required: true, synonyms: ["client_name"] },
    { label: "Legal Company Name", key: "legalCompanyName", synonyms: ["company name / legal name", "company name", "legal name", "legal_company_name"] },
    { label: "GSTIN", key: "gstin", required: true, synonyms: ["gst no.", "gst no", "gst number", "gst"] },
    { label: "PAN", key: "pan" },
    { label: "State Name", key: "state", required: true, synonyms: ["states/ut", "state", "branch_name"] },
    { label: "State Code", key: "stateCode", synonyms: ["state c", "state code", "state_code"] },
    { label: "Billing Address", key: "billingAddress", required: true, synonyms: ["address as per gst rc", "address", "billing_address"] },
    { label: "Shipping Address Descriptor", key: "shippingAddress", synonyms: ["shipping_address"] },
    { label: "Branch/Location descriptor", key: "branchLocationName", synonyms: ["branch_name", "states/ut"] },
    { label: "Contact Person", key: "contactPerson", synonyms: ["contact_person"] },
    { label: "Mobile", key: "mobile" },
    { label: "Email", key: "email" },
    { label: "Is Default Profile (true/false)", key: "isDefault", synonyms: ["default_for_state"] },
    { label: "Is Active (true/false)", key: "isActive", synonyms: ["active"] },
    { label: "Notes", key: "notes" },
    { label: "Internal Client ID (optional, reference only)", key: "clientId", reference: true, synonyms: ["client_id"] },
  ],
  brands: [
    { label: "Brand Name", key: "name", required: true, synonyms: ["brand_name", "brand"] },
    { label: "Parent Client Name (for auto lookup)", key: "clientName", required: true, synonyms: ["client_name", "parent_client", "parent client"] },
    { label: "Is Active (true/false)", key: "isActive", synonyms: ["active"] },
    { label: "Internal Brand ID (optional, reference only)", key: "id", reference: true, synonyms: ["brand_id"] },
    { label: "Internal Client ID (optional, reference only)", key: "clientId", reference: true, synonyms: ["client_id"] },
  ],
  stores: [
    { label: "Store Name", key: "name", required: true, synonyms: ["store_name", "store site name"] },
    { label: "Store Code", key: "storeCode", required: true, synonyms: ["store_code", "code"] },
    { label: "Client", key: "clientName", required: true, synonyms: ["client_name", "client name"] },
    { label: "Brand", key: "brandName", required: true, synonyms: ["brand_name", "brand name"] },
    { label: "City", key: "city", synonyms: ["location_city", "location city"] },
    { label: "State", key: "state", synonyms: ["state_name", "state name"] },
    { label: "State Code", key: "stateCode", synonyms: ["state_code"] },
    { label: "Region / Zone", key: "regionZone", synonyms: ["region_zone", "region/zone", "region", "zone"] },
    { label: "Contact Person", key: "contactPerson", synonyms: ["contact_person", "contact"] },
    { label: "Phone", key: "contactPhone", synonyms: ["contact_number", "contact_phone", "phone"] },
    { label: "Address", key: "address", synonyms: ["full_address"] },
    { label: "Internal Client ID (optional)", key: "clientId", reference: true, synonyms: ["client_id"] },
    { label: "Internal Brand ID (optional)", key: "brandId", reference: true, synonyms: ["brand_id"] },
    { label: "Internal Store ID (optional)", key: "id", reference: true, synonyms: ["store_id"] },
  ],
  products: [
    { label: "Alias", key: "name", required: true, synonyms: ["product_name", "product name", "product / service name"] },
    { label: "Category", key: "category" },
    { label: "UOM (sqft/running_inch/nos/job)", key: "unit", synonyms: ["uom"] },
    { label: "Default Rate", key: "rate", synonyms: ["default_rate"] },
    { label: "Description", key: "description" },
    { label: "HSN/SAC Code", key: "hsnSac", synonyms: ["hsn_sac", "hsn"] },
    { label: "Standard Item (true/false)", key: "isStandard", synonyms: ["standard_non_standard"] },
    { label: "Sizing Rule (sqft/running_inch/fixed)", key: "calculationType", synonyms: ["calculation_type"] },
    { label: "GST Rate %", key: "gstPercent", synonyms: ["gst_percent", "gst %"] },
    { label: "Sizing Specs", key: "defaultSpecification", synonyms: ["default_specification"] },
    { label: "Warranty Term", key: "warranty" },
  ]
};
