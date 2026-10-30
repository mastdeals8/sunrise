-- Migration: 20261030140000_add_sap_code_to_stores.sql
-- Description: Add sap_code column to stores table and update save_master_data_atomic RPC to handle sap_code

-- 1. Add sap_code column to public.stores
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS sap_code text;

-- 2. Update save_master_data_atomic to handle sap_code
CREATE OR REPLACE FUNCTION public.save_master_data_atomic(
  p_entity text,
  p_method text,
  p_id integer,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id integer;
  v_result jsonb;
  v_existing_comp integer;
  v_parent_client_comp integer;
BEGIN
  -- 1. Resolve company_id
  v_company_id := COALESCE(
    (p_payload->>'company_id')::integer,
    (p_payload->>'companyId')::integer
  );

  -- For PATCH/DELETE, if company_id wasn't in payload, find it from the existing record
  IF v_company_id IS NULL AND p_id IS NOT NULL THEN
    IF p_entity = 'clients' THEN
      SELECT company_id INTO v_company_id FROM public.clients WHERE id = p_id;
    ELSIF p_entity = 'brands' THEN
      SELECT company_id INTO v_company_id FROM public.brands WHERE id = p_id;
    ELSIF p_entity = 'stores' THEN
      SELECT company_id INTO v_company_id FROM public.stores WHERE id = p_id;
    ELSIF p_entity = 'products' THEN
      SELECT company_id INTO v_company_id FROM public.products WHERE id = p_id;
    ELSIF p_entity = 'material-codes' THEN
      SELECT company_id INTO v_company_id FROM public.material_codes WHERE id = p_id;
    ELSIF p_entity = 'billing-profiles' THEN
      SELECT c.company_id INTO v_company_id 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;
    END IF;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id is required and could not be determined' USING ERRCODE = '23502';
  END IF;

  -- 2. Verify caller access
  IF NOT public.user_has_company_access(v_company_id) THEN
    RAISE EXCEPTION 'Access denied for company %', v_company_id USING ERRCODE = '42501';
  END IF;

  -- ── CLIENTS ─────────────────────────────────────────────────────────────────
  IF p_entity = 'clients' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.clients (
        company_id, name, email, mobile, city, address, gst_number,
        format, client_group_name, client_type, pan,
        primary_contact_person, payment_terms, vendor_code, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'email', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'mobile', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'city', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'address', '')), ''),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'gstNumber', p_payload->>'gst_number', ''))), ''),
        COALESCE(p_payload->>'format', 'normal'),
        NULLIF(TRIM(COALESCE(p_payload->>'clientGroupName', p_payload->>'client_group_name', '')), ''),
        COALESCE(p_payload->>'clientType', p_payload->>'client_type', 'normal'),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'pan', ''))), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'primaryContactPerson', p_payload->>'primary_contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'paymentTerms', p_payload->>'payment_terms', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'vendorCode', p_payload->>'vendor_code', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(clients.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.clients WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Client % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.clients SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        email = CASE WHEN p_payload ? 'email' THEN NULLIF(TRIM(p_payload->>'email'), '') ELSE email END,
        mobile = CASE WHEN p_payload ? 'mobile' THEN NULLIF(TRIM(p_payload->>'mobile'), '') ELSE mobile END,
        city = CASE WHEN p_payload ? 'city' THEN NULLIF(TRIM(p_payload->>'city'), '') ELSE city END,
        address = CASE WHEN p_payload ? 'address' THEN NULLIF(TRIM(p_payload->>'address'), '') ELSE address END,
        gst_number = CASE WHEN p_payload ? 'gstNumber' OR p_payload ? 'gst_number' THEN NULLIF(TRIM(UPPER(COALESCE(p_payload->>'gstNumber', p_payload->>'gst_number'))), '') ELSE gst_number END,
        format = COALESCE(p_payload->>'format', format),
        client_group_name = CASE WHEN p_payload ? 'clientGroupName' OR p_payload ? 'client_group_name' THEN NULLIF(TRIM(COALESCE(p_payload->>'clientGroupName', p_payload->>'client_group_name')), '') ELSE client_group_name END,
        client_type = COALESCE(p_payload->>'clientType', p_payload->>'client_type', client_type),
        pan = CASE WHEN p_payload ? 'pan' THEN NULLIF(TRIM(UPPER(p_payload->>'pan')), '') ELSE pan END,
        primary_contact_person = CASE WHEN p_payload ? 'primaryContactPerson' OR p_payload ? 'primary_contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'primaryContactPerson', p_payload->>'primary_contact_person')), '') ELSE primary_contact_person END,
        payment_terms = CASE WHEN p_payload ? 'paymentTerms' OR p_payload ? 'payment_terms' THEN NULLIF(TRIM(COALESCE(p_payload->>'paymentTerms', p_payload->>'payment_terms')), '') ELSE payment_terms END,
        vendor_code = CASE WHEN p_payload ? 'vendorCode' OR p_payload ? 'vendor_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'vendorCode', p_payload->>'vendor_code')), '') ELSE vendor_code END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(clients.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.clients WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Client % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      -- Check if client has linked estimates
      IF EXISTS (SELECT 1 FROM public.estimates WHERE client_id = p_id LIMIT 1) THEN
        UPDATE public.clients SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Client has linked estimates — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.clients WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Client deleted.');
      END IF;
    END IF;

  -- ── BRANDS ──────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'brands' THEN
    IF p_method = 'POST' THEN
      -- If parent_client_id provided, verify it belongs to v_company_id
      IF (p_payload->>'parentClientId') IS NOT NULL OR (p_payload->>'parent_client_id') IS NOT NULL THEN
        SELECT company_id INTO v_parent_client_comp 
        FROM public.clients 
        WHERE id = (COALESCE(p_payload->>'parentClientId', p_payload->>'parent_client_id'))::integer;

        IF v_parent_client_comp IS NULL OR v_parent_client_comp != v_company_id THEN
          RAISE EXCEPTION 'Parent client does not belong to authorized company %', v_company_id USING ERRCODE = '42501';
        END IF;
      END IF;

      INSERT INTO public.brands (
        company_id, name, parent_client_id, parent_brand, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        (COALESCE(p_payload->>'parentClientId', p_payload->>'parent_client_id'))::integer,
        NULLIF(TRIM(COALESCE(p_payload->>'parentBrand', p_payload->>'parent_brand', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(brands.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.brands WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Brand % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.brands SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        parent_client_id = COALESCE((p_payload->>'parentClientId')::integer, (p_payload->>'parent_client_id')::integer, parent_client_id),
        parent_brand = CASE WHEN p_payload ? 'parentBrand' OR p_payload ? 'parent_brand' THEN NULLIF(TRIM(COALESCE(p_payload->>'parentBrand', p_payload->>'parent_brand')), '') ELSE parent_brand END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(brands.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.brands WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Brand % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.stores WHERE brand_id = p_id LIMIT 1) THEN
        RAISE EXCEPTION 'Brand has linked stores. Remove them first.' USING ERRCODE = '23503';
      END IF;
      IF EXISTS (SELECT 1 FROM public.estimates WHERE brand_id = p_id LIMIT 1) THEN
        RAISE EXCEPTION 'Brand has linked estimates. Remove them first.' USING ERRCODE = '23503';
      END IF;

      DELETE FROM public.brands WHERE id = p_id AND company_id = v_company_id;
      RETURN jsonb_build_object('message', 'Brand deleted.');
    END IF;

  -- ── STORES ──────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'stores' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.stores (
        company_id, client_id, brand_id, name, location, address,
        contact_person, contact_phone, store_code, sap_code, city, state, state_code,
        region_zone, contact, is_active
      )
      VALUES (
        v_company_id,
        (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer,
        (COALESCE(p_payload->>'brandId', p_payload->>'brand_id'))::integer,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'location', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'address', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPhone', p_payload->>'contact_phone', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'storeCode', p_payload->>'store_code', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'sapCode', p_payload->>'sap_code', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'city', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'state', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'regionZone', p_payload->>'region_zone', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contact', '')), ''),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(stores.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.stores WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Store % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.stores SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        client_id = COALESCE((p_payload->>'clientId')::integer, (p_payload->>'client_id')::integer, client_id),
        brand_id = COALESCE((p_payload->>'brandId')::integer, (p_payload->>'brand_id')::integer, brand_id),
        location = CASE WHEN p_payload ? 'location' THEN NULLIF(TRIM(p_payload->>'location'), '') ELSE location END,
        address = CASE WHEN p_payload ? 'address' THEN NULLIF(TRIM(p_payload->>'address'), '') ELSE address END,
        contact_person = CASE WHEN p_payload ? 'contactPerson' OR p_payload ? 'contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person')), '') ELSE contact_person END,
        contact_phone = CASE WHEN p_payload ? 'contactPhone' OR p_payload ? 'contact_phone' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPhone', p_payload->>'contact_phone')), '') ELSE contact_phone END,
        store_code = CASE WHEN p_payload ? 'storeCode' OR p_payload ? 'store_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'storeCode', p_payload->>'store_code')), '') ELSE store_code END,
        sap_code = CASE WHEN p_payload ? 'sapCode' OR p_payload ? 'sap_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'sapCode', p_payload->>'sap_code')), '') ELSE sap_code END,
        city = CASE WHEN p_payload ? 'city' THEN NULLIF(TRIM(p_payload->>'city'), '') ELSE city END,
        state = CASE WHEN p_payload ? 'state' THEN NULLIF(TRIM(p_payload->>'state'), '') ELSE state END,
        state_code = CASE WHEN p_payload ? 'stateCode' OR p_payload ? 'state_code' THEN NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code')), '') ELSE state_code END,
        region_zone = CASE WHEN p_payload ? 'regionZone' OR p_payload ? 'region_zone' THEN NULLIF(TRIM(COALESCE(p_payload->>'regionZone', p_payload->>'region_zone')), '') ELSE region_zone END,
        contact = CASE WHEN p_payload ? 'contact' THEN NULLIF(TRIM(p_payload->>'contact'), '') ELSE contact END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(stores.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.stores WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Store % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.estimate_items WHERE store_id = p_id LIMIT 1) THEN
        UPDATE public.stores SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Store has estimate items — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.stores WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Store deleted.');
      END IF;
    END IF;

  -- ── PRODUCTS ────────────────────────────────────────────────────────────────
  ELSIF p_entity = 'products' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.products (
        company_id, name, category, unit, rate, description, hsn_sac,
        is_standard, calculation_type, gst_percent, default_specification,
        warranty, material_code_id, is_active
      )
      VALUES (
        v_company_id,
        TRIM(COALESCE(p_payload->>'name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'category', '')), ''),
        COALESCE(p_payload->>'unit', 'sqft'),
        COALESCE((p_payload->>'rate')::numeric, 0),
        NULLIF(TRIM(COALESCE(p_payload->>'description', '')), ''),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'hsnSac', p_payload->>'hsn_sac', ''))), ''),
        COALESCE((p_payload->>'isStandard')::boolean, (p_payload->>'is_standard')::boolean, true),
        COALESCE(p_payload->>'calculationType', p_payload->>'calculation_type', 'sqft'),
        COALESCE((p_payload->>'gstPercent')::numeric, (p_payload->>'gst_percent')::numeric, 18),
        NULLIF(TRIM(COALESCE(p_payload->>'defaultSpecification', p_payload->>'default_specification', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'warranty', '')), ''),
        (COALESCE(p_payload->>'materialCodeId', p_payload->>'material_code_id'))::integer,
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(products.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.products WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Product % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.products SET
        name = COALESCE(NULLIF(TRIM(p_payload->>'name'), ''), name),
        category = CASE WHEN p_payload ? 'category' THEN NULLIF(TRIM(p_payload->>'category'), '') ELSE category END,
        unit = COALESCE(p_payload->>'unit', unit),
        rate = COALESCE((p_payload->>'rate')::numeric, rate),
        description = CASE WHEN p_payload ? 'description' THEN NULLIF(TRIM(p_payload->>'description'), '') ELSE description END,
        hsn_sac = CASE WHEN p_payload ? 'hsnSac' OR p_payload ? 'hsn_sac' THEN NULLIF(TRIM(UPPER(COALESCE(p_payload->>'hsnSac', p_payload->>'hsn_sac'))), '') ELSE hsn_sac END,
        is_standard = COALESCE((p_payload->>'isStandard')::boolean, (p_payload->>'is_standard')::boolean, is_standard),
        calculation_type = COALESCE(p_payload->>'calculationType', p_payload->>'calculation_type', calculation_type),
        gst_percent = COALESCE((p_payload->>'gstPercent')::numeric, (p_payload->>'gst_percent')::numeric, gst_percent),
        default_specification = CASE WHEN p_payload ? 'defaultSpecification' OR p_payload ? 'default_specification' THEN NULLIF(TRIM(COALESCE(p_payload->>'defaultSpecification', p_payload->>'default_specification')), '') ELSE default_specification END,
        warranty = CASE WHEN p_payload ? 'warranty' THEN NULLIF(TRIM(p_payload->>'warranty'), '') ELSE warranty END,
        material_code_id = CASE WHEN p_payload ? 'materialCodeId' OR p_payload ? 'material_code_id' THEN (COALESCE(p_payload->>'materialCodeId', p_payload->>'material_code_id'))::integer ELSE material_code_id END,
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(products.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.products WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Product % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      IF EXISTS (SELECT 1 FROM public.products WHERE id = p_id AND name = 'Installation Service') THEN
        RAISE EXCEPTION 'Cannot delete system service product.' USING ERRCODE = '42501';
      END IF;

      IF EXISTS (SELECT 1 FROM public.estimate_items WHERE product_id = p_id LIMIT 1) THEN
        UPDATE public.products SET is_active = false WHERE id = p_id;
        RETURN jsonb_build_object('soft', true, 'message', 'Product is used in estimates — deactivated instead of deleted.');
      ELSE
        DELETE FROM public.products WHERE id = p_id AND company_id = v_company_id;
        RETURN jsonb_build_object('soft', false, 'message', 'Product deleted.');
      END IF;
    END IF;

  -- ── BILLING PROFILES ────────────────────────────────────────────────────────
  ELSIF p_entity = 'billing-profiles' THEN
    IF p_method = 'POST' THEN
      -- Verify parent client belongs to v_company_id
      SELECT company_id INTO v_parent_client_comp 
      FROM public.clients 
      WHERE id = (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer;

      IF v_parent_client_comp IS NULL OR v_parent_client_comp != v_company_id THEN
        RAISE EXCEPTION 'Parent client does not belong to authorized company %', v_company_id USING ERRCODE = '42501';
      END IF;

      INSERT INTO public.client_billing_profiles (
        client_id, legal_company_name, branch_location_name, gstin, pan,
        state, state_code, billing_address, shipping_address,
        contact_person, mobile, email, is_default, is_active, notes
      )
      VALUES (
        (COALESCE(p_payload->>'clientId', p_payload->>'client_id'))::integer,
        TRIM(COALESCE(p_payload->>'legalCompanyName', p_payload->>'legal_company_name', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'branchLocationName', p_payload->>'branch_location_name', '')), ''),
        TRIM(UPPER(COALESCE(p_payload->>'gstin', ''))),
        NULLIF(TRIM(UPPER(COALESCE(p_payload->>'pan', ''))), ''),
        TRIM(COALESCE(p_payload->>'state', '')),
        TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code', '')),
        TRIM(COALESCE(p_payload->>'billingAddress', p_payload->>'billing_address', '')),
        NULLIF(TRIM(COALESCE(p_payload->>'shippingAddress', p_payload->>'shipping_address', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'mobile', '')), ''),
        NULLIF(TRIM(COALESCE(p_payload->>'email', '')), ''),
        COALESCE((p_payload->>'isDefault')::boolean, (p_payload->>'is_default')::boolean, false),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true),
        NULLIF(TRIM(COALESCE(p_payload->>'notes', '')), '')
      )
      RETURNING row_to_json(client_billing_profiles.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT c.company_id INTO v_existing_comp 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;

      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Billing profile % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.client_billing_profiles SET
        legal_company_name = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'legalCompanyName', p_payload->>'legal_company_name')), ''), legal_company_name),
        branch_location_name = CASE WHEN p_payload ? 'branchLocationName' OR p_payload ? 'branch_location_name' THEN NULLIF(TRIM(COALESCE(p_payload->>'branchLocationName', p_payload->>'branch_location_name')), '') ELSE branch_location_name END,
        gstin = COALESCE(NULLIF(TRIM(UPPER(p_payload->>'gstin')), ''), gstin),
        pan = CASE WHEN p_payload ? 'pan' THEN NULLIF(TRIM(UPPER(p_payload->>'pan')), '') ELSE pan END,
        state = COALESCE(NULLIF(TRIM(p_payload->>'state'), ''), state),
        state_code = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'stateCode', p_payload->>'state_code')), ''), state_code),
        billing_address = COALESCE(NULLIF(TRIM(COALESCE(p_payload->>'billingAddress', p_payload->>'billing_address')), ''), billing_address),
        shipping_address = CASE WHEN p_payload ? 'shippingAddress' OR p_payload ? 'shipping_address' THEN NULLIF(TRIM(COALESCE(p_payload->>'shippingAddress', p_payload->>'shipping_address')), '') ELSE shipping_address END,
        contact_person = CASE WHEN p_payload ? 'contactPerson' OR p_payload ? 'contact_person' THEN NULLIF(TRIM(COALESCE(p_payload->>'contactPerson', p_payload->>'contact_person')), '') ELSE contact_person END,
        mobile = CASE WHEN p_payload ? 'mobile' THEN NULLIF(TRIM(p_payload->>'mobile'), '') ELSE mobile END,
        email = CASE WHEN p_payload ? 'email' THEN NULLIF(TRIM(p_payload->>'email'), '') ELSE email END,
        is_default = COALESCE((p_payload->>'isDefault')::boolean, (p_payload->>'is_default')::boolean, is_default),
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active),
        notes = CASE WHEN p_payload ? 'notes' THEN NULLIF(TRIM(p_payload->>'notes'), '') ELSE notes END
      WHERE id = p_id
      RETURNING row_to_json(client_billing_profiles.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT c.company_id INTO v_existing_comp 
      FROM public.client_billing_profiles cbp 
      JOIN public.clients c ON c.id = cbp.client_id 
      WHERE cbp.id = p_id;

      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Billing profile % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      DELETE FROM public.client_billing_profiles WHERE id = p_id;
      RETURN jsonb_build_object('message', 'Billing profile deleted.');
    END IF;

  -- ── MATERIAL CODES ──────────────────────────────────────────────────────────
  ELSIF p_entity = 'material-codes' THEN
    IF p_method = 'POST' THEN
      INSERT INTO public.material_codes (
        company_id, code, description, uom, default_rate, is_active
      )
      VALUES (
        v_company_id,
        TRIM(UPPER(COALESCE(p_payload->>'code', ''))),
        NULLIF(TRIM(COALESCE(p_payload->>'description', '')), ''),
        COALESCE(p_payload->>'uom', 'sqft'),
        COALESCE((p_payload->>'defaultRate')::numeric, (p_payload->>'default_rate')::numeric, 0),
        COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, true)
      )
      RETURNING row_to_json(material_codes.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'PATCH' THEN
      SELECT company_id INTO v_existing_comp FROM public.material_codes WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Material code % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      UPDATE public.material_codes SET
        code = COALESCE(NULLIF(TRIM(UPPER(p_payload->>'code')), ''), code),
        description = CASE WHEN p_payload ? 'description' THEN NULLIF(TRIM(p_payload->>'description'), '') ELSE description END,
        uom = COALESCE(p_payload->>'uom', uom),
        default_rate = COALESCE((p_payload->>'defaultRate')::numeric, (p_payload->>'default_rate')::numeric, default_rate),
        is_active = COALESCE((p_payload->>'isActive')::boolean, (p_payload->>'is_active')::boolean, is_active)
      WHERE id = p_id AND company_id = v_company_id
      RETURNING row_to_json(material_codes.*)::jsonb INTO v_result;
      RETURN v_result;

    ELSIF p_method = 'DELETE' THEN
      SELECT company_id INTO v_existing_comp FROM public.material_codes WHERE id = p_id;
      IF v_existing_comp IS NULL OR v_existing_comp != v_company_id THEN
        RAISE EXCEPTION 'Material code % not found in company %', p_id, v_company_id USING ERRCODE = 'P0002';
      END IF;

      DELETE FROM public.material_codes WHERE id = p_id AND company_id = v_company_id;
      RETURN jsonb_build_object('message', 'Material code deleted.');
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown entity: %', p_entity USING ERRCODE = '22023';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_master_data_atomic(text, text, integer, jsonb) TO authenticated, service_role;

