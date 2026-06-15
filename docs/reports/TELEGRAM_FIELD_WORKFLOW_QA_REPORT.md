# Telegram / Field Workflow Sprint QA Report

Date: 2026-06-11

## Scope

Implemented the upload-only field workflow:

`Telegram Message -> Open Project Link -> View Assigned Stores -> Select Store -> Upload Photos -> Upload Signed WCC / Delivery Challan -> Done`

Not included:

- Telegram Bot API outbound sending with bot token
- WhatsApp sharing
- Invoice readiness
- Payment workflow
- New document system
- Estimate Builder changes
- WCC/DC template changes

Estimate remains the master project reference. Field links point to the estimate and allowed store codes.

## Database Changes

### `field_access_links`

Additive table created:

- `id`
- `estimate_id`
- `token_hash`
- `token_prefix`
- `channel`
- `recipient_name`
- `recipient_contact`
- `allowed_store_codes`
- `allowed_document_types`
- `permissions`
- `expires_at`
- `revoked_at`
- `revoked_by`
- `created_by`
- `last_used_at`
- `use_count`
- `metadata`
- `created_at`
- `updated_at`

Indexes:

- `idx_field_access_links_estimate`
- `idx_field_access_links_expiry`
- `idx_field_access_links_channel`

Security note:

- Raw field token is never stored.
- Server stores only SHA-256 `token_hash` plus a short `token_prefix` for support/debugging.
- Create-link API no longer returns `tokenHash`.

## Backend APIs

### Authenticated ERP APIs

```text
POST /api/operations/field-access-links
GET /api/operations/field-access-links?estimateId=:id
POST /api/operations/field-access-links/:id/revoke
```

Allowed roles:

- `admin`
- `manager`
- `production`

### Public Field APIs

```text
GET /api/field/:token
POST /api/field/:token/upload
```

These routes do not use ERP login. Access is controlled by the signed random token.

Public payload exposes only:

- Estimate ID
- Estimate number
- Estimate title
- Estimate status
- Assigned stores
- Store status/counts
- Existing document labels/versions/upload dates

Public payload does not expose:

- Estimate items
- Rates
- Amounts
- Client billing data
- Invoices
- Payments
- Admin/users
- ERP navigation

## Frontend Changes

### Mobile Field Page

Created:

- `client/src/pages/FieldProjectUpload.tsx`

Route:

- `/field/:token`

Behavior:

- Bypasses ERP login and shell.
- Mobile-first layout.
- Shows only assigned stores.
- Store detail supports upload-only actions:
  - Photos
  - Signed WCC
  - Delivery Challan
- Uploads write to existing `execution_documents`.

### Execution Workspace Link Generator

Updated:

- `client/src/pages/operations/components/EstimatePreview.tsx`

Added under Execution:

- Generate Link
- Copy
- Open
- Telegram share button

This creates a secure upload-only link for the current estimate and execution stores.

## Upload Mapping

Field uploads attach directly to:

| Field | Source |
|---|---|
| Estimate | `field_access_links.estimate_id` |
| Store | `storeCode` selected in mobile page |
| Document type | `photo`, `signed_wcc`, or `signed_dc` |
| Document table | `execution_documents` |
| Upload source | `uploaded_via = telegram` for Telegram links |

For signed WCC/DC:

- Existing active signed proof for the same WCC/DC owner is marked `replaced`.
- New upload becomes the only active signed proof.
- Legacy `delivery_challans.signed_challan_path` is synchronized for compatibility.

For photos:

- New photo document is inserted into `execution_documents`.
- Existing WCC metadata photos are also appended for WCC print compatibility.

## QA Record

| Field | Value |
|---|---|
| Estimate | `SM/E/26-27/201` |
| Estimate ID | `2` |
| Store | `103298` - Laxmi Road, Pune |
| WCC/DC ID | `5` |
| Channel | `telegram` |

## Mobile Workflow Demo

Screenshots:

- `screenshots/telegram_field_workflow/01-mobile-open-project-link.png`
- `screenshots/telegram_field_workflow/02-mobile-store-detail.png`
- `screenshots/telegram_field_workflow/03-mobile-photo-uploaded.png`
- `screenshots/telegram_field_workflow/04-mobile-signed-wcc-uploaded.png`
- `screenshots/telegram_field_workflow/05-admin-execution-field-link-panel.png`
- `screenshots/telegram_field_workflow/06-admin-generated-telegram-link.png`
- `screenshots/telegram_field_workflow/field-workflow-result.json`

Demo results:

| Step | Result |
|---|---|
| Generate field link from Execution workspace | Passed |
| Open `/field/:token` without ERP login | Passed |
| View assigned store `103298` only | Passed |
| Select store | Passed |
| Upload photo | Passed |
| Upload signed WCC | Passed |
| Documents saved in `execution_documents` | Passed |
| Uploaded via marked as `telegram` | Passed |
| Final store status remains `completed` | Passed |

Final public stats for store `103298` after mobile demo:

| Metric | Value |
|---|---:|
| Photos | 4 |
| Active signed WCC | 1 |
| Signed DC | 0 |
| WCC | 1 |
| DC | 0 |

Focused signed-WCC replacement verification:

- Field upload created document `id 21`.
- Previous active signed WCC was marked `replaced`.
- Active signed WCC count remained `1`.
- New signed WCC version became `4`.

## Security Review

Passed:

- Field route bypasses ERP auth only for `/field/:token`.
- ERP APIs still return `401` without bearer token.
- Field token hash is not returned by create-link API.
- Raw token is not stored in database.
- Wrong store upload blocked with `403`.
- Invalid document type upload blocked.
- Link supports expiry.
- Link supports revoke.
- Field page has no sidebar, no ERP navigation, no estimate pricing, no invoice/payment/admin data.

Security test results:

| Test | Result |
|---|---|
| Create link response exposes token hash | Passed: false |
| Upload to unassigned store `102293` | Passed: `403` |
| Upload invalid document type `po` | Passed: blocked |
| Access `/api/operations/estimates` without ERP token | Passed: `401` |

## QA Commands

- `npm run check` passed.
- Browser QA used Chromium mobile viewport `390x844`.
- API/database verification used actual Supabase-backed records.

## Remaining Gaps

1. Telegram Bot API outbound message sending is not yet connected. Current sprint provides the secure link and Telegram share URL.
2. WhatsApp sharing is not implemented in this sprint.
3. Field link activity log is limited to `use_count`, `last_used_at`, and document metadata. A richer `execution_activity_log` remains future work.
4. Mobile version history/replace UX is intentionally not exposed; field users upload only.
5. Multi-store field assignment is supported by the data model and API, but demo used one assigned store.
6. Link revocation UI is API-ready but not yet surfaced in the Execution workspace.

## Sprint Status

Telegram / Field Workflow Sprint is complete for secure upload-only field links and mobile field uploads.

Do not start invoice or payment work from this sprint. Next recommended sprint: outbound Telegram bot message delivery and field activity log.
