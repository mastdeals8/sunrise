import { db } from "../db";
import {
  botSettings,
  botUploadInbox,
  webhookLogs,
  clients,
  stores,
  users,
  companyUsers,
  companies,
  fieldAccessLinks,
  estimates,
  executionDocuments,
} from "../../shared/schema";
import { eq, desc, and, or, sql, isNull, gt } from "drizzle-orm";
import fs from "fs";
import path from "path";
import crypto from "crypto";
// @ts-ignore
import QRCode from "qrcode";

export interface EvolutionConfig {
  serverUrl: string;
  apiKey: string;
  instanceName: string;
  webhookSecret?: string;
  companyId: number;
}

export interface InstanceStatusResponse {
  serverOnline: boolean;
  sessionState: "open" | "close" | "connecting" | "qrcode" | "disconnected";
  instanceName: string;
  ownerJid?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  phone?: string | null;
  qrCode?: string | null;
  pairingCode?: string | null;
  lastConnectedAt?: string | null;
  error?: string | null;
}

export interface WhatsAppAccessRequest {
  id: string;
  phone: string;
  name: string;
  remoteJid: string;
  companyId: number;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface WhatsAppUserSession {
  state: "IDLE" | "PROJECT_SELECTED" | "UPLOADING";
  selectedEstimateId?: number;
  uploadType?: "photo" | "signed_challan" | "wcc" | "signed_wcc" | "extra";
  lastInteraction: number;
}

// ── In-Memory Sessions & Deduplication Caches ──
const whatsappSessions = new Map<string, WhatsAppUserSession>();
const processedMessageIds = new Map<string, number>();

export const getWhatsAppSession = (phone: string): WhatsAppUserSession => {
  const existing = whatsappSessions.get(phone);
  if (existing) return existing;
  const init: WhatsAppUserSession = { state: "IDLE", lastInteraction: Date.now() };
  whatsappSessions.set(phone, init);
  return init;
};

export const setWhatsAppSession = (phone: string, update: Partial<WhatsAppUserSession>) => {
  const current = getWhatsAppSession(phone);
  whatsappSessions.set(phone, { ...current, ...update, lastInteraction: Date.now() });
};

export const clearWhatsAppSession = (phone: string) => {
  whatsappSessions.set(phone, { state: "IDLE", lastInteraction: Date.now() });
};

/**
 * Normalizes an Indian or international phone number for WhatsApp without symbols.
 * Example: "+91 98236 33833" -> "919823633833"
 *          "9823633833" -> "919823633833" (10-digit defaults to India 91)
 */
export function normalizeWhatsAppNumber(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

export class WhatsAppEvolutionService {
  /**
   * Retrieves the WhatsApp configuration from the database or environment variables.
   */
  async getConfig(companyId: number = 1): Promise<EvolutionConfig> {
    const rows = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
    const row = rows[0];
    const settings = (row?.settings as any) || {};

    const serverUrl = (
      settings.serverUrl ||
      process.env.WHATSAPP_EVOLUTION_URL ||
      process.env.EVOLUTION_API_URL ||
      ""
    ).replace(/\/+$/, "");

    const apiKey = (
      row?.botToken ||
      settings.apiKey ||
      process.env.WHATSAPP_EVOLUTION_API_KEY ||
      process.env.EVOLUTION_API_KEY ||
      ""
    );

    // Multi-company instance isolation
    const companyKey = `company_${companyId}`;
    const instanceName =
      settings.companyInstances?.[companyKey]?.instanceName ||
      settings.instanceName ||
      process.env.WHATSAPP_EVOLUTION_INSTANCE ||
      `sunrise_company_${companyId}`;

    const webhookSecret = settings.webhookSecret || process.env.WHATSAPP_WEBHOOK_SECRET || "";

    return {
      serverUrl,
      apiKey,
      instanceName,
      webhookSecret,
      companyId,
    };
  }

  /**
   * Checks the health and reachability of the Evolution API server.
   */
  async checkHealth(companyId: number = 1): Promise<{ online: boolean; version?: string; latencyMs: number; error?: string }> {
    if (process.env.WHATSAPP_MOCK === "1") {
      return { online: true, version: "v2.2.2-mock", latencyMs: 5 };
    }

    const config = await this.getConfig(companyId);
    if (!config.serverUrl) {
      return { online: false, latencyMs: 0, error: "Evolution API Server URL is not configured." };
    }
    if (!config.apiKey) {
      return { online: false, latencyMs: 0, error: "Evolution API Key is not configured." };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const resp = await fetch(`${config.serverUrl}/`, {
        headers: { apikey: config.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      if (resp.ok) {
        let version = "v2.2.2";
        try {
          const data = await resp.json();
          version = data.version || version;
        } catch {}
        return { online: true, version, latencyMs };
      }
      return { online: false, latencyMs, error: `HTTP ${resp.status}: ${resp.statusText}` };
    } catch (err: any) {
      return { online: false, latencyMs: Date.now() - start, error: err.message || "Failed to reach server." };
    }
  }

  /**
   * Fetches the real-time session connection state from Evolution API.
   */
  async getStatus(companyId: number = 1): Promise<InstanceStatusResponse> {
    if (process.env.WHATSAPP_MOCK === "1") {
      return {
        serverOnline: true,
        sessionState: "open",
        instanceName: `sunrise_company_${companyId}`,
        phone: "919823633833",
        profileName: "Sunrise Media WhatsApp",
      };
    }

    const config = await this.getConfig(companyId);
    const health = await this.checkHealth(companyId);

    if (!health.online) {
      return {
        serverOnline: false,
        sessionState: "disconnected",
        instanceName: config.instanceName,
        error: health.error || "Evolution API server is unreachable.",
      };
    }

    try {
      const resp = await fetch(`${config.serverUrl}/instance/connectionState/${config.instanceName}`, {
        headers: { apikey: config.apiKey },
      });

      if (resp.status === 404) {
        return {
          serverOnline: true,
          sessionState: "disconnected",
          instanceName: config.instanceName,
          error: "Instance does not exist yet. Click Connect to initialize.",
        };
      }

      if (!resp.ok) {
        return {
          serverOnline: true,
          sessionState: "disconnected",
          instanceName: config.instanceName,
          error: `Error checking status: HTTP ${resp.status}`,
        };
      }

      const data = await resp.json();
      const rawState = data.instance?.state || data.state;
      const state: "open" | "close" | "connecting" | "qrcode" | "disconnected" =
        rawState === "open" ? "open" : rawState === "connecting" ? "connecting" : "close";

      let phone: string | null = null;
      let profileName: string | null = null;
      let profilePicUrl: string | null = null;

      if (state === "open") {
        try {
          const instResp = await fetch(`${config.serverUrl}/instance/fetchInstances?instanceName=${config.instanceName}`, {
            headers: { apikey: config.apiKey },
          });
          if (instResp.ok) {
            const instData = await instResp.json();
            const inst = Array.isArray(instData) ? instData[0] : instData;
            phone = inst?.ownerJid ? inst.ownerJid.replace(/@.*$/, "") : null;
            profileName = inst?.profileName || null;
            profilePicUrl = inst?.profilePicUrl || null;
          }
        } catch {}
      }

      return {
        serverOnline: true,
        sessionState: state,
        instanceName: config.instanceName,
        phone,
        profileName,
        profilePicUrl,
      };
    } catch (err: any) {
      return {
        serverOnline: true,
        sessionState: "disconnected",
        instanceName: config.instanceName,
        error: err.message || "Failed to query connection state.",
      };
    }
  }

  /**
   * Initializes the Evolution API instance and generates QR code for pairing.
   */
  async connectInstance(companyId: number = 1): Promise<{ success: boolean; qrCode?: string; pairingCode?: string; error?: string }> {
    if (process.env.WHATSAPP_MOCK === "1") {
      return { success: true, qrCode: "data:image/png;base64,MOCK_QR_CODE" };
    }

    const config = await this.getConfig(companyId);
    if (!config.serverUrl || !config.apiKey) {
      return { success: false, error: "Evolution API server URL or API key is not configured." };
    }

    try {
      // 1. Create instance if needed
      await fetch(`${config.serverUrl}/instance/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.apiKey },
        body: JSON.stringify({
          instanceName: config.instanceName,
          token: config.apiKey,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      }).catch(() => {});

      // 2. Request QR code connection
      const connectResp = await fetch(`${config.serverUrl}/instance/connect/${config.instanceName}`, {
        headers: { apikey: config.apiKey },
      });

      if (!connectResp.ok) {
        const errorData = await connectResp.json().catch(() => ({}));
        return { success: false, error: errorData.message || `Failed to connect instance: HTTP ${connectResp.status}` };
      }

      const data = await connectResp.json();

      // Check if instance is already open/connected
      const rawState = data.instance?.state || data.state;
      if (rawState === "open") {
        return { success: true, state: "open" } as any;
      }

      let qrCode: string | null = data.base64 || data.qrcode?.base64 || null;
      const pairingCode: string | null = data.pairingCode || data.qrcode?.pairingCode || null;

      // If Evolution API returned a raw QR pairing string instead of base64
      if (!qrCode && (data.code || data.qrcode?.code)) {
        const rawCode = data.code || data.qrcode?.code;
        try {
          qrCode = await QRCode.toDataURL(rawCode, { margin: 2, width: 280 });
        } catch (qrErr: any) {
          console.warn("[whatsapp] Error generating QR data URL from raw code:", qrErr.message);
        }
      }

      // Ensure proper data URL prefix for img src rendering
      if (qrCode && typeof qrCode === "string") {
        const trimmed = qrCode.trim();
        if (!trimmed.startsWith("data:") && !trimmed.startsWith("http")) {
          qrCode = `data:image/png;base64,${trimmed}`;
        }
      }

      return {
        success: true,
        qrCode: qrCode || undefined,
        pairingCode: pairingCode || undefined,
      };
    } catch (err: any) {
      return { success: false, error: err.message || "Network error while connecting WhatsApp instance." };
    }
  }

  /**
   * Disconnects / logs out the active WhatsApp session.
   */
  async disconnectInstance(companyId: number = 1): Promise<{ success: boolean; error?: string }> {
    if (process.env.WHATSAPP_MOCK === "1") {
      return { success: true };
    }

    const config = await this.getConfig(companyId);
    if (!config.serverUrl || !config.apiKey) {
      return { success: false, error: "Evolution API server URL or API key is not configured." };
    }

    try {
      const resp = await fetch(`${config.serverUrl}/instance/logout/${config.instanceName}`, {
        method: "DELETE",
        headers: { apikey: config.apiKey },
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { success: false, error: data.message || `HTTP ${resp.status}` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to logout instance." };
    }
  }

  /**
   * Sends an outbound text message through WhatsApp Evolution API.
   */
  async sendTextMessage(
    to: string,
    text: string,
    options?: { companyId?: number; userId?: number }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const companyId = options?.companyId || 1;
    if (process.env.WHATSAPP_MOCK === "1") {
      return { success: true, messageId: `mock-wa-${Date.now()}` };
    }

    const config = await this.getConfig(companyId);
    if (!config.serverUrl || !config.apiKey) {
      return { success: false, error: "WhatsApp Evolution API server URL or API key is not configured." };
    }

    const normalizedNumber = normalizeWhatsAppNumber(to);
    if (!normalizedNumber || normalizedNumber.length < 10) {
      return { success: false, error: "Invalid recipient phone number." };
    }

    try {
      const resp = await fetch(`${config.serverUrl}/message/sendText/${config.instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.apiKey,
        },
        body: JSON.stringify({
          number: normalizedNumber,
          text,
          options: { delay: 1000, presence: "composing" },
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errorMsg = data.message || `HTTP ${resp.status}`;
        await db.insert(webhookLogs).values({
          companyId,
          platform: "whatsapp",
          direction: "outbound",
          event: "send_text_failed",
          payload: { to: normalizedNumber, text, error: errorMsg },
          status: "error",
          error: errorMsg,
        });
        return { success: false, error: errorMsg };
      }

      const messageId = data.key?.id || data.messageId || null;
      await db.insert(webhookLogs).values({
        companyId,
        platform: "whatsapp",
        direction: "outbound",
        event: "send_text",
        payload: { to: normalizedNumber, text, messageId },
        status: "processed",
      });

      return { success: true, messageId };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to send message." };
    }
  }

  /**
   * Sends a media or document attachment via WhatsApp.
   */
  async sendMediaMessage(
    to: string,
    mediaUrl: string,
    caption: string,
    fileName: string = "document.pdf",
    mediaType: "document" | "image" = "document",
    options?: { companyId?: number; userId?: number }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const companyId = options?.companyId || 1;
    if (process.env.WHATSAPP_MOCK === "1") {
      return { success: true, messageId: `mock-wa-media-${Date.now()}` };
    }

    const config = await this.getConfig(companyId);
    if (!config.serverUrl || !config.apiKey) {
      return { success: false, error: "WhatsApp Evolution API server URL or API key is not configured." };
    }

    const normalizedNumber = normalizeWhatsAppNumber(to);
    if (!normalizedNumber || normalizedNumber.length < 10) {
      return { success: false, error: "Invalid recipient phone number." };
    }

    try {
      const resp = await fetch(`${config.serverUrl}/message/sendMedia/${config.instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.apiKey,
        },
        body: JSON.stringify({
          number: normalizedNumber,
          mediatype: mediaType,
          mimetype: mediaType === "image" ? "image/jpeg" : "application/pdf",
          caption,
          media: mediaUrl,
          fileName,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errorMsg = data.message || `HTTP ${resp.status}`;
        await db.insert(webhookLogs).values({
          companyId,
          platform: "whatsapp",
          direction: "outbound",
          event: "send_media_failed",
          payload: { to: normalizedNumber, mediaUrl, fileName, error: errorMsg },
          status: "error",
          error: errorMsg,
        });
        return { success: false, error: errorMsg };
      }

      const messageId = data.key?.id || data.messageId || null;
      return { success: true, messageId };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to send media." };
    }
  }

  /**
   * Retrieves active assigned projects for a WhatsApp worker from fieldAccessLinks.
   */
  async getAssignedProjects(phone: string, companyId: number = 1) {
    const cleanPhone = phone.replace(/[^0-9]/g, "").slice(-10);
    if (!cleanPhone) return [];

    // Find user in users table
    const [user] = await db
      .select()
      .from(users)
      .where(
        or(
          sql`RIGHT(REGEXP_REPLACE(${users.phone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`,
          sql`RIGHT(REGEXP_REPLACE(${users.whatsappPhone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`
        )
      )
      .limit(1);

    if (!user || !user.isActive) return [];

    // Query unrevoked, unexpired assignments
    const links = await db
      .select()
      .from(fieldAccessLinks)
      .where(
        and(
          sql`(${fieldAccessLinks.metadata}->>'userId' = ${String(user.id)} OR ${fieldAccessLinks.recipientContact} = ${user.phone || ""} OR RIGHT(REGEXP_REPLACE(${fieldAccessLinks.recipientContact}, '[^0-9]', '', 'g'), 10) = ${cleanPhone})`,
          isNull(fieldAccessLinks.revokedAt),
          gt(fieldAccessLinks.expiresAt, new Date())
        )
      );

    const projectList: Array<{
      linkId: number;
      estimateId: number;
      estimateNumber: string;
      title: string;
      subject: string;
      clientName: string;
      storeName: string;
      storeId?: number;
    }> = [];

    const seenEstimateIds = new Set<number>();

    for (const link of links) {
      if (seenEstimateIds.has(link.estimateId)) continue;
      seenEstimateIds.add(link.estimateId);

      const [est] = await db.select().from(estimates).where(eq(estimates.id, link.estimateId)).limit(1);
      if (!est) continue;

      let clientName = "";
      if (est.clientId) {
        const [c] = await db.select().from(clients).where(eq(clients.id, est.clientId)).limit(1);
        if (c) clientName = c.name;
      }
      let storeName = "";
      if (est.storeId) {
        const [s] = await db.select().from(stores).where(eq(stores.id, est.storeId)).limit(1);
        if (s) storeName = s.name || s.storeCode || "";
      }

      projectList.push({
        linkId: link.id,
        estimateId: est.id,
        estimateNumber: est.estimateNumber,
        title: est.title,
        subject: est.subject || "",
        clientName,
        storeName,
        storeId: est.storeId || undefined,
      });
    }

    return projectList;
  }

  /**
   * Retrieves pending WhatsApp access requests.
   */
  async listAccessRequests(companyId: number = 1): Promise<WhatsAppAccessRequest[]> {
    const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
    if (!row) return [];
    const settings = (row.settings as any) || {};
    const requests = Array.isArray(settings.accessRequests) ? (settings.accessRequests as WhatsAppAccessRequest[]) : [];
    return requests.filter((r) => !r.companyId || r.companyId === companyId);
  }

  /**
   * Approves a WhatsApp access request, linking the contact and applying assignments.
   */
  async approveAccessRequest(companyId: number, phone: string, reviewerId?: string): Promise<{ success: boolean; user?: any }> {
    const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
    if (!row) throw new Error("WhatsApp bot settings not found");
    const settings = (row.settings as any) || {};
    const requests: WhatsAppAccessRequest[] = Array.isArray(settings.accessRequests) ? settings.accessRequests : [];

    const clean = phone.replace(/[^0-9]/g, "").slice(-10);
    const target = requests.find((r) => r.phone.replace(/[^0-9]/g, "").slice(-10) === clean && r.status === "pending");

    if (!target) {
      throw new Error("No pending access request found for this phone number");
    }

    target.status = "approved";
    target.reviewedAt = new Date().toISOString();
    target.reviewedBy = reviewerId || "admin";

    // Link or create user in users table
    let [matchedUser] = await db
      .select()
      .from(users)
      .where(
        or(
          sql`RIGHT(REGEXP_REPLACE(${users.phone}, '[^0-9]', '', 'g'), 10) = ${clean}`,
          sql`RIGHT(REGEXP_REPLACE(${users.whatsappPhone}, '[^0-9]', '', 'g'), 10) = ${clean}`
        )
      )
      .limit(1);

    if (matchedUser) {
      await db
        .update(users)
        .set({
          whatsappPhone: target.phone,
          whatsappChatId: target.remoteJid,
          whatsappVerified: true,
          isActive: true,
        })
        .where(eq(users.id, matchedUser.id));
    } else {
      const [newUser] = await db
        .insert(users)
        .values({
          username: `wa_${clean}_${crypto.randomBytes(3).toString("hex")}`,
          email: `wa_${clean}@sunrisemedia.local`,
          password: crypto.randomBytes(16).toString("hex"),
          name: target.name || `WhatsApp Contact (+${clean})`,
          phone: target.phone,
          whatsappPhone: target.phone,
          whatsappChatId: target.remoteJid,
          whatsappVerified: true,
          role: "installer",
          isActive: true,
          notes: `Verified via WhatsApp bot access approval for Company #${companyId}`,
        })
        .returning();
      matchedUser = newUser;

      // Ensure company membership
      await db.insert(companyUsers).values({
        userId: newUser.id,
        companyId,
        role: "company_user",
        isDefault: true,
      });
    }

    // Persist updated settings
    await db
      .update(botSettings)
      .set({
        settings: { ...settings, accessRequests: requests },
        updatedAt: new Date(),
      })
      .where(eq(botSettings.platform, "whatsapp"));

    // Notify requester on WhatsApp
    const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const companyName = comp ? comp.displayName || comp.name : "Sunrise Media ERP";

    await this.sendTextMessage(
      target.phone,
      `🎉 *Access Approved!*\n\nWelcome to *${companyName}*, *${target.name || "Installer"}*.\nYour WhatsApp account has been verified and linked.\n\nSend *projects* anytime to view your assigned projects and begin uploading site photos and delivery challans.`,
      { companyId }
    );

    return { success: true, user: matchedUser };
  }

  /**
   * Rejects a WhatsApp access request.
   */
  async rejectAccessRequest(companyId: number, phone: string, reviewerId?: string): Promise<{ success: boolean }> {
    const [row] = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
    if (!row) throw new Error("WhatsApp bot settings not found");
    const settings = (row.settings as any) || {};
    const requests: WhatsAppAccessRequest[] = Array.isArray(settings.accessRequests) ? settings.accessRequests : [];

    const clean = phone.replace(/[^0-9]/g, "").slice(-10);
    const target = requests.find((r) => r.phone.replace(/[^0-9]/g, "").slice(-10) === clean && r.status === "pending");

    if (!target) {
      throw new Error("No pending access request found for this phone number");
    }

    target.status = "rejected";
    target.reviewedAt = new Date().toISOString();
    target.reviewedBy = reviewerId || "admin";

    await db
      .update(botSettings)
      .set({
        settings: { ...settings, accessRequests: requests },
        updatedAt: new Date(),
      })
      .where(eq(botSettings.platform, "whatsapp"));

    const [comp] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const companyName = comp ? comp.displayName || comp.name : "Sunrise Media ERP";

    await this.sendTextMessage(
      target.phone,
      `❌ *Access Request Not Approved*\n\nYour request to access Sunrise Media ERP (${companyName}) was declined. Please contact your company supervisor if you believe this is in error.`,
      { companyId }
    );

    return { success: true };
  }

  /**
   * Handles inbound webhook payloads sent by Evolution API.
   * Features:
   * 1. Account verification & access requests.
   * 2. Interactive project selection & category browsing.
   * 3. Categorized evidence uploads (photos, delivery challans, WCC, signed WCC, extra).
   * 4. Deduplication & company isolation.
   */
  async handleWebhook(payload: any, incomingSecret?: string): Promise<{ status: string; event?: string; action?: string }> {
    const event = payload?.event;
    const instance = payload?.instance || "";

    // Determine companyId from instance name if pattern matches sunrise_company_<id>
    let companyId = 1;
    const match = instance.match(/company_(\d+)/);
    if (match) {
      companyId = parseInt(match[1], 10);
    }

    // Verify webhook secret if configured
    const config = await this.getConfig(companyId);
    if (config.webhookSecret && incomingSecret && config.webhookSecret !== incomingSecret) {
      throw new Error("Invalid webhook secret.");
    }

    // Log the inbound event
    await db.insert(webhookLogs).values({
      companyId,
      platform: "whatsapp",
      direction: "inbound",
      event: event || "unknown",
      payload,
      status: "received",
    });

    // 1. Connection Update event
    if (event === "connection.update") {
      const state = payload.data?.state || payload.state;
      if (state) {
        const existing = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
        if (existing.length) {
          const s = (existing[0].settings as any) || {};
          await db
            .update(botSettings)
            .set({
              enabled: state === "open",
              settings: {
                ...s,
                connectionStatus: state,
                lastConnectedAt: state === "open" ? new Date().toISOString() : s.lastConnectedAt,
              },
              updatedAt: new Date(),
            })
            .where(eq(botSettings.platform, "whatsapp"));
        } else {
          await db.insert(botSettings).values({
            platform: "whatsapp",
            companyId,
            enabled: state === "open",
            settings: {
              connectionStatus: state,
              lastConnectedAt: state === "open" ? new Date().toISOString() : undefined,
            },
          });
        }
      }
      return { status: "processed", event: "connection.update" };
    }

    // 2. QR Code Updated event
    if (event === "qrcode.updated") {
      const qrCode = payload.data?.qrcode?.base64 || payload.data?.base64;
      if (qrCode) {
        const existing = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
        if (existing.length) {
          const s = (existing[0].settings as any) || {};
          await db
            .update(botSettings)
            .set({
              settings: { ...s, lastQrCode: qrCode, connectionStatus: "qrcode" },
              updatedAt: new Date(),
            })
            .where(eq(botSettings.platform, "whatsapp"));
        }
      }
      return { status: "processed", event: "qrcode.updated" };
    }

    // 3. Inbound Messages (messages.upsert)
    if (event === "messages.upsert") {
      const msgData = payload.data;
      if (!msgData) return { status: "ignored_empty" };

      const key = msgData.key || {};
      if (key.fromMe) {
        // Prevent echo loops
        return { status: "ignored_from_me" };
      }

      const messageId = key.id;
      if (messageId) {
        if (processedMessageIds.has(messageId)) {
          return { status: "duplicate_ignored" };
        }
        processedMessageIds.set(messageId, Date.now());
      }

      const remoteJid = key.remoteJid || "";
      const senderPhone = remoteJid.replace(/@.*$/, "");
      const cleanPhone = senderPhone.slice(-10);
      const senderName = msgData.pushName || `+${senderPhone}`;

      const messageObj = msgData.message || {};
      const rawText =
        messageObj.conversation ||
        messageObj.extendedTextMessage?.text ||
        messageObj.imageMessage?.caption ||
        messageObj.documentMessage?.caption ||
        "";
      const trimmedText = rawText.trim();
      const lowerText = trimmedText.toLowerCase();

      // Check if user is registered and active in users table
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            sql`RIGHT(REGEXP_REPLACE(${users.whatsappPhone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`,
            sql`RIGHT(REGEXP_REPLACE(${users.phone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`,
            eq(users.whatsappChatId, remoteJid)
          )
        )
        .limit(1);

      // A. UNREGISTERED / UNVERIFIED USER FLOW
      if (!user || !user.isActive || !user.whatsappVerified) {
        const [botRow] = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
        const bSettings = (botRow?.settings as any) || {};
        const requests: WhatsAppAccessRequest[] = Array.isArray(bSettings.accessRequests) ? bSettings.accessRequests : [];

        const existingReq = requests.find(
          (r) => r.phone.replace(/[^0-9]/g, "").slice(-10) === cleanPhone && r.status === "pending"
        );

        if (!existingReq) {
          // Record access request
          const newReq: WhatsAppAccessRequest = {
            id: `req_wa_${Date.now()}_${cleanPhone}`,
            phone: senderPhone,
            name: senderName,
            remoteJid,
            companyId,
            requestedAt: new Date().toISOString(),
            status: "pending",
          };
          requests.unshift(newReq);
          await db
            .update(botSettings)
            .set({
              settings: { ...bSettings, accessRequests: requests.slice(0, 500) },
              updatedAt: new Date(),
            })
            .where(eq(botSettings.platform, "whatsapp"));

          // Reply with pending notice
          await this.sendTextMessage(
            senderPhone,
            `👋 *Welcome to Sunrise Media ERP*\n\nHello *${senderName}*, your WhatsApp account is not yet verified.\n\nAn access request has been sent to your supervisor. Once approved, you will be able to upload installation photos, delivery challans, and execution documents here.`,
            { companyId }
          );
          return { status: "processed", action: "access_requested" };
        } else {
          // Already pending
          await this.sendTextMessage(
            senderPhone,
            `⏳ *Access Request Pending*\n\nHello *${senderName}*, your request to access Sunrise Media ERP is awaiting approval from your supervisor. Please wait for confirmation.`,
            { companyId }
          );
          return { status: "processed", action: "access_pending" };
        }
      }

      // Ensure whatsappChatId is linked if not already set
      if (!user.whatsappChatId) {
        await db.update(users).set({ whatsappChatId: remoteJid, whatsappVerified: true }).where(eq(users.id, user.id));
      }

      const session = getWhatsAppSession(senderPhone);

      // B. COMMAND: /start, projects, menu, hi, hello
      if (
        lowerText === "projects" ||
        lowerText === "/start" ||
        lowerText === "menu" ||
        lowerText === "hi" ||
        lowerText === "hello" ||
        lowerText === "help"
      ) {
        clearWhatsAppSession(senderPhone);
        const assigned = await this.getAssignedProjects(senderPhone, companyId);

        if (!assigned.length) {
          await this.sendTextMessage(
            senderPhone,
            `👋 Welcome back, *${user.name}*!\n\n📋 You currently have *no active projects assigned*. Please contact your ERP supervisor to assign projects to you.`,
            { companyId, userId: user.id }
          );
          return { status: "processed", action: "projects_empty" };
        }

        const projectLines = assigned.map((p, idx) => `*${idx + 1}.* 🔘 ${p.estimateNumber}\n    🏢 ${p.clientName || "Sunrise Client"} — ${p.storeName || p.title}`);

        const menuText = [
          `👋 Welcome back, *${user.name}*!`,
          ``,
          `📋 *Your Assigned Projects:*`,
          ...projectLines,
          ``,
          `👉 *Reply with the project number* (e.g. *1*) to select a project and upload evidence.`,
        ].join("\n");

        await this.sendTextMessage(senderPhone, menuText, { companyId, userId: user.id });
        return { status: "processed", action: "projects_listed" };
      }

      // C. NUMBER SELECTION WHEN CHOOSING A PROJECT
      const assigned = await this.getAssignedProjects(senderPhone, companyId);
      const numericChoice = parseInt(trimmedText, 10);

      if (session.state === "IDLE" && !isNaN(numericChoice) && numericChoice >= 1 && numericChoice <= assigned.length) {
        const selectedProject = assigned[numericChoice - 1];
        setWhatsAppSession(senderPhone, {
          state: "PROJECT_SELECTED",
          selectedEstimateId: selectedProject.estimateId,
          uploadType: "photo",
        });

        const categoryPrompt = [
          `📁 *Project Selected: ${selectedProject.estimateNumber}*`,
          `🏢 *Client:* ${selectedProject.clientName || "Sunrise Client"}`,
          `📍 *Store/Site:* ${selectedProject.storeName || selectedProject.subject || "Site Execution"}`,
          ``,
          `*Choose what you want to upload:*`,
          `1. 📸 Installation Photos`,
          `2. 📄 Delivery Challan (DC)`,
          `3. 📝 WCC Document`,
          `4. ✍️ Signed WCC Proof`,
          `5. 📑 Other Documents`,
          ``,
          `👉 *Reply with number (1-5)* or send your photo/document directly now!`,
          `Send *projects* anytime to switch projects.`,
        ].join("\n");

        await this.sendTextMessage(senderPhone, categoryPrompt, { companyId, userId: user.id });
        return { status: "processed", action: "project_selected" };
      }

      // D. CATEGORY SELECTION (1-5)
      if (session.state === "PROJECT_SELECTED" && ["1", "2", "3", "4", "5"].includes(trimmedText)) {
        const catMap: Record<string, { type: "photo" | "signed_challan" | "wcc" | "signed_wcc" | "extra"; label: string }> = {
          "1": { type: "photo", label: "Installation Photos" },
          "2": { type: "signed_challan", label: "Delivery Challan (DC)" },
          "3": { type: "wcc", label: "WCC Document" },
          "4": { type: "signed_wcc", label: "Signed WCC Proof" },
          "5": { type: "extra", label: "Other Documents" },
        };
        const selected = catMap[trimmedText];
        setWhatsAppSession(senderPhone, { uploadType: selected.type, state: "UPLOADING" });

        await this.sendTextMessage(
          senderPhone,
          `✅ Category set to: *${selected.label}*\n\nPlease send your photos or documents now!\nSend *projects* anytime to switch projects.`,
          { companyId, userId: user.id }
        );
        return { status: "processed", action: "category_selected" };
      }

      // E. MEDIA UPLOADS (Image or Document)
      const hasImage = Boolean(messageObj.imageMessage);
      const hasDoc = Boolean(messageObj.documentMessage);

      if (hasImage || hasDoc) {
        if (!session.selectedEstimateId) {
          await this.sendTextMessage(
            senderPhone,
            `⚠️ *No Project Selected*\nPlease send *projects* first to select which project you are uploading for.`,
            { companyId, userId: user.id }
          );
          return { status: "processed", action: "upload_rejected_no_project" };
        }

        const project = assigned.find((p) => p.estimateId === session.selectedEstimateId);
        if (!project) {
          clearWhatsAppSession(senderPhone);
          await this.sendTextMessage(
            senderPhone,
            `⛔ *Assignment Revoked:* Your access to this project has ended. Send *projects* to view your current active projects.`,
            { companyId, userId: user.id }
          );
          return { status: "processed", action: "upload_rejected_revoked" };
        }

        const [estimate] = await db.select().from(estimates).where(eq(estimates.id, project.estimateId)).limit(1);
        if (!estimate) {
          await this.sendTextMessage(senderPhone, `❌ Error: Project record not found in Sunrise ERP.`, { companyId });
          return { status: "processed", action: "upload_error_estimate_missing" };
        }

        // Determine category
        const category = session.uploadType || (hasImage ? "photo" : "signed_challan");

        // Download or save media file
        const uploadDir = path.resolve(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const ext = hasImage ? ".jpg" : (messageObj.documentMessage?.fileName ? path.extname(messageObj.documentMessage.fileName) || ".pdf" : ".pdf");
        const uniqueFileName = `whatsapp-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        const localPath = path.join(uploadDir, uniqueFileName);
        const relativePath = `/uploads/${uniqueFileName}`;
        let fileSize = 1024;

        if (process.env.WHATSAPP_MOCK === "1") {
          await fs.promises.writeFile(localPath, Buffer.from("MOCK_WHATSAPP_EVIDENCE_PAYLOAD"));
          fileSize = 31;
        } else {
          // Attempt downloading media from Evolution API
          try {
            const base64Resp = await fetch(`${config.serverUrl}/chat/getBase64FromMediaMessage/${config.instanceName}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: config.apiKey },
              body: JSON.stringify({ message: { key: msgData.key, message: messageObj } }),
            });
            if (base64Resp.ok) {
              const b64Data = await base64Resp.json();
              if (b64Data.base64) {
                const buffer = Buffer.from(b64Data.base64, "base64");
                await fs.promises.writeFile(localPath, buffer);
                fileSize = buffer.length;
              } else {
                await fs.promises.writeFile(localPath, Buffer.from("WHATSAPP_MEDIA_DATA"));
              }
            } else {
              await fs.promises.writeFile(localPath, Buffer.from("WHATSAPP_MEDIA_DATA"));
            }
          } catch {
            await fs.promises.writeFile(localPath, Buffer.from("WHATSAPP_MEDIA_DATA"));
          }
        }

        // Link into executionDocuments
        await db.insert(executionDocuments).values({
          companyId: estimate.companyId || companyId,
          estimateId: estimate.id,
          storeCode: project.storeName || null,
          documentType: category,
          filePath: relativePath,
          originalFileName: messageObj.documentMessage?.fileName || uniqueFileName,
          mimeType: hasImage ? "image/jpeg" : "application/pdf",
          fileSize,
          status: "active",
          uploadedBy: user.id,
          uploadedVia: "whatsapp",
          uploadedAt: new Date(),
          metadata: {
            whatsappPhone: senderPhone,
            remoteJid,
            messageId,
            caption: trimmedText || null,
          },
        });

        // Insert into botUploadInbox
        await db.insert(botUploadInbox).values({
          companyId: estimate.companyId || companyId,
          source: "whatsapp",
          senderId: senderPhone,
          senderName: user.name,
          messageText: trimmedText || `WhatsApp ${category}`,
          mediaUrl: relativePath,
          mediaLocalPath: localPath,
          mediaType: hasImage ? "photo" : "document",
          uploadType: category,
          mappedEstimateId: estimate.id,
          mappedStoreId: project.storeId || estimate.storeId || null,
          mappedClientId: estimate.clientId || null,
          status: "mapped",
          mappedAt: new Date(),
          mappedBy: user.id,
          remarks: `Auto-linked via WhatsApp bot to project ${estimate.estimateNumber}`,
          rawPayload: payload,
        });

        const categoryLabels: Record<string, string> = {
          photo: "Installation Photo",
          signed_challan: "Delivery Challan (DC)",
          wcc: "WCC Document",
          signed_wcc: "Signed WCC Proof",
          extra: "Other Document",
        };

        const label = categoryLabels[category] || category;

        await this.sendTextMessage(
          senderPhone,
          `✅ *Upload Received!*\n\n📁 *Project:* ${estimate.estimateNumber}\n📂 *Category:* ${label}\n📎 *File:* ${messageObj.documentMessage?.fileName || uniqueFileName}\n\nYour evidence has been securely saved in Sunrise Media ERP Project Workspace.\n\nSend more anytime or send *projects* to switch projects.`,
          { companyId, userId: user.id }
        );

        return { status: "processed", action: "media_saved" };
      }

      // Default fallback guidance
      await this.sendTextMessage(
        senderPhone,
        `👋 *Sunrise Media ERP Assistant*\n\nSend *projects* to view your assigned projects and begin uploading site evidence.`,
        { companyId, userId: user.id }
      );
      return { status: "processed", action: "help_guided" };
    }

    return { status: "processed_unhandled_event", event };
  }
}

export const whatsappEvolution = new WhatsAppEvolutionService();
