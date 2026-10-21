import { db } from "./db";
import {
  botSettings,
  telegramDeliveries,
  users,
  fieldAccessLinks,
  estimates,
  clients,
  stores,
  executionDocuments,
  executionStores,
  botUploadInbox,
  webhookLogs,
  deliveryChallans,
  companies,
  companyUsers,
} from "@shared/schema";
import { eq, and, desc, sql, isNull, gt } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Telegram Bot Integration Service for Sunrise Media ERP.
 *
 * Implements end-to-end field photo and delivery challan evidence workflow:
 * 1. Administrator contact registration & project assignment.
 * 2. Unknown user /start contact verification (request_contact: true).
 * 3. Administrator approval/rejection via private Telegram notification with inline buttons.
 * 4. Project selection by authorized Telegram identity.
 * 5. Evidence upload (Installation photos, Delivery Challan photos, Other documents).
 * 6. Storage in executionDocuments and botUploadInbox with deduplication & company isolation.
 *
 * Designed to be testable with TELEGRAM_MOCK=1 without external network calls.
 * SECURITY: Bot token and webhook secrets are never returned to frontend.
 */

const TELEGRAM_API = "https://api.telegram.org";

// ── In-Memory Session & Deduplication Caches ──
export interface TelegramUserSession {
  state: "IDLE" | "MENU" | "AWAITING_CONTACT" | "PROJECT_SELECTED" | "AWAITING_PROJECT_SELECTION" | "UPLOADING";
  selectedEstimateId?: number;
  uploadType?: "photo" | "signed_dc" | "transport_receipt" | "dc" | "extra";
  pendingUploadType?: "photo" | "signed_dc" | "transport_receipt";
  lastInteraction: number;
}

const userSessions = new Map<string, TelegramUserSession>();
const processedUpdates = new Map<number, number>(); // update_id -> timestamp
const mediaGroupDebounce = new Map<string, { count: number; timer?: any }>();

export const getUserSession = (chatId: string): TelegramUserSession => {
  const existing = userSessions.get(chatId);
  if (existing) return existing;
  const init: TelegramUserSession = { state: "IDLE", lastInteraction: Date.now() };
  userSessions.set(chatId, init);
  return init;
};

export const setUserSession = (chatId: string, update: Partial<TelegramUserSession>) => {
  const current = getUserSession(chatId);
  userSessions.set(chatId, { ...current, ...update, lastInteraction: Date.now() });
};

export const clearUserSession = (chatId: string) => {
  userSessions.set(chatId, { state: "IDLE", lastInteraction: Date.now() });
};

// ── Token & Settings Helpers ──
export const getBotToken = async (): Promise<string | null> => {
  const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "telegram")).limit(1);
  if (!row || !row.enabled) return null;
  return row.botToken || null;
};

export interface TelegramAccessRequest {
  id: string;
  chatId: string;
  name: string;
  phone: string;
  username?: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
}

export const getTelegramSettings = async () => {
  const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "telegram")).limit(1);
  if (!row) {
    return {
      row: null,
      token: process.env.TELEGRAM_BOT_TOKEN || null,
      enabled: false,
      botUsername: null,
      webhookUrl: null,
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID || null,
      adminChatVerified: false,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
      accessRequests: [] as TelegramAccessRequest[],
    };
  }
  const settings = (row.settings as any) || {};
  return {
    row,
    token: row.botToken || process.env.TELEGRAM_BOT_TOKEN || null,
    enabled: !!row.enabled,
    botUsername: row.botUsername,
    webhookUrl: row.webhookUrl,
    adminChatId: settings.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID || null,
    adminChatVerified: !!settings.adminChatVerified,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || settings.webhookSecret || "",
    accessRequests: Array.isArray(settings.accessRequests) ? (settings.accessRequests as TelegramAccessRequest[]) : [],
  };
};

export const saveTelegramSettings = async (update: {
  adminChatId?: string | null;
  adminChatVerified?: boolean;
  webhookSecret?: string;
  accessRequests?: TelegramAccessRequest[];
  enabled?: boolean;
  botUsername?: string;
  webhookUrl?: string;
  botToken?: string;
}) => {
  const existing = await db.select().from(botSettings).where(eq(botSettings.platform, "telegram")).limit(1);
  const currentSettings = (existing[0]?.settings as any) || {};
  const newSettings = { ...currentSettings };

  if (update.adminChatId !== undefined) newSettings.adminChatId = update.adminChatId;
  if (update.adminChatVerified !== undefined) newSettings.adminChatVerified = update.adminChatVerified;
  if (update.webhookSecret !== undefined) newSettings.webhookSecret = update.webhookSecret;
  if (update.accessRequests !== undefined) newSettings.accessRequests = update.accessRequests;

  const updateData: any = {
    platform: "telegram",
    settings: newSettings,
    updatedAt: new Date(),
  };
  if (update.enabled !== undefined) updateData.enabled = update.enabled;
  if (update.botUsername !== undefined) updateData.botUsername = update.botUsername;
  if (update.webhookUrl !== undefined) updateData.webhookUrl = update.webhookUrl;
  if (update.botToken !== undefined) updateData.botToken = update.botToken;

  if (existing.length) {
    await db.update(botSettings).set(updateData).where(eq(botSettings.platform, "telegram"));
  } else {
    updateData.enabled = updateData.enabled ?? false;
    await db.insert(botSettings).values(updateData);
  }
  return newSettings;
};

// ── Telegram Low-Level Messaging ──
export type SendResult =
  | { ok: true; messageId: string; mock?: boolean }
  | { ok: false; error: string; mock?: boolean };

export const sendTelegramMessage = async (
  token: string | null,
  chatId: string,
  text: string,
  options?: {
    reply_markup?: any;
    parse_mode?: string;
    disable_web_page_preview?: boolean;
  }
): Promise<SendResult> => {
  if (process.env.TELEGRAM_MOCK === "1") {
    if (!chatId) return { ok: false, error: "Missing chat id", mock: true };
    return { ok: true, messageId: `mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`, mock: true };
  }

  if (!token) return { ok: false, error: "Telegram bot is not configured or disabled" };
  if (!chatId) return { ok: false, error: "Recipient has no Telegram chat id" };

  try {
    const payload: any = {
      chat_id: chatId,
      text,
      disable_web_page_preview: options?.disable_web_page_preview ?? false,
    };
    if (options?.reply_markup) payload.reply_markup = options.reply_markup;
    if (options?.parse_mode) payload.parse_mode = options.parse_mode;

    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }
    return { ok: true, messageId: String(data.result?.message_id ?? "") };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" };
  }
};

export const answerCallbackQuery = async (
  token: string | null,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false
): Promise<boolean> => {
  if (process.env.TELEGRAM_MOCK === "1") return true;
  if (!token || !callbackQueryId) return false;
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || "",
        show_alert: showAlert,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    return !!data?.ok;
  } catch {
    return false;
  }
};

export const editMessageText = async (
  token: string | null,
  chatId: string,
  messageId: number | string,
  text: string,
  options?: { reply_markup?: any; parse_mode?: string }
): Promise<boolean> => {
  if (process.env.TELEGRAM_MOCK === "1") return true;
  if (!token || !chatId || !messageId) return false;
  try {
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text,
    };
    if (options?.reply_markup) payload.reply_markup = options.reply_markup;
    if (options?.parse_mode) payload.parse_mode = options.parse_mode;

    const res = await fetch(`${TELEGRAM_API}/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: any = await res.json().catch(() => ({}));
    return !!data?.ok;
  } catch {
    return false;
  }
};

// ── Company-Isolated Telegram Approver Helpers ──
export interface CompanyTelegramApprover {
  phone: string;
  chatId: string | null;
  username: string | null;
  fullName: string | null;
  status: "not_configured" | "awaiting_link" | "verified" | "error";
  linkCode: string | null;
  linkedAt: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
}

export const getCompanyTelegramApprover = async (companyId: number) => {
  const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!comp) throw new Error(`Company #${companyId} not found`);

  const settings = (comp.settings as any) || {};
  const rawApprover = settings.telegramApprover;

  const approver: CompanyTelegramApprover = {
    phone: rawApprover?.phone || "",
    chatId: rawApprover?.chatId || null,
    username: rawApprover?.username || null,
    fullName: rawApprover?.fullName || null,
    status: rawApprover?.status || (rawApprover?.phone ? (rawApprover?.chatId ? "verified" : "awaiting_link") : "not_configured"),
    linkCode: rawApprover?.linkCode || null,
    linkedAt: rawApprover?.linkedAt || null,
    lastTestedAt: rawApprover?.lastTestedAt || null,
    lastError: rawApprover?.lastError || null,
  };

  const botConfig = await getTelegramSettings();

  return {
    ...approver,
    companyId: comp.id,
    companyName: comp.displayName || comp.name,
    botUsername: botConfig.botUsername || "SunriseMediaErpBot",
  };
};

export const setCompanyTelegramApprover = async (companyId: number, rawPhone: string) => {
  const phone = rawPhone ? rawPhone.trim().replace(/[\s\-\(\)]/g, "") : "";
  if (!phone) {
    return await unlinkCompanyTelegramApprover(companyId);
  }
  const E164_REGEX = /^\+[1-9]\d{6,14}$/;
  if (!E164_REGEX.test(phone)) {
    throw new Error("Invalid phone format. Please use international format starting with '+' (e.g. +628123456789 or +919876543210).");
  }

  const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!comp) throw new Error(`Company #${companyId} not found`);

  const settings = (comp.settings as any) || {};
  const current = settings.telegramApprover || {};
  const isSamePhone = current.phone === phone;
  const isAlreadyVerified = isSamePhone && current.chatId && current.status === "verified";

  const linkCode = isAlreadyVerified ? current.linkCode : `TG-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const updatedApprover: CompanyTelegramApprover = {
    phone,
    chatId: isAlreadyVerified ? current.chatId : null,
    username: isAlreadyVerified ? current.username : null,
    fullName: isAlreadyVerified ? current.fullName : null,
    status: isAlreadyVerified ? "verified" : "awaiting_link",
    linkCode: isAlreadyVerified ? null : linkCode,
    linkedAt: isAlreadyVerified ? current.linkedAt : null,
    lastTestedAt: current.lastTestedAt || null,
    lastError: null,
  };

  const newSettings = {
    ...settings,
    telegramApprover: updatedApprover,
  };

  await db.update(companies).set({ settings: newSettings, updatedAt: new Date() }).where(eq(companies.id, companyId));

  const botConfig = await getTelegramSettings();
  return {
    ...updatedApprover,
    companyId: comp.id,
    companyName: comp.displayName || comp.name,
    botUsername: botConfig.botUsername || "SunriseMediaErpBot",
  };
};

export const unlinkCompanyTelegramApprover = async (companyId: number) => {
  const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!comp) throw new Error(`Company #${companyId} not found`);

  const settings = (comp.settings as any) || {};
  const updatedApprover: CompanyTelegramApprover = {
    phone: "",
    chatId: null,
    username: null,
    fullName: null,
    status: "not_configured",
    linkCode: null,
    linkedAt: null,
    lastTestedAt: null,
    lastError: null,
  };

  const newSettings = {
    ...settings,
    telegramApprover: updatedApprover,
  };

  await db.update(companies).set({ settings: newSettings, updatedAt: new Date() }).where(eq(companies.id, companyId));
  const botConfig = await getTelegramSettings();
  return {
    ...updatedApprover,
    companyId: comp.id,
    companyName: comp.displayName || comp.name,
    botUsername: botConfig.botUsername || "SunriseMediaErpBot",
  };
};

export const testCompanyTelegramApprover = async (companyId: number) => {
  const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!comp) throw new Error(`Company #${companyId} not found`);

  const settings = (comp.settings as any) || {};
  const approver = settings.telegramApprover as CompanyTelegramApprover | undefined;

  if (!approver || approver.status !== "verified" || !approver.chatId) {
    throw new Error("Cannot send test notification: Telegram approver is not verified for this company workspace.");
  }

  const botConfig = await getTelegramSettings();
  const testMessage = [
    `🧪 *Sunrise ERP — Telegram Notification Test*`,
    ``,
    `🏢 *Company Workspace:* ${comp.displayName || comp.name}`,
    `📱 *Registered Phone:* \`${approver.phone}\``,
    `🕒 *Sent At:* ${new Date().toLocaleString("en-IN")}`,
    ``,
    `✅ Your Telegram account is successfully verified and ready to receive field access requests with Approve/Reject actions.`,
  ].join("\n");

  const sendRes = await sendTelegramMessage(botConfig.token, String(approver.chatId), testMessage, {
    parse_mode: "Markdown",
  });

  if (!sendRes.ok) {
    const errorApprover = {
      ...approver,
      status: "error" as const,
      lastError: sendRes.error,
    };
    await db.update(companies).set({ settings: { ...settings, telegramApprover: errorApprover }, updatedAt: new Date() }).where(eq(companies.id, companyId));
    return { ok: false, error: sendRes.error };
  }

  const okApprover = {
    ...approver,
    status: "verified" as const,
    lastTestedAt: new Date().toISOString(),
    lastError: null,
  };
  await db.update(companies).set({ settings: { ...settings, telegramApprover: okApprover }, updatedAt: new Date() }).where(eq(companies.id, companyId));
  return { ok: true, messageId: sendRes.messageId };
};

// ── Media Download Helper ──
export const downloadTelegramFile = async (
  token: string | null,
  fileId: string,
  uploadDir: string
): Promise<{ ok: true; filePath: string; localPath: string; fileName: string; mimeType: string; fileSize: number } | { ok: false; error: string }> => {
  if (process.env.TELEGRAM_MOCK === "1") {
    const fileName = `mock-telegram-${fileId}.jpg`;
    const localPath = path.join(uploadDir, fileName);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    if (!fs.existsSync(localPath)) {
      fs.writeFileSync(localPath, Buffer.from("MOCK_TELEGRAM_EVIDENCE_IMAGE_PAYLOAD"));
    }
    return {
      ok: true,
      filePath: `/uploads/${fileName}`,
      localPath,
      fileName,
      mimeType: "image/jpeg",
      fileSize: 38,
    };
  }

  if (!token) return { ok: false, error: "Bot token is missing" };
  try {
    const fileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
    const fileData: any = await fileRes.json().catch(() => ({}));
    if (!fileRes.ok || !fileData?.ok || !fileData.result?.file_path) {
      return { ok: false, error: fileData?.description || "Unable to get Telegram file metadata" };
    }
    const remotePath = fileData.result.file_path;
    const ext = path.extname(remotePath) || ".jpg";
    const uniqueName = `telegram-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localPath = path.join(uploadDir, uniqueName);

    const downloadRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${remotePath}`);
    if (!downloadRes.ok) {
      return { ok: false, error: `Failed to download file stream: HTTP ${downloadRes.status}` };
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    await fs.promises.writeFile(localPath, buffer);

    let mimeType = "image/jpeg";
    if (ext === ".pdf") mimeType = "application/pdf";
    else if (ext === ".png") mimeType = "image/png";
    else if (ext === ".webp") mimeType = "image/webp";

    return {
      ok: true,
      filePath: `/uploads/${uniqueName}`,
      localPath,
      fileName: path.basename(remotePath) || uniqueName,
      mimeType,
      fileSize: buffer.length,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to download Telegram file" };
  }
};

// ── Project Assignment & Authorization Helpers ──
export const getUserAssignedProjects = async (chatId: string) => {
  const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
  if (!user || !user.isActive) return [];

  // Query active fieldAccessLinks assigned to this user
  const links = await db.select().from(fieldAccessLinks).where(
    and(
      sql`(${fieldAccessLinks.recipientContact} = ${chatId} OR ${fieldAccessLinks.metadata}->>'telegramChatId' = ${chatId} OR ${fieldAccessLinks.metadata}->>'userId' = ${String(user.id)})`,
      isNull(fieldAccessLinks.revokedAt),
      gt(fieldAccessLinks.expiresAt, new Date())
    )
  );

  if (!links.length) return [];

  const estimateIds = Array.from(new Set(links.map((l) => l.estimateId)));
  const assignedList: Array<{
    linkId: number;
    estimateId: number;
    estimateNumber: string;
    title: string;
    subject: string;
    clientName: string;
    storeName: string;
    storeCount: number;
    storeNames: string[];
    storeSummary: string;
  }> = [];

  for (const estId of estimateIds) {
    const link = links.find((l) => l.estimateId === estId);
    const [est] = await db.select().from(estimates).where(eq(estimates.id, estId)).limit(1);
    if (!est) continue;

    let clientName = "";
    if (est.clientId) {
      const [c] = await db.select().from(clients).where(eq(clients.id, est.clientId)).limit(1);
      if (c) clientName = c.name;
    }

    let storeNames: string[] = [];
    const execStores = await db.select().from(executionStores).where(eq(executionStores.estimateId, est.id));
    if (execStores.length > 0) {
      storeNames = execStores.map((s) => s.storeName || s.storeCode || "").filter(Boolean);
    }
    if (storeNames.length === 0 && est.storeId) {
      const [s] = await db.select().from(stores).where(eq(stores.id, est.storeId)).limit(1);
      if (s) storeNames = [s.name || s.storeCode || "Store"];
    }

    const storeCount = storeNames.length;
    let storeSummary = "Main Project";
    if (storeCount === 1) {
      storeSummary = `${storeNames[0]} — 1 store`;
    } else if (storeCount > 1) {
      storeSummary = `${storeNames.slice(0, 3).join(", ")}${storeCount > 3 ? "..." : ""} — ${storeCount} stores`;
    }

    assignedList.push({
      linkId: link ? link.id : 0,
      estimateId: est.id,
      estimateNumber: est.estimateNumber,
      title: est.title,
      subject: est.subject || "",
      clientName,
      storeName: storeNames[0] || "",
      storeCount,
      storeNames,
      storeSummary,
    });
  }
  return assignedList;
};

export const assignProjectToTelegramUser = async ({
  estimateId,
  userId,
  createdBy,
}: {
  estimateId: number;
  userId: number;
  createdBy?: number;
}) => {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Staff contact not found");
  const [est] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
  if (!est) throw new Error("Estimate not found");

  // Check if active assignment already exists
  const existing = await db
    .select()
    .from(fieldAccessLinks)
    .where(
      and(
        eq(fieldAccessLinks.estimateId, estimateId),
        sql`(${fieldAccessLinks.recipientContact} = ${user.telegramChatId || ""} OR ${fieldAccessLinks.metadata}->>'userId' = ${String(user.id)})`,
        isNull(fieldAccessLinks.revokedAt)
      )
    )
    .limit(1);

  if (existing.length) {
    return existing[0];
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const [created] = await db
    .insert(fieldAccessLinks)
    .values({
      estimateId,
      tokenHash,
      tokenPrefix: token.slice(0, 8),
      channel: "telegram",
      recipientName: user.name,
      recipientContact: user.telegramChatId || user.phone || null,
      allowedDocumentTypes: ["photo", "signed_dc", "extra"],
      expiresAt,
      createdBy: createdBy || null,
      metadata: {
        userId: user.id,
        telegramChatId: user.telegramChatId,
        assignedVia: "telegram_admin",
        estimateNumber: est.estimateNumber,
      },
    })
    .returning();

  return created;
};

export const revokeProjectAssignment = async (linkId: number, revokedBy?: number) => {
  const [updated] = await db
    .update(fieldAccessLinks)
    .set({ revokedAt: new Date(), revokedBy: revokedBy || null, updatedAt: new Date() })
    .where(eq(fieldAccessLinks.id, linkId))
    .returning();
  return updated;
};

// ── Webhook Handler & Bot State Engine ──
export const handleTelegramWebhook = async (payload: any, uploadDir: string): Promise<{ handled: boolean; action?: string; companyId?: number }> => {
  if (!payload) return { handled: false };

  // 1. Deduplication: reject repeated updates
  const updateId = payload.update_id;
  if (updateId) {
    if (processedUpdates.has(updateId)) {
      console.log(`[Telegram Bot] Ignoring duplicate update_id: ${updateId}`);
      return { handled: true, action: "duplicate_ignored" };
    }
    processedUpdates.set(updateId, Date.now());
    // Prune cache to keep under 10000 entries
    if (processedUpdates.size > 10000) {
      const cutoff = Date.now() - 3600000;
      for (const [k, v] of Array.from(processedUpdates.entries())) {
        if (v < cutoff) processedUpdates.delete(k);
      }
    }
  }

  const config = await getTelegramSettings();
  const botToken = config.token;

  // 2. Handle Callback Queries (Inline buttons)
  if (payload.callback_query) {
    const cb = payload.callback_query;
    const data = cb.data || "";
    const fromId = String(cb.from?.id);
    const cbId = cb.id;

    // A. Administrator Approval / Rejection
    if (data.startsWith("auth:approve:") || data.startsWith("auth:reject:")) {
      const isApprove = data.startsWith("auth:approve:");
      const parts = data.split(":");
      const targetChatId = parts[2];
      const targetCompanyId = parts[3] ? parseInt(parts[3], 10) : null;

      // Validate administrator identity
      let isAuthorized = false;
      let matchedCompanyName = "Sunrise Media ERP";

      if (targetCompanyId) {
        const [targetComp] = await db.select().from(companies).where(eq(companies.id, targetCompanyId)).limit(1);
        if (targetComp) {
          matchedCompanyName = targetComp.displayName || targetComp.name;
          const compApprover = (targetComp.settings as any)?.telegramApprover;
          if (compApprover && compApprover.status === "verified" && String(compApprover.chatId) === fromId) {
            isAuthorized = true;
          }
        }
      }

      // Check global adminChatId or DB admin user as fallback
      if (!isAuthorized) {
        const isConfiguredAdmin = config.adminChatId && String(config.adminChatId) === fromId;
        const [adminUser] = await db
          .select()
          .from(users)
          .where(and(eq(users.telegramChatId, fromId), eq(users.role, "admin"), eq(users.isActive, true)))
          .limit(1);
        if (isConfiguredAdmin || adminUser) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        await answerCallbackQuery(botToken, cbId, "⛔ Unauthorized: Only configured company administrators can approve requests.", true);
        return { handled: true, action: "auth_callback_unauthorized" };
      }

      // Find pending request in settings
      const requests = config.accessRequests;
      const targetReq = requests.find((r) => r.chatId === targetChatId && r.status === "pending");

      if (!targetReq) {
        await answerCallbackQuery(botToken, cbId, "⚠️ This request has already been processed or does not exist.", true);
        return { handled: true, action: "auth_callback_already_processed" };
      }

      // Update request state
      targetReq.status = isApprove ? "approved" : "rejected";
      targetReq.reviewedAt = new Date().toISOString();
      targetReq.reviewedBy = fromId;
      await saveTelegramSettings({ accessRequests: requests });

      if (isApprove) {
        // Link or create user in ERP users table
        let [matchedUser] = await db.select().from(users).where(eq(users.telegramChatId, targetChatId)).limit(1);

        if (!matchedUser) {
          // Check by phone
          const cleanPhone = targetReq.phone.replace(/[^0-9]/g, "").slice(-10);
          if (cleanPhone) {
            const byPhone = await db.select().from(users).where(sql`RIGHT(phone, 10) = ${cleanPhone}`).limit(1);
            if (byPhone.length) {
              matchedUser = byPhone[0];
              await db.update(users).set({ telegramChatId: targetChatId, isActive: true }).where(eq(users.id, matchedUser.id));
            }
          }
        }

        if (!matchedUser) {
          // Create new staff contact
          const [newUser] = await db
            .insert(users)
            .values({
              username: `tg_${targetChatId}`,
              email: `tg_${targetChatId}@sunrisemedia.local`,
              password: crypto.randomBytes(16).toString("hex"),
              name: targetReq.name,
              phone: targetReq.phone,
              role: "staff",
              telegramChatId: targetChatId,
              isActive: true,
              notes: `Registered via Telegram bot approval for ${matchedCompanyName}`,
            })
            .returning();
          matchedUser = newUser;
        } else {
          await db.update(users).set({ isActive: true }).where(eq(users.id, matchedUser.id));
        }

        // Add to companyUsers if workspace-specific
        if (targetCompanyId && matchedUser) {
          const [existingMembership] = await db
            .select()
            .from(companyUsers)
            .where(and(eq(companyUsers.userId, matchedUser.id), eq(companyUsers.companyId, targetCompanyId)))
            .limit(1);
          if (!existingMembership) {
            await db.insert(companyUsers).values({
              userId: matchedUser.id,
              companyId: targetCompanyId,
              role: "company_user",
              isDefault: true,
            });
          }
        }

        // Notify user
        await sendTelegramMessage(
          botToken,
          targetChatId,
          `🎉 *Access Approved!*\n\nWelcome to *${matchedCompanyName}*, *${targetReq.name}*.\nYour contact is now registered.\n\n⚠️ No projects are currently assigned to you. Once your supervisor assigns projects to you in Sunrise ERP, use /projects to begin uploading site photos and delivery challans.`,
          { parse_mode: "Markdown" }
        );

        // Edit Admin message
        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          `✅ *Approved:* Access granted for ${targetReq.name} (${targetReq.phone}) in ${matchedCompanyName}.\n🆔 Telegram ID: \`${targetChatId}\`\n\n📌 Note: Assign projects to this user via Sunrise ERP.`,
          { parse_mode: "Markdown" }
        );

        await answerCallbackQuery(botToken, cbId, `Approved access for ${targetReq.name}`);
      } else {
        // Rejected
        await sendTelegramMessage(
          botToken,
          targetChatId,
          `❌ *Access Request Not Approved*\n\nYour request to access Sunrise Media ERP (${matchedCompanyName}) was declined. Please contact your administrator if you believe this is in error.`,
          { parse_mode: "Markdown" }
        );

        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          `❌ *Rejected:* Access request for ${targetReq.name} (${targetReq.phone}) was declined for ${matchedCompanyName}.`,
          { parse_mode: "Markdown" }
        );

        await answerCallbackQuery(botToken, cbId, `Rejected access for ${targetReq.name}`);
      }
      return { handled: true, action: isApprove ? "approved_user" : "rejected_user" };
    }

    // B. Administrator Verification Callback
    if (data === "admin:verify") {
      await saveTelegramSettings({ adminChatId: fromId, adminChatVerified: true });
      await editMessageText(
        botToken,
        fromId,
        cb.message?.message_id,
        `🛡️ *Administrator Chat Verified!*\n\nChat ID: \`${fromId}\` is confirmed. You will now receive private Telegram approval requests whenever new field contacts request access.`,
        { parse_mode: "Markdown" }
      );
      await answerCallbackQuery(botToken, cbId, "Admin connection verified successfully!");
      return { handled: true, action: "admin_verified" };
    }

    // C. Menu Actions: menu:projects, menu:cat:photo, menu:cat:dc, menu:cat:transport
    if (data === "menu:projects") {
      const assigned = await getUserAssignedProjects(fromId);
      if (!assigned.length) {
        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          "📋 You have no active projects assigned. Contact your ERP administrator to assign projects to you."
        );
        await answerCallbackQuery(botToken, cbId);
        return { handled: true, action: "no_projects" };
      }

      const buttons = assigned.map((p) => [
        {
          text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
          callback_data: `proj:${p.estimateId}`,
        },
      ]);

      await editMessageText(
        botToken,
        fromId,
        cb.message?.message_id,
        "📋 *Your Assigned Projects*\n\nSelect a project below to proceed:",
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        }
      );
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "menu_projects_listed" };
    }

    if (data.startsWith("menu:cat:")) {
      const cat = data.replace("menu:cat:", "") as "photo" | "dc" | "transport";
      const catType = cat === "dc" ? "signed_dc" : cat === "transport" ? "transport_receipt" : "photo";
      const catLabel =
        cat === "dc"
          ? "Delivery Challan (DC) + Signed WCC proof"
          : cat === "transport"
          ? "Transportation Photo"
          : "Installation Photo";

      const assigned = await getUserAssignedProjects(fromId);
      if (!assigned.length) {
        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          "📋 You have no active projects assigned. Contact your ERP administrator to assign projects to you."
        );
        await answerCallbackQuery(botToken, cbId);
        return { handled: true, action: "no_projects" };
      }

      if (assigned.length === 1) {
        // Exactly one project assigned -> safe auto-select
        const singleProj = assigned[0];
        setUserSession(fromId, {
          state: "UPLOADING",
          selectedEstimateId: singleProj.estimateId,
          uploadType: catType,
          pendingUploadType: undefined,
        });

        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          `📸 *Ready for ${catLabel}*\nProject: *${singleProj.estimateNumber}* (${singleProj.subject || singleProj.title})\n\nPlease send your photo(s) or document now.`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🏁 Finish Upload", callback_data: "nav:finish" }],
                [{ text: "🔙 Switch Project", callback_data: "menu:projects" }],
                [{ text: "❌ Cancel", callback_data: "nav:cancel" }],
              ],
            },
          }
        );
        await answerCallbackQuery(botToken, cbId);
        return { handled: true, action: "category_single_project_auto_selected" };
      }

      // Multiple projects assigned -> ask which project
      setUserSession(fromId, {
        state: "AWAITING_PROJECT_SELECTION",
        pendingUploadType: catType,
      });

      const buttons = assigned.map((p) => [
        {
          text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
          callback_data: `proj:${p.estimateId}`,
        },
      ]);

      await editMessageText(
        botToken,
        fromId,
        cb.message?.message_id,
        `📸 You chose *${catLabel}*.\n\nWhich project does this upload belong to?\nSelect below:`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        }
      );
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "category_ask_project" };
    }

    // D. User Project Selection: proj:<estimateId>
    if (data.startsWith("proj:")) {
      const estimateId = parseInt(data.split(":")[1], 10);
      const assigned = await getUserAssignedProjects(fromId);
      const project = assigned.find((p) => p.estimateId === estimateId);

      if (!project) {
        await answerCallbackQuery(botToken, cbId, "⚠️ You are not assigned to this project or assignment was revoked.", true);
        return { handled: true, action: "project_not_assigned" };
      }

      const session = getUserSession(fromId);

      // If user selected category first, proceed directly to upload
      if (session.pendingUploadType) {
        const catType = session.pendingUploadType;
        const catLabel =
          catType === "signed_dc"
            ? "Delivery Challan (DC) + Signed WCC proof"
            : catType === "transport_receipt"
            ? "Transportation Photo"
            : "Installation Photo";

        setUserSession(fromId, {
          state: "UPLOADING",
          selectedEstimateId: estimateId,
          uploadType: catType,
          pendingUploadType: undefined,
        });

        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          `📸 *Ready for ${catLabel}*\nProject: *${project.estimateNumber}* (${project.subject || project.title})\n\nPlease send your photo(s) or document now.`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🏁 Finish Upload", callback_data: "nav:finish" }],
                [{ text: "🔙 Switch Project", callback_data: "menu:projects" }],
                [{ text: "❌ Cancel", callback_data: "nav:cancel" }],
              ],
            },
          }
        );
        await answerCallbackQuery(botToken, cbId);
        return { handled: true, action: "project_selected_for_pending_category" };
      }

      // Otherwise, project selected first -> ask which of the 3 categories
      setUserSession(fromId, { state: "PROJECT_SELECTED", selectedEstimateId: estimateId });

      const msg = [
        `📁 *Project Selected:* ${project.estimateNumber}`,
        `🏢 *Client:* ${project.clientName || "Sunrise Client"}`,
        `📍 *Subject/Store:* ${project.subject || project.storeName || "Site Execution"}`,
        ``,
        `Choose what you want to upload:`,
      ].join("\n");

      await editMessageText(botToken, fromId, cb.message?.message_id, msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📸 1. Installation Photo", callback_data: `up:photo:${estimateId}` }],
            [{ text: "📄 2. Delivery Challan (DC) + Signed WCC proof", callback_data: `up:dc:${estimateId}` }],
            [{ text: "🚚 3. Transportation Photo", callback_data: `up:transport:${estimateId}` }],
            [{ text: "🔙 Switch Project", callback_data: "menu:projects" }],
          ],
        },
      });
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "project_selected" };
    }

    // E. User Category Action Selection: up:<type>:<estimateId>
    if (data.startsWith("up:")) {
      const parts = data.split(":");
      const uploadTypeRaw = parts[1];
      const estimateId = parseInt(parts[2], 10);

      const assigned = await getUserAssignedProjects(fromId);
      const project = assigned.find((p) => p.estimateId === estimateId);
      if (!project) {
        await answerCallbackQuery(botToken, cbId, "⚠️ Project assignment expired or revoked.", true);
        return { handled: true, action: "project_assignment_invalid" };
      }

      const catType: "photo" | "signed_dc" | "transport_receipt" =
        uploadTypeRaw === "dc" ? "signed_dc" : uploadTypeRaw === "transport" ? "transport_receipt" : "photo";

      setUserSession(fromId, { state: "UPLOADING", selectedEstimateId: estimateId, uploadType: catType });

      const typeLabel =
        catType === "signed_dc"
          ? "Delivery Challan (DC) + Signed WCC proof"
          : catType === "transport_receipt"
          ? "Transportation Photo"
          : "Installation Photo";

      const prompt = [
        `📸 *Ready for ${typeLabel}*`,
        `Project: *${project.estimateNumber}*`,
        ``,
        `Please send your photo(s) or document now. You can send single items or albums.`,
        ``,
        `When finished, tap *Finish Upload* below.`,
      ].join("\n");

      await editMessageText(botToken, fromId, cb.message?.message_id, prompt, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🏁 Finish Upload", callback_data: "nav:finish" }],
            [{ text: "🔙 Switch Category", callback_data: `proj:${estimateId}` }],
            [{ text: "❌ Cancel", callback_data: "nav:cancel" }],
          ],
        },
      });
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "upload_category_selected" };
    }

    // F. Navigation & Control Callbacks
    if (data === "nav:projects") {
      const assigned = await getUserAssignedProjects(fromId);
      if (!assigned.length) {
        await editMessageText(
          botToken,
          fromId,
          cb.message?.message_id,
          "📋 You have no active projects assigned. Contact your ERP administrator to assign projects to you."
        );
        await answerCallbackQuery(botToken, cbId);
        return { handled: true, action: "no_projects" };
      }

      const buttons = assigned.map((p) => [
        {
          text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
          callback_data: `proj:${p.estimateId}`,
        },
      ]);

      await editMessageText(
        botToken,
        fromId,
        cb.message?.message_id,
        "📋 *Your Assigned Projects*\n\nSelect a project to upload site evidence:",
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        }
      );
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "nav_projects" };
    }

    if (data === "nav:finish" || data === "nav:cancel") {
      clearUserSession(fromId);
      await editMessageText(
        botToken,
        fromId,
        cb.message?.message_id,
        data === "nav:finish"
          ? "✅ *Upload Session Completed.*\n\nThank you for uploading project evidence. Send /start or /projects anytime to select another project."
          : "❌ *Upload Cancelled.*\n\nSend /start or /projects anytime to select an assigned project.",
        { parse_mode: "Markdown" }
      );
      await answerCallbackQuery(botToken, cbId);
      return { handled: true, action: "nav_finished" };
    }
  }

  // 3. Handle Regular Inbound Messages
  const msg = payload.message;
  if (!msg) return { handled: false };

  const chatId = String(msg.chat?.id || msg.from?.id);
  const from = msg.from;
  const text = (msg.text || "").trim();

  // A. Contact Sharing Message (Access Request)
  if (msg.contact) {
    const contact = msg.contact;

    // SECURITY CHECK: Verify contact belongs to the sender
    if (contact.user_id && contact.user_id !== from.id) {
      await sendTelegramMessage(
        botToken,
        chatId,
        "⚠️ *Security Notice:*\nPlease share your *OWN* contact using the button below. Forwarded contacts cannot be verified.",
        {
          parse_mode: "Markdown",
          reply_markup: {
            keyboard: [[{ text: "📱 Share My Contact", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return { handled: true, action: "contact_forged_rejected" };
    }

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || from.first_name || "Field Contact";
    const phone = contact.phone_number;

    // 0. Check if shared contact is a company approver awaiting link
    const cleanContactPhone = phone.replace(/[^0-9]/g, "").slice(-10);
    const allCompanies = await db.select().from(companies);
    const matchedApproverComp = allCompanies.find((c) => {
      const app = (c.settings as any)?.telegramApprover;
      if (!app || app.status !== "awaiting_link" || !app.phone) return false;
      const appClean = app.phone.replace(/[^0-9]/g, "").slice(-10);
      return appClean === cleanContactPhone;
    });

    if (matchedApproverComp) {
      const compSettings = (matchedApproverComp.settings as any) || {};
      const approver = compSettings.telegramApprover;
      approver.chatId = chatId;
      approver.username = from.username || null;
      approver.fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
      approver.status = "verified";
      approver.linkedAt = new Date().toISOString();
      approver.linkCode = null;
      approver.lastError = null;

      await db.update(companies).set({ settings: compSettings, updatedAt: new Date() }).where(eq(companies.id, matchedApproverComp.id));

      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ *Telegram Account Verified!*\n\nYou are now registered as the *Main Telegram Approver* for:\n🏢 *${matchedApproverComp.displayName || matchedApproverComp.name}*\n\nYou will receive real-time notifications when field staff request access, with Approve/Reject buttons.`,
        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
      );
      return { handled: true, action: "approver_linked_contact", companyId: matchedApproverComp.id };
    }

    // Check if already approved
    const [existingApprovedUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.telegramChatId, chatId), eq(users.isActive, true)))
      .limit(1);

    if (existingApprovedUser) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `👋 Welcome back, *${existingApprovedUser.name}*! Your account is already approved.\nSend /projects to view your assigned projects.`,
        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
      );
      return { handled: true, action: "already_approved_contact" };
    }

    // Add or update access request
    const requests = config.accessRequests;
    const existingReq = requests.find((r) => r.chatId === chatId);

    if (existingReq && existingReq.status === "pending") {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⏳ *Access Request Pending*\n\nThank you, *${name}*. Your access request is already awaiting administrator approval. You will receive a notification here once approved.`,
        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
      );
      return { handled: true, action: "request_already_pending" };
    }

    const newReq: TelegramAccessRequest = {
      id: `req_${chatId}_${Date.now()}`,
      chatId,
      name,
      phone,
      username: from.username,
      requestedAt: new Date().toISOString(),
      status: "pending",
    };

    const updatedRequests = [...requests.filter((r) => r.chatId !== chatId), newReq];
    await saveTelegramSettings({ accessRequests: updatedRequests });

    // Acknowledge to user
    await sendTelegramMessage(
      botToken,
      chatId,
      `⏳ *Request Submitted*\n\nThank you, *${name}*! Your contact (*${phone}*) has been submitted to the Sunrise ERP Administrator for approval.\n\nYou cannot view projects or upload evidence until approved. We will notify you here once access is granted.`,
      { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
    );

    // Notify Company Administrator(s) via Telegram
    const notifiedChatIds = new Set<string>();
    for (const comp of allCompanies) {
      const app = (comp.settings as any)?.telegramApprover;
      if (app && app.status === "verified" && app.chatId) {
        notifiedChatIds.add(String(app.chatId));
        const approverNotice = [
          `🔔 *Sunrise ERP — New Telegram Access Request*`,
          `🏢 *Workspace:* ${comp.displayName || comp.name}`,
          ``,
          `👤 *Name:* ${name}`,
          `📱 *Phone:* ${phone}`,
          `🆔 *Telegram ID:* \`${chatId}\``,
          `🕒 *Requested:* ${new Date().toLocaleString("en-IN")}`,
          ``,
          `Do you want to approve this user for project evidence uploads?`,
        ].join("\n");

        await sendTelegramMessage(botToken, String(app.chatId), approverNotice, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: `✅ Approve (${comp.displayName || comp.name})`, callback_data: `auth:approve:${chatId}:${comp.id}` },
                { text: `❌ Reject`, callback_data: `auth:reject:${chatId}:${comp.id}` },
              ]
            ],
          },
        });
      }
    }

    // Fallback to global adminChatId if configured and not already notified
    if (config.adminChatId && !notifiedChatIds.has(String(config.adminChatId))) {
      const adminNotice = [
        `🔔 *Sunrise ERP — New Telegram Access Request*`,
        ``,
        `👤 *Name:* ${name}`,
        `📱 *Phone:* ${phone}`,
        `🆔 *Telegram ID:* \`${chatId}\``,
        `🕒 *Requested:* ${new Date().toLocaleString("en-IN")}`,
        ``,
        `Do you want to approve this user for project evidence uploads?`,
      ].join("\n");

      await sendTelegramMessage(botToken, String(config.adminChatId), adminNotice, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `auth:approve:${chatId}` },
              { text: "❌ Reject", callback_data: `auth:reject:${chatId}` },
            ]
          ],
        },
      });
    }

    return { handled: true, action: "access_requested" };
  }

  // B. /start Command
  if (text.startsWith("/start")) {
    const startParts = text.trim().split(/\s+/);
    const startParam = startParts[1]?.trim() || "";

    // 0. Check for link code e.g. /start link_TG123456 or /start TG-123456
    if (startParam) {
      const cleanParam = startParam.replace(/^(link_|LINK_|tg_|TG_)/i, "").trim().toUpperCase();
      const allCompanies = await db.select().from(companies);
      const matchedComp = allCompanies.find((c) => {
        const app = (c.settings as any)?.telegramApprover;
        if (!app || !app.linkCode) return false;
        const cCode = String(app.linkCode).replace(/^(TG-|LINK-)/i, "").trim().toUpperCase();
        return (
          app.linkCode.toUpperCase() === cleanParam ||
          app.linkCode.toUpperCase() === `TG-${cleanParam}` ||
          app.linkCode.toUpperCase() === `LINK-${cleanParam}` ||
          cCode === cleanParam
        );
      });

      if (matchedComp) {
        const compSettings = (matchedComp.settings as any) || {};
        const approver = compSettings.telegramApprover;
        approver.chatId = chatId;
        approver.username = from.username || null;
        approver.fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
        approver.status = "verified";
        approver.linkedAt = new Date().toISOString();
        approver.linkCode = null;
        approver.lastError = null;

        await db.update(companies).set({ settings: compSettings, updatedAt: new Date() }).where(eq(companies.id, matchedComp.id));

        await sendTelegramMessage(
          botToken,
          chatId,
          `✅ *Telegram Account Verified!*\n\nYou are now registered as the *Main Telegram Approver* for:\n🏢 *${matchedComp.displayName || matchedComp.name}*\n\nYou will receive real-time notifications when field staff request access, with Approve/Reject buttons.`,
          { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
        );
        return { handled: true, action: "approver_linked", companyId: matchedComp.id };
      }
    }
    // 1. Check if user is known and approved
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);

    if (user && user.isActive) {
      const assigned = await getUserAssignedProjects(chatId);

      const welcomeMenuButtons = [
        [{ text: "1. 📁 Select a project", callback_data: "menu:projects" }],
        [{ text: "2. 📸 Upload an installation photo", callback_data: "menu:cat:photo" }],
        [{ text: "3. 📄 Upload a delivery challan (DC)", callback_data: "menu:cat:dc" }],
        [{ text: "4. 🚚 Upload a transportation photo", callback_data: "menu:cat:transport" }],
      ];

      setUserSession(chatId, { state: "MENU" });

      await sendTelegramMessage(
        botToken,
        chatId,
        `👋 *Welcome to Sunrise Media ERP, ${user.name}!*\n\nPlease choose an option below:\n1. 📁 Select a project\n2. 📸 Upload an installation photo\n3. 📄 Upload a delivery challan (DC)\n4. 🚚 Upload a transportation photo\n\nTap an option or reply with *1*, *2*, *3*, or *4*.`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: welcomeMenuButtons },
        }
      );
      return { handled: true, action: "welcome_menu_displayed" };
    }

    // 2. Check if pending request exists
    const pendingReq = config.accessRequests.find((r) => r.chatId === chatId && r.status === "pending");
    if (pendingReq) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⏳ *Access Awaiting Approval*\n\nHello *${pendingReq.name}*, your access request is currently pending review by the Sunrise ERP Administrator. No project access or uploads are permitted while pending.`,
        { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } }
      );
      return { handled: true, action: "start_pending" };
    }

    // 3. Unknown user — request contact verification
    const welcome = [
      `👋 *Welcome to Sunrise Media ERP Bot*`,
      ``,
      `To access your assigned installation projects and upload photo evidence or delivery challans, please verify your identity by sharing your contact.`,
      ``,
      `Tap the button below to request access.`,
    ].join("\n");

    await sendTelegramMessage(botToken, chatId, welcome, {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [[{ text: "📱 Share Contact to Request Access", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return { handled: true, action: "start_prompt_contact" };
  }

  // C. General Greetings (hi, hello, menu, etc.) for approved users
  const lowerText = text.toLowerCase();
  if (lowerText === "hi" || lowerText === "hello" || lowerText === "menu" || lowerText === "/menu") {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
    if (user && user.isActive) {
      setUserSession(chatId, { state: "MENU" });
      const welcomeMenuButtons = [
        [{ text: "1. 📁 Select a project", callback_data: "menu:projects" }],
        [{ text: "2. 📸 Upload an installation photo", callback_data: "menu:cat:photo" }],
        [{ text: "3. 📄 Upload a delivery challan (DC)", callback_data: "menu:cat:dc" }],
        [{ text: "4. 🚚 Upload a transportation photo", callback_data: "menu:cat:transport" }],
      ];

      await sendTelegramMessage(
        botToken,
        chatId,
        `👋 *Welcome to Sunrise Media ERP, ${user.name}!*\n\nPlease choose an option below:\n1. 📁 Select a project\n2. 📸 Upload an installation photo\n3. 📄 Upload a delivery challan (DC)\n4. 🚚 Upload a transportation photo\n\nTap an option or reply with *1*, *2*, *3*, or *4*.`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: welcomeMenuButtons },
        }
      );
      return { handled: true, action: "welcome_menu_displayed" };
    }
  }

  // D. Numbered Replies (1, 2, 3, 4)
  if (["1", "2", "3", "4"].includes(text)) {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
    if (user && user.isActive) {
      const assigned = await getUserAssignedProjects(chatId);

      if (text === "1") {
        // Select a project
        if (!assigned.length) {
          await sendTelegramMessage(
            botToken,
            chatId,
            `📋 You currently have *no active projects assigned*. Please contact your ERP administrator.`
          );
          return { handled: true, action: "projects_none" };
        }
        const buttons = assigned.map((p) => [
          {
            text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
            callback_data: `proj:${p.estimateId}`,
          },
        ]);
        await sendTelegramMessage(
          botToken,
          chatId,
          `📋 *Your Assigned Projects*\n\nSelect a project below:`,
          { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
        );
        return { handled: true, action: "projects_listed" };
      }

      const catMap: Record<string, { type: "photo" | "signed_dc" | "transport_receipt"; label: string }> = {
        "2": { type: "photo", label: "Installation Photo" },
        "3": { type: "signed_dc", label: "Delivery Challan (DC) + Signed WCC proof" },
        "4": { type: "transport_receipt", label: "Transportation Photo" },
      };
      const cat = catMap[text];
      if (cat) {
        if (!assigned.length) {
          await sendTelegramMessage(
            botToken,
            chatId,
            `📋 You currently have *no active projects assigned*. Please contact your ERP administrator.`
          );
          return { handled: true, action: "projects_none" };
        }

        if (assigned.length === 1) {
          setUserSession(chatId, {
            state: "UPLOADING",
            selectedEstimateId: assigned[0].estimateId,
            uploadType: cat.type,
            pendingUploadType: undefined,
          });
          await sendTelegramMessage(
            botToken,
            chatId,
            `📸 *Ready for ${cat.label}*\nProject: *${assigned[0].estimateNumber}* (${assigned[0].subject || assigned[0].title})\n\nPlease send your photo(s) or document now.`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🏁 Finish Upload", callback_data: "nav:finish" }],
                  [{ text: "🔙 Switch Project", callback_data: "menu:projects" }],
                ],
              },
            }
          );
          return { handled: true, action: "category_single_project_auto_selected" };
        }

        setUserSession(chatId, {
          state: "AWAITING_PROJECT_SELECTION",
          pendingUploadType: cat.type,
        });
        const buttons = assigned.map((p) => [
          {
            text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
            callback_data: `proj:${p.estimateId}`,
          },
        ]);
        await sendTelegramMessage(
          botToken,
          chatId,
          `📸 You chose *${cat.label}*.\n\nWhich project does this upload belong to?\nSelect below:`,
          { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
        );
        return { handled: true, action: "category_ask_project" };
      }
    }
  }

  // E. /projects Command
  if (text.startsWith("/projects")) {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
    if (!user || !user.isActive) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⛔ You are not an approved user. Send /start to request access.`
      );
      return { handled: true, action: "projects_unauthorized" };
    }

    const assigned = await getUserAssignedProjects(chatId);
    if (!assigned.length) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `📋 You have no active projects assigned. Please ask your administrator to assign projects to you in Sunrise ERP.`
      );
      return { handled: true, action: "projects_none" };
    }

    const buttons = assigned.map((p) => [
      {
        text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
        callback_data: `proj:${p.estimateId}`,
      },
    ]);

    await sendTelegramMessage(
      botToken,
      chatId,
      `📋 *Your Assigned Projects*\n\nSelect a project to upload evidence:`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      }
    );
    return { handled: true, action: "projects_listed" };
  }

  // F. Photo and Document Uploads
  const photo = msg.photo ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document;

  if (photo || doc) {
    // 1. Verify user is approved
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId)).limit(1);
    if (!user || !user.isActive) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `⛔ *Access Denied:* You cannot upload evidence without an approved Sunrise ERP account. Send /start to request access.`
      );
      return { handled: true, action: "upload_rejected_unapproved" };
    }

    // 2. Verify active project session or safe auto-select if single project assigned
    const session = getUserSession(chatId);
    const assigned = await getUserAssignedProjects(chatId);
    let targetEstimateId = session.selectedEstimateId;

    if (!targetEstimateId) {
      if (assigned.length === 1) {
        targetEstimateId = assigned[0].estimateId;
        setUserSession(chatId, { selectedEstimateId: targetEstimateId });
      } else if (assigned.length > 1) {
        const buttons = assigned.map((p) => [
          {
            text: `🔘 ${p.estimateNumber} — ${p.subject || p.title} (${p.storeSummary || p.storeName || "Site"})`,
            callback_data: `proj:${p.estimateId}`,
          },
        ]);
        await sendTelegramMessage(
          botToken,
          chatId,
          `⚠️ *Multiple Projects Assigned*\nPlease select which project this upload belongs to first:`,
          { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
        );
        return { handled: true, action: "upload_rejected_ambiguous_project" };
      } else {
        await sendTelegramMessage(
          botToken,
          chatId,
          `📋 You currently have *no active projects assigned*. Please contact your ERP supervisor.`
        );
        return { handled: true, action: "upload_rejected_no_project" };
      }
    }

    // 3. Verify server-side project assignment is still valid and unrevoked
    const activeProject = assigned.find((p) => p.estimateId === targetEstimateId);
    if (!activeProject) {
      clearUserSession(chatId);
      await sendTelegramMessage(
        botToken,
        chatId,
        `⛔ *Assignment Revoked:* Your access to this project has ended. Send /projects to see your current projects.`
      );
      return { handled: true, action: "upload_rejected_revoked" };
    }

    const [estimate] = await db.select().from(estimates).where(eq(estimates.id, targetEstimateId)).limit(1);
    if (!estimate) {
      await sendTelegramMessage(botToken, chatId, `❌ Error: Target project record not found in database.`);
      return { handled: true, action: "upload_error_estimate_missing" };
    }

    // 4. Determine category from caption or session
    const rawCaption = (msg.caption || "").trim();
    const capUpper = rawCaption.toUpperCase();

    let category: "photo" | "signed_dc" | "transport_receipt";
    if (capUpper === "INSTALLATION" || capUpper === "INSTALLATION PHOTO") {
      category = "photo";
    } else if (capUpper === "DC" || capUpper === "DELIVERY CHALLAN" || capUpper === "SIGNED WCC" || capUpper === "WCC") {
      category = "signed_dc";
    } else if (capUpper === "TRANSPORTATION" || capUpper === "TRANSPORT" || capUpper === "TRANSPORT PHOTO") {
      category = "transport_receipt";
    } else if (rawCaption === "") {
      const sType = session.pendingUploadType || session.uploadType;
      category = (sType === "signed_dc" || (sType as any) === "dc") ? "signed_dc" : (sType === "transport_receipt" || (sType as any) === "transport") ? "transport_receipt" : "photo";
    } else {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❓ *Unrecognized Caption:* "${rawCaption}"\n\nPlease select the correct upload category:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📸 1. Installation Photo", callback_data: `up:photo:${targetEstimateId}` }],
              [{ text: "📄 2. Delivery Challan (DC) + Signed WCC proof", callback_data: `up:dc:${targetEstimateId}` }],
              [{ text: "🚚 3. Transportation Photo", callback_data: `up:transport:${targetEstimateId}` }],
            ],
          },
        }
      );
      return { handled: true, action: "upload_rejected_unknown_caption" };
    }

    const fileId = photo?.file_id || doc?.file_id;
    if (!fileId) {
      await sendTelegramMessage(botToken, chatId, `❌ Error: Missing file identifier.`);
      return { handled: true, action: "upload_error_no_file_id" };
    }

    // 5. Download file from Telegram Bot API
    const download = await downloadTelegramFile(botToken, fileId, uploadDir);
    if (!download.ok) {
      await sendTelegramMessage(botToken, chatId, `❌ Upload failed: ${download.error}. Please retry.`);
      return { handled: true, action: "upload_download_failed" };
    }

    // 6. Query if Delivery Challan exists for this estimate
    const [existingDc] = await db
      .select()
      .from(deliveryChallans)
      .where(eq(deliveryChallans.estimateId, estimate.id))
      .limit(1);

    // 7. Link to executionDocuments with strict category
    const [execDoc] = await db
      .insert(executionDocuments)
      .values({
        companyId: estimate.companyId || 1,
        estimateId: estimate.id,
        deliveryChallanId: existingDc?.id || null,
        storeCode: activeProject.storeName || null,
        documentType: category,
        filePath: download.filePath,
        originalFileName: download.fileName,
        mimeType: download.mimeType,
        fileSize: download.fileSize,
        status: "active",
        uploadedBy: user.id,
        uploadedVia: "telegram",
        uploadedAt: new Date(),
        metadata: {
          telegramChatId: chatId,
          telegramMessageId: msg.message_id,
          mediaGroupId: msg.media_group_id || null,
          caption: msg.caption || null,
        },
      })
      .returning();

    // 8. If DC exists, update corresponding field without falsely marking unsigned proofs complete
    if (existingDc) {
      if (category === "signed_dc") {
        await db.update(deliveryChallans).set({ signedChallanPath: download.filePath }).where(eq(deliveryChallans.id, existingDc.id));
      } else if (category === "transport_receipt") {
        await db.update(deliveryChallans).set({ transportReceiptPath: download.filePath }).where(eq(deliveryChallans.id, existingDc.id));
      } else if (category === "photo") {
        await db.update(deliveryChallans).set({ photoPath: download.filePath }).where(eq(deliveryChallans.id, existingDc.id));
      }
    }

    // 9. Insert into botUploadInbox
    await db.insert(botUploadInbox).values({
      companyId: estimate.companyId || 1,
      source: "telegram",
      senderId: chatId,
      senderName: user.name,
      messageText: msg.caption || `Telegram ${category.replace("_", " ")}`,
      mediaUrl: download.filePath,
      mediaLocalPath: download.localPath,
      mediaType: photo ? "photo" : "document",
      uploadType: category,
      mappedEstimateId: estimate.id,
      mappedClientId: estimate.clientId,
      status: "mapped",
      mappedAt: new Date(),
      mappedBy: user.id,
      remarks: `Auto-linked via Telegram bot to project ${estimate.estimateNumber}`,
      rawPayload: payload,
    });

    // 10. Handle media group deduplication / response
    const mediaGroupId = msg.media_group_id;
    if (mediaGroupId) {
      const existing = mediaGroupDebounce.get(mediaGroupId) || { count: 0 };
      existing.count += 1;
      mediaGroupDebounce.set(mediaGroupId, existing);

      if (!existing.timer) {
        existing.timer = setTimeout(async () => {
          mediaGroupDebounce.delete(mediaGroupId);
          await sendTelegramMessage(
            botToken,
            chatId,
            `✅ Received *${existing.count}* files for project *${estimate.estimateNumber}*.\n\nSend more or send /projects to switch projects.`,
            { parse_mode: "Markdown" }
          );
        }, 1500);
        if (typeof existing.timer?.unref === "function") existing.timer.unref();
      }
    } else {
      const label =
        category === "signed_dc"
          ? "Delivery Challan (DC) + Signed WCC proof"
          : category === "transport_receipt"
          ? "Transportation Photo"
          : "Installation Photo";

      await sendTelegramMessage(
        botToken,
        chatId,
        `✅ *Saved:* ${label} uploaded and linked to project *${estimate.estimateNumber}*.\n\nSend more or send /projects to finish.`,
        { parse_mode: "Markdown" }
      );
    }

    return { handled: true, action: "upload_saved" };
  }

  return { handled: false };
};

/**
 * Chat-ID discovery: reads recent bot updates (getUpdates) so an admin can
 * find the chat IDs of people who have messaged the bot.
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
      const m = upd.message || upd.edited_message || upd.channel_post;
      const chat = m?.chat;
      if (!chat?.id) continue;
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || chat.username || String(chat.id);
      byChat.set(String(chat.id), {
        chatId: String(chat.id),
        name,
        username: chat.username,
        lastText: m.text,
      });
    }
    return { ok: true, chats: Array.from(byChat.values()) };
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
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
