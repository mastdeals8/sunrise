# TELEGRAM LIVE-TEST RUNBOOK (items 1–3 — requires a human + real Telegram)
These three steps cannot be automated by Claude: they need a real bot token, a real phone, and a real person messaging the bot. Everything is ready in code; this is the ~15-minute manual validation.

## One-time setup
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **bot token** (looks like `123456789:AAH...`).
2. In Sunrise ERP → **Telegram Settings**, paste the bot token and set platform enabled = true. (Stored in bot_settings; never shown back in full.)
3. Make sure the server is running WITHOUT `TELEGRAM_MOCK` (unset it) so real API calls go out.

## Item 3 — Chat ID discovery workflow
4. On the phone you want to receive messages: open the bot (t.me/your_bot_username) and tap **Start** / send any message.
5. In the ERP, call the discovery endpoint (or its UI button if wired):
   ```
   GET /api/operations/telegram/discover-chats     (admin/manager)
   ```
   It returns the chat IDs of everyone who messaged the bot, e.g. `[{ "chatId": "8123456", "name": "Rohit", "lastText": "/start" }]`.
6. Copy that chatId into the user's profile → **User Management → edit user → Telegram Chat ID → Save**.
   ✅ PASS = the chat ID appears and saves on the user.

## Item 1 + 2 — Real send + delivery on a phone
7. In a project (Projects → expand "Field Upload Links") → **Generate Link** → **Send** → pick the user you just set up.
8. ✅ PASS = within seconds, the bot message arrives on that phone with the exact format:
   ```
   Project: SM/E/26-27/NNN
   Stores: N
   Upload Photos:
   https://.../field/<token>
   Upload Signed WCC:
   https://.../field/<token>
   Expiry:
   <date>
   ```
9. In the ERP delivery log, the row shows **status = sent** (and a Telegram message id).

## Failure / retry validation (live)
10. Temporarily clear a user's chat ID and Send → expect **400 "Recipient has no Telegram chat ID"**.
11. Put an invalid chat ID (e.g. `999`) and Send → delivery row shows **failed** with Telegram's error ("chat not found"). Click **Retry** after fixing the ID → status flips to **sent**.

## What "done" looks like
- Message physically received on the phone (item 2) ✓
- Discovery returned a real chat id you saved (item 3) ✓
- Live token send recorded status=sent (item 1) ✓
If any step errors, the delivery row's `error` column carries Telegram's exact message — paste it back and I'll diagnose.
