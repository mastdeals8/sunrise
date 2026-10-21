import { db } from "../db";
import {
  users,
  companyUsers,
  companies,
  fieldAccessLinks,
  estimates,
  clients,
  stores,
  botSettings,
} from "../../shared/schema";
import { eq, and, sql, isNull, gt, or } from "drizzle-orm";
import crypto from "crypto";

/**
 * Normalizes phone numbers to standard international E.164 without symbols.
 * Example: "+91 98236 33833" -> "+919823633833"
 *          "9823633833" -> "+919823633833" (10-digit Indian numbers get +91)
 */
export function normalizePhoneE164(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}

export function cleanPhoneLast10(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-10);
}

export interface AssignedProjectSummary {
  linkId: number;
  estimateId: number;
  estimateNumber: string;
  title: string;
  subject?: string;
  clientName?: string;
  storeName?: string;
  allowedStoreCodes?: string[];
  allowedDocumentTypes?: string[];
  expiresAt: string;
}

export interface InstallerContact {
  id: number;
  name: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  telegramChatId: string | null;
  telegramVerified: boolean;
  whatsappPhone: string | null;
  whatsappChatId: string | null;
  whatsappVerified: boolean;
  notes: string | null;
  companyId: number;
  assignedProjects: AssignedProjectSummary[];
}

export class InstallerService {
  /**
   * Lists all installers / contractors registered for a specific company.
   */
  async listInstallers(companyId: number, search?: string): Promise<InstallerContact[]> {
    // 1. Get users associated with this company
    const members = await db
      .select({
        user: users,
        companyUser: companyUsers,
      })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          or(
            eq(users.role, "installer"),
            eq(users.role, "contractor"),
            eq(users.role, "staff"),
            eq(users.role, "field")
          )
        )
      );

    // Fallback if companyUsers is empty: query users table directly if companyId === 1
    let allUsers = members.map((m) => m.user);
    if (allUsers.length === 0 && companyId === 1) {
      allUsers = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.role, "installer"),
            eq(users.role, "contractor"),
            eq(users.role, "staff"),
            eq(users.role, "field")
          )
        );
    }

    // Filter by search if provided
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      allUsers = allUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (u.phone && u.phone.includes(q)) ||
          (u.whatsappPhone && u.whatsappPhone.includes(q))
      );
    }

    // 2. Fetch all active fieldAccessLinks for these users
    const userIds = allUsers.map((u) => u.id);
    const results: InstallerContact[] = [];

    for (const u of allUsers) {
      const cleanPhone = cleanPhoneLast10(u.phone || "");
      const cleanWa = cleanPhoneLast10(u.whatsappPhone || "");

      const links = await db
        .select()
        .from(fieldAccessLinks)
        .where(
          and(
            sql`(${fieldAccessLinks.metadata}->>'userId' = ${String(u.id)} OR ${fieldAccessLinks.recipientContact} = ${u.phone || ""} OR (${cleanPhone ? sql`RIGHT(REGEXP_REPLACE(${fieldAccessLinks.recipientContact}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}` : sql`1=0`}))`,
            isNull(fieldAccessLinks.revokedAt),
            gt(fieldAccessLinks.expiresAt, new Date())
          )
        );

      const assignedProjects: AssignedProjectSummary[] = [];
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

        assignedProjects.push({
          linkId: link.id,
          estimateId: est.id,
          estimateNumber: est.estimateNumber,
          title: est.title,
          subject: est.subject || "",
          clientName,
          storeName,
          allowedStoreCodes: (link.allowedStoreCodes as string[]) || undefined,
          allowedDocumentTypes: (link.allowedDocumentTypes as string[]) || undefined,
          expiresAt: link.expiresAt.toISOString(),
        });
      }

      results.push({
        id: u.id,
        name: u.name,
        phone: u.phone,
        role: u.role || "installer",
        isActive: !!u.isActive,
        telegramChatId: u.telegramChatId || null,
        telegramVerified: !!u.telegramVerified || !!u.telegramChatId,
        whatsappPhone: u.whatsappPhone || u.phone || null,
        whatsappChatId: u.whatsappChatId || null,
        whatsappVerified: !!u.whatsappVerified,
        notes: u.notes || null,
        companyId,
        assignedProjects,
      });
    }

    return results;
  }

  /**
   * Registers a new installer/contractor or updates an existing contact.
   * Guarantees phone normalization, company isolation, and duplicate prevention.
   */
  async upsertInstaller(
    companyId: number,
    data: {
      id?: number;
      name: string;
      phone: string;
      role?: string;
      isActive?: boolean;
      whatsappPhone?: string;
      telegramChatId?: string;
      notes?: string;
    }
  ): Promise<InstallerContact> {
    const normalizedPhone = normalizePhoneE164(data.phone);
    const cleanPhone = cleanPhoneLast10(data.phone);

    if (!data.name || !data.name.trim()) {
      throw new Error("Contact name is required");
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      throw new Error("A valid 10-digit mobile number is required");
    }

    const normalizedWhatsapp = data.whatsappPhone ? normalizePhoneE164(data.whatsappPhone) : normalizedPhone;

    // Duplicate Check within the same company
    const existingMembers = await db
      .select({ user: users })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          sql`RIGHT(REGEXP_REPLACE(${users.phone}, '[^0-9]', '', 'g'), 10) = ${cleanPhone}`
        )
      );

    if (data.id) {
      // Editing existing contact
      const [currentUser] = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
      if (!currentUser) throw new Error("Installer contact not found");

      // Verify no other user in this company has this phone
      const duplicate = existingMembers.find((m) => m.user.id !== data.id);
      if (duplicate) {
        throw new Error(`Another contact named '${duplicate.user.name}' already has phone number ${data.phone} in this company.`);
      }

      await db
        .update(users)
        .set({
          name: data.name.trim(),
          phone: normalizedPhone,
          whatsappPhone: normalizedWhatsapp,
          role: data.role || currentUser.role || "installer",
          isActive: data.isActive !== undefined ? data.isActive : currentUser.isActive,
          telegramChatId: data.telegramChatId !== undefined ? data.telegramChatId : currentUser.telegramChatId,
          notes: data.notes !== undefined ? data.notes : currentUser.notes,
        })
        .where(eq(users.id, data.id));

      const [updated] = await this.listInstallers(companyId);
      const contact = (await this.listInstallers(companyId)).find((c) => c.id === data.id);
      return contact!;
    } else {
      // Adding new contact
      if (existingMembers.length > 0) {
        throw new Error(`A contact named '${existingMembers[0].user.name}' already exists with phone number ${data.phone} in this company.`);
      }

      const randomSuffix = crypto.randomBytes(4).toString("hex");
      const [newUser] = await db
        .insert(users)
        .values({
          username: `installer_${cleanPhone}_${randomSuffix}`,
          email: `installer_${cleanPhone}_${randomSuffix}@sunrisemedia.local`,
          password: crypto.randomBytes(16).toString("hex"),
          name: data.name.trim(),
          phone: normalizedPhone,
          whatsappPhone: normalizedWhatsapp,
          role: data.role || "installer",
          isActive: data.isActive !== undefined ? data.isActive : true,
          telegramChatId: data.telegramChatId || null,
          telegramVerified: Boolean(data.telegramChatId),
          whatsappVerified: false,
          notes: data.notes || `Registered in company #${companyId}`,
        })
        .returning();

      // Ensure company membership
      await db.insert(companyUsers).values({
        userId: newUser.id,
        companyId,
        role: "company_user",
        isDefault: true,
      });

      const contact = (await this.listInstallers(companyId)).find((c) => c.id === newUser.id);
      return contact!;
    }
  }

  /**
   * Deactivates an installer and revokes active assignments across both channels.
   */
  async deactivateInstaller(companyId: number, installerId: number, revokedBy?: number): Promise<boolean> {
    const [u] = await db.select().from(users).where(eq(users.id, installerId)).limit(1);
    if (!u) return false;

    await db.update(users).set({ isActive: false }).where(eq(users.id, installerId));

    // Revoke all active fieldAccessLinks for this user
    await db
      .update(fieldAccessLinks)
      .set({
        revokedAt: new Date(),
        revokedBy: revokedBy || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`(${fieldAccessLinks.metadata}->>'userId' = ${String(installerId)} OR ${fieldAccessLinks.recipientContact} = ${u.phone || ""})`,
          isNull(fieldAccessLinks.revokedAt)
        )
      );

    return true;
  }

  /**
   * One single assignment that instantly authorizes both Telegram and WhatsApp.
   */
  async assignProjectToInstaller(
    companyId: number,
    params: {
      installerId: number;
      estimateId: number;
      allowedStoreCodes?: string[];
      allowedDocumentTypes?: string[];
      createdBy?: number;
    }
  ): Promise<AssignedProjectSummary> {
    const [user] = await db.select().from(users).where(eq(users.id, params.installerId)).limit(1);
    if (!user) throw new Error("Installer not found");
    if (!user.isActive) throw new Error("Cannot assign project to an inactive installer");

    const [est] = await db.select().from(estimates).where(eq(estimates.id, params.estimateId)).limit(1);
    if (!est) throw new Error("Estimate/Project not found");
    if (est.companyId && est.companyId !== companyId) {
      throw new Error("Project belongs to a different company");
    }

    // Check if active assignment already exists
    const existing = await db
      .select()
      .from(fieldAccessLinks)
      .where(
        and(
          eq(fieldAccessLinks.estimateId, params.estimateId),
          sql`(${fieldAccessLinks.metadata}->>'userId' = ${String(user.id)} OR ${fieldAccessLinks.recipientContact} = ${user.phone || ""})`,
          isNull(fieldAccessLinks.revokedAt)
        )
      )
      .limit(1);

    let link = existing[0];
    if (!link) {
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000); // 45 days validity

      const [created] = await db
        .insert(fieldAccessLinks)
        .values({
          estimateId: est.id,
          tokenHash,
          tokenPrefix: token.slice(0, 8),
          channel: "dual", // Valid for BOTH Telegram and WhatsApp
          recipientName: user.name,
          recipientContact: user.phone || user.whatsappPhone || user.telegramChatId || null,
          allowedStoreCodes: params.allowedStoreCodes || null,
          allowedDocumentTypes: params.allowedDocumentTypes || ["photo", "signed_challan", "wcc", "signed_wcc", "extra"],
          expiresAt,
          createdBy: params.createdBy || null,
          metadata: {
            userId: user.id,
            companyId,
            estimateNumber: est.estimateNumber,
            telegramChatId: user.telegramChatId,
            whatsappPhone: user.whatsappPhone || user.phone,
            assignedVia: "unified_installer_directory",
          },
        })
        .returning();
      link = created;
    }

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

    return {
      linkId: link.id,
      estimateId: est.id,
      estimateNumber: est.estimateNumber,
      title: est.title,
      subject: est.subject || "",
      clientName,
      storeName,
      allowedStoreCodes: (link.allowedStoreCodes as string[]) || undefined,
      allowedDocumentTypes: (link.allowedDocumentTypes as string[]) || undefined,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * Revokes a specific project assignment by linkId.
   */
  async revokeAssignment(companyId: number, linkId: number, revokedBy?: number): Promise<boolean> {
    const [link] = await db.select().from(fieldAccessLinks).where(eq(fieldAccessLinks.id, linkId)).limit(1);
    if (!link) return false;

    await db
      .update(fieldAccessLinks)
      .set({
        revokedAt: new Date(),
        revokedBy: revokedBy || null,
        updatedAt: new Date(),
      })
      .where(eq(fieldAccessLinks.id, linkId));

    return true;
  }
}

export const installerService = new InstallerService();
