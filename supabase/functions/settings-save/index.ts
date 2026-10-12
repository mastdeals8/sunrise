import { corsHeaders, corsResponse, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, adminClient } from "../_shared/auth.ts";

/**
 * Upsert app_settings key-value pairs using the service-role admin client,
 * bypassing RLS restrictions that block INSERT from the browser anon client.
 *
 * Body: { [key: string]: string | null }
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const { user: authUser } = await requireUser(req);
    const db = adminClient();

    const body: Record<string, any> = await req.json().catch(() => ({}));

    // If companyId is provided, perform company-specific settings update
    const companyId = body.companyId ? parseInt(String(body.companyId), 10) : null;
    if (companyId && Number.isFinite(companyId)) {
      // Security check: verify user is allowed to manage this company
      const { data: dbUser } = await db
        .from("users")
        .select("id, role, is_super_admin")
        .or(`auth_user_id.eq.${authUser.id},email.eq.${authUser.email}`)
        .maybeSingle();

      const isSuper = dbUser?.id === 1 || dbUser?.role === "admin" || dbUser?.is_super_admin === true;
      if (!isSuper) {
        if (!dbUser) {
          return errorResponse("User not found in system", 403);
        }
        const { data: membership } = await db
          .from("company_users")
          .select("role")
          .eq("user_id", dbUser.id)
          .eq("company_id", companyId)
          .maybeSingle();

        const role = membership?.role;
        if (role !== "super_admin" && role !== "company_admin") {
          return errorResponse("Forbidden: Company administrator permissions required", 403);
        }
      }

      // Map incoming fields to companies table columns
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if ("name" in body || "companyName" in body) updateData.name = String(body.name ?? body.companyName ?? "").trim();
      if ("legalName" in body) updateData.legal_name = String(body.legalName ?? "").trim() || null;
      if ("tradeName" in body) updateData.trade_name = String(body.tradeName ?? "").trim() || null;
      if ("displayName" in body) updateData.display_name = String(body.displayName ?? "").trim() || null;
      if ("address" in body || "companyAddress" in body) updateData.address = String(body.address ?? body.companyAddress ?? "").trim() || null;
      if ("gstin" in body || "companyGstin" in body) updateData.gstin = String(body.gstin ?? body.companyGstin ?? "").trim() || null;
      if ("pan" in body || "companyPan" in body) updateData.pan = String(body.pan ?? body.companyPan ?? "").trim() || null;
      if ("state" in body || "companyState" in body) updateData.state = String(body.state ?? body.companyState ?? "").trim() || null;
      if ("stateCode" in body || "companyStateCode" in body) updateData.state_code = String(body.stateCode ?? body.companyStateCode ?? "").trim() || null;
      if ("mobile" in body || "companyMobile" in body) updateData.mobile = String(body.mobile ?? body.companyMobile ?? "").trim() || null;
      if ("email" in body || "companyEmail" in body) updateData.email = String(body.email ?? body.companyEmail ?? "").trim() || null;
      if ("bankName" in body) updateData.bank_name = String(body.bankName ?? "").trim() || null;
      if ("bankAccountNumber" in body) updateData.bank_account_number = String(body.bankAccountNumber ?? "").trim() || null;
      if ("bankIfsc" in body) updateData.bank_ifsc = String(body.bankIfsc ?? "").trim() || null;
      if ("bankBranch" in body) updateData.bank_branch = String(body.bankBranch ?? "").trim() || null;

      if ("defaultGstPercent" in body) updateData.default_gst_percent = parseFloat(body.defaultGstPercent) || 18;
      if ("defaultPacking" in body || "defaultPackingPercent" in body) updateData.default_packing_percent = parseFloat(body.defaultPacking ?? body.defaultPackingPercent) || 0;
      if ("defaultImplementation" in body || "defaultImplementationPercent" in body) updateData.default_implementation_percent = parseFloat(body.defaultImplementation ?? body.defaultImplementationPercent) || 0;
      if ("defaultLocalTransport" in body) updateData.default_local_transport = parseFloat(body.defaultLocalTransport) || 0;
      if ("defaultOutstationTransportRate" in body) updateData.default_outstation_transport_rate = parseFloat(body.defaultOutstationTransportRate) || 0;

      if ("estimatePrefix" in body || "defaultEstimatePrefix" in body) updateData.estimate_prefix = String(body.estimatePrefix ?? body.defaultEstimatePrefix ?? "").trim() || "EST";
      if ("invoicePrefix" in body || "defaultInvoicePrefix" in body) updateData.invoice_prefix = String(body.invoicePrefix ?? body.defaultInvoicePrefix ?? "").trim() || "INV";
      if ("dcPrefix" in body || "defaultDcPrefix" in body) updateData.dc_prefix = String(body.dcPrefix ?? body.defaultDcPrefix ?? "").trim() || "DC";

      if ("logoPath" in body || "companyLogoPath" in body) updateData.logo_path = body.logoPath ?? body.companyLogoPath ?? null;
      if ("signaturePath" in body) updateData.signature_path = body.signaturePath || null;
      if ("sealPath" in body) updateData.seal_path = body.sealPath || null;
      if ("signatureStampPath" in body) updateData.signature_stamp_path = body.signatureStampPath || null;

      // Keep signature_stamp_path synced if signature_path is set but signature_stamp_path is not
      if (updateData.signature_path && !updateData.signature_stamp_path) {
        updateData.signature_stamp_path = updateData.signature_path;
      }

      if ("terms" in body || "termsAndConditions" in body) updateData.terms_and_conditions = String(body.terms ?? body.termsAndConditions ?? "").trim() || null;
      if ("documentHeader" in body || "docHeaderText" in body) updateData.doc_header_text = String(body.documentHeader ?? body.docHeaderText ?? "").trim() || null;
      if ("documentFooter" in body || "docFooterText" in body) updateData.doc_footer_text = String(body.documentFooter ?? body.docFooterText ?? "").trim() || null;

      if ("footerBgColor" in body) updateData.footer_bg_color = String(body.footerBgColor || "#f59e0b").trim();
      if ("footerTextColor" in body) updateData.footer_text_color = String(body.footerTextColor || "#ffffff").trim();
      if ("headerBgColor" in body) updateData.header_bg_color = String(body.headerBgColor || "#ffffff").trim();
      if ("headerTextColor" in body) updateData.header_text_color = String(body.headerTextColor || "#1e293b").trim();
      if ("footerAlignment" in body) updateData.footer_alignment = String(body.footerAlignment || "center").trim();
      if ("brandingOptions" in body) updateData.branding_options = typeof body.brandingOptions === "object" ? body.brandingOptions : {};

      const { data: updated, error } = await db
        .from("companies")
        .update(updateData)
        .eq("id", companyId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update company #${companyId}: ${error.message}`);
      }

      // If companyId === 1, mirror to app_settings for backwards compatibility
      if (companyId === 1) {
        const mirrorMap: Record<string, string | null> = {
          "company.name": updateData.name,
          "company.address": updateData.address,
          "company.gstin": updateData.gstin,
          "company.pan": updateData.pan,
          "company.stateCode": updateData.state_code,
          "company.mobile": updateData.mobile,
          "company.email": updateData.email,
          "bank.name": updateData.bank_name,
          "bank.accountNumber": updateData.bank_account_number,
          "bank.ifsc": updateData.bank_ifsc,
          "bank.branch": updateData.bank_branch,
          "defaults.gstPercent": updateData.default_gst_percent != null ? String(updateData.default_gst_percent) : null,
          "defaults.packingPercent": updateData.default_packing_percent != null ? String(updateData.default_packing_percent) : null,
          "defaults.implementationPercent": updateData.default_implementation_percent != null ? String(updateData.default_implementation_percent) : null,
          "defaults.localTransport": updateData.default_local_transport != null ? String(updateData.default_local_transport) : null,
          "defaults.outstationTransportRate": updateData.default_outstation_transport_rate != null ? String(updateData.default_outstation_transport_rate) : null,
          "defaults.terms": updateData.terms_and_conditions,
          "company.logoPath": updateData.logo_path,
          "company.signatureStampPath": updateData.signature_stamp_path,
        };
        for (const [k, v] of Object.entries(mirrorMap)) {
          if (v !== undefined) {
            await db.from("app_settings").upsert({ key: k, value: v }, { onConflict: "key" });
          }
        }
      }

      return jsonResponse({ ok: true, company: updated });
    }

    // Legacy fallback: key-value app_settings upsert
    const entries = Object.entries(body);
    if (entries.length === 0) return jsonResponse({ ok: true, updated: 0 });

    for (const [key, value] of entries) {
      if (!key || typeof key !== "string") continue;
      const { error } = await db
        .from("app_settings")
        .upsert({ key, value }, { onConflict: "key" });
      if (error) throw new Error(`Failed to save key "${key}": ${error.message}`);
    }

    return jsonResponse({ ok: true, updated: entries.length });
  } catch (err: unknown) {
    if (err instanceof Response) return err;
    return errorResponse(err instanceof Error ? err.message : "Unknown error");
  }
});
