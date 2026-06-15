# Bot Integration Setup Guide

**Date:** 2026-05-24
**Scope:** Telegram Bot and WhatsApp Cloud API integration for Sunrise Media ERP

---

## Audit pass — current live status (verified by `scripts/audit-api-tests.mjs`)

- Telegram bot settings (`GET /api/automation/telegram`) — returns `botToken: null` when unset; on set, returns masked `"••••" + last4` only. Raw token NEVER returned to the client. ✓
- WhatsApp settings (`GET /api/automation/whatsapp`) — same masking. ✓
- WhatsApp webhook verify (`GET /api/webhook/whatsapp`) — returns the challenge on correct `verify_token`, 403 on wrong token. ✓
- Telegram inbound webhook (`POST /api/webhook/telegram`) — logged into `webhook_logs`; photo/document payloads route into `bot_upload_inbox` with `status="unlinked"`. ✓
- WhatsApp inbound webhook (`POST /api/webhook/whatsapp`) — same flow.
- Bot inbox listing (`GET /api/bot-inbox`) — admin/manager only. ✓
- Webhook logs (`GET /api/automation/logs/:platform`) — last 100, admin only. ✓

The 4 bot/automation tests in the smoke suite all pass.

---

## What Is Live Now

| Feature | Status | Notes |
|---|---|---|
| Telegram bot settings screen | ✅ Live | `/automation/telegram` |
| WhatsApp API settings screen | ✅ Live | `/automation/whatsapp` |
| Bot Upload Inbox | ✅ Live | `/automation/inbox` |
| Telegram webhook endpoint | ✅ Live | `POST /api/webhook/telegram` |
| WhatsApp webhook verify | ✅ Live | `GET /api/webhook/whatsapp` |
| WhatsApp inbound messages | ✅ Live | `POST /api/webhook/whatsapp` |
| Webhook logs (per platform) | ✅ Live | `GET /api/automation/logs/:platform` |
| Inbound media → bot inbox | ✅ Live | Photo/document from Telegram or WhatsApp saved to `bot_upload_inbox` |
| Admin manual mapping | ✅ Live | Link inbox item to client, estimate, upload type |
| Ignore/status management | ✅ Live | Mark as ignored or mapped |

---

## What Needs Real Credentials

| Step | Requirement |
|---|---|
| Telegram messages actually received | Real bot token from @BotFather + public HTTPS URL for webhook |
| WhatsApp messages actually received | Meta Business account + approved phone number + access token |
| Media file download | Access token required to call Meta Graph API to download media |
| Telegram file download | Bot token required to call Telegram Bot API |

**The app runs fully without credentials.** No routes fail if token is missing. Bot is disabled by default.

---

## Telegram Setup (Step by Step)

### 1. Create Your Bot
1. Open Telegram → Search `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., `Sunrise Media ERP`)
4. Choose a username (e.g., `sunrise_erp_bot`) — must end in `bot`
5. Copy the token provided (format: `1234567890:ABCdef...`)

### 2. Configure in ERP
1. Go to **Automation → Telegram Bot** in the sidebar
2. Paste the token in the Bot Token field
3. Enter the bot username (e.g., `@sunrise_erp_bot`)
4. Enable the toggle
5. Save

### 3. Set the Webhook
The app must be deployed on a public HTTPS URL (not `localhost`).

Run this URL in your browser or via curl (replace `TOKEN` and `YOUR_DOMAIN`):
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_DOMAIN/api/webhook/telegram
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 4. Link Staff Users
Staff send photos/documents to the bot:
- The bot accepts any incoming media
- Photos and documents are saved to the **Bot Upload Inbox** automatically
- Admin maps each upload to the correct project/estimate

### 5. Bot Commands (for future expansion)
| Command | Description |
|---|---|
| `/start` | Welcome message, shows how to upload |
| `/upload` | Prompts for upload type |
| `/photo` | Upload installation photo |
| `/po` | Upload PO document |
| `/signedchallan` | Upload signed DC |
| `/transport` | Upload transport receipt |

*Note: Command handler logic can be added in `POST /api/webhook/telegram` in `server/routes.ts`*

### Local Development Testing
Use **ngrok** to expose your local server:
```bash
ngrok http 5088
```
Use the HTTPS URL from ngrok as the webhook URL.

---

## WhatsApp Cloud API Setup (Step by Step)

### Prerequisites
- Meta Business account (business.facebook.com)
- A phone number not linked to any existing WhatsApp account
- App reviewed by Meta for WhatsApp product access

### 1. Create Meta Developer App
1. Go to `developers.facebook.com` → My Apps → Create App
2. Select "Business" app type
3. Add the **WhatsApp** product to your app

### 2. Get API Credentials
From the WhatsApp > Getting Started panel:
- **Phone Number ID**: Copy from the number row
- **WABA ID**: Copy from the WhatsApp Business Account row
- **Access Token**: Generate a System User Token (for production) or use the temp token for testing

### 3. Configure Webhook in Meta
In Meta App Dashboard → WhatsApp → Configuration:
- **Callback URL**: `https://YOUR_DOMAIN/api/webhook/whatsapp`
- **Verify Token**: Set any string (e.g., `sunrise_verify_2026`)
- Subscribe to: `messages` webhook field

### 4. Configure in ERP
1. Go to **Automation → WhatsApp API** in the sidebar
2. Enter Phone Number ID, WABA ID
3. Paste the access token
4. Enter the same verify token you used in Meta Dashboard
5. Enable the toggle
6. Save

### 5. Inbound Media Flow
When a WhatsApp user sends an image or document:
1. Meta calls your webhook
2. The webhook handler extracts sender, media type, caption
3. Item is saved to `bot_upload_inbox` with `status = "unlinked"`
4. Admin maps it to a project in **Bot Upload Inbox**

*Note: Full media download (fetching the actual file bytes) requires calling the Meta Graph API with the access token — this is partially scaffolded and can be completed when credentials are available.*

---

## Bot Upload Inbox Usage

**Location:** Sidebar → Automation → Bot Upload Inbox

**Workflow:**
1. Unlinked uploads appear in the **Unlinked** tab
2. Click **Map** on any item
3. Select:
   - Upload type (PO, photo, signed challan, transport, WCC, extra)
   - Client
   - Estimate
4. Save — item moves to **Mapped**
5. Ignore items that are spam/irrelevant

---

## Database Tables

| Table | Purpose |
|---|---|
| `bot_settings` | Stores platform config (token masked), enabled/disabled |
| `bot_upload_inbox` | All inbound media items, link status |
| `webhook_logs` | Log of every inbound webhook call |

---

## Security Notes

- Bot token / WhatsApp access token is **never returned to the frontend** — only last 4 characters shown
- Webhook endpoints do not require auth headers (Telegram/WhatsApp doesn't send them)
- Telegram endpoint is protected by checking `enabled` flag in `bot_settings`
- WhatsApp verify endpoint checks the `verify_token` from `bot_settings`
- If token is missing or bot is disabled, all webhook calls return `200 OK` (silent ignore) to prevent retry storms

---

## Files Created/Modified

| File | Change |
|---|---|
| `shared/schema.ts` | Added `botSettings`, `botUploadInbox`, `webhookLogs` tables |
| `server/routes.ts` | Added automation routes, telegram/whatsapp webhook handlers |
| `client/src/pages/TelegramSettings.tsx` | New settings screen |
| `client/src/pages/WhatsAppSettings.tsx` | New settings screen |
| `client/src/pages/BotInbox.tsx` | New Bot Upload Inbox screen |
| `client/src/App.tsx` | Added Automation section to sidebar, new routes |
