# TELEGRAM_BOT_DELIVERY_REPORT — Phase 5A — 13 June 2026

Replaces the Telegram share-intent with true ERP→Telegram bot delivery. All constraints honored: purely additive migration; field_access_links, readiness, execution, estimate/WCC/invoice/PO/numbering/document systems untouched.

## Schema (additive only — see migration SQL)
1. `users.telegram_chat_id text` (nullable) — Option A, recipients stay under one user system.
2. `telegram_deliveries` table — delivery log (status, error, retry_count, telegram_message_id, sent_at, links to estimate + field_link).
Both idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`). Indexes on estimate_id, field_link_id, status.

## What was built
**1. Recipient management (in existing User Management):** Telegram Chat ID field added to the Staff/user edit form; saved via existing `PUT /api/users/:id` (field allow-listed). Any user (installer/manager/production/admin) with a chat ID becomes a valid recipient.

**2. Bot send** — `POST /api/operations/telegram/send`: resolves recipient (must be a user with a chat ID), builds the exact brief message format, creates a `pending` delivery row, dispatches via Telegram Bot API `sendMessage`, records outcome. Message format (verified):
```
Project: {EstimateNumber}
Stores: {Count}

Upload Photos:
{Field Link}

Upload Signed WCC:
{Field Link}

Expiry:
{Date}
```
**3. Delivery status** — pending → sent / failed (delivered-state ready via telegram_message_id when webhook receipts are wired). Surfaced per-link and in message history.

**4. Message log** (per project) — `GET /api/operations/telegram/deliveries?estimateId=`: sent-to, date, status, retry count, with retry buttons. Rendered in FieldLinkManager.

**5. Retry** — `POST /api/operations/telegram/deliveries/:id/retry`: bumps retry_count, re-dispatches. Verified failed→sent.

**6. Security** — bot token read server-side only from bot_settings, never returned (existing `••••last4` masking preserved); token hashes never exposed. Verified: no token/hash in any response body.

## QA evidence
### Verified by mock (TELEGRAM_MOCK=1) — full flow, live server + Postgres:
- Set chat ID via User Management → 200, reflected in /api/users ✓
- Generate link → Send bot → delivery status `sent` ✓
- Message body matches required format exactly ✓
- Open /field/:token → 200, usage incremented ✓
- Upload photo → 201, upload signed WCC → 201 ✓
- Delivery log shows sent + retry available ✓
- Failure path: recipient without chat ID → 400 "Recipient has no Telegram chat ID set in their profile" ✓
- Retry failed delivery → status sent, retryCount incremented, error cleared ✓
- Security: no token/hash leak ✓

### Requires live token validation (cannot verify without your credentials):
- Actual message arrival on a real Telegram device.
- Real chat_id resolution / "chat not found" handling from Telegram.
- Telegram delivery receipts (the "delivered" state) — needs a real bot + webhook.
To validate live: set a real `botToken` in bot_settings (Telegram settings UI), put a real chat ID on a user, unset TELEGRAM_MOCK, and run the same flow. The send path already targets `https://api.telegram.org/bot{token}/sendMessage`.

## Files changed
NEW: server/telegram.ts, scripts/migrations/2026-06-13-telegram-delivery.sql
MODIFIED: shared/schema.ts (users.telegramChatId + telegram_deliveries), server/routes.ts (3 endpoints + telegramChatId allow-listed in user update), server/indexes.ts, client/src/components/FieldLinkManager.tsx (recipient picker + delivery log + retry, share-intent removed), client/src/pages/Staff.tsx (chat ID field)
