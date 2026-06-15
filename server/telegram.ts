import { db } from "./db";
import { botSettings, telegramDeliveries } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Phase 5A: Telegram bot delivery service.
 *
 * Reads the bot token from bot_settings (server-side only — NEVER returned to
 * client). Sends via the Telegram Bot API sendMessage method. Designed to be
 * mockable for QA without a live token: set TELEGRAM_MOCK=1 to short-circuit
 * the network call and simulate success.
 *
 * SECURITY: bot token and token hashes are never logged or returned.
 */

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Chat-ID discovery: reads recent bot updates (getUpdates) so an admin can
 * find the chat IDs of people who have messaged the bot. This is the standard
 * Telegram onboarding flow — a user sends /start to the bot, then the admin
 * reads their chat.id here and saves it to that user's profile.
 * Returns a de-duplicated list of {chatId, name, username, lastText}.
 * Mockable for QA via TELEGRAM_MOCK.
 */
export const discoverChats = async (
  token: string | null
): Promise<{ ok: true; chats: Array<{ chatId: string; name: string; username?: string; lastText?: string }> } | { ok: false; error: string }> => {
  if (process.env.TELEGRAM_MOCK === "1") {
    return {
      ok: true,
      chats: [
        { chatId: "111222333", name: "Installer Demo", username: "installer_demo", lastText: "/start" },
        { chatId: "444555666", name: "Site Lead Demo", username: "sitelead_demo", lastText: "hi" },
      ],
    };
  }
  if (!token) return { ok: false, error: "Telegram bot is not configured or disabled" };
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/getUpdates`, { method: "GET" });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.description || `HTTP ${res.status}` };
    const byChat = new Map<string, { chatId: string; name: string; username?: string; lastText?: string }>();
    for (const upd of data.result || []) {
      const msg = upd.message || upd.edited_message || upd.channel_post;
      const chat = msg?.chat;
      if (!chat?.id) continue;
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || chat.username || String(chat.id);
      byChat.set(String(chat.id), {
        chatId: String(chat.id),
        name,
        username: chat.username,
        lastText: msg.text,
      });
    }
    return { ok: true, chats: Array.from(byChat.values()) };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" };
  }
};

export const getBotToken = async (): Promise<string | null> => {
  const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "telegram")).limit(1);
  if (!row || !row.enabled) return null;
  return row.botToken || null;
};

export type SendResult =
  | { ok: true; messageId: string; mock?: boolean }
  | { ok: false; error: string; mock?: boolean };

/**
 * Low-level send. Returns a structured result; never throws.
 * Token is passed in by the caller (already fetched) so this stays pure.
 */
export const sendTelegramMessage = async (
  token: string | null,
  chatId: string,
  text: string
): Promise<SendResult> => {
  // Mock mode for QA without live credentials.
  if (process.env.TELEGRAM_MOCK === "1") {
    if (!chatId) return { ok: false, error: "Missing chat id", mock: true };
    return { ok: true, messageId: `mock-${Date.now()}`, mock: true };
  }

  if (!token) return { ok: false, error: "Telegram bot is not configured or disabled" };
  if (!chatId) return { ok: false, error: "Recipient has no Telegram chat id" };

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      // Telegram returns { ok:false, description: "..." }
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: String(data.result?.message_id ?? "") };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" };
  }
};

/**
 * Build the standard field-link delivery message (exact format from brief).
 */
export const buildDeliveryMessage = (opts: {
  estimateNumber: string;
  storeCount: number;
  url: string;
  expiresAt: Date | string;
}): string => {
  const expiry = new Date(opts.expiresAt).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return [
    `Project: ${opts.estimateNumber}`,
    `Stores: ${opts.storeCount}`,
    ``,
    `Upload Photos:`,
    opts.url,
    ``,
    `Upload Signed WCC:`,
    opts.url,
    ``,
    `Expiry:`,
    expiry,
  ].join("\n");
};

/**
 * Send a delivery row (pending → sent/failed) and persist the outcome.
 * Used by both initial send and retry. Returns the updated row.
 */
export const dispatchDelivery = async (deliveryId: number): Promise<any> => {
  const [delivery] = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.id, deliveryId)).limit(1);
  if (!delivery) throw new Error("Delivery not found");

  const token = await getBotToken();
  const result = await sendTelegramMessage(token, delivery.chatId || "", delivery.message || "");

  const update = result.ok
    ? { status: "sent" as const, telegramMessageId: result.messageId, sentAt: new Date(), error: null }
    : { status: "failed" as const, error: result.error, retryCount: Number(delivery.retryCount || 0) };

  const [updated] = await db.update(telegramDeliveries).set(update).where(eq(telegramDeliveries.id, deliveryId)).returning();
  return updated;
};
