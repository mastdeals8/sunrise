-- Backfill only the denormalized WCC store_code mirror from existing metadata.
-- WCC-before-PO behavior is unchanged; no WCC rows are created/deleted.
update public.delivery_challans
set store_code = trim(metadata->>'storeCode')
where status <> 'deleted'
  and coalesce(store_code, '') = ''
  and coalesce(metadata->>'storeCode', '') <> '';
