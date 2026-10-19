/**
 * Canonical Material Code resolution for Estimate Editor.
 *
 * Rules:
 * 1. Strict workspace isolation: only matches material codes belonging to the target company (companyId).
 *    Never exposes or resolves codes from another workspace/company.
 * 2. Stable IDs first: matches via product.materialCodeId / materialCodes.id.
 * 3. Fallback to product.materialCode (direct code text on product master).
 * 4. Fallback to master data lookup in material_codes by product_name:
 *    Priority: (clientId + brandId match) > (clientId match) > (global for company).
 * 5. Preserves existing user-entered or saved material codes unless an explicit change is requested.
 */

export interface MaterialCodeCandidate {
  id: number;
  companyId?: number | null;
  clientId?: number | null;
  brandId?: number | null;
  productId?: number | null;
  code: string;
  productName?: string | null;
  name?: string | null;
  description?: string | null;
  hsn?: string | null;
  isActive?: boolean;
}

export interface ProductCandidate {
  id: number;
  name?: string | null;
  materialCode?: string | null;
  materialCodeId?: number | null;
  companyId?: number | null;
}

export interface ResolveMaterialCodeOptions {
  companyId: number;
  clientId?: number | null;
  brandId?: number | null;
  existingCode?: string | null;
  existingCodeId?: number | null;
}

export interface ResolvedMaterialCode {
  materialCode: string;
  materialCodeId: number | null;
  materialDescription: string;
  isAutoMatched: boolean;
}

export function resolveMatchingMaterialCode(
  product: ProductCandidate | null | undefined,
  allMaterialCodes: MaterialCodeCandidate[],
  options: ResolveMaterialCodeOptions
): ResolvedMaterialCode {
  const targetCompanyId = options.companyId || 1;

  // Strict multi-tenant isolation: only consider material codes for target company (or global null if allowed in legacy)
  const scopedCodes = allMaterialCodes.filter(
    (m) => (m.companyId == null || m.companyId === targetCompanyId) && m.isActive !== false
  );

  // 1. If explicit existingCodeId is provided and valid in company scope
  if (options.existingCodeId != null && options.existingCodeId > 0) {
    const matched = scopedCodes.find((m) => m.id === Number(options.existingCodeId));
    if (matched) {
      return {
        materialCode: matched.code,
        materialCodeId: matched.id,
        materialDescription: matched.description || "",
        isAutoMatched: false,
      };
    }
  }

  // 2. If explicit existingCode text is provided (e.g. from previously saved item or manual entry)
  if (options.existingCode && options.existingCode.trim() !== "") {
    const trimmed = options.existingCode.trim();
    const matched = scopedCodes.find((m) => m.code.toLowerCase() === trimmed.toLowerCase());
    if (matched) {
      return {
        materialCode: matched.code,
        materialCodeId: matched.id,
        materialDescription: matched.description || "",
        isAutoMatched: false,
      };
    }
    // Preserves manual entry text even if not in master table
    return {
      materialCode: trimmed,
      materialCodeId: null,
      materialDescription: "",
      isAutoMatched: false,
    };
  }

  // 3. Product's linked materialCodeId (stable FK)
  if (product?.materialCodeId != null && product.materialCodeId > 0) {
    const matched = scopedCodes.find((m) => m.id === product.materialCodeId);
    if (matched) {
      return {
        materialCode: matched.code,
        materialCodeId: matched.id,
        materialDescription: matched.description || "",
        isAutoMatched: true,
      };
    }
  }

  // 4. Product's direct materialCode text
  if (product?.materialCode && product.materialCode.trim() !== "") {
    const trimmed = product.materialCode.trim();
    const matched = scopedCodes.find((m) => m.code.toLowerCase() === trimmed.toLowerCase());
    return {
      materialCode: matched?.code || trimmed,
      materialCodeId: matched?.id ?? null,
      materialDescription: matched?.description || "",
      isAutoMatched: true,
    };
  }

  // 5. Direct product ID match in materialCodes
  if (product?.id) {
    const matched = scopedCodes.find((m) => m.productId === product.id);
    if (matched) {
      return {
        materialCode: matched.code,
        materialCodeId: matched.id,
        materialDescription: matched.description || "",
        isAutoMatched: true,
      };
    }
  }

  // 6. Look up in material_codes by product name
  if (product?.name && product.name.trim() !== "") {
    const pName = product.name.trim().toLowerCase();
    const cId = options.clientId ? Number(options.clientId) : null;
    const bId = options.brandId ? Number(options.brandId) : null;

    const getCandidateName = (m: MaterialCodeCandidate) =>
      (m.productName || m.name || "").trim().toLowerCase();

    // Hierarchy: (client + brand) > (client) > (global for company)
    let match = scopedCodes.find(
      (m) =>
        getCandidateName(m) === pName &&
        m.clientId === cId &&
        m.brandId === bId &&
        bId !== null
    );

    if (!match && cId) {
      match = scopedCodes.find(
        (m) =>
          getCandidateName(m) === pName &&
          m.clientId === cId &&
          (m.brandId == null || m.brandId === 0)
      );
    }

    if (!match) {
      match = scopedCodes.find(
        (m) =>
          getCandidateName(m) === pName &&
          (m.clientId == null || m.clientId === 0) &&
          (m.brandId == null || m.brandId === 0)
      );
    }

    // Substring / partial match if exact match not found
    if (!match && pName.length >= 3) {
      match = scopedCodes.find((m) => {
        const cn = getCandidateName(m);
        return cn && (cn.includes(pName) || pName.includes(cn));
      });
    }

    if (match) {
      return {
        materialCode: match.code,
        materialCodeId: match.id,
        materialDescription: match.description || "",
        isAutoMatched: true,
      };
    }
  }

  // No match found
  return {
    materialCode: "",
    materialCodeId: null,
    materialDescription: "",
    isAutoMatched: false,
  };
}
