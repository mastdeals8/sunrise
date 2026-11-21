export interface InvoicePacketRequirements {
  taxInvoice: boolean;
  estimate: boolean;
  purchaseOrder: boolean;
  installationPhotos: boolean;
  generatedWcc: boolean;
  signedWcc: boolean;
  transportReceipt: boolean;
  otherDocs: boolean;
}

export const DEFAULT_INVOICE_PACKET_REQUIREMENTS: InvoicePacketRequirements = {
  taxInvoice: true,
  estimate: true,
  purchaseOrder: true,
  installationPhotos: true,
  generatedWcc: true,
  signedWcc: false,
  transportReceipt: true,
  otherDocs: false,
};

export type RequirementSource =
  | "client_brand_override"
  | "brand"
  | "parent_brand"
  | "client"
  | "company"
  | "default";

export interface ResolvedRequirementsResult {
  requirements: InvoicePacketRequirements;
  source: RequirementSource;
  matchedRecordId?: number | null;
}

export function normalizeRequirements(row?: any): InvoicePacketRequirements {
  if (!row) return { ...DEFAULT_INVOICE_PACKET_REQUIREMENTS };
  return {
    taxInvoice: row.taxInvoice ?? row.tax_invoice ?? true,
    estimate: row.estimate ?? true,
    purchaseOrder: row.purchaseOrder ?? row.purchase_order ?? true,
    installationPhotos: row.installationPhotos ?? row.installation_photos ?? true,
    generatedWcc: Boolean(row.generatedWcc ?? row.generated_wcc ?? DEFAULT_INVOICE_PACKET_REQUIREMENTS.generatedWcc),
    signedWcc: Boolean(row.signedWcc ?? row.signed_wcc ?? DEFAULT_INVOICE_PACKET_REQUIREMENTS.signedWcc),
    transportReceipt: Boolean(row.transportReceipt ?? row.transport_receipt ?? false),
    otherDocs: Boolean(row.otherDocs ?? row.other_docs ?? false),
  };
}

export function resolveInvoicePacketRequirements(
  allRequirements: Array<any>,
  context: {
    companyId: number;
    brandId?: number | null;
    clientId?: number | null;
    parentBrandName?: string | null;
    allBrands?: Array<any>;
  }
): ResolvedRequirementsResult {
  const compId = Number(context.companyId || 1);
  const brandId = context.brandId ? Number(context.brandId) : null;
  const clientId = context.clientId ? Number(context.clientId) : null;

  // Filter requirements matching this company strictly (preserves company-level isolation)
  const compReqs = (allRequirements || []).filter(
    (r) => Number(r.companyId ?? r.company_id ?? 1) === compId
  );

  // 1. Client + Brand-specific override
  if (brandId && clientId) {
    const match = compReqs.find(
      (r) => Number(r.brandId ?? r.brand_id) === brandId && Number(r.clientId ?? r.client_id) === clientId
    );
    if (match) {
      return {
        requirements: normalizeRequirements(match),
        source: "client_brand_override",
        matchedRecordId: match.id,
      };
    }
  }

  // 2. Company-specific Brand configuration
  if (brandId) {
    const match = compReqs.find(
      (r) => Number(r.brandId ?? r.brand_id) === brandId && !(r.clientId ?? r.client_id)
    );
    if (match) {
      return {
        requirements: normalizeRequirements(match),
        source: "brand",
        matchedRecordId: match.id,
      };
    }
  }

  // 3. Sub-brand inheritance from parent brand
  if (brandId && context.allBrands) {
    const currentBrand = context.allBrands.find((b) => Number(b.id) === brandId);
    const parentName = (currentBrand?.parentBrand || context.parentBrandName || "").trim().toLowerCase();
    if (parentName) {
      const parentBrand = context.allBrands.find(
        (b) =>
          Number(b.id) !== brandId &&
          Number(b.companyId ?? b.company_id ?? 1) === compId &&
          String(b.name || "").trim().toLowerCase() === parentName
      );
      if (parentBrand) {
        const parentMatch = compReqs.find(
          (r) => Number(r.brandId ?? r.brand_id) === Number(parentBrand.id) && !(r.clientId ?? r.client_id)
        );
        if (parentMatch) {
          return {
            requirements: normalizeRequirements(parentMatch),
            source: "parent_brand",
            matchedRecordId: parentMatch.id,
          };
        }
      }
    }
  }

  // 4. Client-level configuration
  if (clientId) {
    const match = compReqs.find(
      (r) => !(r.brandId ?? r.brand_id) && Number(r.clientId ?? r.client_id) === clientId
    );
    if (match) {
      return {
        requirements: normalizeRequirements(match),
        source: "client",
        matchedRecordId: match.id,
      };
    }
  }

  // 5. Company-level default
  const compDefault = compReqs.find(
    (r) => !(r.brandId ?? r.brand_id) && !(r.clientId ?? r.client_id)
  );
  if (compDefault) {
    return {
      requirements: normalizeRequirements(compDefault),
      source: "company",
      matchedRecordId: compDefault.id,
    };
  }

  // 6. Existing system default
  return {
    requirements: { ...DEFAULT_INVOICE_PACKET_REQUIREMENTS },
    source: "default",
    matchedRecordId: null,
  };
}
