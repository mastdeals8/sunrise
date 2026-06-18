import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

/** Normalize a display name: trim + title-case each word */
function normalizeDisplayName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize GSTIN/PAN: uppercase + trim */
function normalizeGstinPan(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toUpperCase();
}

/** Convert camelCase payload keys to snake_case for DB */
function toSnake(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k.replace(/([A-Z])/g, (_: string, c: string) => `_${c.toLowerCase()}`),
      v,
    ])
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const { jwt } = await requireUser(req);
    const db = adminClient();

    // URL pattern: /master-data-save/{entity}[/{id}]
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/functions\/v1\/master-data-save\/?/, "").split("/").filter(Boolean);
    const entity = parts[0] ?? "";
    const id = parts[1] ? parseInt(parts[1], 10) : null;
    const method = req.method;

    if (!entity) return errorResponse("Missing entity in path", 400);

    const body: Record<string, unknown> = method !== "DELETE" ? await req.json().catch(() => ({})) : {};

    // ── CLIENTS ───────────────────────────────────────────────────────────────
    if (entity === "clients") {
      if (method === "POST") {
        const row = {
          name: normalizeDisplayName(String(body.name ?? "")),
          email: body.email || null,
          mobile: body.mobile || null,
          city: body.city ? normalizeDisplayName(String(body.city)) : null,
          address: body.address || null,
          gst_number: body.gstNumber ? normalizeGstinPan(String(body.gstNumber)) : null,
          format: body.format || "normal",
          client_group_name: body.clientGroupName ? normalizeDisplayName(String(body.clientGroupName)) : null,
          client_type: body.clientType || "normal",
          pan: body.pan ? normalizeGstinPan(String(body.pan)) : null,
          primary_contact_person: body.primaryContactPerson ? normalizeDisplayName(String(body.primaryContactPerson)) : null,
          payment_terms: body.paymentTerms || null,
          vendor_code: body.vendorCode || null,
          is_active: true,
        };
        const { data, error } = await db.from("clients").insert(row).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      if (method === "PATCH" && id) {
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = normalizeDisplayName(String(body.name));
        if (body.email !== undefined) updates.email = body.email;
        if (body.mobile !== undefined) updates.mobile = body.mobile;
        if (body.city !== undefined) updates.city = body.city ? normalizeDisplayName(String(body.city)) : null;
        if (body.address !== undefined) updates.address = body.address;
        if (body.gstNumber !== undefined) updates.gst_number = body.gstNumber ? normalizeGstinPan(String(body.gstNumber)) : null;
        if (body.format !== undefined) updates.format = body.format;
        if (body.clientGroupName !== undefined) updates.client_group_name = body.clientGroupName ? normalizeDisplayName(String(body.clientGroupName)) : null;
        if (body.clientType !== undefined) updates.client_type = body.clientType;
        if (body.pan !== undefined) updates.pan = body.pan ? normalizeGstinPan(String(body.pan)) : null;
        if (body.primaryContactPerson !== undefined) updates.primary_contact_person = body.primaryContactPerson ? normalizeDisplayName(String(body.primaryContactPerson)) : null;
        if (body.paymentTerms !== undefined) updates.payment_terms = body.paymentTerms;
        if (body.vendorCode !== undefined) updates.vendor_code = body.vendorCode;
        if (body.isActive !== undefined) updates.is_active = body.isActive;
        const { data, error } = await db.from("clients").update(updates).eq("id", id).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      if (method === "DELETE" && id) {
        // Soft-delete if estimates exist, hard-delete otherwise
        const { data: estCheck } = await db.from("estimates").select("id").eq("client_id", id).limit(1);
        if (estCheck && estCheck.length > 0) {
          await db.from("clients").update({ is_active: false }).eq("id", id);
          return jsonResponse({ soft: true, message: "Client has estimates — deactivated instead of deleted." });
        }
        await db.from("clients").delete().eq("id", id);
        return jsonResponse({ soft: false, message: "Client deleted." });
      }
    }

    // ── BRANDS ────────────────────────────────────────────────────────────────
    if (entity === "brands") {
      if (method === "POST") {
        const parentClientId = Number(body.parentClientId);
        const { data: parentClient } = await db.from("clients").select("name, client_group_name").eq("id", parentClientId).single();
        const row = {
          name: normalizeDisplayName(String(body.name ?? "")),
          parent_client_id: parentClientId,
          parent_brand: parentClient ? normalizeDisplayName(String(parentClient.client_group_name || parentClient.name)) : null,
          is_active: true,
        };
        const { data, error } = await db.from("brands").insert(row).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      if (method === "PATCH" && id) {
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = normalizeDisplayName(String(body.name));
        if (body.isActive !== undefined) updates.is_active = body.isActive;
        if (body.parentClientId !== undefined) {
          updates.parent_client_id = Number(body.parentClientId);
          const { data: parentClient } = await db.from("clients").select("name, client_group_name").eq("id", Number(body.parentClientId)).single();
          updates.parent_brand = parentClient ? normalizeDisplayName(String(parentClient.client_group_name || parentClient.name)) : null;
        }
        const { data, error } = await db.from("brands").update(updates).eq("id", id).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      if (method === "DELETE" && id) {
        const { data: storeCheck } = await db.from("stores").select("id").eq("brand_id", id).limit(1);
        if (storeCheck && storeCheck.length > 0) return errorResponse("Brand has linked stores. Remove them first.", 400);
        const { data: estCheck } = await db.from("estimates").select("id").eq("brand_id", id).limit(1);
        if (estCheck && estCheck.length > 0) return errorResponse("Brand has linked estimates. Remove them first.", 400);
        await db.from("brands").delete().eq("id", id);
        return jsonResponse({ message: "Brand deleted." });
      }
    }

    // ── STORES ────────────────────────────────────────────────────────────────
    if (entity === "stores") {
      if (method === "POST") {
        const row: Record<string, unknown> = {
          name: normalizeDisplayName(String(body.name ?? "")),
          client_id: Number(body.clientId),
          brand_id: Number(body.brandId),
          location: body.location || null,
          address: body.address || null,
          contact_person: body.contactPerson ? normalizeDisplayName(String(body.contactPerson)) : null,
          contact_phone: body.contactPhone || null,
          store_code: body.storeCode || null,
          city: body.city ? normalizeDisplayName(String(body.city)) : null,
          state: body.state ? normalizeDisplayName(String(body.state)) : null,
          state_code: body.stateCode || null,
          region_zone: body.regionZone || null,
          contact: body.contact ? normalizeDisplayName(String(body.contact)) : null,
          is_active: true,
        };
        const { data, error } = await db.from("stores").insert(row).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      if (method === "PATCH" && id) {
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = normalizeDisplayName(String(body.name));
        if (body.clientId !== undefined) updates.client_id = Number(body.clientId);
        if (body.brandId !== undefined) updates.brand_id = Number(body.brandId);
        if (body.location !== undefined) updates.location = body.location;
        if (body.address !== undefined) updates.address = body.address;
        if (body.contactPerson !== undefined) updates.contact_person = body.contactPerson ? normalizeDisplayName(String(body.contactPerson)) : null;
        if (body.contactPhone !== undefined) updates.contact_phone = body.contactPhone;
        if (body.storeCode !== undefined) updates.store_code = body.storeCode;
        if (body.city !== undefined) updates.city = body.city ? normalizeDisplayName(String(body.city)) : null;
        if (body.state !== undefined) updates.state = body.state ? normalizeDisplayName(String(body.state)) : null;
        if (body.stateCode !== undefined) updates.state_code = body.stateCode;
        if (body.regionZone !== undefined) updates.region_zone = body.regionZone;
        if (body.contact !== undefined) updates.contact = body.contact ? normalizeDisplayName(String(body.contact)) : null;
        if (body.isActive !== undefined) updates.is_active = body.isActive;
        const { data, error } = await db.from("stores").update(updates).eq("id", id).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      if (method === "DELETE" && id) {
        const { data: estCheck } = await db.from("estimate_items").select("id").eq("store_id", id).limit(1);
        if (estCheck && estCheck.length > 0) {
          await db.from("stores").update({ is_active: false }).eq("id", id);
          return jsonResponse({ soft: true, message: "Store has estimate items — deactivated instead of deleted." });
        }
        await db.from("stores").delete().eq("id", id);
        return jsonResponse({ soft: false, message: "Store deleted." });
      }
    }

    // ── PRODUCTS ──────────────────────────────────────────────────────────────
    if (entity === "products") {
      if (method === "POST") {
        const row: Record<string, unknown> = {
          name: String(body.name ?? "").trim(),
          category: body.category ? normalizeDisplayName(String(body.category)) : null,
          unit: body.unit || "sqft",
          rate: Number(body.rate) || 0,
          description: body.description || null,
          hsn_sac: body.hsnSac ? String(body.hsnSac).trim().toUpperCase() : null,
          is_standard: body.isStandard !== undefined ? Boolean(body.isStandard) : true,
          calculation_type: body.calculationType || "sqft",
          gst_percent: Number(body.gstPercent) || 18,
          default_specification: body.defaultSpecification || null,
          warranty: body.warranty || null,
          material_code_id: body.materialCodeId ? Number(body.materialCodeId) : null,
          is_active: true,
        };
        const { data, error } = await db.from("products").insert(row).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      if (method === "PATCH" && id) {
        const updates: Record<string, unknown> = {};
        if (body.name !== undefined) updates.name = String(body.name).trim();
        if (body.category !== undefined) updates.category = body.category ? normalizeDisplayName(String(body.category)) : null;
        if (body.unit !== undefined) updates.unit = body.unit;
        if (body.rate !== undefined) updates.rate = Number(body.rate);
        if (body.description !== undefined) updates.description = body.description;
        if (body.hsnSac !== undefined) updates.hsn_sac = body.hsnSac ? String(body.hsnSac).trim().toUpperCase() : null;
        if (body.isStandard !== undefined) updates.is_standard = Boolean(body.isStandard);
        if (body.calculationType !== undefined) updates.calculation_type = body.calculationType;
        if (body.gstPercent !== undefined) updates.gst_percent = Number(body.gstPercent);
        if (body.defaultSpecification !== undefined) updates.default_specification = body.defaultSpecification;
        if (body.warranty !== undefined) updates.warranty = body.warranty;
        if (body.materialCodeId !== undefined) updates.material_code_id = body.materialCodeId ? Number(body.materialCodeId) : null;
        if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);
        const { data, error } = await db.from("products").update(updates).eq("id", id).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      if (method === "DELETE" && id) {
        const { data: product } = await db.from("products").select("name").eq("id", id).single();
        if (product && (product as any).name === "Installation Service") {
          return errorResponse("Cannot delete system service product.", 409);
        }
        const { data: usageCheck } = await db.from("estimate_items").select("id").eq("product_id", id).limit(1);
        if (usageCheck && usageCheck.length > 0) {
          await db.from("products").update({ is_active: false }).eq("id", id);
          return jsonResponse({ soft: true, message: "Product is used in estimates — deactivated instead of deleted." });
        }
        await db.from("products").delete().eq("id", id);
        return jsonResponse({ soft: false, message: "Product deleted." });
      }
    }

    // ── BILLING PROFILES ──────────────────────────────────────────────────────
    if (entity === "billing-profiles") {
      if (method === "POST") {
        const row = toSnake({
          clientId: Number(body.clientId),
          legalCompanyName: normalizeDisplayName(String(body.legalCompanyName ?? "")),
          branchLocationName: body.branchLocationName ? normalizeDisplayName(String(body.branchLocationName)) : null,
          gstin: body.gstin ? normalizeGstinPan(String(body.gstin)) : null,
          pan: body.pan ? normalizeGstinPan(String(body.pan)) : null,
          state: body.state ? normalizeDisplayName(String(body.state)) : null,
          stateCode: body.stateCode || null,
          billingAddress: body.billingAddress || null,
          shippingAddress: body.shippingAddress || null,
          contactPerson: body.contactPerson ? normalizeDisplayName(String(body.contactPerson)) : null,
          mobile: body.mobile || null,
          email: body.email || null,
          isDefault: Boolean(body.isDefault),
          isActive: body.isActive !== false,
          notes: body.notes || null,
        });
        const { data, error } = await db.from("client_billing_profiles").insert(row).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      if (method === "PATCH" && id) {
        const updates: Record<string, unknown> = {};
        if (body.legalCompanyName !== undefined) updates.legal_company_name = normalizeDisplayName(String(body.legalCompanyName));
        if (body.branchLocationName !== undefined) updates.branch_location_name = body.branchLocationName ? normalizeDisplayName(String(body.branchLocationName)) : null;
        if (body.gstin !== undefined) updates.gstin = body.gstin ? normalizeGstinPan(String(body.gstin)) : null;
        if (body.pan !== undefined) updates.pan = body.pan ? normalizeGstinPan(String(body.pan)) : null;
        if (body.state !== undefined) updates.state = body.state ? normalizeDisplayName(String(body.state)) : null;
        if (body.stateCode !== undefined) updates.state_code = body.stateCode;
        if (body.billingAddress !== undefined) updates.billing_address = body.billingAddress;
        if (body.shippingAddress !== undefined) updates.shipping_address = body.shippingAddress;
        if (body.contactPerson !== undefined) updates.contact_person = body.contactPerson ? normalizeDisplayName(String(body.contactPerson)) : null;
        if (body.mobile !== undefined) updates.mobile = body.mobile;
        if (body.email !== undefined) updates.email = body.email;
        if (body.isDefault !== undefined) updates.is_default = Boolean(body.isDefault);
        if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);
        if (body.notes !== undefined) updates.notes = body.notes;
        const { data, error } = await db.from("client_billing_profiles").update(updates).eq("id", id).select().single();
        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }
    }

    return errorResponse(`Unknown entity or method: ${entity} ${method}`, 400);
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    return errorResponse(String((err as Error).message ?? err), 500);
  }
});
