import { db } from "../db";
import { botSettings, botUploadInbox, webhookLogs, clients, stores } from "../../shared/schema";
import { eq, desc, and, or, sql } from "drizzle-orm";

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

/**
 * Normalizes an Indian or international phone number for WhatsApp E.164 without symbols.
 * Example: "+91 98236 33833" -> "919823633833"
 *          "9823633833" -> "919823633833" (10-digit defaults to India 91)
 */
export function normalizeWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
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

      // If open, fetch instance details (phone number, profile name)
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
        error: err.message,
      };
    }
  }

  /**
   * Initializes or connects an instance and retrieves the QR code for pairing.
   */
  async connectInstance(companyId: number = 1): Promise<{
    success: boolean;
    qrCode?: string | null;
    pairingCode?: string | null;
    state?: string;
    message?: string;
  }> {
    const config = await this.getConfig(companyId);
    if (!config.serverUrl || !config.apiKey) {
      throw new Error("Evolution API URL and API Key must be configured first.");
    }

    // Step 1: Ensure instance exists
    try {
      const checkResp = await fetch(`${config.serverUrl}/instance/connectionState/${config.instanceName}`, {
        headers: { apikey: config.apiKey },
      });

      if (checkResp.status === 404) {
        // Create instance
        const createResp = await fetch(`${config.serverUrl}/instance/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: config.apiKey,
          },
          body: JSON.stringify({
            instanceName: config.instanceName,
            token: config.apiKey,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          }),
        });

        if (!createResp.ok) {
          const errText = await createResp.text();
          throw new Error(`Failed to create instance: ${errText}`);
        }
      }
    } catch (err: any) {
      if (err.message?.includes("Failed to create instance")) throw err;
    }

    // Step 2: Request connection & QR code
    const connectResp = await fetch(`${config.serverUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
    });

    if (!connectResp.ok) {
      const errText = await connectResp.text();
      throw new Error(`Failed to initiate QR connection: ${errText}`);
    }

    const data = await connectResp.json();
    const qrCode = data.base64 || data.qrcode?.base64 || null;
    const pairingCode = data.pairingCode || null;

    // Save state in botSettings
    const existing = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
    const existingSettings = (existing[0]?.settings as any) || {};

    const updatedSettings = {
      ...existingSettings,
      lastQrCode: qrCode,
      lastPairingCode: pairingCode,
      connectionStatus: qrCode ? "qrcode" : "connecting",
      lastConnectAttemptAt: new Date().toISOString(),
    };

    if (existing.length) {
      await db
        .update(botSettings)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(botSettings.platform, "whatsapp"));
    } else {
      await db.insert(botSettings).values({
        platform: "whatsapp",
        companyId,
        enabled: true,
        settings: updatedSettings,
      });
    }

    return {
      success: true,
      qrCode,
      pairingCode,
      state: qrCode ? "qrcode" : "connecting",
    };
  }

  /**
   * Safely logs out and disconnects the WhatsApp session.
   */
  async disconnectInstance(companyId: number = 1): Promise<{ success: boolean; message: string }> {
    const config = await this.getConfig(companyId);
    try {
      const resp = await fetch(`${config.serverUrl}/instance/logout/${config.instanceName}`, {
        method: "DELETE",
        headers: { apikey: config.apiKey },
      });

      // Update botSettings
      const existing = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
      if (existing.length) {
        const settings = (existing[0].settings as any) || {};
        await db
          .update(botSettings)
          .set({
            enabled: false,
            settings: { ...settings, connectionStatus: "close", lastDisconnectedAt: new Date().toISOString() },
            updatedAt: new Date(),
          })
          .where(eq(botSettings.platform, "whatsapp"));
      }

      return { success: true, message: "WhatsApp session logged out successfully." };
    } catch (err: any) {
      return { success: false, message: err.message || "Failed to disconnect session." };
    }
  }

  /**
   * Sends a plain text message via WhatsApp.
   */
  async sendTextMessage(
    to: string,
    text: string,
    options?: { companyId?: number; userId?: number }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const companyId = options?.companyId || 1;
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
          options: {
            delay: 1200,
            presence: "composing",
          },
        }),
      });

      const data = await resp.json();
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
   * Sends a media or document attachment via WhatsApp (e.g. Invoice / Estimate PDF, Store Photo).
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

      const data = await resp.json();
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
      await db.insert(webhookLogs).values({
        companyId,
        platform: "whatsapp",
        direction: "outbound",
        event: "send_media",
        payload: { to: normalizedNumber, fileName, messageId },
        status: "processed",
      });

      return { success: true, messageId };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to send media." };
    }
  }

  /**
   * Handles inbound webhook payloads sent by Evolution API.
   * Extracts messages, deduplicates by WhatsApp message ID, and maps to CRM clients/stores.
   */
  async handleWebhook(payload: any, incomingSecret?: string): Promise<{ status: string; event?: string }> {
    const event = payload.event;
    const instance = payload.instance || "";

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
        } else {
          await db.insert(botSettings).values({
            platform: "whatsapp",
            companyId,
            enabled: false,
            settings: {
              lastQrCode: qrCode,
              connectionStatus: "qrcode",
            },
          });
        }
      }
      return { status: "processed", event: "qrcode.updated" };
    }


    // 3. Inbound Messages Upsert
    if (event === "messages.upsert") {
      const msgData = payload.data;
      if (!msgData) return { status: "ignored_empty" };

      const key = msgData.key || {};
      const fromMe = key.fromMe;
      if (fromMe) {
        // Skip messages sent from the connected phone itself to prevent echo loops
        return { status: "ignored_from_me" };
      }

      const messageId = key.id;
      const remoteJid = key.remoteJid || "";
      const senderPhone = remoteJid.replace(/@.*$/, "");
      const senderName = msgData.pushName || senderPhone;

      // Duplicate Check
      if (messageId) {
        const existingUploads = await db
          .select()
          .from(botUploadInbox)
          .where(sql`${botUploadInbox.rawPayload}->'data'->'key'->>'id' = ${messageId}`)
          .limit(1);

        if (existingUploads.length > 0) {
          return { status: "duplicate_skipped" };
        }
      }

      const messageObj = msgData.message || {};
      const text =
        messageObj.conversation ||
        messageObj.extendedTextMessage?.text ||
        messageObj.imageMessage?.caption ||
        messageObj.documentMessage?.caption ||
        "";

      let mediaType: "text" | "photo" | "document" | "video" = "text";
      let mediaUrl: string | null = null;

      if (messageObj.imageMessage) {
        mediaType = "photo";
        mediaUrl = messageObj.imageMessage.url || null;
      } else if (messageObj.documentMessage) {
        mediaType = "document";
        mediaUrl = messageObj.documentMessage.url || null;
      } else if (messageObj.videoMessage) {
        mediaType = "video";
        mediaUrl = messageObj.videoMessage.url || null;
      }

      // CRM Matching: attempt matching senderPhone with client or store in this company
      let mappedClientId: number | null = null;
      let mappedStoreId: number | null = null;
      let remarks: string | null = null;
      let status: "unlinked" | "mapped" = "unlinked";

      const phoneLast10 = senderPhone.slice(-10);

      // Match client by mobile
      if (phoneLast10.length === 10) {
        const matchingClients = await db
          .select()
          .from(clients)
          .where(and(eq(clients.companyId, companyId), sql`RIGHT(REGEXP_REPLACE(${clients.mobile}, '[^0-9]', '', 'g'), 10) = ${phoneLast10}`))
          .limit(1);

        if (matchingClients.length > 0) {
          mappedClientId = matchingClients[0].id;
          status = "mapped";
          remarks = `Auto-matched to client: ${matchingClients[0].name}`;
        } else {
          // Try matching store contact phone
          const matchingStores = await db
            .select()
            .from(stores)
            .where(and(eq(stores.companyId, companyId), sql`RIGHT(REGEXP_REPLACE(${stores.contactPhone}, '[^0-9]', '', 'g'), 10) = ${phoneLast10}`))
            .limit(1);

          if (matchingStores.length > 0) {
            mappedStoreId = matchingStores[0].id;
            mappedClientId = matchingStores[0].clientId || null;
            status = "mapped";
            remarks = `Auto-matched to store: ${matchingStores[0].name}`;
          }
        }
      }

      // Insert into Bot Upload Inbox
      await db.insert(botUploadInbox).values({
        companyId,
        source: "whatsapp",
        senderId: senderPhone,
        senderName,
        messageText: text || null,
        mediaType,
        mediaUrl,
        uploadType: mediaType === "photo" ? "photo" : mediaType === "document" ? "signed_challan" : "extra",
        rawPayload: payload,
        mappedClientId,
        mappedStoreId,
        status,
        remarks,
      });

      return { status: "processed", event: "messages.upsert" };
    }

    return { status: "processed_unhandled_event", event };
  }
}

export const whatsappEvolution = new WhatsAppEvolutionService();
