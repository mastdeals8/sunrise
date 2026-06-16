import { createServer, type Server } from "http";
import express, { type Express, Request, Response, NextFunction } from "express";
import { storage, sanitizeUser } from "./storage";
import { hashPassword, comparePassword, generateToken, authenticateToken, authenticateBrowserRequest, requireRole, setSessionCookie, clearSessionCookie, AuthRequest } from "./auth";
import { insertUserSchema, insertAttendanceSchema, insertTaskSchema, insertPettyCashExpenseSchema, insertInvoiceSchema, insertPaymentSchema, insertChartOfAccountSchema, insertClientSchema, insertClientBillingProfileSchema, insertBrandSchema, insertStoreSchema, insertProductSchema, insertEstimateSchema, insertEstimateItemSchema, insertStaffAdvanceSchema, insertPayrollSchema, insertDeliveryChallanSchema, clients, brands, stores, products, invoices, payments, botSettings, botUploadInbox, webhookLogs, customerRateCards, customerRateItems, estimates, estimateItems, deliveryChallans, executionDocuments, executionStores, fieldAccessLinks, staffAdvances, attendance, projectStoreStatus, users, telegramDeliveries } from "../shared/schema";
import { db } from "./db";
import { inArray, eq, sql } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { ensureIndexes } from "./indexes";
import { audit, diffForAudit } from "./audit";
import { deriveNotifications, refreshNotificationsThrottled } from "./notifications";
import { dispatchDelivery, buildDeliveryMessage, discoverChats, getBotToken } from "./telegram";
import { auditLogs, notifications } from "@shared/schema";
import { desc, isNull, and as andOp } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { strToU8, unzipSync, zipSync } from "fflate";
// xlsx-js-style is an API-compatible drop-in for "xlsx" that additionally
// honours per-cell `.s` style objects (fills, borders, fonts, alignment).
// Read paths (sheet_to_json on uploads) behave identically.
import XLSX from "xlsx-js-style";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { JWT_SECRET, UPLOAD_DIR, UPLOAD_MAX_BYTES, TELEGRAM_WEBHOOK_SECRET } from "./config";
import { preprocessDateFields, nowDefault } from "./utils/dateFields";
import { buildInvoicePacketPdf } from "./utils/pdfPacket.js";
import { ABLBL_LEGAL_NAME, isAblblFormat, normalizeDisplayName, normalizeFormatMode, normalizeGstinPan, nameMatchKey, nameSimilarity, NAME_SIMILAR_THRESHOLD } from "../shared/textFormat";
import { formatProductDetails } from "../shared/productDetails";

export async function registerRoutes(app: Express): Promise<Server> {
  const documentTypeForDc = (value: any): "wcc" | "dc" => {
    return isAblblFormat(value?.documentType || value?.clientFormat) ? "wcc" : String(value?.documentType || "").toLowerCase() === "wcc" ? "wcc" : "dc";
  };
  const storeCodeForDc = (value: any): string => {
    return String(value?.storeCode || value?.metadata?.storeCode || value?.metadata?.storeId || "").trim();
  };
  const normalizeStoreCode = (value: any) => String(value ?? "").trim();
  const storeCodeFromStore = (store: any, fallback: any) => normalizeStoreCode(store?.storeCode || fallback);
  const executionStoreKey = (estimateId: number, storeCode: string) => `${estimateId}:${normalizeStoreCode(storeCode).toLowerCase()}`;
  const fileNameFromPath = (filePath: string | null | undefined) => {
    if (!filePath) return null;
    return String(filePath).split("/").filter(Boolean).pop() || filePath;
  };
  const mimeTypeFromPath = (filePath: string | null | undefined) => {
    const lower = String(filePath || "").toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    return null;
  };
  const rootDocumentIdFor = (doc: any) => Number(doc?.metadata?.rootDocumentId || doc?.id || 0) || null;
  const loadExecutionDocumentVersions = async (doc: any) => {
    const rootId = rootDocumentIdFor(doc) || doc.id;
    const rows = await db.select().from(executionDocuments).where(sql`
      id = ${rootId}
      OR replaced_by_document_id = ${rootId}
      OR metadata->>'rootDocumentId' = ${String(rootId)}
    `);
    rows.sort((a: any, b: any) => Number(b.version || 1) - Number(a.version || 1));
    return { rootId, rows };
  };
  const legacyDeliveryChallanFileFieldForDoc = (documentType: string | null | undefined) => {
    switch (String(documentType || "").toLowerCase()) {
      case "signed_wcc":
      case "signed_dc":
        return deliveryChallans.signedChallanPath;
      case "photo":
        return deliveryChallans.photoPath;
      case "transport_receipt":
        return deliveryChallans.transportReceiptPath;
      case "extra":
        return deliveryChallans.extraDocPath;
      default:
        return null;
    }
  };
  const syncLegacyDeliveryChallanFile = async (doc: any, filePath: string | null, previousPath?: string | null) => {
    if (!doc?.deliveryChallanId) return;
    const documentType = String(doc.documentType || "").toLowerCase();
    const field = legacyDeliveryChallanFileFieldForDoc(documentType);
    if (!field) return;
    if (previousPath !== undefined) {
      const [owner] = await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, doc.deliveryChallanId)).limit(1);
      const currentPath = documentType === "photo"
        ? (owner as any)?.photoPath
        : documentType === "transport_receipt"
          ? (owner as any)?.transportReceiptPath
          : documentType === "extra"
            ? (owner as any)?.extraDocPath
            : (owner as any)?.signedChallanPath;
      if (normalizeStoredFilePath(currentPath) !== normalizeStoredFilePath(previousPath || "")) return;
    }
    if (documentType === "photo") {
      await db.update(deliveryChallans).set({ photoPath: filePath || null }).where(eq(deliveryChallans.id, doc.deliveryChallanId));
    } else if (documentType === "transport_receipt") {
      await db.update(deliveryChallans).set({ transportReceiptPath: filePath || null }).where(eq(deliveryChallans.id, doc.deliveryChallanId));
    } else if (documentType === "extra") {
      await db.update(deliveryChallans).set({ extraDocPath: filePath || null }).where(eq(deliveryChallans.id, doc.deliveryChallanId));
    } else {
      await db.update(deliveryChallans).set({ signedChallanPath: filePath || null }).where(eq(deliveryChallans.id, doc.deliveryChallanId));
    }
  };
  const normalizeStoredFilePath = (filePath: string | null | undefined) => {
    if (!filePath) return "";
    const raw = String(filePath).trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) return raw;
    return `/${raw.replace(/^\/+/, "")}`;
  };
  const generateFieldToken = () => crypto.randomBytes(32).toString("base64url");
  const hashFieldToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
  const normalizeAllowedDocumentType = (value: any) => {
    const raw = String(value || "").trim().toLowerCase();
    if (["photo", "photos", "image", "images"].includes(raw)) return "photo";
    if (["signed_wcc", "signed-wcc", "signed wcc", "wcc_signed"].includes(raw)) return "signed_wcc";
    if (["delivery_challan", "delivery-challan", "delivery challan", "dc", "signed_dc"].includes(raw)) return "signed_dc";
    return raw;
  };
  const fieldDocumentTypes = new Set(["photo", "signed_wcc", "signed_dc"]);
  const publicEstimateRef = (estimate: any) => ({
    id: estimate.id,
    estimateNumber: estimate.estimateNumber,
    title: estimate.title,
    status: estimate.status,
  });
  const resolveFieldLink = async (token: string) => {
    const raw = String(token || "").trim();
    if (!raw) return { error: "Access token is required", status: 401 as const };
    const [link] = await db.select().from(fieldAccessLinks).where(eq(fieldAccessLinks.tokenHash, hashFieldToken(raw))).limit(1);
    if (!link) return { error: "Invalid field access link", status: 404 as const };
    if (link.revokedAt) return { error: "This field link has been revoked", status: 403 as const };
    if (new Date(link.expiresAt as any).getTime() < Date.now()) return { error: "This field link has expired", status: 403 as const };
    return { link, status: 200 as const };
  };
  const allowedStoreCodesForLink = (link: any) =>
    Array.isArray(link.allowedStoreCodes) ? link.allowedStoreCodes.map((code: any) => normalizeStoreCode(code)).filter(Boolean) : [];
  const allowedDocumentTypesForLink = (link: any) => {
    const values = Array.isArray(link.allowedDocumentTypes) ? link.allowedDocumentTypes : ["photo", "signed_wcc", "signed_dc"];
    return values.map(normalizeAllowedDocumentType).filter((type: string) => fieldDocumentTypes.has(type));
  };
  const ensureExecutionDocument = async (doc: {
    estimateId: number;
    deliveryChallanId?: number | null;
    storeCode?: string | null;
    documentType: string;
    filePath?: string | null;
    uploadedBy?: number | null;
    uploadedVia?: string;
    uploadedAt?: Date | null;
    metadata?: any;
  }) => {
    const filePath = normalizeStoredFilePath(doc.filePath);
    if (!filePath) return null;
    const singleActiveOwnerTypes = new Set(["signed_wcc", "signed_dc", "transport_receipt", "extra"]);
    if (doc.deliveryChallanId && singleActiveOwnerTypes.has(String(doc.documentType || "").toLowerCase())) {
      const activeOwnerDoc = await db.select().from(executionDocuments)
        .where(sql`
          estimate_id = ${doc.estimateId}
          AND delivery_challan_id = ${doc.deliveryChallanId}
          AND document_type = ${doc.documentType}
          AND status = 'active'
        `)
        .limit(1);
      if (activeOwnerDoc[0]) return activeOwnerDoc[0];
    }
    const existing = await db.select().from(executionDocuments)
      .where(sql`
        estimate_id = ${doc.estimateId}
        AND COALESCE(delivery_challan_id, 0) = ${doc.deliveryChallanId || 0}
        AND document_type = ${doc.documentType}
        AND file_path = ${filePath}
        AND status = 'active'
      `)
      .limit(1);
    if (existing[0]) return existing[0];
    const inserted = await db.insert(executionDocuments).values({
      estimateId: doc.estimateId,
      deliveryChallanId: doc.deliveryChallanId || null,
      storeCode: doc.storeCode || null,
      documentType: doc.documentType,
      filePath,
      originalFileName: fileNameFromPath(filePath),
      mimeType: mimeTypeFromPath(filePath),
      status: "active",
      version: 1,
      uploadedBy: doc.uploadedBy || null,
      uploadedVia: doc.uploadedVia || "migration",
      uploadedAt: doc.uploadedAt || new Date(),
      metadata: doc.metadata || null,
    }).returning();
    return inserted[0];
  };
  const deriveExecutionStoreStatus = (input: { wccCount: number; dcCount: number; photoCount: number; signedWccCount: number; signedDcCount: number }) => {
    if ((input.signedWccCount > 0 || input.signedDcCount > 0) && (input.wccCount > 0 || input.dcCount > 0)) return "completed";
    if (input.signedWccCount > 0 || input.signedDcCount > 0) return "signed_wcc_received";
    if (input.wccCount > 0 || input.dcCount > 0) return "wcc_generated";
    if (input.photoCount > 0) return "photos_uploaded";
    return "pending";
  };
  const activeOwnerKeyForDocs = (estimateId: number, storeCode: string) => `${Number(estimateId)}:${normalizeStoreCode(storeCode).toLowerCase()}`;
  const buildActiveDocumentOwnerSet = (dcs: any[]) => {
    const activeOwnerIds = new Set<number>();
    const activeStoreKeys = new Set<string>();
    (dcs as any[]).forEach(dc => {
      if (dc.status === "deleted" || dc.metadata?.deleted) return;
      const storeCode = storeCodeForDc(dc);
      if (!storeCode) return;
      activeOwnerIds.add(Number(dc.id));
      activeStoreKeys.add(activeOwnerKeyForDocs(Number(dc.estimateId), storeCode));
    });
    return { activeOwnerIds, activeStoreKeys };
  };
  const documentHasActiveWorkflowOwner = (doc: any, owners: { activeOwnerIds: Set<number>; activeStoreKeys: Set<string> }) => {
    const type = String(doc.documentType || "").toLowerCase();
    if (!["photo", "signed_wcc", "signed_dc", "transport_receipt", "extra"].includes(type)) return true;
    const ownerId = Number(doc.deliveryChallanId || 0);
    if (ownerId) return owners.activeOwnerIds.has(ownerId);
    return owners.activeStoreKeys.has(activeOwnerKeyForDocs(Number(doc.estimateId), doc.storeCode));
  };
  const ensureExecutionStore = async (row: {
    estimateId: number;
    storeId?: number | null;
    storeCode: string;
    storeName?: string | null;
    storeLocation?: string | null;
    storeCity?: string | null;
    storeState?: string | null;
    storeAddress?: string | null;
    source?: string;
    metadata?: any;
  }) => {
    const storeCode = normalizeStoreCode(row.storeCode);
    if (!row.estimateId || !storeCode) return null;
    const existing = await db.select().from(executionStores)
      .where(sql`estimate_id = ${row.estimateId} AND lower(store_code) = lower(${storeCode})`)
      .limit(1);
    const values = {
      estimateId: row.estimateId,
      storeId: row.storeId || null,
      storeCode,
      storeName: row.storeName || null,
      storeLocation: row.storeLocation || null,
      storeCity: row.storeCity || null,
      storeState: row.storeState || null,
      storeAddress: row.storeAddress || null,
      source: row.source || "estimate_store_grouping",
      metadata: row.metadata || null,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      const updated = await db.update(executionStores)
        .set({
          storeId: existing[0].storeId || values.storeId,
          storeName: existing[0].storeName || values.storeName,
          storeLocation: existing[0].storeLocation || values.storeLocation,
          storeCity: existing[0].storeCity || values.storeCity,
          storeState: existing[0].storeState || values.storeState,
          storeAddress: existing[0].storeAddress || values.storeAddress,
          metadata: existing[0].metadata || values.metadata,
          updatedAt: new Date(),
        })
        .where(eq(executionStores.id, existing[0].id))
        .returning();
      return updated[0];
    }
    const inserted = await db.insert(executionStores).values(values).returning();
    return inserted[0];
  };
  const backfillExecutionStores = async () => {
    const [allEstimates, allStores, allItems, allDcs, allDocs, allOverrides] = await Promise.all([
      db.select().from(estimates),
      db.select().from(stores),
      db.select().from(estimateItems),
      db.select().from(deliveryChallans),
      db.select().from(executionDocuments),
      db.select().from(projectStoreStatus),
    ]);
    const storeById = new Map((allStores as any[]).map(store => [Number(store.id), store]));
    const itemsByEstimate = new Map<number, any[]>();
    (allItems as any[]).forEach(item => {
      const list = itemsByEstimate.get(Number(item.estimateId)) || [];
      list.push(item);
      itemsByEstimate.set(Number(item.estimateId), list);
    });
    const dcsByEstimate = new Map<number, any[]>();
    (allDcs as any[]).forEach(dc => {
      const list = dcsByEstimate.get(Number(dc.estimateId)) || [];
      list.push(dc);
      dcsByEstimate.set(Number(dc.estimateId), list);
    });

    for (const est of allEstimates as any[]) {
      const candidates = new Map<string, any>();
      const grouping = est.storeGrouping && typeof est.storeGrouping === "object" ? est.storeGrouping : {};
      Object.entries(grouping).forEach(([storeIdText, groupData]: [string, any]) => {
        const storeId = Number(storeIdText);
        const store = storeById.get(storeId);
        const storeCode = storeCodeFromStore(store, storeIdText);
        if (!storeCode) return;
        candidates.set(storeCode.toLowerCase(), {
          estimateId: est.id,
          storeId: Number.isFinite(storeId) ? storeId : null,
          storeCode,
          storeName: groupData?.storeName || store?.name || null,
          storeLocation: groupData?.storeLocation || store?.location || null,
          storeCity: groupData?.storeCity || store?.city || null,
          storeState: groupData?.storeState || store?.state || null,
          storeAddress: groupData?.storeAddress || store?.address || null,
          source: "estimate_store_grouping",
          metadata: { source: "estimate.storeGrouping", itemSls: groupData?.itemSls || [] },
        });
      });

      if (Object.keys(grouping).length === 0) {
        (itemsByEstimate.get(Number(est.id)) || []).forEach(item => {
          const explicitStoreCode = normalizeStoreCode(item.storeCode);
          if (!explicitStoreCode) return;
          const store = (allStores as any[]).find(candidate => normalizeStoreCode(candidate.storeCode).toLowerCase() === explicitStoreCode.toLowerCase());
          if (candidates.has(explicitStoreCode.toLowerCase())) return;
          candidates.set(explicitStoreCode.toLowerCase(), {
            estimateId: est.id,
            storeId: store?.id || null,
            storeCode: explicitStoreCode,
            storeName: item.manualStoreName || store?.name || null,
            storeLocation: store?.location || null,
            storeCity: store?.city || null,
            storeState: store?.state || null,
            storeAddress: store?.address || null,
            source: "estimate_items",
            metadata: { source: "estimate_items.storeCode" },
          });
        });
      }

      (dcsByEstimate.get(Number(est.id)) || []).forEach(dc => {
        const storeCode = storeCodeForDc(dc);
        if (!storeCode || candidates.has(storeCode.toLowerCase())) return;
        const storeId = Number(dc.metadata?.storeId);
        const store = storeById.get(storeId);
        candidates.set(storeCode.toLowerCase(), {
          estimateId: est.id,
          storeId: Number.isFinite(storeId) && storeId > 0 ? storeId : null,
          storeCode,
          storeName: dc.metadata?.storeName || store?.name || null,
          storeLocation: store?.location || null,
          storeCity: store?.city || null,
          storeState: store?.state || null,
          storeAddress: dc.metadata?.storeAddress || store?.address || null,
          source: "delivery_challans",
          metadata: { source: "delivery_challans.metadata" },
        });
      });

      if (candidates.size === 0 && est.storeId) {
        const store = storeById.get(Number(est.storeId));
        const storeCode = storeCodeFromStore(store, est.storeId);
        if (storeCode) {
          candidates.set(storeCode.toLowerCase(), {
            estimateId: est.id,
            storeId: Number(est.storeId),
            storeCode,
            storeName: store?.name || null,
            storeLocation: store?.location || null,
            storeCity: store?.city || null,
            storeState: store?.state || null,
            storeAddress: store?.address || null,
            source: "estimate_store_id",
            metadata: { source: "estimates.storeId" },
          });
        }
      }

      for (const row of Array.from(candidates.values())) {
        await ensureExecutionStore(row);
      }
    }

    const groupedEstimateIds = new Set((allEstimates as any[])
      .filter(est => est.storeGrouping && typeof est.storeGrouping === "object" && Object.keys(est.storeGrouping).length > 0)
      .map(est => Number(est.id)));
    const currentRowsBeforeCleanup = await db.select().from(executionStores);
    for (const row of currentRowsBeforeCleanup as any[]) {
      if (row.source !== "estimate_items" || !groupedEstimateIds.has(Number(row.estimateId))) continue;
      const hasDc = (allDcs as any[]).some(dc => Number(dc.estimateId) === Number(row.estimateId) && storeCodeForDc(dc).toLowerCase() === normalizeStoreCode(row.storeCode).toLowerCase());
      const hasDoc = (allDocs as any[]).some(doc => Number(doc.estimateId) === Number(row.estimateId) && normalizeStoreCode(doc.storeCode).toLowerCase() === normalizeStoreCode(row.storeCode).toLowerCase());
      if (!hasDc && !hasDoc) {
        await db.delete(executionStores).where(eq(executionStores.id, row.id));
      }
    }

    const currentRows = await db.select().from(executionStores);
    const stats = new Map<string, { wccCount: number; dcCount: number; photoCount: number; signedWccCount: number; signedDcCount: number }>();
    (currentRows as any[]).forEach(row => {
      stats.set(executionStoreKey(row.estimateId, row.storeCode), { wccCount: 0, dcCount: 0, photoCount: 0, signedWccCount: 0, signedDcCount: 0 });
    });
    (allDcs as any[]).forEach(dc => {
      if (dc.status === "deleted" || dc.metadata?.deleted) return;
      const key = executionStoreKey(dc.estimateId, storeCodeForDc(dc));
      const item = stats.get(key);
      if (!item) return;
      if (documentTypeForDc(dc) === "wcc") item.wccCount += 1;
      else item.dcCount += 1;
    });
    const allActiveOwners = buildActiveDocumentOwnerSet(allDcs as any[]);
    (allDocs as any[]).forEach(doc => {
      if (doc.status === "deleted") return;
      if (!documentHasActiveWorkflowOwner(doc, allActiveOwners)) return;
      const key = executionStoreKey(doc.estimateId, doc.storeCode);
      const item = stats.get(key);
      if (!item) return;
      if (doc.documentType === "photo") item.photoCount += 1;
      if (doc.documentType === "signed_wcc") item.signedWccCount += 1;
      if (doc.documentType === "signed_dc") item.signedDcCount += 1;
    });
    const overrideByKey = new Map((allOverrides as any[]).map(row => [executionStoreKey(row.estimateId, row.storeCode), row]));
    for (const row of currentRows as any[]) {
      const key = executionStoreKey(row.estimateId, row.storeCode);
      const override = overrideByKey.get(key);
      const derivedStatus = override?.status || deriveExecutionStoreStatus(stats.get(key) || { wccCount: 0, dcCount: 0, photoCount: 0, signedWccCount: 0, signedDcCount: 0 });
      await db.update(executionStores)
        .set({ status: derivedStatus, updatedAt: new Date() })
        .where(eq(executionStores.id, row.id));
    }
  };
  const backfillExecutionDocuments = async () => {
    const allEstimates = await db.select().from(estimates);
    for (const est of allEstimates as any[]) {
      if (est.poFilePath) {
        await ensureExecutionDocument({
          estimateId: est.id,
          documentType: "po",
          filePath: est.poFilePath,
          uploadedBy: est.createdBy || null,
          uploadedVia: "migration",
          uploadedAt: est.poDate || est.createdAt || new Date(),
          metadata: { source: "estimates.poFilePath", poNumber: est.poNumber || null },
        });
      }
    }
    const allDcs = await db.select().from(deliveryChallans);
    for (const dc of allDcs as any[]) {
      const dcType = documentTypeForDc(dc);
      const storeCode = storeCodeForDc(dc) || null;
      if (dc.photoPath) {
        await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "photo", filePath: dc.photoPath, uploadedVia: "migration", uploadedAt: dc.createdAt || new Date(), metadata: { source: "delivery_challans.photoPath" } });
      }
      if (dc.signedChallanPath) {
        await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: dcType === "wcc" ? "signed_wcc" : "signed_dc", filePath: dc.signedChallanPath, uploadedVia: "migration", uploadedAt: dc.createdAt || new Date(), metadata: { source: "delivery_challans.signedChallanPath" } });
      }
      if (dc.transportReceiptPath) {
        await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "transport_receipt", filePath: dc.transportReceiptPath, uploadedVia: "migration", uploadedAt: dc.createdAt || new Date(), metadata: { source: "delivery_challans.transportReceiptPath" } });
      }
      if (dc.extraDocPath) {
        await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "extra", filePath: dc.extraDocPath, uploadedVia: "migration", uploadedAt: dc.createdAt || new Date(), metadata: { source: "delivery_challans.extraDocPath" } });
      }
      const photos = Array.isArray(dc.metadata?.photos) ? dc.metadata.photos : [];
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "photo", filePath: photo?.path, uploadedVia: "migration", uploadedAt: dc.createdAt || new Date(), metadata: { source: "delivery_challans.metadata.photos", index: i, photo } });
      }
    }
  };
  const findActiveDuplicateWcc = async (payload: any, excludeId?: number) => {
    if (documentTypeForDc(payload) !== "wcc") return null;
    const storeCode = storeCodeForDc(payload);
    if (!payload.estimateId || !storeCode) return null;
    const rows = await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, Number(payload.estimateId)));
    return (rows as any[]).find((row) => {
      if (excludeId && Number(row.id) === Number(excludeId)) return false;
      if (row.status === "deleted" || row.metadata?.deleted) return false;
      if (documentTypeForDc(row) !== "wcc") return false;
      return storeCodeForDc(row) === storeCode;
    }) || null;
  };
  const syncEstimateDocuments = async (estimate: any, uploadedBy?: number | null) => {
    if (!estimate?.id || !estimate.poFilePath) return;
    await ensureExecutionDocument({
      estimateId: estimate.id,
      documentType: "po",
      filePath: estimate.poFilePath,
      uploadedBy: uploadedBy || estimate.createdBy || null,
      uploadedVia: "erp",
      uploadedAt: estimate.poDate || new Date(),
      metadata: { source: "estimates.poFilePath", poNumber: estimate.poNumber || null },
    });
  };
  const syncDeliveryChallanDocuments = async (dc: any, uploadedBy?: number | null) => {
    if (!dc?.id || !dc.estimateId) return;
    const dcType = documentTypeForDc(dc);
    const storeCode = storeCodeForDc(dc) || null;
    if (dc.photoPath) {
      await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "photo", filePath: dc.photoPath, uploadedBy: uploadedBy || null, uploadedVia: "erp", uploadedAt: new Date(), metadata: { source: "delivery_challans.photoPath" } });
    }
    if (dc.signedChallanPath) {
      await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: dcType === "wcc" ? "signed_wcc" : "signed_dc", filePath: dc.signedChallanPath, uploadedBy: uploadedBy || null, uploadedVia: "erp", uploadedAt: new Date(), metadata: { source: "delivery_challans.signedChallanPath" } });
    }
    if (dc.transportReceiptPath) {
      await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "transport_receipt", filePath: dc.transportReceiptPath, uploadedBy: uploadedBy || null, uploadedVia: "erp", uploadedAt: new Date(), metadata: { source: "delivery_challans.transportReceiptPath" } });
    }
    if (dc.extraDocPath) {
      await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "extra", filePath: dc.extraDocPath, uploadedBy: uploadedBy || null, uploadedVia: "erp", uploadedAt: new Date(), metadata: { source: "delivery_challans.extraDocPath" } });
    }
    const photos = Array.isArray(dc.metadata?.photos) ? dc.metadata.photos : [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      await ensureExecutionDocument({ estimateId: dc.estimateId, deliveryChallanId: dc.id, storeCode, documentType: "photo", filePath: photo?.path, uploadedBy: uploadedBy || null, uploadedVia: "erp", uploadedAt: new Date(), metadata: { source: "delivery_challans.metadata.photos", index: i, photo } });
    }
  };
  const reconcileSignedExecutionDocumentOwners = async () => {
    const allDcs = await db.select().from(deliveryChallans);
    const activeOwners = buildActiveDocumentOwnerSet(allDcs as any[]);
    const activeOwnedDocs = await db.select().from(executionDocuments).where(sql`
      status = 'active'
      AND delivery_challan_id IS NOT NULL
      AND document_type IN ('photo', 'signed_wcc', 'signed_dc', 'transport_receipt', 'extra')
    `);
    for (const doc of activeOwnedDocs as any[]) {
      if (documentHasActiveWorkflowOwner(doc, activeOwners)) continue;
      await db.update(executionDocuments)
        .set({
          status: "deleted",
          deletedAt: new Date(),
          metadata: { ...(doc.metadata || {}), deletedReason: "inactive_delivery_challan_owner" },
          updatedAt: new Date(),
        })
        .where(eq(executionDocuments.id, doc.id));
    }
    const activeSignedDocs = await db.select().from(executionDocuments).where(sql`
      status = 'active'
      AND delivery_challan_id IS NOT NULL
      AND document_type IN ('signed_wcc', 'signed_dc')
    `);
    const latestByDc = new Map<number, any>();
    for (const doc of activeSignedDocs as any[]) {
      const dcId = Number(doc.deliveryChallanId || 0);
      if (!dcId) continue;
      const current = latestByDc.get(dcId);
      const currentTime = current ? new Date((current.uploadedAt || current.createdAt) as any).getTime() : 0;
      const docTime = new Date((doc.uploadedAt || doc.createdAt) as any).getTime();
      if (!current || Number(doc.version || 1) > Number(current.version || 1) || docTime > currentTime) {
        latestByDc.set(dcId, doc);
      }
    }
    // PERF (Phase 2): single IN(...) fetch instead of one SELECT per document.
    const latestDocs = Array.from(latestByDc.values());
    const ownerIds = latestDocs.map((doc: any) => Number(doc.deliveryChallanId)).filter(Boolean);
    const owners = ownerIds.length
      ? await db.select().from(deliveryChallans).where(inArray(deliveryChallans.id, ownerIds))
      : [];
    const ownerById = new Map((owners as any[]).map((o: any) => [Number(o.id), o]));
    for (const doc of latestDocs) {
      const owner = ownerById.get(Number(doc.deliveryChallanId));
      if (!owner) continue;
      if (normalizeStoredFilePath((owner as any).signedChallanPath) === normalizeStoredFilePath(doc.filePath)) continue;
      await syncLegacyDeliveryChallanFile(doc, doc.filePath);
    }
    for (const doc of activeSignedDocs as any[]) {
      const ownerDoc = latestByDc.get(Number(doc.deliveryChallanId || 0));
      if (!ownerDoc || Number(ownerDoc.id) === Number(doc.id)) continue;
      await db.update(executionDocuments)
        .set({ status: "replaced", replacedByDocumentId: ownerDoc.id, updatedAt: new Date() })
        .where(eq(executionDocuments.id, doc.id));
    }
  };
  const deriveInvoiceReadinessForEstimate = async (estimateId: number) => {
    const [estimate] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
    if (!estimate) return { ready: false, message: "Estimate not found", checks: {} };
    const [storeRows, docs, dcs] = await Promise.all([
      db.select().from(executionStores).where(eq(executionStores.estimateId, estimateId)),
      db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, estimateId)),
      db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, estimateId)),
    ]);
    const activeDcs = (dcs as any[]).filter(dc => dc.status !== "deleted" && !dc.metadata?.deleted);
    const activeOwners = buildActiveDocumentOwnerSet(activeDcs);
    const activeDocs = (docs as any[]).filter(doc => doc.status === "active" && documentHasActiveWorkflowOwner(doc, activeOwners));
    const storesReady = (storeRows as any[]).map(row => {
      const key = normalizeStoreCode(row.storeCode).toLowerCase();
      const storeDcs = activeDcs.filter(dc => storeCodeForDc(dc).toLowerCase() === key);
      const storeDocs = activeDocs.filter(doc => normalizeStoreCode(doc.storeCode).toLowerCase() === key);
      const stats = {
        wccCount: storeDcs.filter(dc => documentTypeForDc(dc) === "wcc").length,
        dcCount: storeDcs.filter(dc => documentTypeForDc(dc) !== "wcc").length,
        photoCount: storeDocs.filter(doc => doc.documentType === "photo").length,
        signedWccCount: storeDocs.filter(doc => doc.documentType === "signed_wcc").length,
        signedDcCount: storeDocs.filter(doc => doc.documentType === "signed_dc").length,
      };
      return { row, stats, completed: deriveExecutionStoreStatus(stats) === "completed" };
    });
    const storeCount = storesReady.length;
    const generated = storesReady.filter(item => (item.stats.wccCount + item.stats.dcCount) > 0).length;
    const signed = storesReady.filter(item => (item.stats.signedWccCount + item.stats.signedDcCount) > 0).length;
    const photos = storesReady.filter(item => item.stats.photoCount > 0).length;
    const completed = storesReady.filter(item => item.completed).length;
    const checks = {
      poAttached: Boolean((estimate as any).poNumber || (estimate as any).poFilePath),
      wccGenerated: storeCount > 0 && generated >= storeCount,
      signedWccReceived: storeCount > 0 && signed >= storeCount,
      photosUploaded: storeCount > 0 && photos >= storeCount,
      executionComplete: storeCount > 0 && completed >= storeCount,
    };
    return {
      ready: Object.values(checks).every(Boolean),
      checks,
      counts: { storeCount, generated, signed, photos, completed },
    };
  };
  // DDL: additive columns — fast, idempotent, must complete before routes serve queries.
  await db.execute(sql`ALTER TABLE brands ADD COLUMN IF NOT EXISTS parent_client_id integer REFERENCES clients(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE estimates ADD COLUMN IF NOT EXISTS estimate_date timestamp`);
  await db.execute(sql`ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS store_sort_order integer`);
  await db.execute(sql`ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS row_sort_order integer`);
  await db.execute(sql`ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'dc'`);

  // Data backfills: idempotent UPDATEs that run in background so they never
  // delay server.listen. Safe because all columns have defaults and app code
  // handles NULL values via COALESCE / OR fallbacks already.
  void (async () => {
    try {
      await db.execute(sql`
        UPDATE brands b SET parent_client_id = c.id FROM clients c
        WHERE b.parent_client_id IS NULL AND b.parent_brand IS NOT NULL
          AND (lower(trim(b.parent_brand)) = lower(trim(c.name))
            OR lower(trim(b.parent_brand)) = lower(trim(coalesce(c.client_group_name, ''))))
      `);
      await db.execute(sql`UPDATE estimates SET estimate_date = created_at WHERE estimate_date IS NULL`);
      await db.execute(sql`
        UPDATE estimate_items
        SET store_sort_order = COALESCE(store_sort_order, sl, id),
            row_sort_order = COALESCE(row_sort_order, sl, id)
        WHERE store_sort_order IS NULL OR row_sort_order IS NULL
      `);
      await db.execute(sql`
        UPDATE delivery_challans SET document_type = CASE
          WHEN lower(coalesce(document_type, '')) = 'wcc'
            OR lower(coalesce(client_format, '')) IN ('abfrl', 'ablbl', 'abfrl_multi_store', 'ablbl_multi_store')
          THEN 'wcc' ELSE 'dc' END
      `);
    } catch (e) { console.error("[startup] data backfills:", e); }
  })();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS execution_documents (
      id serial PRIMARY KEY,
      estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      delivery_challan_id integer REFERENCES delivery_challans(id) ON DELETE SET NULL,
      store_code text,
      document_type text NOT NULL,
      file_path text NOT NULL,
      original_file_name text,
      mime_type text,
      file_size integer,
      status text NOT NULL DEFAULT 'active',
      version integer NOT NULL DEFAULT 1,
      uploaded_by integer REFERENCES users(id),
      uploaded_via text NOT NULL DEFAULT 'erp',
      uploaded_at timestamp DEFAULT now(),
      replaced_by_document_id integer,
      deleted_at timestamp,
      deleted_by integer REFERENCES users(id),
      metadata jsonb,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS execution_stores (
      id serial PRIMARY KEY,
      estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      store_id integer REFERENCES stores(id) ON DELETE SET NULL,
      store_code text NOT NULL,
      store_name text,
      store_location text,
      store_city text,
      store_state text,
      store_address text,
      status text NOT NULL DEFAULT 'pending_execution',
      source text NOT NULL DEFAULT 'estimate_store_grouping',
      metadata jsonb,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS field_access_links (
      id serial PRIMARY KEY,
      estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      token_prefix text,
      channel text NOT NULL DEFAULT 'telegram',
      recipient_name text,
      recipient_contact text,
      allowed_store_codes jsonb,
      allowed_document_types jsonb,
      permissions jsonb,
      expires_at timestamp NOT NULL,
      revoked_at timestamp,
      revoked_by integer REFERENCES users(id),
      created_by integer REFERENCES users(id),
      last_used_at timestamp,
      use_count integer NOT NULL DEFAULT 0,
      metadata jsonb,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    )
  `);
  // All indexes and heavy backfills run in background — all IF NOT EXISTS / idempotent.
  void (async () => {
    try {
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_estimate ON execution_documents(estimate_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_dc ON execution_documents(delivery_challan_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_store ON execution_documents(estimate_id, store_code)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_documents_type ON execution_documents(document_type, status)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_stores_estimate_store ON execution_stores(estimate_id, lower(store_code))`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_estimate ON execution_stores(estimate_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_execution_stores_status ON execution_stores(status)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_estimate ON field_access_links(estimate_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_expiry ON field_access_links(expires_at)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_field_access_links_channel ON field_access_links(channel)`);
    } catch (e) { console.error("[startup] indexes:", e); }
    try { await backfillExecutionDocuments(); } catch (e) { console.error("[startup] backfillExecutionDocuments:", e); }
    try { await reconcileSignedExecutionDocumentOwners(); } catch (e) { console.error("[startup] reconcileSignedExecutionDocumentOwners:", e); }
    try { await backfillExecutionStores(); } catch (e) { console.error("[startup] backfillExecutionStores:", e); }
    try { await ensureIndexes(db); } catch (e) { console.error("[startup] ensureIndexes:", e); }
  })();

  // Health check — used by Railway / Render / Fly.io to verify the server is up.
  // Must be registered BEFORE authentication middleware so probes are not rejected.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, app: "Sunrise Media ERP" });
  });

  // Configure uploads folder and multer
  const uploadDir = UPLOAD_DIR;
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  const companyAssetDir = path.join(uploadDir, "company-assets");
  if (!fs.existsSync(companyAssetDir)) {
    fs.mkdirSync(companyAssetDir, { recursive: true });
  }

  const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + ext);
    }
  });

  // ── Upload hardening (audit H2): size limit + extension/MIME allowlist ──
  const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf",
    ".xls", ".xlsx", ".csv", ".doc", ".docx", ".ppt", ".pptx", ".txt", ".zip",
  ]);
  const ALLOWED_UPLOAD_MIMETYPES = /^(image\/(png|jpe?g|webp|gif)|application\/pdf|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document|presentationml\.presentation))|application\/msword|application\/vnd\.ms-powerpoint|text\/(csv|plain)|application\/(zip|x-zip-compressed)|application\/octet-stream)$/i;
  const uploadFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      cb(new Error(`File type ${ext || "(none)"} is not allowed`));
      return;
    }
    if (!ALLOWED_UPLOAD_MIMETYPES.test(file.mimetype || "")) {
      cb(new Error(`MIME type ${file.mimetype} is not allowed`));
      return;
    }
    cb(null, true);
  };

  /**
   * Virus-scan hook placeholder (audit H2). Wire to ClamAV / VirusTotal / a
   * cloud scanner later. Returning { clean: true } keeps current behaviour.
   */
  const scanUploadedFile = async (_filePath: string): Promise<{ clean: boolean; reason?: string }> => {
    // TODO: integrate real scanner, e.g. clamdjs scan(filePath)
    return { clean: true };
  };
  void scanUploadedFile; // referenced for future use; silences unused warning

  const upload = multer({
    storage: uploadStorage,
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 5 },
    fileFilter: uploadFileFilter,
  });
  const companyAssetStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, companyAssetDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeField = String(file.fieldname || "asset").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, safeField + "-" + uniqueSuffix + ext);
    }
  });
  const companyAssetUpload = multer({
    storage: companyAssetStorage,
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error("Only PNG, JPEG, or WebP images are allowed for company document assets"));
    }
  });

  // NOTE (audit C1): public express.static for /uploads removed. Files are now
  // served via an authenticated handler in server/index.ts.

  // ── Final hardening: global response sensitive-field scrubber ───────────
  // Defense in depth. Recursively strips known secret keys from EVERY /api JSON
  // response so no endpoint — present or future — can leak them. Endpoint-level
  // masking (e.g. botToken ••••last4) still applies; this is the safety net.
  const SENSITIVE_KEYS = new Set([
    "password", "passwordHash", "password_hash",
    "tokenHash", "token_hash", "refreshToken", "resetToken",
    "verifyToken", "verify_token", "jwtSecret", "sessionSecret",
  ]);
  const scrubSensitive = (val: any, depth = 0): any => {
    if (depth > 6 || val === null || typeof val !== "object") return val;
    // Date objects must pass through unchanged — they have no enumerable own properties,
    // so the plain-object branch below would silently turn them into {}.
    if (val instanceof Date) return val;
    if (Array.isArray(val)) return val.map((v) => scrubSensitive(v, depth + 1));
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      if (SENSITIVE_KEYS.has(k)) continue; // drop
      // Mask bot/access tokens to last 4 rather than dropping (UI shows hint).
      if ((k === "botToken" || k === "accessToken") && typeof v === "string" && !v.startsWith("••••")) {
        out[k] = "••••" + v.slice(-4);
        continue;
      }
      out[k] = scrubSensitive(v, depth + 1);
    }
    return out;
  };
  app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
    const orig = res.json.bind(res);
    (res as any).json = (body: any) => orig(scrubSensitive(body));
    next();
  });

  // ── Phase 3: generic audit middleware ──────────────────────────────────
  // Auto-logs every successful mutating API call (who/when/what/new value).
  // Rich entries with oldValue are added explicitly on core entities below.
  const AUDIT_SKIP = [/^\/api\/auth\//, /^\/api\/webhook\//, /^\/api\/notifications/];
  const ENTITY_LINKS: Record<string, string> = {
    estimates: "estimate", invoices: "invoice", "delivery-challans": "delivery_challan",
    payments: "payment", "execution-documents": "execution_document", clients: "client",
    brands: "brand", stores: "store", products: "product", "material-codes": "material_code",
    "rate-cards": "rate_card", uploads: "upload", users: "user", "petty-cash": "petty_cash",
  };
  app.use("/api", (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (AUDIT_SKIP.some((rx) => rx.test(req.originalUrl))) return next();
    const originalJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 300 && !(res as any).__auditDone) {
          const segs = req.path.split("/").filter(Boolean); // e.g. operations/estimates/12
          const idSeg = segs.findIndex((s) => /^\d+$/.test(s));
          const entitySeg = idSeg > 0 ? segs[idSeg - 1] : segs[segs.length - 1];
          const entityType = ENTITY_LINKS[entitySeg] || entitySeg;
          const entityId = idSeg >= 0 ? Number(segs[idSeg]) : (body && typeof body === "object" ? body.id ?? null : null);
          const action = req.method === "POST" ? "create" : req.method === "DELETE" ? "delete" : "update";
          audit(req, {
            action: action as any,
            entityType,
            entityId,
            entityLabel: body?.estimateNumber || body?.invoiceNumber || body?.dcNumber || body?.name || null,
            estimateId: body?.estimateId ?? (entityType === "estimate" ? entityId : null),
            invoiceId: body?.invoiceId ?? (entityType === "invoice" ? entityId : null),
            deliveryChallanId: body?.deliveryChallanId ?? (entityType === "delivery_challan" ? entityId : null),
            newValue: req.method === "DELETE" ? null : (typeof body === "object" ? body : null),
          });
        }
      } catch { /* auditing must never break the request */ }
      return originalJson(body);
    };
    next();
  });

  // Opt-in text search helper (Phase 2): case-insensitive substring match
  // across the given fields when ?q= is present. Runs BEFORE pagination so
  // X-Total-Count reflects the filtered set. No params → list unchanged.
  const searchList = <T extends Record<string, any>>(list: T[], req: Request, fields: string[]): T[] => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) =>
      fields.some((f) => String(row?.[f] ?? "").toLowerCase().includes(q))
    );
  };

  // Opt-in pagination helper (audit H4). Slices an in-memory list when the
  // request carries ?limit= (and optional ?offset=). Returns total=null when
  // pagination is not requested so handlers keep legacy full-list behaviour.
  const paginateList = <T,>(list: T[], req: Request): { page: T[]; total: number | null } => {
    const rawLimit = req.query.limit;
    if (rawLimit === undefined) return { page: list, total: null };
    const limit = Math.min(Math.max(parseInt(String(rawLimit), 10) || 0, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset || 0), 10) || 0, 0);
    return { page: list.slice(offset, offset + limit), total: list.length };
  };

  const normalizeBool = (value: any, fallback = false) => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["true", "yes", "y", "1", "active"].includes(String(value).trim().toLowerCase());
  };

  const normalizeImportFormat = (value: any) => {
    return normalizeFormatMode(value);
  };

  const namesMatch = (a: any, b: any) => normalizeDisplayName(a).toLowerCase() === normalizeDisplayName(b).toLowerCase();

  const estimateServiceLineTypes = new Set(["packing", "installation", "transport"]);
  const isEstimateServiceItem = (item: any) => estimateServiceLineTypes.has(String(item?.lineType || "").toLowerCase());
  const serviceItemRateValue = (item: any) => Number(item?.rate) || 0;
  const serviceItemLabel = (item: any) => {
    const lineType = String(item?.lineType || "").toLowerCase();
    const rate = serviceItemRateValue(item);
    if (lineType === "packing") return rate > 0 ? `Packing Charges (${rate}%)` : "Packing Charges";
    if (lineType === "installation") return rate > 0 ? `Installation Charges (${rate}%)` : "Installation Charges";
    if (lineType === "transport" && String(item?.unit || "").toLowerCase() === "km") {
      return rate > 0 ? `Outstation Transportation (₹${rate}/KM)` : "Outstation Transportation";
    }
    if (lineType === "transport") return "Local Transportation";
    return item?.itemName || "";
  };
  const serviceItemRateLabel = (item: any) => item?.calculationType === "percentage" ? `${serviceItemRateValue(item)}%` : "";
  const numericOrder = (value: any, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const compareEstimateItems = (a: any, b: any) => {
    const aStore = numericOrder(a?.storeSortOrder, numericOrder(a?.sl, numericOrder(a?.id, 0)));
    const bStore = numericOrder(b?.storeSortOrder, numericOrder(b?.sl, numericOrder(b?.id, 0)));
    if (aStore !== bStore) return aStore - bStore;
    const aRow = numericOrder(a?.rowSortOrder, numericOrder(a?.sl, numericOrder(a?.id, 0)));
    const bRow = numericOrder(b?.rowSortOrder, numericOrder(b?.sl, numericOrder(b?.id, 0)));
    if (aRow !== bRow) return aRow - bRow;
    const aSl = numericOrder(a?.sl, numericOrder(a?.id, 0));
    const bSl = numericOrder(b?.sl, numericOrder(b?.id, 0));
    if (aSl !== bSl) return aSl - bSl;
    return numericOrder(a?.id, 0) - numericOrder(b?.id, 0);
  };
  const orderedEstimateItems = (items: any[]) => [...items].sort(compareEstimateItems);
  const orderedStoreKeysFromItems = (items: any[], storeGrouping: Record<string, any>) => {
    const knownKeys = new Set(Object.keys(storeGrouping || {}));
    const orderedKeys: string[] = [];
    const slToStore = new Map<number, string>();
    Object.entries(storeGrouping || {}).forEach(([sid, groupData]: [string, any]) => {
      const itemSls = Array.isArray(groupData) ? groupData : (groupData?.itemSls || []);
      itemSls.forEach((sl: any) => {
        const parsed = Number(sl);
        if (Number.isFinite(parsed)) slToStore.set(parsed, sid);
      });
    });
    orderedEstimateItems(items).forEach(item => {
      const sid = String(item?.storeId || slToStore.get(Number(item?.sl)) || "");
      if (!sid || !knownKeys.has(sid) || orderedKeys.includes(sid)) return;
      orderedKeys.push(sid);
    });
    Object.keys(storeGrouping || {}).forEach(sid => {
      if (!orderedKeys.includes(sid)) orderedKeys.push(sid);
    });
    return orderedKeys;
  };
  const wrapAddressForExcel = (value: any) => {
    const raw = String(value || "");
    // Structured (multi-line) addresses from the GST Profile form already have
    // explicit \n breaks — respect them and don't split on commas. Falls back
    // to the legacy comma-split for single-line legacy data.
    if (raw.includes("\n")) {
      return raw.split(/\n+/).map(line => line.trim()).filter(Boolean).join("\n");
    }
    return raw
      .replace(/\s*,\s*/g, "\n")
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .join("\n");
  };

  const xmlEscape = (value: string) => value.replace(/[<>&'"]/g, ch => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  }[ch] || ch));

  // ── OOXML worksheet element-order normalizer (Phase 3 fix) ──────────────
  // The OOXML CT_Worksheet schema mandates a strict child order. Our two-pass
  // XML post-processing (logo drawing, then print options) could emit
  // <drawing> before <printOptions>/<pageMargins>/<pageSetup>/<headerFooter>,
  // which strict parsers (Excel for Mac) reject with "needs repair" while
  // lenient ones (Windows Excel, LibreOffice) silently fix. This rewrites the
  // tail of <worksheet> into schema order so every reader is happy.
  const normalizeWorksheetXmlOrder = (buffer: Buffer): Buffer => {
    try {
      const zip = unzipSync(new Uint8Array(buffer));
      // Canonical CT_Worksheet child order (subset we ever emit).
      const ORDER = [
        "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData",
        "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter",
        "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr",
        "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions",
        "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks",
        "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
        "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts",
        "extLst",
      ];
      for (const sheetPath of Object.keys(zip).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
        let xml = Buffer.from(zip[sheetPath]).toString("utf8");
        const openMatch = xml.match(/<worksheet[^>]*>/);
        if (!openMatch) continue;
        const openTag = openMatch[0];
        const bodyStart = (openMatch.index || 0) + openTag.length;
        const bodyEnd = xml.lastIndexOf("</worksheet>");
        if (bodyEnd < 0) continue;
        const head = xml.slice(0, bodyStart);
        const body = xml.slice(bodyStart, bodyEnd);

        // Extract each top-level element (self-closing or paired) in document order.
        const elements: Array<{ name: string; xml: string }> = [];
        const re = /<([A-Za-z][\w]*)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
        let m: RegExpExecArray | null;
        let consumed = "";
        while ((m = re.exec(body)) !== null) {
          elements.push({ name: m[1], xml: m[0] });
          consumed += m[0];
        }
        // If parsing didn't capture everything (unexpected structure), bail safely.
        if (!elements.length) continue;

        const idx = (n: string) => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; };
        // Stable sort by canonical order.
        const sorted = elements
          .map((el, i) => ({ el, i }))
          .sort((a, b) => idx(a.el.name) - idx(b.el.name) || a.i - b.i)
          .map(x => x.el.xml)
          .join("");
        xml = head + sorted + "</worksheet>";
        zip[sheetPath] = strToU8(xml);
      }
      return Buffer.from(zipSync(zip));
    } catch {
      return buffer; // never break the export
    }
  };

  const addCompanyLogoToEstimateWorkbook = (
    buffer: Buffer,
    anchor: { fromCol?: number; toCol?: number; fromRow?: number; toRow?: number } = {},
    logoRef?: string | null,
  ) => {
    const cleanLogoRef = String(logoRef || "").trim();
    const companyAssetPrefix = "/uploads/company-assets/";
    if (!cleanLogoRef.startsWith(companyAssetPrefix)) return buffer;
    const logoFilename = path.basename(cleanLogoRef);
    if (!logoFilename || cleanLogoRef !== `${companyAssetPrefix}${logoFilename}`) return buffer;
    const logoPath = path.join(companyAssetDir, logoFilename);
    const normalizedDir = path.resolve(companyAssetDir);
    const normalizedLogo = path.resolve(logoPath);
    if (!normalizedLogo.startsWith(normalizedDir + path.sep) || !fs.existsSync(normalizedLogo)) return buffer;

    try {
      const fromCol = anchor.fromCol ?? 12;
      const toCol = anchor.toCol ?? 16;
      const fromRow = anchor.fromRow ?? 0;
      const toRow = anchor.toRow ?? 3;
      const zip = unzipSync(new Uint8Array(buffer));
      const logo = fs.readFileSync(logoPath);
      zip["xl/media/company-logo.png"] = new Uint8Array(logo);

      const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="1" name="Company Logo" descr="Company Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>
      <xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
      <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
      zip["xl/drawings/drawing1.xml"] = strToU8(drawingXml);
      zip["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/company-logo.png"/>
</Relationships>`);

      const relPath = "xl/worksheets/_rels/sheet1.xml.rels";
      const relXml = zip[relPath]
        ? Buffer.from(zip[relPath]).toString("utf8")
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
      if (!relXml.includes("drawing1.xml")) {
        zip[relPath] = strToU8(relXml.replace("</Relationships>", `<Relationship Id="rIdLogoDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
      }

      const sheetPath = "xl/worksheets/sheet1.xml";
      const sheetXml = Buffer.from(zip[sheetPath]).toString("utf8");
      if (!sheetXml.includes("<drawing r:id=\"rIdLogoDrawing\"")) {
        const sheetWithNamespace = sheetXml.includes("xmlns:r=")
          ? sheetXml
          : sheetXml.replace("<worksheet ", "<worksheet xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
        zip[sheetPath] = strToU8(sheetWithNamespace.replace("</worksheet>", `<drawing r:id="rIdLogoDrawing"/></worksheet>`));
      }

      const contentPath = "[Content_Types].xml";
      let contentXml = Buffer.from(zip[contentPath]).toString("utf8");
      if (!contentXml.includes('Extension="png"')) {
        contentXml = contentXml.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
      }
      if (!contentXml.includes('/xl/drawings/drawing1.xml')) {
        contentXml = contentXml.replace("</Types>", `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      }
      zip[contentPath] = strToU8(contentXml);

      return Buffer.from(zipSync(zip));
    } catch {
      return buffer;
    }
  };

  const applyEstimateWorkbookPrintXml = (
    buffer: Buffer,
    options: { repeatHeaderRow: number; freezeRows: number; rowBreaks?: Array<{ id: number }> },
  ) => {
    try {
      const zip = unzipSync(new Uint8Array(buffer));
      const sheetPath = "xl/worksheets/sheet1.xml";
      const workbookPath = "xl/workbook.xml";
      if (!zip[sheetPath]) return buffer;

      let sheetXml = Buffer.from(zip[sheetPath]).toString("utf8");
      const rowBreaks = (options.rowBreaks || []).filter(item => Number.isFinite(Number(item.id)) && Number(item.id) > 0);
      const breaksXml = rowBreaks.length > 0
        ? `<rowBreaks count="${rowBreaks.length}" manualBreakCount="${rowBreaks.length}">${rowBreaks.map(item => `<brk id="${item.id}" max="16383" man="1"/>`).join("")}</rowBreaks>`
        : "";
      const pagePrintXml = `<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.45" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter><evenFooter>&amp;CPage &amp;P of &amp;N</evenFooter></headerFooter>`;
      const paneXml = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${options.freezeRows}" topLeftCell="A${options.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${options.freezeRows + 1}" sqref="A${options.freezeRows + 1}"/></sheetView></sheetViews>`;

      sheetXml = sheetXml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, paneXml);
      if (!sheetXml.includes("<sheetViews")) {
        sheetXml = sheetXml.replace(/(<worksheet[^>]*>)/, `$1${paneXml}`);
      }
      sheetXml = sheetXml
        .replace(/<printOptions[^>]*\/>/g, "")
        .replace(/<pageMargins[^>]*\/>/g, "")
        .replace(/<pageSetup[^>]*\/>/g, "")
        .replace(/<headerFooter>[\s\S]*?<\/headerFooter>/g, "")
        .replace(/<rowBreaks[\s\S]*?<\/rowBreaks>/g, "");
      sheetXml = sheetXml.replace("</worksheet>", `${breaksXml}${pagePrintXml}</worksheet>`);
      zip[sheetPath] = strToU8(sheetXml);

      if (zip[workbookPath]) {
        let workbookXml = Buffer.from(zip[workbookPath]).toString("utf8");
        workbookXml = workbookXml.replace(/<definedName name="_xlnm\.Print_Titles"[^>]*>[\s\S]*?<\/definedName>/g, "");
        const repeatHeaderRef = `'Estimate'!$${options.repeatHeaderRow}:$${options.repeatHeaderRow}`;
        const definedNameXml = `<definedName name="_xlnm.Print_Titles" localSheetId="0">${repeatHeaderRef}</definedName>`;
        if (workbookXml.includes("<definedNames>")) {
          workbookXml = workbookXml.replace("</definedNames>", `${definedNameXml}</definedNames>`);
        } else {
          workbookXml = workbookXml.replace("</workbook>", `<definedNames>${definedNameXml}</definedNames></workbook>`);
        }
        zip[workbookPath] = strToU8(workbookXml);
      }

      return Buffer.from(zipSync(zip));
    } catch {
      return buffer;
    }
  };

  // Seller / company defaults. Sunrise Media is registered in Maharashtra
  // (state code 27). These defaults are used when the user hasn't yet
  // configured `company.*` keys in app_settings. Read order: app_settings →
  // env override → these defaults.
  const SUNRISE_DEFAULT_SELLER = {
    name: "Sunrise Media",
    gstin: "27AAAAA0000A1Z5",
    pan: "AAAAA0000A",
    state: "Maharashtra",
    stateCode: "27",
    address: "",
    mobile: "",
    email: "",
    bankName: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankBranch: "",
    defaultGstPercent: "18",
    defaultPacking: "4",
    defaultImplementation: "7",
    defaultLocalTransport: "1000",
    defaultOutstationTransportRate: "18",
    defaultEstimatePrefix: "SM/E",
    defaultInvoicePrefix: "SM/INV",
    defaultDcPrefix: "SM/DC",
    logoPath: "",
    signatureStampPath: "",
    terms: "1. Taxes will be applicable.\n2. 100% Payment after the delivery of the meterial.\n3. Transportation charges As per Actual.\n4. Any additional work / rework will be extra.",
  };
  type SellerProfile = typeof SUNRISE_DEFAULT_SELLER;

  const companySettingMap: Record<string, keyof SellerProfile> = {
    "company.name": "name",
    "company.gstin": "gstin",
    "company.pan": "pan",
    "company.state": "state",
    "company.stateCode": "stateCode",
    "company.address": "address",
    "company.mobile": "mobile",
    "company.email": "email",
    "bank.name": "bankName",
    "bank.accountNumber": "bankAccountNumber",
    "bank.ifsc": "bankIfsc",
    "bank.branch": "bankBranch",
    "defaults.gstPercent": "defaultGstPercent",
    "defaults.packingPercent": "defaultPacking",
    "defaults.implementationPercent": "defaultImplementation",
    "defaults.localTransport": "defaultLocalTransport",
    "defaults.outstationTransportRate": "defaultOutstationTransportRate",
    "defaults.terms": "terms",
    "company.logoPath": "logoPath",
    "company.signatureStampPath": "signatureStampPath",
  };
  const legacySettingMap: Record<string, string> = {
    companyName: "company.name",
    companyGstin: "company.gstin",
    companyPan: "company.pan",
    companyStateCode: "company.stateCode",
    companyAddress: "company.address",
    companyMobile: "company.mobile",
    companyEmail: "company.email",
    bankName: "bank.name",
    bankAccountNumber: "bank.accountNumber",
    bankIfsc: "bank.ifsc",
    bankBranch: "bank.branch",
    defaultGstPercent: "defaults.gstPercent",
    defaultPacking: "defaults.packingPercent",
    defaultImplementation: "defaults.implementationPercent",
    terms: "defaults.terms",
    companyLogoPath: "company.logoPath",
    signatureStampPath: "company.signatureStampPath",
  };

  const cleanSetting = (value: any) => String(value ?? "").trim();
  const cleanCompanyAssetRef = (value: any) => {
    const raw = cleanSetting(value);
    if (!raw) return "";
    const prefix = "/uploads/company-assets/";
    if (!raw.startsWith(prefix)) return "";
    const filename = path.basename(raw);
    return filename && raw === `${prefix}${filename}` ? raw : "";
  };
  const readSettingWithLegacy = async (canonicalKey: string) => {
    const direct = await storage.getAppSetting(canonicalKey).catch(() => null);
    if (direct !== null && direct !== undefined && cleanSetting(direct)) return direct;
    const legacyKey = Object.keys(legacySettingMap).find(k => legacySettingMap[k] === canonicalKey);
    if (!legacyKey) return null;
    const legacyValue = await storage.getAppSetting(legacyKey).catch(() => null);
    if (legacyValue !== null && legacyValue !== undefined && cleanSetting(legacyValue)) {
      await storage.setAppSetting(canonicalKey, String(legacyValue ?? "")).catch(() => null);
    }
    return legacyValue;
  };

  async function getSellerProfile(): Promise<SellerProfile> {
    const out = { ...SUNRISE_DEFAULT_SELLER };
    for (const [settingKey, outKey] of Object.entries(companySettingMap)) {
      const v = await readSettingWithLegacy(settingKey);
      if (outKey === "logoPath" || outKey === "signatureStampPath") {
        const assetRef = cleanCompanyAssetRef(v);
        if (assetRef) (out as any)[outKey] = assetRef;
      } else if (v !== null && v !== undefined && cleanSetting(v)) {
        (out as any)[outKey] = cleanSetting(v);
      }
    }
    const numberingPairs: Array<[keyof SellerProfile, string, string]> = [
      ["defaultEstimatePrefix", "numbering.estimate", "defaultEstimatePrefix"],
      ["defaultInvoicePrefix", "numbering.invoice", "defaultInvoicePrefix"],
      ["defaultDcPrefix", "numbering.dc", "defaultDcPrefix"],
    ];
    for (const [outKey, canonicalKey, legacyKey] of numberingPairs) {
      const cfg = await storage.getAppSetting(canonicalKey).catch(() => null) as any;
      const legacy = await storage.getAppSetting(legacyKey).catch(() => null);
      const prefix = typeof cfg?.prefix === "string" && cfg.prefix.trim()
        ? cfg.prefix.trim()
        : cleanSetting(legacy);
      if (prefix) {
        (out as any)[outKey] = prefix;
        if (!(typeof cfg?.prefix === "string" && cfg.prefix.trim())) {
          await storage.setAppSetting(canonicalKey, {
            ...(cfg || {}),
            prefix,
            startAt: Number.isFinite(Number(cfg?.startAt)) ? Number(cfg.startAt) : 101,
            fyAware: cfg?.fyAware !== false,
          }).catch(() => null);
        }
      }
    }
    return out;
  }

  // Decide GST type based on seller vs billing state code. Two-digit zero-
  // padded comparison so "1" and "01" both work. If billing state code is
  // missing, default to CGST+SGST (intra-state) so the legacy behaviour is
  // preserved for old rows.
  function deriveGstType(sellerStateCode: string | null | undefined, billingStateCode: string | null | undefined): "CGST+SGST" | "IGST" {
    const norm = (v: any) => String(v ?? "").trim().padStart(2, "0").slice(0, 2);
    const a = norm(sellerStateCode);
    const b = norm(billingStateCode);
    if (!b) return "CGST+SGST";
    return a === b ? "CGST+SGST" : "IGST";
  }

  const findAblblClient = (list: any[]) => list.find(c =>
    isAblblFormat(c.format) ||
    /aditya birla/i.test(String(c.name || "")) ||
    /\b(abfrl|ablbl)\b/i.test(String(c.clientGroupName || ""))
  );

  // Upload API Endpoint
  app.post("/api/operations/upload", authenticateToken, upload.single("file"), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const filePath = `/uploads/${req.file.filename}`;
      res.status(201).json({ filePath, fileName: req.file.originalname, fileSize: req.file.size });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/company-assets/upload", authenticateToken, requireRole(["admin", "manager"]), companyAssetUpload.single("file"), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const filePath = `/uploads/company-assets/${req.file.filename}`;
      await storage.createUpload({
        fileName: req.file.originalname,
        filePath,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        category: "company-assets",
        uploadedBy: req.user.id
      }).catch(() => null);
      res.status(201).json({ filePath, fileName: req.file.originalname, fileSize: req.file.size, mimeType: req.file.mimetype });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/company-assets/:filename", authenticateBrowserRequest, async (req: AuthRequest, res: Response) => {
    try {
      const filename = path.basename(String(req.params.filename || ""));
      if (!filename || filename !== req.params.filename) {
        return res.status(400).json({ message: "Invalid file reference" });
      }
      const filePath = path.join(companyAssetDir, filename);
      const normalizedDir = path.resolve(companyAssetDir);
      const normalizedFile = path.resolve(filePath);
      if (!normalizedFile.startsWith(normalizedDir + path.sep) || !fs.existsSync(normalizedFile)) {
        return res.status(404).json({ message: "File not found" });
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(normalizedFile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Excel/CSV parse endpoint for Imports
  app.post("/api/operations/imports/parse-file", authenticateToken, upload.single("file"), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Delete temporary file
      try { fs.unlinkSync(req.file.path); } catch (e) {}

      if (rows.length === 0) {
        return res.status(400).json({ message: "The uploaded file is empty" });
      }

      const headers = rows[0].map(h => String(h || "").trim());
      const dataRows = rows.slice(1).map(row => {
        const obj: Record<string, any> = {};
        headers.forEach((header, index) => {
          if (header) {
            obj[header] = row[index] !== undefined ? row[index] : null;
          }
        });
        return obj;
      });

      res.json({
        headers,
        previewRows: dataRows.slice(0, 20),
        allRows: dataRows
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 1. Authentication & Staff Administration
  // ==========================================
  // SECURITY (audit C4): brute-force protection on credential endpoints.
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10, // 10 attempts/min/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many login attempts. Try again in a minute." },
  });

  app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertUserSchema.safeParse(
        preprocessDateFields({
          ...req.body,
          name: normalizeDisplayName(req.body.name),
          department: normalizeDisplayName(req.body.department) || null,
          designation: normalizeDisplayName(req.body.designation) || null,
          emergencyContact: normalizeDisplayName(req.body.emergencyContact) || null,
        }, ["joiningDate"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid user data", errors: parsed.error.errors });
      }

      // First-user signup is open; after that, only admins can create users.
      const existingAll = await storage.getAllUsers();
      if (existingAll.length > 0) {
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];
        if (!token) {
          return res.status(401).json({ message: "Admin authentication required" });
        }
        try {
          const decoded: any = jwt.verify(token, JWT_SECRET);
          const requester = await storage.getUser(decoded.id);
          if (!requester || !requester.isActive || requester.role !== "admin") {
            return res.status(403).json({ message: "Only admins can create users" });
          }
        } catch (e) {
          return res.status(401).json({ message: "Invalid admin token" });
        }
      }

      const existingUser = await storage.getUserByUsername(parsed.data.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(parsed.data.password);
      const user = await storage.createUser({
        ...parsed.data,
        password: hashedPassword
      });

      const token = generateToken(user);
      res.status(201).json({ user: { id: user.id, username: user.username, name: user.name, role: user.role }, token });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const token = generateToken(user);
      // httpOnly cookie lets <img>/<a href> requests (file downloads, prints)
      // authenticate without putting tokens in URLs (audit C1/C3).
      setSessionCookie(res, token);
      res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role }, token });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Mint the session cookie for an existing Bearer session (e.g. users already
  // logged in before the cookie mechanism existed, or after clearing cookies).
  app.post("/api/auth/session-cookie", authenticateToken, async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token) setSessionCookie(res, token);
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", async (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/user", authenticateToken, async (req: AuthRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ message: "Unauthenticated" });
    const user = await storage.getUser(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ id: user.id, username: user.username, name: user.name, role: user.role, email: user.email });
  });

  app.get("/api/users", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.getAllUsers();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const updates = preprocessDateFields({
        ...req.body,
        ...(req.body.name !== undefined ? { name: normalizeDisplayName(req.body.name) } : {}),
        ...(req.body.department !== undefined ? { department: normalizeDisplayName(req.body.department) || null } : {}),
        ...(req.body.designation !== undefined ? { designation: normalizeDisplayName(req.body.designation) || null } : {}),
        ...(req.body.emergencyContact !== undefined ? { emergencyContact: normalizeDisplayName(req.body.emergencyContact) || null } : {}),
      }, ["joiningDate"]);

      // Role guard: non-admins may only update their own basic profile fields
      const isAdmin = req.user?.role === "admin";
      const isSelf = req.user?.id === id;
      if (!isAdmin && !isSelf) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      if (!isAdmin) {
        // restrict the fields a non-admin self-update can touch
        const allowed = ["name", "email", "phone", "telegramChatId", "address", "profilePhotoUrl", "emergencyContact", "emergencyContactPhone", "password"];
        for (const k of Object.keys(updates)) {
          if (!allowed.includes(k)) delete updates[k];
        }
      }

      if (updates.password) {
        updates.password = await hashPassword(updates.password);
      }

      const updated = await storage.updateUser(id, updates);
      if (!updated) return res.status(404).json({ message: "Staff not found" });
      res.json(sanitizeUser(updated));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/users/:id", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (req.user?.id === id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      const success = await storage.deleteUser(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 2. Attendance tracking (Touch logs Console)
  // ==========================================
  app.get("/api/attendance", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const date = req.query.date as string | undefined;
      const list = await storage.getAllAttendance(date);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/attendance/user/:userId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const list = await storage.getAttendanceByUser(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/attendance", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertAttendanceSchema.safeParse(
        preprocessDateFields(req.body, ["date", "checkInTime", "checkOutTime"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid attendance data", errors: parsed.error.errors });
      }

      // Check if attendance already exists for this day
      const dateStr = new Date(parsed.data.date).toISOString().split("T")[0];
      const existing = await storage.getAttendance(parsed.data.userId, dateStr);

      if (existing) {
        const updated = await storage.updateAttendance(existing.id, {
          checkOutTime: parsed.data.checkOutTime ?? existing.checkOutTime,
          checkInTime: parsed.data.checkInTime ?? existing.checkInTime,
          workingHours: parsed.data.workingHours || existing.workingHours,
          overtimeHours: parsed.data.overtimeHours || existing.overtimeHours,
          status: parsed.data.status || existing.status,
          leaveType: parsed.data.leaveType || existing.leaveType,
          notes: parsed.data.notes || existing.notes,
        });
        return res.json(updated);
      }

      const created = await storage.createAttendance({
        ...parsed.data,
        date: parsed.data.date,
        checkInTime: parsed.data.checkInTime ?? null,
        checkOutTime: parsed.data.checkOutTime ?? null,
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 3. Tasks & Kanban Board
  // ==========================================
  app.get("/api/tasks", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const assignedTo = req.query.assignedTo ? parseInt(req.query.assignedTo as string, 10) : undefined;
      const status = req.query.status as string | undefined;
      const list = await storage.getAllTasks({ assignedTo, status });
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertTaskSchema.safeParse(
        preprocessDateFields(req.body, ["dueDate", "startDate", "completedDate"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid task data", errors: parsed.error.errors });
      }

      const created = await storage.createTask({
        ...parsed.data,
        assignedBy: req.user.id,
        dueDate: parsed.data.dueDate ?? null,
        startDate: parsed.data.startDate ?? null,
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/tasks/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = preprocessDateFields(req.body, ["dueDate", "startDate", "completedDate"]);

      const updated = await storage.updateTask(id, updates);
      if (!updated) return res.status(404).json({ message: "Task not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/tasks/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await storage.deleteTask(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 4. Petty Cash & OCR Receipt Processing
  // ==========================================
  app.get("/api/petty-cash", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const status = req.query.status as string | undefined;
      const list = await storage.getAllPettyCashExpenses({ category, status });
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/petty-cash", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertPettyCashExpenseSchema.safeParse(
        preprocessDateFields(
          { ...req.body, addedBy: req.user.id },
          [{ field: "expenseDate", defaultTo: nowDefault }],
        ),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid petty cash data", errors: parsed.error.errors });
      }

      const created = await storage.createPettyCashExpense(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/petty-cash/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = preprocessDateFields(req.body, ["expenseDate"]);

      const updated = await storage.updatePettyCashExpense(id, updates);
      if (!updated) return res.status(404).json({ message: "Expense not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/petty-cash/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await storage.deletePettyCashExpense(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Base64 Receipt OCR Scanner Uploader Mock
  app.post("/api/uploads", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const { fileName, mimeType, base64Data, category } = req.body;
      
      if (!fileName || !base64Data) {
        return res.status(400).json({ message: "File name and content are required" });
      }

      // Calculate size from base64 string
      const sizeBytes = Math.round((base64Data.length * 3) / 4);

      // Create local file path metadata. SECURITY: basename() strips any
      // path-traversal characters from the client-supplied name.
      const safeName = path.basename(String(fileName));
      const filePath = `/uploads/receipts/${Date.now()}_${safeName}`;
      const uploadRecord = await storage.createUpload({
        fileName,
        filePath,
        fileSize: sizeBytes,
        mimeType: mimeType || "image/jpeg",
        category: category || "receipts",
        uploadedBy: req.user.id
      });

      res.status(201).json(uploadRecord);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 5. Finance Ledger & Chart of Accounts
  // ==========================================
  app.get("/api/finance/accounts", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.getAllAccounts();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/finance/accounts", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertChartOfAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid account data", errors: parsed.error.errors });
      }

      const created = await storage.createAccount(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/finance/ledger/:accountId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const accountId = parseInt(req.params.accountId, 10);
      const lines = await storage.getLedgerLines(accountId);
      res.json(lines);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 6. Invoice Tracking (Sales & Purchases)
  // ==========================================
  app.get("/api/finance/invoices", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const type = req.query.type as string | undefined;
      const status = req.query.status as string | undefined;
      const list = searchList(await storage.getAllInvoices({ type, status }), req,
        ["invoiceNumber", "partyName", "status", "type"]);
      // Opt-in pagination (audit H4): ?limit=&offset= slice + X-Total-Count.
      // Without params, full list is returned — existing clients unaffected.
      const { page, total } = paginateList(list, req);
      if (total !== null) res.setHeader("X-Total-Count", String(total));
      res.json(page);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/finance/invoices", authenticateToken, requireRole(["admin", "accounts", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertInvoiceSchema.safeParse(
        preprocessDateFields(req.body, ["date", "dueDate"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid invoice data", errors: parsed.error.errors });
      }
      if (parsed.data.estimateId) {
        const readiness = await deriveInvoiceReadinessForEstimate(Number(parsed.data.estimateId));
        if (!readiness.ready) {
          return res.status(409).json({ message: "Invoice readiness is incomplete", readiness });
        }
      }

      const created = await storage.createInvoice(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 7. Payment Vouchers & Allocation
  // ==========================================
  app.get("/api/finance/payments", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const type = req.query.type as string | undefined;
      const list = await storage.getAllPayments({ type });
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/finance/payments", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertPaymentSchema.safeParse(
        preprocessDateFields(req.body, ["date"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payment data", errors: parsed.error.errors });
      }

      const created = await storage.createPayment(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/finance/invoices/estimate/:estimateId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estId = Number(req.params.estimateId);
      const invoiceList = await db.select().from(invoices).where(eq(invoices.estimateId, estId)).limit(1);
      res.json(invoiceList[0] || null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/finance/payments/allocate", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const { payment, allocations } = req.body;
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertPaymentSchema.safeParse(
        preprocessDateFields(payment ?? {}, ["date"]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payment data", errors: parsed.error.errors });
      }

      const created = await storage.createPaymentWithAllocations(parsed.data, allocations || []);

      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/finance/ledgers/summary", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const allClients = await storage.getAllClients();
      const allInvoices = await storage.getAllInvoices({ type: "sales" });
      const allPayments = await storage.getAllPayments({ type: "receipt" });

      const summaryList = allClients.map(client => {
        const clientInvoices = allInvoices.filter(i => i.clientId === client.id || i.partyName === client.name);
        const clientPayments = allPayments.filter(p => p.clientId === client.id || p.partyName === client.name);

        const totalBilled = clientInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0);
        const totalPaid = clientInvoices.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0);
        const totalOutstanding = Math.max(0, totalBilled - totalPaid);

        return {
          clientId: client.id,
          clientName: client.name,
          totalBilled,
          totalPaid,
          totalOutstanding,
          status: totalOutstanding <= 0 ? "clean" : "outstanding"
        };
      });

      res.json(summaryList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/finance/ledgers/client/:clientId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const cId = Number(req.params.clientId);
      const clientList = await db.select().from(clients).where(eq(clients.id, cId)).limit(1);
      const client = clientList[0];
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      const clientInvoices = await db.select().from(invoices).where(eq(invoices.clientId, cId)).orderBy(invoices.date);
      const clientPayments = await db.select().from(payments).where(eq(payments.clientId, cId)).orderBy(payments.date);

      // Map to combined chronological transaction array
      const items: any[] = [];

      clientInvoices.forEach(inv => {
        items.push({
          date: inv.date,
          ref: inv.invoiceNumber,
          type: "Invoice",
          amount: Number(inv.totalAmount),
          debitAmount: Number(inv.totalAmount),
          creditAmount: 0,
          details: `Invoice for Job Reference: ${inv.remarks || 'Signage Installation'}`
        });
      });

      clientPayments.forEach(pay => {
        items.push({
          date: pay.date,
          ref: pay.voucherNumber,
          type: "Payment Receipt",
          amount: Number(pay.amount),
          debitAmount: 0,
          creditAmount: Number(pay.amount),
          details: `Received via ${pay.method.toUpperCase()} - ${pay.description || 'Account Settlement'}`
        });
      });

      // Sort chronologically
      items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Compute cumulative running balance
      let runningBalance = 0;
      const statement = items.map(item => {
        runningBalance = runningBalance + item.debitAmount - item.creditAmount;
        return {
          ...item,
          balance: runningBalance
        };
      });

      res.json({
        client,
        statement,
        totalBilled: clientInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0),
        totalPaid: clientInvoices.reduce((sum, i) => sum + Number(i.paidAmount || 0), 0),
        totalOutstanding: runningBalance
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 8. Finance & Operations Summary Dashboard
  // ==========================================
  app.get("/api/finance/dashboard", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : null;
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : null;
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);
      const inRange = (value: any) => {
        if (!startDate || !endDate) return true;
        if (!value) return false;
        const time = new Date(value).getTime();
        return Number.isFinite(time) && time >= startDate.getTime() && time <= endDate.getTime();
      };
      // Calculate operational & financial statistics
      const allInvoices = (await storage.getAllInvoices()).filter((inv: any) => inRange(inv.date || inv.createdAt));
      const allExpenses = (await storage.getAllPettyCashExpenses({ status: "approved" })).filter((exp: any) => inRange(exp.expenseDate || exp.createdAt));
      const allTasks = (await storage.getAllTasks()).filter((task: any) => inRange(task.dueDate || task.createdAt));
      const allStaff = await storage.getAllUsers();

      const totalRevenue = allInvoices
        .filter(inv => inv.type === "sales")
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      const totalReceivables = allInvoices
        .filter(inv => inv.type === "sales" && inv.status !== "paid")
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      const totalPayables = allInvoices
        .filter(inv => inv.type === "purchase" && inv.status !== "paid")
        .reduce((sum, inv) => sum + inv.totalAmount, 0);

      // Petty cash: count only what's actually spent (pending + approved).
      // Rejected entries should NOT inflate the total.
      const pettyCashSpent = allExpenses
        .filter((exp: any) => exp.status !== "rejected")
        .reduce((sum: number, exp: any) => sum + (exp.amount || 0), 0);

      const taskSummary = {
        total: allTasks.length,
        pending: allTasks.filter(t => t.status === "pending").length,
        inProgress: allTasks.filter(t => t.status === "in_progress").length,
        completed: allTasks.filter(t => t.status === "completed").length,
      };

      // Extended ERP counters
      let estimatesAwaitingPo = 0;
      let poReceived = 0;
      let estimatesDraft = 0;
      let estimatesApproved = 0;
      let dcPending = 0;
      let dcDelivered = 0;
      let invoicePending = 0;
      let invoicePaid = 0;
      let invoiceOverdue = 0;
      let staffPresentToday = 0;
      let pettyCashPending = 0;
      let jobsInProgress = 0;
      let storesCompleted = 0;
      let storesPending = 0;
      let invoicesReady = 0;     // approved/po_received estimates with no invoice yet
      let invoicesSubmitted = 0;
      let tallyPending = 0;      // exported_xml but not pushed_to_tally
      let dcWccPending = 0;      // ABFRL po_received estimates with no DC yet

      try {
        const allEstimates = (await storage.getAllEstimates()).filter((e: any) => inRange(e.estimateDate || e.createdAt));
        const allDc = (await storage.getAllDeliveryChallans()).filter((dc: any) => inRange(dc.createdAt || dc.deliveryDate));
        for (const e of allEstimates) {
          if (e.status === "awaiting_po" || e.status === "approved") estimatesAwaitingPo++;
          if (e.status === "po_received" || e.poNumber) poReceived++;
          if (e.status === "draft") estimatesDraft++;
          if (e.status === "approved") estimatesApproved++;

          // "jobs in progress" = PO received but invoice not generated
          const hasInvoice = allInvoices.some((i: any) => i.estimateId === e.id);
          if ((e.poNumber || e.status === "po_received") && !hasInvoice) jobsInProgress++;

          // Multi-store completion split (ABFRL grouping)
          const isAbfrl = isAblblFormat(e.clientFormat);
          if (isAbfrl && e.storeGrouping) {
            const storeCount = Object.keys(e.storeGrouping as Record<string, any>).length;
            const dcsForEst = allDc.filter((d: any) => d.estimateId === e.id);
            const doneByCode = new Set<string>();
            for (const d of dcsForEst) {
              const sc = d.storeCode || (d.metadata && (d.metadata as any).storeCode) || "";
              if (sc) doneByCode.add(String(sc));
            }
            storesCompleted += doneByCode.size;
            storesPending += Math.max(0, storeCount - doneByCode.size);
          } else if (e.poNumber || e.status === "po_received") {
            // Single-store job — completed when there's a DC, else pending
            const dcsForEst = allDc.filter((d: any) => d.estimateId === e.id);
            if (dcsForEst.length > 0) storesCompleted++; else storesPending++;
          }

          // DC / WCC pending = PO received but no DC at all
          if ((e.poNumber || e.status === "po_received")) {
            const has = allDc.some((d: any) => d.estimateId === e.id);
            if (!has) dcWccPending++;
          }
        }
      } catch (e) { /* table may not exist */ }

      try {
        const allDc = (await storage.getAllDeliveryChallans()).filter((dc: any) => inRange(dc.createdAt || dc.deliveryDate));
        for (const d of allDc) {
          if (d.status === "draft" || d.status === "pending") dcPending++;
          if (d.status === "delivered" || d.status === "completed") dcDelivered++;
        }
      } catch (e) { /* */ }

      const now = new Date();
      for (const inv of allInvoices) {
        if (inv.type === "sales") {
          if (inv.status === "paid") invoicePaid++;
          else {
            invoicePending++;
            if (inv.dueDate && new Date(inv.dueDate) < now) invoiceOverdue++;
          }
          // Invoices submitted = drafted + submitted statuses (everything that's not draft)
          if (inv.status !== "draft") invoicesSubmitted++;
          // Tally still-pending = exported_xml waiting on pushed_to_tally confirmation
          if ((inv as any).tallyExportStatus === "exported_xml") tallyPending++;
        }
      }

      // Invoice ready: estimates with PO but no invoice yet
      try {
        const allE = await storage.getAllEstimates();
        for (const e of allE) {
          if ((e.poNumber || e.status === "po_received") && !allInvoices.some((i: any) => i.estimateId === e.id)) {
            invoicesReady++;
          }
        }
      } catch { /* */ }

      try {
        const today = new Date().toISOString().slice(0, 10);
        const todayAttendance = await storage.getAllAttendance(today);
        staffPresentToday = todayAttendance.filter((a: any) => a.status === "present" || a.status === "late" || a.status === "overtime" || a.status === "half_day").length;
      } catch (e) { /* */ }

      try {
        const pending = (await storage.getAllPettyCashExpenses({ status: "pending" })).filter((exp: any) => inRange(exp.expenseDate || exp.createdAt));
        pettyCashPending = pending.length;
      } catch (e) { /* */ }

      const erpCounters = {
        estimatesAwaitingPo,
        poReceived,
        estimatesDraft,
        estimatesApproved,
        dcPending,
        dcDelivered,
        invoicePending,
        invoicePaid,
        invoiceOverdue,
        staffPresentToday,
        pettyCashPending,
        jobsInProgress,
        storesCompleted,
        storesPending,
        invoicesReady,
        invoicesSubmitted,
        tallyPending,
        dcWccPending,
      };

      // Extended financial summaries
      let totalOutstanding = 0;
      let monthlyBilling = 0;
      let salaryPayable = 0;
      let totalAdvances = 0;
      let botInboxPending = 0;

      try {
        const salesInvoices = allInvoices.filter((inv: any) => inv.type === "sales");
        totalOutstanding = salesInvoices.filter((inv: any) => inv.status !== "paid").reduce((s: number, inv: any) => s + (inv.balanceAmount || inv.totalAmount || 0), 0);
        monthlyBilling = salesInvoices.reduce((s: number, inv: any) => s + (inv.totalAmount || 0), 0);
      } catch (e) { /* */ }

      try {
        const thisM = new Date();
        const payrollList = await storage.getPayrollByMonthYear(thisM.getMonth() + 1, thisM.getFullYear());
        // Payroll schema status values: "draft" | "approved" | "paid".
        // Anything not yet paid is payable; the source of truth amount is `netSalary`.
        salaryPayable = payrollList
          .filter((p: any) => p.status !== "paid")
          .reduce((s: number, p: any) => s + (p.netSalary || 0), 0);
      } catch (e) { /* */ }

      try {
        // Advances schema has `isAdjusted` (no `status`); unadjusted advances are still owed.
        const advances = (await storage.getAllAdvances()).filter((a: any) => inRange(a.date || a.createdAt));
        totalAdvances = advances
          .filter((a: any) => !a.isAdjusted)
          .reduce((s: number, a: any) => s + (a.amount || 0), 0);
      } catch (e) { /* */ }

      try {
        const inbox = await db.select().from(botUploadInbox).where(eq(botUploadInbox.status, "unlinked"));
        botInboxPending = inbox.length;
      } catch (e) { /* */ }

      // ── Dashboard Command Center additions ─────────────────────────────
      // monthlyCollections: sum of receipt-type payments inside the date range
      let monthlyCollections = 0;
      try {
        const receipts = (await storage.getAllPayments({ type: "receipt" }))
          .filter((p: any) => inRange(p.paymentDate || p.createdAt));
        monthlyCollections = receipts.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      } catch (e) { /* */ }

      // projectHealth: derived from existing estimates + invoice linkage.
      // - Active            : estimate has no fully-paid invoice yet
      // - Completed         : estimate has a paid invoice
      // - Delayed           : estimate older than 60 days, still active
      // - NearCompletion    : estimate has issued invoice (not yet paid)
      let projectHealth = { active: 0, completed: 0, delayed: 0, nearCompletion: 0 };
      try {
        const estList = await storage.getAllEstimates();
        const allInvLookup = await storage.getAllInvoices();
        const invByEstimate = new Map<number, any[]>();
        allInvLookup.forEach((inv: any) => {
          if (!inv.estimateId) return;
          const list = invByEstimate.get(inv.estimateId) || [];
          list.push(inv);
          invByEstimate.set(inv.estimateId, list);
        });
        const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        estList.forEach((est: any) => {
          const invs = invByEstimate.get(est.id) || [];
          const hasPaid = invs.some((i: any) => i.status === "paid");
          const hasIssued = invs.some((i: any) => i.status !== "draft");
          const createdMs = new Date(est.createdAt || est.estimateDate || now).getTime();
          const ageMs = Number.isFinite(createdMs) ? (now - createdMs) : 0;
          if (hasPaid) projectHealth.completed++;
          else if (hasIssued) projectHealth.nearCompletion++;
          else if (ageMs > SIXTY_DAYS && est.status !== "rejected" && est.status !== "archived") projectHealth.delayed++;
          else projectHealth.active++;
        });
      } catch (e) { /* */ }

      // recentActivity: latest 10 events, ordered by createdAt desc, drawn from
      // existing tables. No new audit log — just a union view.
      let recentActivity: Array<{
        type: string; label: string; meta: string;
        date: string | Date | null; href: string;
      }> = [];
      try {
        const [estList, dcList, invList, paymentList] = await Promise.all([
          storage.getAllEstimates(),
          storage.getAllDeliveryChallans(),
          Promise.resolve(allInvoices),
          storage.getAllPayments(),
        ]);
        const events: typeof recentActivity = [];
        estList.forEach((e: any) => events.push({
          type: "estimate",
          label: `Estimate ${e.estimateNumber || `#${e.id}`} created`,
          meta: e.title || "",
          date: e.createdAt,
          href: `/projects?estimateId=${e.id}`,
        }));
        estList.filter((e: any) => e.poNumber).forEach((e: any) => events.push({
          type: "po",
          label: `PO ${e.poNumber} uploaded`,
          meta: e.estimateNumber || "",
          date: e.poDate || e.updatedAt,
          href: `/projects?estimateId=${e.id}`,
        }));
        dcList.forEach((dc: any) => events.push({
          type: dc.signedChallanPath ? "signed_wcc" : "wcc",
          label: `${dc.signedChallanPath ? "Signed WCC" : "WCC"} ${dc.dcNumber || `#${dc.id}`} ${dc.signedChallanPath ? "received" : "generated"}`,
          meta: dc.metadata?.storeCode || "",
          date: dc.signedChallanPath ? (dc.updatedAt || dc.createdAt) : dc.createdAt,
          href: dc.estimateId ? `/projects?estimateId=${dc.estimateId}` : `/operations#challans`,
        }));
        invList.filter((i: any) => i.type === "sales").forEach((i: any) => events.push({
          type: "invoice",
          label: `Invoice ${i.invoiceNumber || `#${i.id}`} ${i.status || "drafted"}`,
          meta: i.partyName || "",
          date: i.createdAt,
          href: `/submitted-invoices`,
        }));
        paymentList.filter((p: any) => p.type === "receipt").forEach((p: any) => events.push({
          type: "payment",
          label: `Payment received ${p.paymentNumber || `#${p.id}`}`,
          meta: p.partyName || "",
          date: p.paymentDate || p.createdAt,
          href: `/pending-payments`,
        }));
        events.sort((a, b) => {
          const ta = a.date ? new Date(a.date as any).getTime() : 0;
          const tb = b.date ? new Date(b.date as any).getTime() : 0;
          return tb - ta;
        });
        recentActivity = events.slice(0, 10);
      } catch (e) { /* */ }

      res.json({
        totalRevenue,
        totalReceivables,
        totalPayables,
        pettyCashSpent,
        staffCount: allStaff.length,
        taskSummary,
        erpCounters,
        totalOutstanding,
        monthlyBilling,
        monthlyCollections,
        projectHealth,
        recentActivity,
        salaryPayable,
        totalAdvances,
        botInboxPending,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 9. Sunrise Custom Operations API
  // ==========================================
  app.get("/api/operations/clients", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.getAllClients();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/clients", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertClientSchema.safeParse({
        ...req.body,
        name: normalizeDisplayName(req.body.name),
        city: normalizeDisplayName(req.body.city) || null,
        gstNumber: normalizeGstinPan(req.body.gstNumber) || null,
        pan: normalizeGstinPan(req.body.pan) || null,
        clientGroupName: normalizeDisplayName(req.body.clientGroupName) || null,
        primaryContactPerson: normalizeDisplayName(req.body.primaryContactPerson) || null,
        format: normalizeImportFormat(req.body.format),
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid client data", errors: parsed.error.errors });
      }
      const created = await storage.createClient(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Client Billing Profiles API
  app.get("/api/operations/clients/:id/billing-profiles", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const clientId = parseInt(req.params.id, 10);
      const list = await storage.getClientBillingProfiles(clientId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/billing-profiles", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertClientBillingProfileSchema.safeParse({
        ...req.body,
        legalCompanyName: normalizeDisplayName(req.body.legalCompanyName),
        branchLocationName: normalizeDisplayName(req.body.branchLocationName) || null,
        gstin: normalizeGstinPan(req.body.gstin),
        pan: normalizeGstinPan(req.body.pan) || null,
        state: normalizeDisplayName(req.body.state),
        contactPerson: normalizeDisplayName(req.body.contactPerson) || null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid billing profile data", errors: parsed.error.errors });
      }
      const created = await storage.createBillingProfile(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/operations/billing-profiles/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = {
        ...req.body,
        ...(req.body.legalCompanyName !== undefined ? { legalCompanyName: normalizeDisplayName(req.body.legalCompanyName) } : {}),
        ...(req.body.branchLocationName !== undefined ? { branchLocationName: normalizeDisplayName(req.body.branchLocationName) || null } : {}),
        ...(req.body.gstin !== undefined ? { gstin: normalizeGstinPan(req.body.gstin) } : {}),
        ...(req.body.pan !== undefined ? { pan: normalizeGstinPan(req.body.pan) || null } : {}),
        ...(req.body.state !== undefined ? { state: normalizeDisplayName(req.body.state) } : {}),
        ...(req.body.contactPerson !== undefined ? { contactPerson: normalizeDisplayName(req.body.contactPerson) || null } : {}),
      };
      const updated = await storage.updateBillingProfile(id, updates);
      if (!updated) return res.status(404).json({ message: "Billing profile not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operations/billing-profiles/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await storage.deleteBillingProfile(id);
      if (!success) return res.status(404).json({ message: "Billing profile not found" });
      res.json({ message: "Billing profile deleted successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/brands", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const list = await storage.getAllBrands(clientId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/brands", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const parentClientId = Number(req.body.parentClientId);
      if (!parentClientId) {
        return res.status(400).json({ message: "Parent client is required" });
      }
      const parentClient = (await db.select().from(clients).where(eq(clients.id, parentClientId)).limit(1))[0];
      if (!parentClient) {
        return res.status(400).json({ message: "Parent client not found" });
      }
      const parsed = insertBrandSchema.safeParse({
        ...req.body,
        name: normalizeDisplayName(req.body.name),
        parentClientId,
        parentBrand: normalizeDisplayName(parentClient.name) || null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid brand data", errors: parsed.error.errors });
      }
      const created = await storage.createBrand(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/stores", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const brandId = req.query.brandId ? parseInt(req.query.brandId as string, 10) : undefined;
      const list = await storage.getAllStores(clientId, brandId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/stores", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertStoreSchema.safeParse({
        ...req.body,
        name: normalizeDisplayName(req.body.name),
        location: normalizeDisplayName(req.body.location) || null,
        contactPerson: normalizeDisplayName(req.body.contactPerson) || null,
        city: normalizeDisplayName(req.body.city) || null,
        state: normalizeDisplayName(req.body.state) || null,
        contact: normalizeDisplayName(req.body.contact) || null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid store data", errors: parsed.error.errors });
      }
      const created = await storage.createStore(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/products", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.getAllProducts();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const productCategoryKey = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const normalizeProductCategory = async (value: unknown): Promise<string | null> => {
    const normalized = normalizeDisplayName(value);
    if (!normalized) return null;
    const key = productCategoryKey(normalized);
    const list = await storage.getAllProducts();
    const existing = list.find(p => productCategoryKey(p.category) === key);
    return existing?.category || normalized;
  };

  app.post("/api/operations/products", authenticateToken, requireRole(["admin", "manager", "designer"]), async (req: AuthRequest, res: Response) => {
    try {
      const body = {
        ...req.body,
        category: await normalizeProductCategory(req.body.category),
      };
      const parsed = insertProductSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid product data", errors: parsed.error.errors });
      }
      const created = await storage.createProduct(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/estimates", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = searchList(await storage.getAllEstimates(), req,
        ["estimateNumber", "title", "clientName", "billingTo", "status"]);
      const { page, total } = paginateList(list, req);
      if (total !== null) res.setHeader("X-Total-Count", String(total));
      res.json(page);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/estimates", authenticateToken, requireRole(["admin", "manager", "designer", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const { estimate, items } = req.body;

      if (estimate && estimate.billingProfileId) {
        const bp = await storage.getBillingProfile(estimate.billingProfileId);
        if (bp) {
          estimate.billingLegalNameSnapshot = bp.legalCompanyName;
          estimate.billingGstinSnapshot = bp.gstin;
          estimate.billingStateSnapshot = bp.state;
          estimate.billingStateCodeSnapshot = bp.stateCode;
          estimate.billingAddressSnapshot = bp.billingAddress;
          estimate.shippingAddressSnapshot = bp.shippingAddress;

          estimate.billingTo = bp.legalCompanyName;
          estimate.gstin = bp.gstin;
          estimate.pan = bp.pan || estimate.pan;
          estimate.stateCode = bp.stateCode;
        }
      }

      // Auto-derive gstType from seller (Sunrise) state vs billing state.
      // Same state → CGST+SGST; different → IGST. Override remains possible
      // by explicitly setting gstType in the request.
      const seller = await getSellerProfile();
      const billingStateCode = estimate?.billingStateCodeSnapshot || estimate?.stateCode || null;
      if (estimate && !estimate.gstType) {
        estimate.gstType = deriveGstType(seller.stateCode, billingStateCode);
      }

      // Estimate date: default to today if missing, coerce strings → Date for
      // the Drizzle timestamp column.
      const preprocessed = preprocessDateFields(estimate || {}, [
        { field: "estimateDate", defaultTo: () => new Date() },
        "poDate",
      ]);
      preprocessed.estimateNumber = await nextDocumentNumber("estimate");

      const parsedEstimate = insertEstimateSchema.safeParse(preprocessed);
      if (!parsedEstimate.success) {
        return res.status(400).json({ message: "Invalid estimate data", errors: parsedEstimate.error.errors });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Estimate must contain at least one item" });
      }

      const parsedItems = z.array(insertEstimateItemSchema.omit({ estimateId: true })).safeParse(items);
      if (!parsedItems.success) {
        return res.status(400).json({ message: "Invalid estimate items data", errors: parsedItems.error.errors });
      }

      // ABFRL CAPEX rule: every line must carry a material code.
      // ABFRL SELEX: material code is optional. Non-ABFRL: not enforced.
      // See ARCHITECTURE_NOTES.md "SELEX vs CAPEX".
      const fmt = parsedEstimate.data.clientFormat;
      const isAbfrl = isAblblFormat(fmt);
      if (isAbfrl && parsedEstimate.data.abfrlProjectType === "CAPEX") {
        const missing = parsedItems.data
          .map((it: any, i: number) => ({ sl: it.sl ?? i + 1, mc: it.materialCode, id: it.materialCodeId }))
          .filter((r: any) => !r.mc && !r.id);
        if (missing.length > 0) {
          return res.status(400).json({
            message: `ABLBL CAPEX requires Material Code on every row. Missing on row(s): ${missing.map((m: any) => m.sl).join(", ")}.`,
            errors: missing,
          });
        }
      }

      const created = await storage.createEstimate(
        {
          ...parsedEstimate.data,
          createdBy: req.user.id
        },
        parsedItems.data as any
      );
      await backfillExecutionStores();

      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/estimates/:id/items", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = parseInt(req.params.id, 10);
      const list = await storage.getEstimateItems(estimateId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/operations/estimates/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    console.log(`[estimate-update] route hit, id: ${req.params.id}, hasItems: ${Array.isArray(req.body?.items)}`);
    try {
      const id = parseInt(req.params.id, 10);
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const updates: any = preprocessDateFields(req.body, ["poDate", "estimateDate"]);
      // Phase 3 audit: capture prior state for old→new diff logging.
      const [priorEstimate] = await db.select().from(estimates).where(eq(estimates.id, id)).limit(1);

      // If the caller passes a separate `items` array we treat this as an
      // edit of the line items: delete + recreate. Keeps the rest of the
      // estimate untouched if no items are sent. The items field is consumed
      // here and removed from `updates` so it doesn't try to map to a column.
      const replaceItems: any[] | undefined = Array.isArray(updates.items) ? updates.items : undefined;
      if (replaceItems !== undefined) delete updates.items;

      if (updates.billingProfileId) {
        const bp = await storage.getBillingProfile(updates.billingProfileId);
        if (bp) {
          updates.billingLegalNameSnapshot = bp.legalCompanyName;
          updates.billingGstinSnapshot = bp.gstin;
          updates.billingStateSnapshot = bp.state;
          updates.billingStateCodeSnapshot = bp.stateCode;
          updates.billingAddressSnapshot = bp.billingAddress;
          updates.shippingAddressSnapshot = bp.shippingAddress;

          updates.billingTo = bp.legalCompanyName;
          updates.gstin = bp.gstin;
          updates.pan = bp.pan || updates.pan;
          updates.stateCode = bp.stateCode;
        }
      }

      // Re-derive gstType when state changes and the caller didn't explicitly
      // override it. This keeps the document consistent with seller location.
      if (updates.gstType === undefined && (updates.stateCode || updates.billingStateCodeSnapshot)) {
        const seller = await getSellerProfile();
        const newStateCode = updates.billingStateCodeSnapshot || updates.stateCode;
        updates.gstType = deriveGstType(seller.stateCode, newStateCode);
      }

      if (replaceItems) {
        console.log(`[estimate-update] replaceItems path, count: ${replaceItems.length}`);
        try {
          const updated = await db.transaction(async (tx) => {
            const updatedRows = await tx.update(estimates).set(updates).where(eq(estimates.id, id)).returning();
            const updatedEstimate = updatedRows[0];
            if (!updatedEstimate) return null;

            await tx.delete(estimateItems).where(eq(estimateItems.estimateId, id));
            if (replaceItems.length > 0) {
              await tx.insert(estimateItems).values(
                replaceItems.map((it: any) => ({ ...it, estimateId: id }))
              );
            }
            return updatedEstimate;
          });
          if (!updated) return res.status(404).json({ message: "Estimate not found" });
          console.log(`[estimate-update] transaction complete, sending response`);
          (res as any).__auditDone = true;
          if (priorEstimate) {
            const d = diffForAudit(priorEstimate, { ...priorEstimate, ...updates });
            audit(req, {
              action: updates.status && updates.status !== (priorEstimate as any).status ? "status_change" : "update",
              entityType: "estimate", entityId: id,
              entityLabel: (priorEstimate as any).estimateNumber,
              estimateId: id, oldValue: d.oldValue, newValue: d.newValue,
            });
          }
          return res.json(updated);
        } catch (e: any) {
          return res.status(400).json({ message: `Items replace failed: ${e.message}` });
        }
      }

      const updated = await storage.updateEstimate(id, updates);
      if (!updated) return res.status(404).json({ message: "Estimate not found" });
      await syncEstimateDocuments(updated, req.user?.id || null);
      (res as any).__auditDone = true;
        if (priorEstimate) {
          const d = diffForAudit(priorEstimate, { ...priorEstimate, ...updates });
          audit(req, {
            action: updates.status && updates.status !== (priorEstimate as any).status ? "status_change" : "update",
            entityType: "estimate", entityId: id,
            entityLabel: (priorEstimate as any).estimateNumber,
            estimateId: id, oldValue: d.oldValue, newValue: d.newValue,
          });
        }
        res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/estimates/:id/export-excel", authenticateBrowserRequest, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ message: "Estimate not found" });

      // If the estimate links to a GST Profile, overlay the LIVE profile data
      // onto the estimate so exports reflect any updates the user made after
      // the estimate was created (multi-line structured address, GSTIN edits,
      // etc.). The historical snapshots stay intact on the row for audit.
      if ((estimate as any).billingProfileId) {
        const liveBp = await storage.getBillingProfile((estimate as any).billingProfileId);
        if (liveBp) {
          (estimate as any).billingLegalNameSnapshot = liveBp.legalCompanyName;
          (estimate as any).billingGstinSnapshot = liveBp.gstin;
          (estimate as any).billingStateSnapshot = liveBp.state;
          (estimate as any).billingStateCodeSnapshot = liveBp.stateCode;
          (estimate as any).billingAddressSnapshot = liveBp.billingAddress;
          if (liveBp.shippingAddress) (estimate as any).shippingAddressSnapshot = liveBp.shippingAddress;
          (estimate as any).billingTo = liveBp.legalCompanyName;
          (estimate as any).gstin = liveBp.gstin;
          (estimate as any).pan = liveBp.pan || (estimate as any).pan;
          (estimate as any).stateCode = liveBp.stateCode;
        }
      }

      const items = orderedEstimateItems(await storage.getEstimateItems(id));
      const clientsList = await storage.getAllClients();
      const client = clientsList.find(c => c.id === estimate.clientId);
      const brandsList = await storage.getAllBrands();
      const brand = brandsList.find(b => b.id === estimate.brandId);
      const storesList = await storage.getAllStores();
      const store = storesList.find(s => s.id === estimate.storeId);
      const productsList = await storage.getAllProducts();
      const seller = await getSellerProfile();
      const isIgst = estimate.gstType === "IGST";
      const sellerTerms = String(seller.terms || "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean);

      // Flawless English / Indian Words converter
      const numberToWords = (num: number): string => {
        const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
        const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        let internalNum = Math.floor(num);
        if (internalNum === 0) return 'Zero';

        const g = (n: number): string => {
          if (n < 20) return a[n];
          const digit = n % 10;
          return b[Math.floor(n / 10)] + (digit ? '-' + a[digit] : '');
        };

        const h = (n: number): string => {
          if (n === 0) return '';
          if (n < 100) return g(n) + ' ';
          return a[Math.floor(n / 100)] + 'Hundred ' + (n % 100 === 0 ? '' : 'and ' + g(n % 100) + ' ');
        };

        let str = '';
        const cr = Math.floor(internalNum / 10000000);
        internalNum %= 10000000;
        if (cr) str += h(cr) + 'Crore ';

        const lk = Math.floor(internalNum / 100000);
        internalNum %= 100000;
        if (lk) str += h(lk) + 'Lakh ';

        const th = Math.floor(internalNum / 1000);
        internalNum %= 1000;
        if (th) str += h(th) + 'Thousand ';

        if (internalNum) str += h(internalNum);
        return 'Rupees ' + str.trim() + ' Only';
      };

      // ==========================================
      // SINGLE SHEET: Printable Estimate — mirrors the on-screen preview /
      // PDF template exactly. 14-column dense ERP grid:
      // SL | ELEMENT | HSN | Standard/Non | PRODUCT DETAILS | W | H | Qty | T.Sqft
      //    | Rate | Amount | GST% | GST Amount | Total
      // Styled with xlsx-js-style (borders, bold headers, yellow Total
      // Material Cost row, orange footer banner).
      // ==========================================
      const printableRows: any[][] = [];
      const merges: any[] = [];
      const wsPageBreaks: any[] = [];
      const COL_COUNT_X = 14;
      const LAST_COL_X = COL_COUNT_X - 1;
      const blankRow = () => Array(COL_COUNT_X).fill("");
      // Excel stores raw floats; we round to 2dp before writing so values like
      // 1713.3600000000001 don't appear when a workbook opens without a fmt.
      const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
      const productDetailsForItem = (item: any) => formatProductDetails(
        item.productId ? productsList.find((product: any) => product.id === item.productId) : null,
        item.description || "",
        item.itemName || "",
      );

      // --- shared style fragments ---
      const thinBorder = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } },
      };
      const S_HEADER = { font: { bold: true, sz: 9 }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: thinBorder };
      const S_CELL = { font: { sz: 9 }, alignment: { vertical: "top", wrapText: true }, border: thinBorder };
      const S_NUM = { font: { sz: 9 }, alignment: { horizontal: "right", vertical: "top" }, border: thinBorder };
      const S_YELLOW = { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: "FFF066" } }, alignment: { vertical: "top" }, border: thinBorder };
      const S_YELLOW_NUM = { font: { bold: true, sz: 9 }, fill: { fgColor: { rgb: "FFF066" } }, alignment: { horizontal: "right", vertical: "top" }, border: thinBorder };
      const S_STORE = { font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" }, border: thinBorder };
      const S_SUBJECT = { font: { bold: true, sz: 11 }, alignment: { horizontal: "center", vertical: "center" }, border: thinBorder };
      const S_LOGO = { font: { bold: true, sz: 22, color: { rgb: "F59E0B" } }, alignment: { horizontal: "right", vertical: "center" } };
      const S_BILL_LABEL = { font: { bold: true, sz: 10 }, alignment: { vertical: "top", wrapText: true } };
      const S_BILL = { font: { sz: 10 }, alignment: { vertical: "top", wrapText: true } };
      const S_META_L = { font: { sz: 10 }, alignment: { horizontal: "left", vertical: "center" } };
      const S_META_V = { font: { bold: true, sz: 10 }, alignment: { horizontal: "left", vertical: "center" } };
      const S_TOTAL_NUM = { font: { bold: true, sz: 9 }, alignment: { horizontal: "right" }, border: thinBorder };
      const S_TOTAL_LBL = { font: { bold: true, sz: 9 }, alignment: { horizontal: "right" }, border: thinBorder };
      const S_BANNER_TITLE = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "F59E0B" } }, alignment: { horizontal: "center", vertical: "center" } };
      const S_BANNER = { font: { sz: 9, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "F59E0B" } }, alignment: { horizontal: "center", vertical: "center" } };
      const S_TERMS_HEAD = { font: { bold: true, sz: 9, color: { rgb: "B91C1C" }, underline: true }, border: thinBorder };
      const S_TERMS = { font: { sz: 9 }, alignment: { vertical: "top" }, border: thinBorder };
      const S_TERMS_BOLD = { font: { bold: true, sz: 9 }, alignment: { vertical: "top" }, border: thinBorder };

      // Cell-style registry: keyed "r,c" → style object. Applied after the
      // sheet is built (aoa_to_sheet does not carry styles by itself).
      const styleMap: Record<string, any> = {};
      const setStyle = (r: number, c: number, s: any) => { styleMap[`${r},${c}`] = s; };
      const styleRange = (r: number, cStart: number, cEnd: number, s: any) => {
        for (let c = cStart; c <= cEnd; c++) setStyle(r, c, s);
      };

      // --- Billing / shipping parsing (mirrors client preview) ---
      const billingRaw = estimate.billingTo || "";
      const billingLines = billingRaw.split("\n").map(s => s.trim()).filter(Boolean);
      const billingNameSnap = estimate.billingLegalNameSnapshot || "";
      const billingAddrSnap = estimate.billingAddressSnapshot || "";
      let billingName = billingNameSnap;
      let billingAddress = billingAddrSnap;
      if (!billingName) {
        const first = (billingLines[0] || "").replace(/^M\/S\s*:?\s*/i, "").trim();
        billingName = first || client?.name || "";
      }
      if (!billingAddress) {
        if (billingLines.length > 1) billingAddress = billingLines.slice(1).join("\n");
        else if (billingNameSnap && billingRaw && billingRaw !== billingNameSnap) billingAddress = billingRaw;
        else billingAddress = client?.address || "";
      }
      const billingGstin = estimate.billingGstinSnapshot || estimate.gstin || client?.gstNumber || "";
      const billingStateCode = estimate.billingStateCodeSnapshot || estimate.stateCode || "";
      const billingPan = estimate.pan || client?.pan || "";

      const shippingRaw = estimate.shippingAddressSnapshot || estimate.shippingTo || "";
      const shippingHasOwn = shippingRaw.trim().length > 0;
      let shippingName = billingName;
      let shippingAddress = billingAddress;
      if (shippingHasOwn) {
        const shipLines = shippingRaw.split("\n").map(s => s.trim()).filter(Boolean);
        if (shipLines.length > 0 && /^M\/S\s*:/i.test(shipLines[0])) {
          shippingName = shipLines[0].replace(/^M\/S\s*:?\s*/i, "").trim();
          shippingAddress = shipLines.slice(1).join("\n");
        } else {
          shippingAddress = shippingRaw.split("\n").map(s => s.trim()).filter(Boolean).join("\n");
        }
      }
      const dateStr = ((estimate as any).estimateDate || estimate.createdAt)
        ? new Date((estimate as any).estimateDate || estimate.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-")
        : "";

      const pushMerge = (rowIdx: number, cStart: number, cEnd: number) => {
        merges.push({ s: { r: rowIdx, c: cStart }, e: { r: rowIdx, c: cEnd } });
      };

      // --- Top header block: Billing/Shipping (left) + dedicated logo + meta ---
      // Left column spans cols 0-8; logo spans cols 10-13 on its own rows;
      // meta label col 10, meta value cols 11-13 below the logo area.
      const addHeaderRow = (left: string, leftStyle: any, metaLabel: string, metaValue: string) => {
        const row = blankRow();
        row[0] = left;
        if (metaLabel) row[10] = metaLabel;
        if (metaValue) row[11] = metaValue;
        printableRows.push(row);
        const r = printableRows.length - 1;
        pushMerge(r, 0, 8);
        styleRange(r, 0, 8, leftStyle);
        if (metaLabel) setStyle(r, 10, S_META_L);
        if (metaValue) { pushMerge(r, 11, LAST_COL_X); styleRange(r, 11, LAST_COL_X, S_META_V); }
        return r;
      };

      // Logo area: 2 reserved rows. The floating image overlays both.
      // The metadata block on the right starts at row 3 (index 2) so it sits
      // visually below the logo bottom edge.
      const logoR = printableRows.length;
      const logoRow = blankRow();
      logoRow[0] = "Billing To";
      logoRow[10] = seller.logoPath ? "" : (seller.name || "Sunrise Media");
      printableRows.push(logoRow);
      pushMerge(logoR, 0, 8);
      styleRange(logoR, 0, 8, S_BILL_LABEL);
      pushMerge(logoR, 10, LAST_COL_X);
      styleRange(logoR, 10, LAST_COL_X, S_LOGO);

      const logoSpacerR = printableRows.length;
      printableRows.push(blankRow());
      pushMerge(logoSpacerR, 0, 8);
      styleRange(logoSpacerR, 0, 8, S_BILL);
      pushMerge(logoSpacerR, 10, LAST_COL_X);
      styleRange(logoSpacerR, 10, LAST_COL_X, S_LOGO);

      // Billing block (left, cols 0-8) + metadata block (right, cols 10-13).
      // Matches the reference layout exactly:
      //   R2: M/S | Date
      //   R3: address (wrapped) | Est-No
      //   R4: State Code | seller GSTN
      //   R5: client GSTN | PAN
      //   R6: (blank)    | Vendor Code
      //   R7: Shipping To
      //   R8: M/S shipping
      //   R9: shipping address (wrapped)
      //   R10: client GSTN
      addHeaderRow(`M/S : ${billingName}`, S_BILL_LABEL, "Date :", dateStr);
      addHeaderRow(wrapAddressForExcel(billingAddress), S_BILL, "Est - No -", estimate.estimateNumber);
      addHeaderRow(billingStateCode ? `State Code: ${billingStateCode}` : "", S_BILL, "GSTN -", seller.gstin);
      addHeaderRow(billingGstin ? `GSTN - ${billingGstin}` : "", S_BILL_LABEL, "PAN -", seller.pan);
      addHeaderRow("", S_BILL, estimate.vendorCode ? "Vendor Code -" : "", estimate.vendorCode || "");
      addHeaderRow("Shipping To", S_BILL_LABEL, "", "");
      addHeaderRow(`M/S : ${shippingName}`, S_BILL_LABEL, "", "");
      addHeaderRow(wrapAddressForExcel(shippingAddress), S_BILL, "", "");
      addHeaderRow(billingGstin ? `GSTN - ${billingGstin}` : "", S_BILL_LABEL, "", "");

      // Spacer
      printableRows.push(blankRow());

      // Subject row (full width)
      const subjR = printableRows.length;
      const subjectRow = blankRow();
      subjectRow[0] = `Subject : ${estimate.subject || estimate.title || ""}`;
      printableRows.push(subjectRow);
      pushMerge(subjR, 0, LAST_COL_X);
      styleRange(subjR, 0, LAST_COL_X, S_SUBJECT);

      // Column header row
      const headR = printableRows.length;
      printableRows.push([
        "SL", "ELEMENT", "HSN", "Standard / Non", "PRODUCT DETAILS",
        "W", "H", "Qty", "T.Sqft", "Rate", "Amount",
        "GST %", "GST Amount", "Total",
      ]);
      styleRange(headR, 0, LAST_COL_X, S_HEADER);
      const repeatHeaderStart = headR + 1;

      // --- Store sections (unified: derive from storeGrouping regardless of
      // client format; fall back to a single section). ---
      type Section = {
        storeName: string;
        storeCode: string;
        storeItems: typeof items;
        serviceItems: typeof items;
        packingPercent: number;
        implPercent: number;
        transportAmt: number;
        transportDescription: string;
      };
      const sections: Section[] = [];
      const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
      const storeKeys = orderedStoreKeysFromItems(items, storeGrouping);
      if (storeKeys.length > 0) {
        storeKeys.forEach((sidKey) => {
          const tStore = storesList.find(s => s.id === Number(sidKey));
          const groupData = storeGrouping[sidKey] || [];
          const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
          const groupedItems = items.filter(it => itemSls.includes(it.sl || 0));
          if (groupedItems.length === 0) return;
          const storeItems = groupedItems.filter(it => !isEstimateServiceItem(it));
          const serviceItems = groupedItems.filter(isEstimateServiceItem);
          sections.push({
            storeName: tStore?.name || (!Array.isArray(groupData) && groupData.storeName) || `Store ${sidKey}`,
            storeCode: tStore?.storeCode || "",
            storeItems,
            serviceItems,
            packingPercent: !Array.isArray(groupData) && groupData.packingPercent !== undefined ? Number(groupData.packingPercent) : Number(estimate.packingPercent || 0),
            implPercent: !Array.isArray(groupData) && groupData.implementationPercent !== undefined ? Number(groupData.implementationPercent) : Number(estimate.implementationPercent || 0),
            transportAmt: !Array.isArray(groupData) && groupData.transportAmount !== undefined ? Number(groupData.transportAmount) : 0,
            transportDescription: !Array.isArray(groupData) && groupData.transportDescription ? String(groupData.transportDescription) : "Local Transportation",
          });
        });
      }
      if (sections.length === 0) {
        sections.push({
          storeName: store?.name || estimate.title || "Site",
          storeCode: store?.storeCode || "",
          storeItems: items.filter(it => !isEstimateServiceItem(it)),
          serviceItems: items.filter(isEstimateServiceItem),
          packingPercent: Number(estimate.packingPercent || 0),
          implPercent: Number(estimate.implementationPercent || 0),
          transportAmt: Number(estimate.transportAmount || 0),
          transportDescription: "Local Transportation",
        });
      }

      let grandBeforeTax = 0;
      let grandSgst = 0;
      let grandCgst = 0;
      let grandIgst = 0;

      sections.forEach((sec, sIdx) => {
        const sectionStartR = printableRows.length;
        const storeR = printableRows.length;
        const storeHeaderRow = blankRow();
        storeHeaderRow[0] = `Store: ${sec.storeName}${sec.storeCode ? `,  Store Code: ${sec.storeCode}` : ""}`;
        printableRows.push(storeHeaderRow);
        pushMerge(storeR, 0, LAST_COL_X);
        styleRange(storeR, 0, LAST_COL_X, S_STORE);

        sec.storeItems.forEach((item, idx) => {
          const r = printableRows.length;
          printableRows.push([
            idx + 1,
            item.itemName || "",
            item.hsn || "",
            item.isStandard ? "Standard" : "Non-standard",
            productDetailsForItem(item),
            item.width != null ? r2(Number(item.width)) : "",
            item.height != null ? r2(Number(item.height)) : "",
            item.quantity != null ? r2(Number(item.quantity)) : "",
            item.totalSize != null ? r2(Number(item.totalSize)) : "",
            item.rate != null ? r2(Number(item.rate)) : "",
            r2(Number(item.totalPrice) || 0),
            isIgst ? Number(item.igstPercent) || 0 : (Number(item.sgstPercent) || 0) + (Number(item.cgstPercent) || 0),
            r2(isIgst ? Number(item.igstAmount) || 0 : (Number(item.sgstAmount) || 0) + (Number(item.cgstAmount) || 0)),
            r2(Number(item.totalAmount) || 0),
          ]);
          setStyle(r, 0, S_HEADER); // SL centered
          styleRange(r, 1, 4, S_CELL);
          styleRange(r, 5, LAST_COL_X, S_NUM);
        });

        const materialBase = sec.storeItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
        const materialSgst = sec.storeItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0);
        const materialCgst = sec.storeItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0);
        const materialIgst = sec.storeItems.reduce((s, it) => s + Number(it.igstAmount || 0), 0);

        // Total Material Cost — yellow highlight
        const tmcR = printableRows.length;
        const tmcRow = blankRow();
        tmcRow[1] = "Total Material Cost";
        tmcRow[10] = r2(materialBase);
        tmcRow[11] = 18;
        tmcRow[12] = r2(isIgst ? materialIgst : materialSgst + materialCgst);
        tmcRow[13] = r2(materialBase + materialSgst + materialCgst + materialIgst);
        printableRows.push(tmcRow);
        styleRange(tmcR, 0, 9, S_YELLOW);
        styleRange(tmcR, 10, LAST_COL_X, S_YELLOW_NUM);

        const hasSavedServices = sec.serviceItems.length > 0;
        const packAmt = hasSavedServices
          ? sec.serviceItems.filter(it => it.lineType === "packing").reduce((s, it) => s + Number(it.totalPrice || 0), 0)
          : materialBase * (sec.packingPercent / 100);
        const implAmt = hasSavedServices
          ? sec.serviceItems.filter(it => it.lineType === "installation").reduce((s, it) => s + Number(it.totalPrice || 0), 0)
          : materialBase * (sec.implPercent / 100);
        const transAmt = hasSavedServices
          ? sec.serviceItems.filter(it => it.lineType === "transport").reduce((s, it) => s + Number(it.totalPrice || 0), 0)
          : sec.transportAmt;

        const serviceRow = (label: string, descr: string, pctLabel: string, base: number) => {
          if (base <= 0) return;
          const r = printableRows.length;
          const row = blankRow();
          row[1] = label;
          row[2] = "9987";
          row[3] = "Standard";
          row[4] = descr;
          row[9] = pctLabel;
          row[10] = r2(base);
          row[11] = 18;
          row[12] = r2(base * 0.18);
          row[13] = r2(base * 1.18);
          printableRows.push(row);
          setStyle(r, 0, S_CELL);
          styleRange(r, 1, 4, S_CELL);
          styleRange(r, 5, LAST_COL_X, S_NUM);
        };
        const savedServiceRow = (item: any) => {
          const base = Number(item.totalPrice || 0);
          if (base <= 0) return;
          const r = printableRows.length;
          const row = blankRow();
          row[1] = serviceItemLabel(item);
          row[2] = item.hsn || "9987";
          row[3] = item.isStandard === false ? "Non-standard" : "Standard";
          row[4] = serviceItemLabel(item);
          row[7] = r2(Number(item.quantity) || 1);
          row[9] = serviceItemRateLabel(item);
          row[10] = r2(base);
          row[11] = isIgst ? Number(item.igstPercent) || 0 : (Number(item.sgstPercent) || 0) + (Number(item.cgstPercent) || 0);
          row[12] = r2(isIgst ? Number(item.igstAmount) || 0 : (Number(item.sgstAmount) || 0) + (Number(item.cgstAmount) || 0));
          row[13] = r2(Number(item.totalAmount) || 0);
          printableRows.push(row);
          setStyle(r, 0, S_CELL);
          styleRange(r, 1, 4, S_CELL);
          styleRange(r, 5, LAST_COL_X, S_NUM);
        };
        if (hasSavedServices) {
          sec.serviceItems.forEach(savedServiceRow);
        } else {
          serviceRow(`Packing Charges (${sec.packingPercent}%)`, `Packing Charges (${sec.packingPercent}%)`, `${sec.packingPercent}%`, packAmt);
          serviceRow(`Installation Charges (${sec.implPercent}%)`, `Installation Charges (${sec.implPercent}%)`, `${sec.implPercent}%`, implAmt);
          serviceRow("Local Transportation", sec.transportDescription || "Local Transportation", "", transAmt);
        }

        // Spacer between stores
        if (sIdx < sections.length - 1) printableRows.push(blankRow());

        const savedServiceBase = sec.serviceItems.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
        const syntheticServiceBase = hasSavedServices ? 0 : packAmt + implAmt + transAmt;
        grandBeforeTax += materialBase + savedServiceBase + syntheticServiceBase;
        if (isIgst) {
          grandIgst += materialIgst
            + sec.serviceItems.reduce((s, it) => s + Number(it.igstAmount || 0), 0)
            + syntheticServiceBase * 0.18;
        } else {
          grandSgst += materialSgst
            + sec.serviceItems.reduce((s, it) => s + Number(it.sgstAmount || 0), 0)
            + syntheticServiceBase * 0.09;
          grandCgst += materialCgst
            + sec.serviceItems.reduce((s, it) => s + Number(it.cgstAmount || 0), 0)
            + syntheticServiceBase * 0.09;
        }
        if (sIdx > 0) {
          (wsPageBreaks as any[]).push({ id: sectionStartR, max: 16383, man: 1 });
        }
      });

      const grandTotal = grandBeforeTax + grandSgst + grandCgst + grandIgst;

      // Grand TOTAL row
      const totR = printableRows.length;
      const totalRow = blankRow();
      totalRow[9] = "TOTAL";
      totalRow[10] = r2(grandBeforeTax);
      totalRow[11] = 18;
      totalRow[12] = r2(isIgst ? grandIgst : grandSgst + grandCgst);
      totalRow[13] = r2(grandTotal);
      printableRows.push(totalRow);
      styleRange(totR, 9, LAST_COL_X, S_TOTAL_NUM);

      // Stacked tax summary — label spans cols 9-12 (right-aligned) so long
      // labels like "TOTAL AMOUNT BEFORE TAX" don't visually clip into the
      // adjacent column border. Value stays in col 13 (Total).
      const stacked = (label: string, value: number) => {
        const r = printableRows.length;
        const row = blankRow();
        row[9] = label;
        row[13] = r2(value);
        printableRows.push(row);
        pushMerge(r, 9, 12);
        styleRange(r, 9, 12, S_TOTAL_LBL);
        setStyle(r, 13, S_TOTAL_NUM);
      };
      stacked("TOTAL AMOUNT BEFORE TAX", grandBeforeTax);
      if (isIgst) {
        stacked("Add : IGST 18%", grandIgst);
      } else {
        stacked("Add : CGST 9%", grandCgst);
        stacked("Add : SGST 9%", grandSgst);
      }
      stacked("TOTAL AMOUNT AFTER TAX", grandTotal);

      // Amount in words
      const wordsR = printableRows.length;
      const wordsRow = blankRow();
      wordsRow[0] = `Amount in Words: ${numberToWords(grandTotal)}`;
      printableRows.push(wordsRow);
      pushMerge(wordsR, 0, LAST_COL_X);
      setStyle(wordsR, 0, S_TERMS_BOLD);

      // Terms / Bank / Signature block
      const termsHeadR = printableRows.length;
      const termsHeaderRow = blankRow();
      termsHeaderRow[0] = "Terms & Condition :";
      termsHeaderRow[5] = "BANK ACCOUNT DETAILS";
      termsHeaderRow[10] = `For ${(seller.name || "Sunrise Media").toUpperCase()}`;
      printableRows.push(termsHeaderRow);
      pushMerge(termsHeadR, 0, 4);
      pushMerge(termsHeadR, 5, 9);
      pushMerge(termsHeadR, 10, LAST_COL_X);
      styleRange(termsHeadR, 0, 4, S_TERMS_HEAD);
      styleRange(termsHeadR, 5, 9, S_TERMS_BOLD);
      styleRange(termsHeadR, 10, LAST_COL_X, S_TERMS_BOLD);

      const tcLines: [string, string, string][] = [
        [sellerTerms[0] || "", `Bank Name : ${seller.bankName || ""}`, ""],
        [sellerTerms[1] || "", `Branch Name : ${seller.bankBranch || ""}`, ""],
        [sellerTerms[2] || "", `C.A/c No : ${seller.bankAccountNumber || ""}`, ""],
        [sellerTerms[3] || "", `IFSC NO : ${seller.bankIfsc || ""}`, "Authorised Signatory"],
      ];
      tcLines.forEach(([t, b, s]) => {
        const r = printableRows.length;
        const row = blankRow();
        row[0] = t;
        row[5] = b;
        row[10] = s;
        printableRows.push(row);
        pushMerge(r, 0, 4);
        pushMerge(r, 5, 9);
        pushMerge(r, 10, LAST_COL_X);
        styleRange(r, 0, 4, S_TERMS);
        styleRange(r, 5, 9, S_TERMS);
        styleRange(r, 10, LAST_COL_X, s ? S_TERMS_BOLD : S_TERMS);
      });

      // Spacer
      printableRows.push(blankRow());

      // Orange branding banner (full-width rows)
      const bannerLine = (text: string, style: any) => {
        const r = printableRows.length;
        const row = blankRow();
        row[0] = text;
        printableRows.push(row);
        pushMerge(r, 0, LAST_COL_X);
        styleRange(r, 0, LAST_COL_X, style);
      };
      bannerLine((seller.name || "Sunrise Media").toUpperCase(), S_BANNER_TITLE);
      if (seller.address) bannerLine(seller.address, S_BANNER);
      if (seller.mobile || seller.email) bannerLine([seller.mobile, seller.email].filter(Boolean).join("  ·  "), S_BANNER);

      // Convert to worksheet and apply styles + merges + widths.
      const wsPrintable = XLSX.utils.aoa_to_sheet(printableRows);
      wsPrintable['!merges'] = merges;
      Object.keys(styleMap).forEach((key) => {
        const [r, c] = key.split(",").map(Number);
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!wsPrintable[addr]) wsPrintable[addr] = { t: "s", v: "" };
        (wsPrintable[addr] as any).s = styleMap[key];
      });

      // 14-column widths matching the dense layout
      wsPrintable['!cols'] = [
        { wch: 5 },   // SL
        { wch: 22 },  // ELEMENT
        { wch: 8 },   // HSN
        { wch: 13 },  // Standard / Non
        { wch: 34 },  // Product Details
        { wch: 7 },   // W
        { wch: 7 },   // H
        { wch: 7 },   // Qty
        { wch: 9 },   // T.Sqft
        { wch: 9 },   // Rate
        { wch: 11 },  // Amount
        { wch: 8 },   // GST %
        { wch: 13 },  // GST Amount
        { wch: 12 },  // Total
      ];
      wsPrintable['!rows'] = printableRows.map((row, idx) => {
        if (idx === logoR || idx === logoSpacerR) return { hpt: 28 };
        if (idx === headR) return { hpt: 22 };
        // Address / wrapped rows: count explicit \n breaks and estimate wrap
        // lines from a long single string at the merged width (~100 chars).
        // Cap at 2 lines visible — matches the PDF (which shows the address
        // as 2 lines), with the rest reachable by clicking the cell.
        const leftText = String(row[0] || "");
        const newlineCount = (leftText.match(/\n/g) || []).length + 1;
        const wrappedLines = Math.max(1, Math.ceil(leftText.length / 100));
        const linesNeeded = Math.min(2, Math.max(newlineCount, wrappedLines));
        if (linesNeeded >= 2) return { hpt: 32 };
        return { hpt: 16 };
      });
      (wsPrintable as any)['!freeze'] = { xSplit: 0, ySplit: repeatHeaderStart, topLeftCell: `A${repeatHeaderStart + 1}`, activePane: "bottomLeft", state: "frozen" };
      (wsPrintable as any)['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headR, c: 0 }, e: { r: headR, c: LAST_COL_X } }) };
      // Manual per-store page breaks intentionally dropped — Excel's fit-to-page
      // packs content into the fewest pages possible, matching "compact" intent.
      (wsPrintable as any)['!rowBreaks'] = [];
      (wsPrintable as any)['!pageSetup'] = {
        orientation: "landscape",
        paperSize: 9,
        fitToWidth: 1,
        // fitToHeight: 0 = no height constraint — content flows to as many
        // pages as needed but pages fill before breaking (no forced per-store
        // breaks). Small estimates land on 1 page; large ones span N pages
        // packed tight, matching "1 of N" Excel behavior.
        fitToHeight: 0,
        horizontalCentered: true,
      };
      (wsPrintable as any)['!printHeader'] = [`$${repeatHeaderStart}:$${repeatHeaderStart}`];
      (wsPrintable as any)['!margins'] = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.45, header: 0.2, footer: 0.2 };
      (wsPrintable as any)['!headerFooter'] = {
        oddFooter: "&CPage &P of &N",
        evenFooter: "&CPage &P of &N",
      };

      // Create Workbook with the single printable sheet (Clean Data sheet
      // removed — the preview no longer exposes that tab; one template only).
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsPrintable, "Estimate");

      // Write binary buffer
      const workbookBuffer = addCompanyLogoToEstimateWorkbook(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
        { fromCol: 10, toCol: 14, fromRow: logoR, toRow: logoSpacerR + 1 },
        seller.logoPath,
      );
      const buffer = normalizeWorksheetXmlOrder(applyEstimateWorkbookPrintXml(workbookBuffer, {
        repeatHeaderRow: repeatHeaderStart,
        freezeRows: repeatHeaderStart,
        rowBreaks: wsPageBreaks,
      }));

      res.setHeader("Content-Disposition", `attachment; filename=estimate_${estimate.estimateNumber}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/estimates/:id/export-summary-excel", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const estimate = await storage.getEstimate(id);
      if (!estimate) return res.status(404).json({ message: "Estimate not found" });

      const seller = await getSellerProfile();
      const items = orderedEstimateItems(await storage.getEstimateItems(id));
      const storesList = await storage.getAllStores();
      const targetStore = storesList.find(s => s.id === estimate.storeId);
      const storeGrouping = (estimate.storeGrouping as Record<string, any>) || {};
      const storeKeys = orderedStoreKeysFromItems(items, storeGrouping);
      const summaryRows = (storeKeys.length > 0
        ? storeKeys.map((sidKey, index) => {
            const groupData = storeGrouping[sidKey] || [];
            const itemSls = Array.isArray(groupData) ? groupData : (groupData.itemSls || []);
            const storeItems = items.filter((it: any) => itemSls.includes(it.sl || 0));
            const store = storesList.find(s => s.id === Number(sidKey));
            return {
              srNo: index + 1,
              storeCode: store?.storeCode || storeItems.find((it: any) => it.storeCode)?.storeCode || sidKey,
              items: storeItems,
            };
          }).filter(section => section.items.length > 0)
        : [{
            srNo: 1,
            storeCode: targetStore?.storeCode || items.find((it: any) => it.storeCode)?.storeCode || "",
            items,
          }]
      ).flatMap(section => section.items.map((item: any) => ({
        srNo: section.srNo,
        vendorCode: estimate.vendorCode || "",
        activityName: isEstimateServiceItem(item)
          ? `${serviceItemLabel(item)}${serviceItemRateLabel(item) ? ` ${serviceItemRateLabel(item)}` : ""}`
          : (item.itemName || item.description || ""),
        storeCode: section.storeCode,
        qty: Number(item.quantity || 0),
        beforeGst: Number(item.totalPrice || 0),
        estimateNo: estimate.estimateNumber,
      })));

      const totalBeforeGst = summaryRows.reduce((sum, row) => sum + row.beforeGst, 0);
      const aoa: any[][] = [
        ["", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        ["Sr No", "Vendor Code", "Element / Product Details", "Store Code", "Qty", "Before GST Net Price", "Estimate No"],
        ...summaryRows.map(row => [
          row.srNo,
          row.vendorCode,
          row.activityName,
          row.storeCode,
          row.qty,
          Math.round(row.beforeGst * 100) / 100,
          row.estimateNo,
        ]),
        ["", "", "", "", "Total Before GST", Math.round(totalBeforeGst * 100) / 100, ""],
      ];

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const thinBorder = {
        top: { style: "thin", color: { rgb: "000000" } },
        bottom: { style: "thin", color: { rgb: "000000" } },
        left: { style: "thin", color: { rgb: "000000" } },
        right: { style: "thin", color: { rgb: "000000" } },
      };
      const headerStyle = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: "F1F5F9" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: thinBorder };
      const cellStyle = { font: { sz: 10 }, alignment: { vertical: "top", wrapText: true }, border: thinBorder };
      const numStyle = { font: { sz: 10 }, alignment: { horizontal: "right", vertical: "top" }, border: thinBorder, numFmt: "#,##0.00" };
      const totalStyle = { font: { bold: true, sz: 10 }, alignment: { horizontal: "right", vertical: "center" }, border: thinBorder, numFmt: "#,##0.00" };
      for (let r = 0; r < aoa.length; r++) {
        for (let c = 0; c < 7; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        (ws[addr] as any).s = r === 3
            ? headerStyle
            : (r < 3 ? cellStyle : (c === 4 || c === 5 ? (r === aoa.length - 1 ? totalStyle : numStyle) : cellStyle));
        }
      }
      ws["!cols"] = [
        { wch: 8 },
        { wch: 16 },
        { wch: 42 },
        { wch: 14 },
        { wch: 10 },
        { wch: 18 },
        { wch: 18 },
      ];
      (ws as any)["!pageSetup"] = { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
      XLSX.utils.book_append_sheet(wb, ws, "Summary");

      const buffer = normalizeWorksheetXmlOrder(addCompanyLogoToEstimateWorkbook(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
        { fromCol: 0, toCol: 3, fromRow: 0, toRow: 3 },
        seller.logoPath,
      ));
      res.setHeader("Content-Disposition", `attachment; filename=estimate_summary_${estimate.estimateNumber}.xlsx`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/delivery-challans", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = searchList(await storage.getAllDeliveryChallans(), req,
        ["dcNumber", "challanNumber", "status", "storeCode"]);
      const { page, total } = paginateList(list, req);
      if (total !== null) res.setHeader("X-Total-Count", String(total));
      res.json(page);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/delivery-challans/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const dc = await storage.getDeliveryChallan(id);
      if (!dc) return res.status(404).json({ message: "Delivery challan not found" });
      res.json(dc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/delivery-challans/estimate/:estimateId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = parseInt(req.params.estimateId, 10);
      const list = (await storage.getDeliveryChallansByEstimate(estimateId))
        .filter((dc: any) => dc.status !== "deleted" && !dc.metadata?.deleted);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/execution-documents", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : null;
      const deliveryChallanId = req.query.deliveryChallanId ? Number(req.query.deliveryChallanId) : null;
      const includeHistory = String(req.query.includeHistory || "").toLowerCase() === "true";
      let rows: any[];
      if (estimateId) {
        rows = await db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, estimateId));
      } else if (deliveryChallanId) {
        rows = await db.select().from(executionDocuments).where(eq(executionDocuments.deliveryChallanId, deliveryChallanId));
      } else {
        rows = await db.select().from(executionDocuments);
      }
      rows = rows
        .filter((row) => includeHistory ? row.status !== "deleted" : row.status === "active")
        .sort((a, b) => new Date((b.uploadedAt || b.createdAt) as any).getTime() - new Date((a.uploadedAt || a.createdAt) as any).getTime());
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create a new execution document (photo, signed_wcc, extra, etc.)
  app.post("/api/operations/execution-documents", authenticateToken, requireRole(["admin", "manager", "production", "installer"]), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const { estimateId, deliveryChallanId, storeCode, documentType, filePath, originalFileName, mimeType, fileSize, uploadedVia, metadata } = req.body;
      if (!estimateId || !documentType || !filePath) return res.status(400).json({ message: "estimateId, documentType and filePath are required" });
      const doc = await db.insert(executionDocuments).values({
        estimateId: Number(estimateId),
        deliveryChallanId: deliveryChallanId ? Number(deliveryChallanId) : null,
        storeCode: storeCode || null,
        documentType,
        filePath,
        originalFileName: originalFileName || null,
        mimeType: mimeType || null,
        fileSize: fileSize ? Number(fileSize) : null,
        status: "active",
        version: 1,
        uploadedBy: req.user.id,
        uploadedVia: uploadedVia || "project_workspace",
        uploadedAt: new Date(),
        metadata: metadata ?? null,
      }).returning();
      audit(req as AuthRequest, {
        action: "create",
        entityType: "execution_document",
        entityId: doc[0].id,
        entityLabel: `${documentType}: ${originalFileName || filePath}`,
        estimateId: Number(estimateId),
        newValue: { documentType, filePath, storeCode },
      });
      res.status(201).json(doc[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/execution-documents/:id/versions", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [doc] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, id)).limit(1);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const { rows } = await loadExecutionDocumentVersions(doc);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/field-access-links", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = Number(req.body?.estimateId);
      if (!estimateId) return res.status(400).json({ message: "estimateId is required" });
      const [estimate] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
      if (!estimate) return res.status(404).json({ message: "Estimate not found" });
      const estimateStores = await db.select().from(executionStores).where(eq(executionStores.estimateId, estimateId));
      const allStoreCodes = (estimateStores as any[]).map(row => normalizeStoreCode(row.storeCode)).filter(Boolean);
      const requestedStores = Array.isArray(req.body?.storeCodes) ? req.body.storeCodes.map(normalizeStoreCode).filter(Boolean) : [];
      const allowedStoreCodes = requestedStores.length ? requestedStores.filter((code: string) => allStoreCodes.some(existing => existing.toLowerCase() === code.toLowerCase())) : allStoreCodes;
      if (allowedStoreCodes.length === 0) return res.status(400).json({ message: "At least one valid execution store is required" });
      const requestedDocTypes = Array.isArray(req.body?.documentTypes) ? req.body.documentTypes : ["photo", "signed_wcc", "signed_dc"];
      const allowedDocumentTypes = requestedDocTypes.map(normalizeAllowedDocumentType).filter((type: string) => fieldDocumentTypes.has(type));
      if (allowedDocumentTypes.length === 0) return res.status(400).json({ message: "At least one valid document type is required" });
      const ttlHours = Math.max(1, Math.min(Number(req.body?.ttlHours || 168), 24 * 30));
      const token = generateFieldToken();
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
      const inserted = await db.insert(fieldAccessLinks).values({
        estimateId,
        tokenHash: hashFieldToken(token),
        tokenPrefix: token.slice(0, 8),
        channel: String(req.body?.channel || "telegram").toLowerCase(),
        recipientName: req.body?.recipientName || null,
        recipientContact: req.body?.recipientContact || null,
        allowedStoreCodes,
        allowedDocumentTypes,
        permissions: { uploadOnly: true },
        expiresAt,
        createdBy: req.user?.id || null,
        metadata: { source: "erp", estimateNumber: (estimate as any).estimateNumber },
      }).returning();
      const baseUrl = String(req.body?.baseUrl || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const url = `${baseUrl}/field/${token}`;
      const { tokenHash: _tokenHash, ...safeLink } = inserted[0] as any;
      res.status(201).json({ ...safeLink, url, expiresAt, allowedStoreCodes, allowedDocumentTypes });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/field-access-links", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : null;
      const rows = estimateId
        ? await db.select().from(fieldAccessLinks).where(eq(fieldAccessLinks.estimateId, estimateId))
        : await db.select().from(fieldAccessLinks);
      res.json((rows as any[]).map(row => ({
        ...row,
        tokenHash: undefined,
        active: !row.revokedAt && new Date(row.expiresAt as any).getTime() >= Date.now(),
      })).sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/field-access-links/:id/revoke", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const updated = await db.update(fieldAccessLinks)
        .set({ revokedAt: new Date(), revokedBy: req.user?.id || null, updatedAt: new Date() })
        .where(eq(fieldAccessLinks.id, id))
        .returning();
      if (!updated[0]) return res.status(404).json({ message: "Field access link not found" });
      res.json({ ...updated[0], tokenHash: undefined });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/field/:token", async (req: Request, res: Response) => {
    try {
      const resolved = await resolveFieldLink(req.params.token);
      if (!("link" in resolved)) return res.status(resolved.status).json({ message: resolved.error });
      const link: any = resolved.link;
      const [estimate] = await db.select().from(estimates).where(eq(estimates.id, link.estimateId)).limit(1);
      if (!estimate) return res.status(404).json({ message: "Project not found" });
      const [storeRows, docs, dcs] = await Promise.all([
        db.select().from(executionStores).where(eq(executionStores.estimateId, link.estimateId)),
        db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, link.estimateId)),
        db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, link.estimateId)),
      ]);
      const activeDcs = (dcs as any[]).filter(dc => dc.status !== "deleted" && !dc.metadata?.deleted);
      const activeOwners = buildActiveDocumentOwnerSet(activeDcs);
      const activeDocs = (docs as any[]).filter(doc => doc.status === "active" && documentHasActiveWorkflowOwner(doc, activeOwners));
      const allowedCodes = allowedStoreCodesForLink(link).map((code: string) => code.toLowerCase());
      const storesPayload = (storeRows as any[])
        .filter(row => allowedCodes.length === 0 || allowedCodes.includes(normalizeStoreCode(row.storeCode).toLowerCase()))
        .map(row => {
          const key = normalizeStoreCode(row.storeCode).toLowerCase();
          const storeDocs = activeDocs.filter(doc => normalizeStoreCode(doc.storeCode).toLowerCase() === key);
          const storeDcs = activeDcs.filter(dc => storeCodeForDc(dc).toLowerCase() === key);
          const stats = {
            photoCount: storeDocs.filter(doc => doc.documentType === "photo").length,
            signedWccCount: storeDocs.filter(doc => doc.documentType === "signed_wcc").length,
            signedDcCount: storeDocs.filter(doc => doc.documentType === "signed_dc").length,
            wccCount: storeDcs.filter(dc => documentTypeForDc(dc) === "wcc").length,
            dcCount: storeDcs.filter(dc => documentTypeForDc(dc) !== "wcc").length,
          };
          return {
            storeCode: row.storeCode,
            storeName: row.storeName,
            storeLocation: row.storeLocation,
            storeCity: row.storeCity,
            storeState: row.storeState,
            status: deriveExecutionStoreStatus({ ...stats, documentCount: storeDocs.length } as any),
            stats,
            documents: storeDocs.map(doc => ({
              id: doc.id,
              documentType: doc.documentType,
              originalFileName: doc.originalFileName,
              uploadedAt: doc.uploadedAt,
              version: doc.version,
            })),
          };
        })
        .sort((a, b) => String(a.storeCode).localeCompare(String(b.storeCode), undefined, { numeric: true }));
      await db.update(fieldAccessLinks)
        .set({ lastUsedAt: new Date(), useCount: Number(link.useCount || 0) + 1, updatedAt: new Date() })
        .where(eq(fieldAccessLinks.id, link.id));
      res.json({
        project: publicEstimateRef(estimate),
        channel: link.channel,
        expiresAt: link.expiresAt,
        allowedDocumentTypes: allowedDocumentTypesForLink(link),
        stores: storesPayload,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/field/:token/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const resolved = await resolveFieldLink(req.params.token);
      if (!("link" in resolved)) return res.status(resolved.status).json({ message: resolved.error });
      const link: any = resolved.link;
      const storeCode = normalizeStoreCode(req.body?.storeCode);
      const documentType = normalizeAllowedDocumentType(req.body?.documentType);
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      if (!storeCode) return res.status(400).json({ message: "storeCode is required" });
      if (!fieldDocumentTypes.has(documentType)) return res.status(400).json({ message: "Invalid document type" });
      const allowedCodes = allowedStoreCodesForLink(link).map((code: string) => code.toLowerCase());
      if (allowedCodes.length && !allowedCodes.includes(storeCode.toLowerCase())) return res.status(403).json({ message: "Store is not assigned to this field link" });
      const allowedTypes = allowedDocumentTypesForLink(link);
      if (!allowedTypes.includes(documentType)) return res.status(403).json({ message: "Document type is not allowed for this field link" });
      const [storeRow] = await db.select().from(executionStores).where(sql`
        estimate_id = ${link.estimateId}
        AND lower(store_code) = lower(${storeCode})
      `).limit(1);
      if (!storeRow) return res.status(404).json({ message: "Assigned store not found" });
      const dcRows = await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, link.estimateId));
      const ownerDc = (dcRows as any[]).find(dc => storeCodeForDc(dc).toLowerCase() === storeCode.toLowerCase() && dc.status !== "deleted" && !dc.metadata?.deleted) || null;
      if (!ownerDc && ["photo", "signed_wcc", "signed_dc"].includes(documentType)) {
        return res.status(409).json({ message: "Generate an active WCC/DC for this store before uploading photos or signed proof" });
      }
      const filePath = `/uploads/${req.file.filename}`;
      let nextVersion = 1;
      let previousSignedDocs: any[] = [];
      if (ownerDc && (documentType === "signed_wcc" || documentType === "signed_dc")) {
        previousSignedDocs = await db.select().from(executionDocuments).where(sql`
          delivery_challan_id = ${ownerDc.id}
          AND document_type = ${documentType}
          AND status = 'active'
        `);
        const allSignedVersions = await db.select().from(executionDocuments).where(sql`
          delivery_challan_id = ${ownerDc.id}
          AND document_type = ${documentType}
        `);
        nextVersion = Math.max(1, ...((allSignedVersions as any[]).map(doc => Number(doc.version || 1)))) + 1;
      }
      const inserted = await db.insert(executionDocuments).values({
        estimateId: link.estimateId,
        deliveryChallanId: ownerDc?.id || null,
        storeCode,
        documentType,
        filePath,
        originalFileName: req.file.originalname || req.file.filename,
        mimeType: req.file.mimetype || mimeTypeFromPath(filePath),
        fileSize: req.file.size || null,
        status: "active",
        version: nextVersion,
        uploadedBy: null,
        uploadedVia: link.channel === "telegram" ? "telegram" : "field_link",
        uploadedAt: new Date(),
        metadata: {
          source: "field_access_link",
          fieldAccessLinkId: link.id,
          channel: link.channel,
          storeCode,
        },
      }).returning();
      const doc = inserted[0];
      if (ownerDc && (documentType === "signed_wcc" || documentType === "signed_dc")) {
        for (const previous of previousSignedDocs) {
          await db.update(executionDocuments)
            .set({ status: "replaced", replacedByDocumentId: doc.id, updatedAt: new Date() })
            .where(eq(executionDocuments.id, previous.id));
        }
        await syncLegacyDeliveryChallanFile({ ...doc, deliveryChallanId: ownerDc.id, documentType }, filePath);
      } else if (ownerDc && documentType === "photo") {
        const meta = (ownerDc as any).metadata || {};
        const photos = Array.isArray(meta.photos) ? meta.photos : [];
        await storage.updateDeliveryChallan(ownerDc.id, {
          metadata: {
            ...meta,
            photos: [...photos, { path: filePath, caption: req.file.originalname || "Field photo", uploadedVia: "field_link" }],
          },
        } as any);
      }
      await db.update(fieldAccessLinks)
        .set({ lastUsedAt: new Date(), useCount: Number(link.useCount || 0) + 1, updatedAt: new Date() })
        .where(eq(fieldAccessLinks.id, link.id));
      res.status(201).json({ document: doc, message: "Upload received" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/execution-documents/:id/replace", authenticateToken, requireRole(["admin", "manager", "production", "installer"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [doc] = await db.select().from(executionDocuments).where(eq(executionDocuments.id, id)).limit(1);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const filePath = normalizeStoredFilePath(req.body?.filePath);
      if (!filePath) return res.status(400).json({ message: "filePath is required" });
      const { rootId, rows: versions } = await loadExecutionDocumentVersions(doc);
      const nextVersion = Math.max(1, ...versions.map((row: any) => Number(row.version || 1))) + 1;
      const inserted = await db.insert(executionDocuments).values({
        estimateId: doc.estimateId,
        deliveryChallanId: doc.deliveryChallanId,
        storeCode: doc.storeCode,
        documentType: doc.documentType,
        filePath,
        originalFileName: req.body?.originalFileName || fileNameFromPath(filePath),
        mimeType: req.body?.mimeType || mimeTypeFromPath(filePath),
        fileSize: req.body?.fileSize || null,
        status: "active",
        version: nextVersion,
        uploadedBy: req.user?.id || null,
        uploadedVia: "erp",
        uploadedAt: new Date(),
        metadata: {
          ...(doc.metadata || {}),
          rootDocumentId: rootId,
          replacedDocumentId: doc.id,
        },
      }).returning();
      const nextDoc = inserted[0];
      await db.update(executionDocuments)
        .set({ status: "replaced", replacedByDocumentId: nextDoc.id, updatedAt: new Date() })
        .where(eq(executionDocuments.id, doc.id));
      await syncLegacyDeliveryChallanFile(doc, filePath);
      res.status(201).json(nextDoc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operations/execution-documents/:id", authenticateToken, requireRole(["admin", "manager", "production", "installer"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const updated = await db.update(executionDocuments)
        .set({ status: "deleted", deletedAt: new Date(), deletedBy: req.user?.id || null, updatedAt: new Date() })
        .where(eq(executionDocuments.id, id))
        .returning();
      if (!updated[0]) return res.status(404).json({ message: "Document not found" });
      await syncLegacyDeliveryChallanFile(updated[0], null, updated[0].filePath);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operations/execution-stores", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : null;
      if (!estimateId) return res.status(400).json({ message: "estimateId is required" });

      const [rows, docs, dcs] = await Promise.all([
        db.select().from(executionStores).where(eq(executionStores.estimateId, estimateId)),
        db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, estimateId)),
        db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, estimateId)),
      ]);

      const activeDcs = (dcs as any[]).filter(dc => dc.status !== "deleted" && !dc.metadata?.deleted);
      const activeOwners = buildActiveDocumentOwnerSet(activeDcs);
      const activeDocs = (docs as any[]).filter(doc => doc.status === "active" && documentHasActiveWorkflowOwner(doc, activeOwners));
      const byStore = (rows as any[]).map(row => {
        const key = normalizeStoreCode(row.storeCode).toLowerCase();
        const storeDocs = activeDocs.filter(doc => normalizeStoreCode(doc.storeCode).toLowerCase() === key);
        const storeDcs = activeDcs.filter(dc => storeCodeForDc(dc).toLowerCase() === key);
        const wccRecords = storeDcs.filter(dc => documentTypeForDc(dc) === "wcc");
        const dcRecords = storeDcs.filter(dc => documentTypeForDc(dc) !== "wcc");
        const photoDocs = storeDocs.filter(doc => doc.documentType === "photo");
        const signedWccDocs = storeDocs.filter(doc => doc.documentType === "signed_wcc");
        const signedDcDocs = storeDocs.filter(doc => doc.documentType === "signed_dc");
        const stats = {
          wccCount: wccRecords.length,
          dcCount: dcRecords.length,
          photoCount: photoDocs.length,
          signedWccCount: signedWccDocs.length,
          signedDcCount: signedDcDocs.length,
          documentCount: storeDocs.length,
        };
        return {
          ...row,
          status: deriveExecutionStoreStatus(stats),
          stats,
          documents: storeDocs,
          wccRecords,
          dcRecords,
          signedWccDocuments: signedWccDocs,
          photoDocuments: photoDocs,
        };
      }).sort((a, b) => String(a.storeCode).localeCompare(String(b.storeCode), undefined, { numeric: true }));

      res.json(byStore);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // PROJECT WORKSPACE v2 API
  // ==========================================

  // PATCH a single execution-store row (billing_ready, notes, status)
  app.patch("/api/operations/execution-stores/:id", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { billingReady, notes, status } = req.body as { billingReady?: boolean; notes?: string; status?: string };
      const updates: Record<string, unknown> = {};
      if (billingReady !== undefined) updates.billingReady = billingReady;
      if (notes !== undefined) updates.notes = notes;
      if (status !== undefined) updates.status = status;
      updates.updatedAt = new Date();
      const updated = await db.update(executionStores).set(updates).where(eq(executionStores.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Execution store not found" });
      res.json(updated[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/projects/:estimateId — aggregated project data in one call
  app.get("/api/projects/:estimateId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = parseInt(req.params.estimateId, 10);
      if (isNaN(estimateId)) return res.status(400).json({ message: "Invalid estimateId" });

      const [estRows, itemRows, challanRows, docRows, storeRows, invoiceRows] = await Promise.all([
        db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1),
        db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId)),
        db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, estimateId)),
        db.select().from(executionDocuments).where(eq(executionDocuments.estimateId, estimateId)),
        db.select().from(executionStores).where(eq(executionStores.estimateId, estimateId)),
        db.select().from(invoices).where(eq(invoices.estimateId, estimateId)),
      ]);

      const est = estRows[0];
      if (!est) return res.status(404).json({ message: "Project not found" });

      const activeDcs = (challanRows as any[]).filter(dc => dc.status !== "deleted" && !(dc.metadata as any)?.deleted);
      const activeOwners = buildActiveDocumentOwnerSet(activeDcs);
      // Execution store rows are valid owners for documents uploaded directly
      // via the project workspace (no deliveryChallanId). Without this, photos
      // uploaded to a store that has no WCC yet would be filtered out.
      (storeRows as any[]).forEach(row => {
        if (row.storeCode) {
          activeOwners.activeStoreKeys.add(activeOwnerKeyForDocs(Number(estimateId), row.storeCode));
        }
      });
      const activeDocs = (docRows as any[]).filter(doc => doc.status === "active" && documentHasActiveWorkflowOwner(doc, activeOwners));

      // Project-level documents: no store association, or type in [po, transport_receipt, extra, field_upload]
      const projectDocs = activeDocs.filter(doc =>
        !doc.storeCode ||
        ["po", "transport_receipt", "extra"].includes(doc.documentType)
      );

      // Per-store execution data
      const byStore = (storeRows as any[]).map(row => {
        const key = normalizeStoreCode(row.storeCode).toLowerCase();
        const storeDocs = activeDocs.filter(doc => normalizeStoreCode(doc.storeCode || "").toLowerCase() === key && !["po", "transport_receipt"].includes(doc.documentType));
        const storeDcs = activeDcs.filter(dc => storeCodeForDc(dc).toLowerCase() === key);
        const wccRecords = storeDcs.filter(dc => documentTypeForDc(dc) === "wcc");
        const dcRecords = storeDcs.filter(dc => documentTypeForDc(dc) !== "wcc");
        const photoDocs = storeDocs.filter(doc => doc.documentType === "photo");
        const signedWccDocs = storeDocs.filter(doc => doc.documentType === "signed_wcc");
        const signedDcDocs = storeDocs.filter(doc => doc.documentType === "signed_dc");
        const stats = {
          wccCount: wccRecords.length,
          dcCount: dcRecords.length,
          photoCount: photoDocs.length,
          signedWccCount: signedWccDocs.length,
          signedDcCount: signedDcDocs.length,
          documentCount: storeDocs.length,
        };
        return {
          ...row,
          stats,
          documents: storeDocs,
          wccRecords,
          dcRecords,
          signedWccDocuments: signedWccDocs,
          photoDocuments: photoDocs,
        };
      }).sort((a, b) => String(a.storeCode).localeCompare(String(b.storeCode), undefined, { numeric: true }));

      res.json({
        estimate: est,
        items: itemRows,
        challans: challanRows,
        stores: byStore,
        projectDocuments: projectDocs,
        invoices: invoiceRows,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/projects/:estimateId/activity — chronological activity feed
  app.get("/api/projects/:estimateId/activity", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = parseInt(req.params.estimateId, 10);
      if (isNaN(estimateId)) return res.status(400).json({ message: "Invalid estimateId" });

      // Pull audit logs linked to this estimate (direct link or via invoice/DC)
      const logs = await db.select().from(auditLogs)
        .where(eq(auditLogs.estimateId, estimateId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(100);

      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/projects/:estimateId/transport-receipt — upload project-level transport receipt
  app.post("/api/projects/:estimateId/transport-receipt", authenticateToken, requireRole(["admin", "manager", "production"]), upload.single("file"), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ message: "Unauthorized" });
      const estimateId = parseInt(req.params.estimateId, 10);
      if (isNaN(estimateId)) return res.status(400).json({ message: "Invalid estimateId" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = `/uploads/${req.file.filename}`;
      const doc = await db.insert(executionDocuments).values({
        estimateId,
        deliveryChallanId: null,
        storeCode: null,
        documentType: "transport_receipt",
        filePath,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype || null,
        fileSize: req.file.size || null,
        status: "active",
        version: 1,
        uploadedBy: req.user.id,
        uploadedVia: "project_workspace",
        uploadedAt: new Date(),
      }).returning();

      audit(req as AuthRequest, {
        action: "create",
        entityType: "execution_document",
        entityId: doc[0].id,
        entityLabel: `Transport Receipt: ${req.file.originalname}`,
        estimateId,
        newValue: { documentType: "transport_receipt", filePath },
      });

      res.status(201).json(doc[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/delivery-challans", authenticateToken, requireRole(["admin", "manager", "production", "installer"]), async (req: AuthRequest, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const body = preprocessDateFields(req.body, [{ field: "deliveryDate", defaultTo: nowDefault }]);
      body.documentType = documentTypeForDc(body);
      const parsed = insertDeliveryChallanSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid delivery challan data", errors: parsed.error.errors });
      }
      const existingWcc = await findActiveDuplicateWcc(parsed.data);
      if (existingWcc) {
        return res.status(200).json({ ...existingWcc, duplicatePrevented: true, message: "WCC already exists for this store" });
      }
      const created = await storage.createDeliveryChallan(parsed.data);
      await syncDeliveryChallanDocuments(created, req.user?.id || null);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/operations/delivery-challans/:id", authenticateToken, requireRole(["admin", "manager", "production", "installer"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await storage.getDeliveryChallan(id);
      if (!existing) return res.status(404).json({ message: "Delivery challan not found" });
      const updates = preprocessDateFields(req.body, ["deliveryDate"]);
      const uniquenessPayload = {
        ...existing,
        ...updates,
        metadata: updates.metadata !== undefined ? updates.metadata : existing.metadata,
      };
      if (updates.clientFormat !== undefined || updates.documentType !== undefined || updates.metadata !== undefined || updates.storeCode !== undefined || updates.estimateId !== undefined) {
        updates.documentType = documentTypeForDc(uniquenessPayload);
        const existingWcc = await findActiveDuplicateWcc({ ...uniquenessPayload, documentType: updates.documentType }, id);
        if (existingWcc) {
          return res.status(409).json({ message: "WCC already exists for this store", existingWcc });
        }
      }
      const updated = await storage.updateDeliveryChallan(id, updates);
      if (!updated) return res.status(404).json({ message: "Delivery challan not found" });
      await syncDeliveryChallanDocuments(updated, req.user?.id || null);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 10. Staff Advances API (Sunrise Custom / Furnili Pattern)
  // ==========================================
  app.get("/api/advances", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.getAllAdvances();
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/advances/user/:userId", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const list = await storage.getAdvancesByUser(userId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/advances", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      // Drizzle timestamp columns -> z.date() (no coercion). See server/utils/dateFields.ts.
      const parsed = insertStaffAdvanceSchema.safeParse(
        preprocessDateFields(req.body, [{ field: "date", defaultTo: nowDefault }]),
      );
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid advance request data", errors: parsed.error.errors });
      }

      const created = await storage.createAdvance(parsed.data);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // 11. Payroll & Salary Calculation API (Sunrise Custom / Furnili Pattern)
  // ==========================================
  app.get("/api/payroll", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
      const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
      const list = await storage.getPayrollByMonthYear(month, year);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/payroll", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const parsed = insertPayrollSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid payroll data", errors: parsed.error.errors });
      }

      const created = await storage.createPayroll({
        ...parsed.data,
        approvedBy: req.user?.id || null
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/payroll/:id", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = req.body;
      
      const updated = await storage.updatePayroll(id, updates);
      if (!updated) return res.status(404).json({ message: "Payroll entry not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Master Data Imports API
  app.post("/api/operations/imports/:type", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const type = req.params.type;
      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Invalid payload, items must be an array" });
      }

      // Always ignore blank/invalid IDs. Use them only when numeric and > 0.
      const optId = (v: any): number | null => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;   // duplicates within file or already-fine rows
      let errorCount = 0;
      const errors: any[] = [];
      const recordError = (row: number, message: string) => {
        errorCount++;
        errors.push({ row, message });
      };

      if (type === "clients") {
        const existingClients = await storage.getAllClients();
        const seenGstin = new Map<string, number>();
        const seenNameKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          const item = items[i] || {};
          const excelRow = i + 2;
          try {
            const normalizedName = normalizeDisplayName(item.name);
            if (!normalizedName) {
              recordError(excelRow, "Missing required field 'name'");
              continue;
            }
            const gstin = normalizeGstinPan(item.gstNumber);
            // Within-file dedupe
            if (gstin) {
              if (seenGstin.has(gstin)) {
                skippedCount++;
                errors.push({ row: excelRow, message: `Duplicate GSTIN ${gstin} (also row ${seenGstin.get(gstin)}); skipped` });
                continue;
              }
              seenGstin.set(gstin, excelRow);
            }
            const nameKey = nameMatchKey(normalizedName);
            if (seenNameKey.has(nameKey)) {
              skippedCount++;
              errors.push({ row: excelRow, message: `Duplicate client name "${normalizedName}" (also row ${seenNameKey.get(nameKey)}); skipped` });
              continue;
            }
            seenNameKey.set(nameKey, excelRow);

            // Match against masters: GSTIN first, then nameMatchKey
            let existing = gstin
              ? existingClients.find(c => normalizeGstinPan(c.gstNumber) === gstin)
              : undefined;
            if (!existing) existing = existingClients.find(c => nameMatchKey(c.name) === nameKey);
            // Last resort: explicit ID from the same export
            if (!existing) {
              const explicitId = optId(item.id);
              if (explicitId) existing = existingClients.find(c => c.id === explicitId);
            }
            if (existing) {
              await db.update(clients).set({
                name: normalizedName,
                email: item.email || existing.email,
                mobile: item.mobile || existing.mobile,
                city: normalizeDisplayName(item.city) || existing.city,
                address: item.address || existing.address,
                gstNumber: gstin || existing.gstNumber,
                format: item.format ? normalizeImportFormat(item.format) : existing.format,
                clientGroupName: normalizeDisplayName(item.clientGroupName) || existing.clientGroupName,
                clientType: item.clientType || existing.clientType,
                pan: normalizeGstinPan(item.pan) || existing.pan,
                primaryContactPerson: normalizeDisplayName(item.primaryContactPerson) || existing.primaryContactPerson,
                paymentTerms: item.paymentTerms || existing.paymentTerms,
                vendorCode: item.vendorCode || existing.vendorCode,
              }).where(eq(clients.id, existing.id));
              updatedCount++;
            } else {
              const created = await storage.createClient({
                name: normalizedName,
                email: item.email || null,
                mobile: item.mobile || null,
                city: normalizeDisplayName(item.city) || null,
                address: item.address || null,
                gstNumber: gstin || null,
                format: normalizeImportFormat(item.format),
                clientGroupName: normalizeDisplayName(item.clientGroupName) || null,
                clientType: item.clientType || "normal",
                pan: normalizeGstinPan(item.pan) || null,
                primaryContactPerson: normalizeDisplayName(item.primaryContactPerson) || null,
                paymentTerms: item.paymentTerms || null,
                vendorCode: item.vendorCode || null,
              });
              existingClients.push(created);
              importedCount++;
            }
          } catch (e: any) {
            recordError(excelRow, e.message || "Unknown error");
          }
        }
      } else if (type === "billing_profiles") {
        const existingClients = await storage.getAllClients();
        const allProfiles = await storage.getAllBillingProfiles();
        const seenKey = new Map<string, number>();

        for (let i = 0; i < items.length; i++) {
          const item = items[i] || {};
          const excelRow = i + 2;
          try {
            const gstin = normalizeGstinPan(item.gstin);
            const state = normalizeDisplayName(item.state || item.branchLocationName);
            const stateCode = String(item.stateCode || gstin.slice(0, 2)).trim().padStart(2, "0");
            const billingAddress = String(item.billingAddress || "").trim();
            const legalCompanyName = normalizeDisplayName(item.legalCompanyName || ABLBL_LEGAL_NAME);

            // Resolve client: name first (most user-facing), explicit ID only if valid
            let targetClientId: number | null = null;
            if (item.clientName) {
              const key = nameMatchKey(item.clientName);
              const matched = existingClients.find(c => nameMatchKey(c.name) === key);
              if (matched) targetClientId = matched.id;
            }
            if (!targetClientId) {
              const explicitId = optId(item.clientId);
              if (explicitId && existingClients.find(c => c.id === explicitId)) targetClientId = explicitId;
            }
            if (!targetClientId && (legalCompanyName === ABLBL_LEGAL_NAME || isAblblFormat(item.clientName))) {
              const ablbl = findAblblClient(existingClients);
              if (ablbl) targetClientId = ablbl.id;
            }
            if (!targetClientId) {
              recordError(excelRow, `Could not resolve parent client (clientName="${item.clientName ?? ""}")`);
              continue;
            }
            if (!gstin || !state || !stateCode || !billingAddress) {
              recordError(excelRow, "Missing required fields (GSTIN, state, state code, billing address)");
              continue;
            }
            if (gstin.length !== 15) {
              recordError(excelRow, `Invalid GSTIN length for ${gstin}; expected 15 characters`);
              continue;
            }
            if (stateCode !== gstin.slice(0, 2)) {
              recordError(excelRow, `State code ${stateCode} does not match GSTIN prefix ${gstin.slice(0, 2)}`);
              continue;
            }

            const dKey = `${targetClientId}|${gstin}`;
            if (seenKey.has(dKey)) {
              skippedCount++;
              errors.push({ row: excelRow, message: `Duplicate GSTIN+Client with row ${seenKey.get(dKey)}; skipped` });
              continue;
            }
            seenKey.set(dKey, excelRow);

            const existing = allProfiles.find(p => p.clientId === targetClientId && normalizeGstinPan(p.gstin) === gstin);
            if (existing) {
              await storage.updateBillingProfile(existing.id, {
                legalCompanyName,
                branchLocationName: normalizeDisplayName(item.branchLocationName || state) || existing.branchLocationName,
                pan: normalizeGstinPan(item.pan) || existing.pan,
                state,
                stateCode,
                billingAddress,
                shippingAddress: item.shippingAddress || billingAddress || existing.shippingAddress,
                contactPerson: normalizeDisplayName(item.contactPerson) || existing.contactPerson,
                mobile: item.mobile || existing.mobile,
                email: item.email || existing.email,
                notes: item.notes || existing.notes,
                isActive: normalizeBool(item.isActive, true),
                isDefault: normalizeBool(item.isDefault, true),
              });
              updatedCount++;
            } else {
              const createdProfile = await storage.createBillingProfile({
                clientId: targetClientId,
                legalCompanyName,
                branchLocationName: normalizeDisplayName(item.branchLocationName || state) || null,
                gstin,
                pan: normalizeGstinPan(item.pan) || null,
                state,
                stateCode,
                billingAddress,
                shippingAddress: item.shippingAddress || billingAddress,
                contactPerson: normalizeDisplayName(item.contactPerson) || null,
                mobile: item.mobile || null,
                email: item.email || null,
                isDefault: normalizeBool(item.isDefault, true),
                isActive: normalizeBool(item.isActive, true),
                notes: item.notes || null,
              });
              allProfiles.push(createdProfile);
              importedCount++;
            }
          } catch (e: any) {
            recordError(excelRow, e.message || "Unknown error");
          }
        }
      } else if (type === "brands") {
        const existingClients = await storage.getAllClients();
        const existingBrands = await storage.getAllBrands();
        const seenKey = new Map<string, number>();

        for (let i = 0; i < items.length; i++) {
          const item = items[i] || {};
          const excelRow = i + 2;
          try {
            const name = normalizeDisplayName(item.name);
            if (!name) {
              recordError(excelRow, "Missing required field 'name'");
              continue;
            }
            // Resolve parent client: name first, then ID
            let parentClient = null as null | typeof existingClients[number];
            if (item.clientName) {
              const key = nameMatchKey(item.clientName);
              parentClient = existingClients.find(c => nameMatchKey(c.name) === key) || null;
            }
            if (!parentClient) {
              const explicitId = optId(item.clientId);
              if (explicitId) parentClient = existingClients.find(c => c.id === explicitId) || null;
            }
            if (!parentClient) {
              recordError(excelRow, `Could not resolve parent client (clientName="${item.clientName ?? ""}")`);
              continue;
            }

            const dKey = `${parentClient.id}|${nameMatchKey(name)}`;
            if (seenKey.has(dKey)) {
              skippedCount++;
              errors.push({ row: excelRow, message: `Duplicate brand+client with row ${seenKey.get(dKey)}; skipped` });
              continue;
            }
            seenKey.set(dKey, excelRow);

            // Match: brand name + (same client OR no client linked yet)
            const nameKey = nameMatchKey(name);
            const existing = existingBrands.find(b =>
              nameMatchKey(b.name) === nameKey &&
              (b.parentClientId === parentClient!.id || !b.parentClientId)
            );
            if (existing) {
              await db.update(brands).set({
                name,
                parentClientId: parentClient.id,
                parentBrand: normalizeDisplayName(parentClient.name) || existing.parentBrand,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : existing.isActive
              }).where(eq(brands.id, existing.id));
              updatedCount++;
            } else {
              const created = await storage.createBrand({
                name,
                parentClientId: parentClient.id,
                parentBrand: normalizeDisplayName(parentClient.name) || null,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : true
              });
              existingBrands.push(created);
              importedCount++;
            }
          } catch (e: any) {
            recordError(excelRow, e.message || "Unknown error");
          }
        }
      } else if (type === "stores") {
        const existingClients = await storage.getAllClients();
        const existingBrands = await storage.getAllBrands();
        const existingStores = await storage.getAllStores();
        const seenCode = new Map<string, number>();
        const seenName = new Map<string, number>();

        for (let i = 0; i < items.length; i++) {
          const item = items[i] || {};
          const excelRow = i + 2;
          try {
            const name = normalizeDisplayName(item.name);
            const code = String(item.storeCode || "").trim();
            if (!name && !code) {
              recordError(excelRow, "Missing store name and store code");
              continue;
            }
            // Resolve client: name first, ID only if valid
            let client = null as null | typeof existingClients[number];
            if (item.clientName) {
              const key = nameMatchKey(item.clientName);
              client = existingClients.find(c => nameMatchKey(c.name) === key) || null;
            }
            if (!client) {
              const explicitId = optId(item.clientId);
              if (explicitId) client = existingClients.find(c => c.id === explicitId) || null;
            }
            if (!client) {
              recordError(excelRow, `Could not resolve parent client (clientName="${item.clientName ?? ""}")`);
              continue;
            }

            // Resolve brand: name + same client (or unlinked) preferred
            let brand = null as null | typeof existingBrands[number];
            if (item.brandName) {
              const key = nameMatchKey(item.brandName);
              brand = existingBrands.find(b =>
                nameMatchKey(b.name) === key &&
                (b.parentClientId === client!.id || !b.parentClientId)
              ) || null;
            }
            if (!brand) {
              const explicitId = optId(item.brandId);
              if (explicitId) brand = existingBrands.find(b => b.id === explicitId) || null;
            }
            if (!brand) {
              recordError(excelRow, `Could not resolve brand "${item.brandName ?? ""}" under client "${normalizeDisplayName(client.name)}"`);
              continue;
            }

            // Within-file dedupe by code (preferred) or name
            if (code) {
              const dKey = `${client.id}|${brand.id}|${code.toLowerCase()}`;
              if (seenCode.has(dKey)) {
                skippedCount++;
                errors.push({ row: excelRow, message: `Duplicate store code with row ${seenCode.get(dKey)}; skipped` });
                continue;
              }
              seenCode.set(dKey, excelRow);
            }
            if (name) {
              const dKey = `${client.id}|${brand.id}|${nameMatchKey(name)}`;
              if (seenName.has(dKey)) {
                skippedCount++;
                errors.push({ row: excelRow, message: `Duplicate store name with row ${seenName.get(dKey)}; skipped` });
                continue;
              }
              seenName.set(dKey, excelRow);
            }

            // Match priority: store code + client/brand, else name + client/brand
            let existing = null as null | typeof existingStores[number];
            if (code) {
              existing = existingStores.find(s =>
                (s.storeCode || "").toLowerCase() === code.toLowerCase() &&
                s.clientId === client!.id && s.brandId === brand!.id
              ) || null;
            }
            if (!existing && name) {
              const key = nameMatchKey(name);
              existing = existingStores.find(s =>
                nameMatchKey(s.name) === key &&
                s.clientId === client!.id && s.brandId === brand!.id
              ) || null;
            }
            if (existing) {
              await db.update(stores).set({
                name: name || existing.name,
                clientId: client.id,
                brandId: brand.id,
                location: normalizeDisplayName(item.location) || existing.location,
                address: item.address || existing.address,
                contactPerson: normalizeDisplayName(item.contactPerson) || existing.contactPerson,
                contactPhone: item.contactPhone || existing.contactPhone,
                storeCode: code || existing.storeCode,
                city: normalizeDisplayName(item.city) || existing.city,
                state: normalizeDisplayName(item.state) || existing.state,
                stateCode: item.stateCode || existing.stateCode,
                regionZone: item.regionZone || existing.regionZone,
                contact: normalizeDisplayName(item.contact) || existing.contact,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : existing.isActive
              }).where(eq(stores.id, existing.id));
              updatedCount++;
            } else {
              const created = await storage.createStore({
                name: name || code,
                clientId: client.id,
                brandId: brand.id,
                location: normalizeDisplayName(item.location) || null,
                address: item.address || null,
                contactPerson: normalizeDisplayName(item.contactPerson) || null,
                contactPhone: item.contactPhone || null,
                storeCode: code || null,
                city: normalizeDisplayName(item.city) || null,
                state: normalizeDisplayName(item.state) || null,
                stateCode: item.stateCode || null,
                regionZone: item.regionZone || null,
                contact: normalizeDisplayName(item.contact) || null,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : true
              });
              existingStores.push(created);
              importedCount++;
            }
          } catch (e: any) {
            recordError(excelRow, e.message || "Unknown error");
          }
        }
      } else if (type === "products" || type === "material_codes") {
        const existingProducts = await storage.getAllProducts();
        const seenKey = new Map<string, number>();
        for (let i = 0; i < items.length; i++) {
          const item = items[i] || {};
          const excelRow = i + 2;
          try {
            if (!item.name) {
              recordError(excelRow, "Missing required field 'name'");
              continue;
            }
            const nameKey = nameMatchKey(item.name);
            if (seenKey.has(nameKey)) {
              skippedCount++;
              errors.push({ row: excelRow, message: `Duplicate product name with row ${seenKey.get(nameKey)}; skipped` });
              continue;
            }
            seenKey.set(nameKey, excelRow);
            const existing = existingProducts.find(p => nameMatchKey(p.name) === nameKey);
            const normalizedCategory = item.category !== undefined ? await normalizeProductCategory(item.category) : null;
            if (existing) {
              await db.update(products).set({
                category: normalizedCategory || existing.category,
                unit: item.unit || existing.unit,
                rate: item.rate !== undefined ? Number(item.rate) : existing.rate,
                description: item.description || existing.description,
                hsnSac: item.hsnSac || existing.hsnSac,
                isStandard: item.isStandard !== undefined ? normalizeBool(item.isStandard, true) : existing.isStandard,
                calculationType: item.calculationType || existing.calculationType,
                gstPercent: item.gstPercent !== undefined ? Number(item.gstPercent) : existing.gstPercent,
                defaultSpecification: item.defaultSpecification || existing.defaultSpecification,
                warranty: item.warranty || existing.warranty,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : existing.isActive
              }).where(eq(products.id, existing.id));
              updatedCount++;
            } else {
              const created = await storage.createProduct({
                name: item.name,
                category: normalizedCategory,
                unit: item.unit || "pcs",
                rate: item.rate !== undefined ? Number(item.rate) : 0,
                description: item.description || null,
                hsnSac: item.hsnSac || null,
                isStandard: item.isStandard !== undefined ? normalizeBool(item.isStandard, true) : true,
                calculationType: item.calculationType || "fixed",
                gstPercent: item.gstPercent !== undefined ? Number(item.gstPercent) : 18,
                defaultSpecification: item.defaultSpecification || null,
                warranty: item.warranty || null,
                isActive: item.isActive !== undefined ? normalizeBool(item.isActive, true) : true
              });
              existingProducts.push(created);
              importedCount++;
            }
          } catch (e: any) {
            recordError(excelRow, e.message || "Unknown error");
          }
        }
      } else {
        return res.status(400).json({ message: `Invalid import type: ${type}` });
      }

      res.json({
        message: "Import processing finished",
        imported: importedCount,
        created: importedCount,
        updated: updatedCount,
        skipped: skippedCount,
        skippedRows: skippedCount,
        total: items.length,
        errorsCount: errorCount,
        errors
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Master Data Exports API
  app.get("/api/operations/exports/:type", authenticateBrowserRequest, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const type = req.params.type;
      let aoa: any[][] = [];
      let filename = `export_${type}.xlsx`;

      if (type === "clients") {
        const list = await storage.getAllClients();
        aoa.push(["ID", "Name", "Email", "Mobile", "City", "Address", "GSTIN", "Format Setting", "Group Name", "Client Type", "PAN", "Contact Person", "Payment Terms"]);
        list.forEach(c => {
          aoa.push([c.id, c.name, c.email || "", c.mobile || "", c.city || "", c.address || "", c.gstNumber || "", c.format, c.clientGroupName || "", c.clientType || "", c.pan || "", c.primaryContactPerson || "", c.paymentTerms || ""]);
        });
      } else if (type === "billing_profiles") {
        const list = await storage.getAllBillingProfiles();
        const clientsList = await storage.getAllClients();
        aoa.push(["ID", "Client ID", "Client Name", "Legal Company Name", "Branch/Location", "GSTIN", "PAN", "State", "State Code", "Billing Address", "Shipping Address", "Contact Person", "Mobile", "Email", "Is Default", "Is Active"]);
        list.forEach(p => {
          const client = clientsList.find(c => c.id === p.clientId);
          aoa.push([p.id, p.clientId, client?.name || "", p.legalCompanyName, p.branchLocationName || "", p.gstin, p.pan || "", p.state, p.stateCode, p.billingAddress, p.shippingAddress || "", p.contactPerson || "", p.mobile || "", p.email || "", p.isDefault ? "Yes" : "No", p.isActive ? "Yes" : "No"]);
        });
      } else if (type === "brands") {
        const list = await storage.getAllBrands();
        aoa.push(["ID", "Brand Name", "Parent Brand", "Is Active"]);
        list.forEach(b => {
          aoa.push([b.id, b.name, b.parentBrand || "", b.isActive ? "Yes" : "No"]);
        });
      } else if (type === "stores") {
        const list = await storage.getAllStores();
        const clientsList = await storage.getAllClients();
        const brandsList = await storage.getAllBrands();
        aoa.push(["ID", "Store Name", "Client ID", "Client Name", "Brand ID", "Brand Name", "Location", "Address", "Contact Person", "Contact Phone", "Store Code", "City", "State", "State Code", "Region/Zone", "Contact"]);
        list.forEach(s => {
          const client = clientsList.find(c => c.id === s.clientId);
          const brand = brandsList.find(b => b.id === s.brandId);
          aoa.push([s.id, s.name, s.clientId, client?.name || "", s.brandId, brand?.name || "", s.location || "", s.address || "", s.contactPerson || "", s.contactPhone || "", s.storeCode || "", s.city || "", s.state || "", s.stateCode || "", s.regionZone || "", s.contact || ""]);
        });
      } else if (type === "products" || type === "material_codes") {
        const list = await storage.getAllProducts();
        aoa.push(["ID", "Alias", "Description", "HSN/SAC", "Default Rate", "GST %", "Category", "UOM", "Is Standard", "Calculation Type", "Sizing Specs", "Warranty", "Is Active"]);
        list.forEach(p => {
          aoa.push([p.id, p.name, p.description || "", p.hsnSac || "", p.rate, p.gstPercent, p.category || "", p.unit, p.isStandard ? "Yes" : "No", p.calculationType, p.defaultSpecification || "", p.warranty || "", p.isActive ? "Yes" : "No"]);
        });
      } else {
        return res.status(400).json({ message: `Invalid export type: ${type}` });
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, "Sheet 1");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Material Codes Master (additive)
  // Seller / company settings — Sunrise Media's GSTIN, PAN, state etc.
  // Used by the estimate header (top-right) and as the source of truth for
  // CGST+SGST vs IGST decisions. Reads `company.<key>` from app_settings,
  // falling back to SUNRISE_DEFAULT_SELLER for any unset key.
  app.get("/api/company-settings", authenticateToken, async (_req: AuthRequest, res: Response) => {
    try {
      const seller = await getSellerProfile();
      res.json(seller);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  app.put("/api/company-settings", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const fieldToKey: Record<string, string> = {
        name: "company.name",
        gstin: "company.gstin",
        pan: "company.pan",
        state: "company.state",
        stateCode: "company.stateCode",
        address: "company.address",
        mobile: "company.mobile",
        email: "company.email",
        bankName: "bank.name",
        bankAccountNumber: "bank.accountNumber",
        bankIfsc: "bank.ifsc",
        bankBranch: "bank.branch",
        defaultGstPercent: "defaults.gstPercent",
        defaultPacking: "defaults.packingPercent",
        defaultImplementation: "defaults.implementationPercent",
        defaultLocalTransport: "defaults.localTransport",
        defaultOutstationTransportRate: "defaults.outstationTransportRate",
        terms: "defaults.terms",
        logoPath: "company.logoPath",
        signatureStampPath: "company.signatureStampPath",
      };
      const allowed = Object.keys(fieldToKey);
      for (const key of allowed) {
        if (key in req.body) {
          const value = key === "logoPath" || key === "signatureStampPath"
            ? cleanCompanyAssetRef(req.body[key])
            : String(req.body[key] ?? "");
          await storage.setAppSetting(fieldToKey[key], value);
        }
      }
      const prefixUpdates: Array<[string, string]> = [
        ["defaultEstimatePrefix", "estimate"],
        ["defaultInvoicePrefix", "invoice"],
        ["defaultDcPrefix", "dc"],
      ];
      for (const [field, kind] of prefixUpdates) {
        if (!(field in req.body)) continue;
        const current = (await storage.getAppSetting(`numbering.${kind}`).catch(() => null) as any) || {};
        await storage.setAppSetting(`numbering.${kind}`, {
          ...current,
          prefix: String(req.body[field] ?? ""),
          startAt: Number.isFinite(Number(current.startAt)) ? Number(current.startAt) : 101,
          fyAware: current.fyAware !== false,
        });
      }
      const seller = await getSellerProfile();
      res.json(seller);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  app.get("/api/operations/material-codes", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string, 10) : undefined;
      const brandId = req.query.brandId ? parseInt(req.query.brandId as string, 10) : undefined;
      const list = await storage.getAllMaterialCodes({ clientId, brandId });
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operations/material-codes", authenticateToken, requireRole(["admin", "manager", "designer", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const created = await storage.createMaterialCode(req.body);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/operations/material-codes/:id", authenticateToken, requireRole(["admin", "manager", "designer", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updated = await storage.updateMaterialCode(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operations/material-codes/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const ok = await storage.deleteMaterialCode(id);
      res.json({ success: ok });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // App Settings (additive)
  // ==========================================
  app.get("/api/settings", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = await storage.listAppSettings();
      const obj: Record<string, any> = {};
      for (const row of list) obj[(row as any).key] = (row as any).value;
      const seller = await getSellerProfile();
      Object.assign(obj, {
        companyName: seller.name,
        companyGstin: seller.gstin,
        companyPan: seller.pan,
        companyStateCode: seller.stateCode,
        companyAddress: seller.address,
        companyMobile: seller.mobile,
        companyEmail: seller.email,
        bankName: seller.bankName,
        bankAccountNumber: seller.bankAccountNumber,
        bankIfsc: seller.bankIfsc,
        bankBranch: seller.bankBranch,
        defaultGstPercent: seller.defaultGstPercent,
        defaultPacking: seller.defaultPacking,
        defaultImplementation: seller.defaultImplementation,
        defaultLocalTransport: seller.defaultLocalTransport,
        defaultOutstationTransportRate: seller.defaultOutstationTransportRate,
        defaultEstimatePrefix: seller.defaultEstimatePrefix,
        defaultInvoicePrefix: seller.defaultInvoicePrefix,
        defaultDcPrefix: seller.defaultDcPrefix,
        terms: seller.terms,
      });
      res.json(obj);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/settings/:key", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const key = req.params.key;
      const value = req.body?.value !== undefined ? req.body.value : req.body;
      const legacyTarget = legacySettingMap[key];
      if (legacyTarget) {
        const field = Object.entries(companySettingMap).find(([settingKey]) => settingKey === legacyTarget)?.[1];
        if (field) {
          const body: any = { [field]: value };
          const prefixField = key === "defaultEstimatePrefix" ? "estimate" : key === "defaultInvoicePrefix" ? "invoice" : key === "defaultDcPrefix" ? "dc" : "";
          if (prefixField) {
            const current = (await storage.getAppSetting(`numbering.${prefixField}`).catch(() => null) as any) || {};
            await storage.setAppSetting(`numbering.${prefixField}`, {
              ...current,
              prefix: String(value ?? ""),
              startAt: Number.isFinite(Number(current.startAt)) ? Number(current.startAt) : 101,
              fyAware: current.fyAware !== false,
            });
          } else {
            await storage.setAppSetting(legacyTarget, String(value ?? ""));
          }
          return res.json({ key: legacyTarget, value: body[field] });
        }
      }
      const numberingKey = key === "defaultEstimatePrefix" ? "estimate" : key === "defaultInvoicePrefix" ? "invoice" : key === "defaultDcPrefix" ? "dc" : "";
      if (numberingKey) {
        const current = (await storage.getAppSetting(`numbering.${numberingKey}`).catch(() => null) as any) || {};
        const saved = await storage.setAppSetting(`numbering.${numberingKey}`, {
          ...current,
          prefix: String(value ?? ""),
          startAt: Number.isFinite(Number(current.startAt)) ? Number(current.startAt) : 101,
          fyAware: current.fyAware !== false,
        });
        return res.json(saved);
      }
      const saved = await storage.setAppSetting(key, value);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Uploads list — for Project Documents page
  // ==========================================
  app.get("/api/uploads", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const list = searchList(
        (await storage.listAllUploads()).filter((upload: any) => upload.category !== "company-assets"),
        req, ["fileName", "category", "mimeType"]);
      const { page, total } = paginateList(list, req);
      if (total !== null) res.setHeader("X-Total-Count", String(total));
      res.json(page);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Aggregated Invoice Packet data
  // GET /api/finance/invoice-packet/:invoiceId
  // Returns invoice + linked estimate + estimate items + DC + PO file ref + uploads
  // ==========================================
  app.get("/api/finance/invoice-packet/:invoiceId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.invoiceId, 10);
      const allInvoices = await storage.getAllInvoices();
      const invoice = allInvoices.find((i) => i.id === id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      let estimate: any = null;
      let estimateItems: any[] = [];
      let challans: any[] = [];
      let client: any = null;
      // The shared <EstimateDocument /> renderer needs the stores list so it
      // can resolve store names from the storeGrouping object on a multi-store
      // estimate. Loading the master tables alongside is cheap and keeps the
      // page self-contained — no separate fetch chain on the client.
      const stores = await storage.getAllStores();
      const allClients = await storage.getAllClients();
      const allProducts = await storage.getAllProducts();

      if (invoice.estimateId) {
        estimate = await storage.getEstimate(invoice.estimateId);
        if (estimate) {
          estimateItems = orderedEstimateItems(await storage.getEstimateItems(estimate.id));
          const allDc = await storage.getAllDeliveryChallans();
          challans = allDc.filter((d) => d.estimateId === estimate.id && d.status !== "deleted" && !(d.metadata as any)?.deleted);
        }
      }
      if (invoice.clientId) {
        client = allClients.find((c: any) => c.id === invoice.clientId);
      }

      // related payments
      const allPayments = await storage.getAllPayments();
      const payments = allPayments.filter((p: any) => p.invoiceId === invoice.id);

      res.json({ invoice, estimate, estimateItems, challans, client, payments, stores, clients: allClients, products: allProducts });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/finance/invoice-packet/:invoiceId/pdf
  // Pure server-side packet PDF assembly:
  //   playwright → Tax Invoice PDF + Estimate PDF
  //   pdf-lib copyPages → PO and other uploaded PDFs
  //   pdf-lib drawImage → transport receipts, signed WCCs, photos (images)
  // No filePages from client — server determines order from DB.
  app.post("/api/finance/invoice-packet/:invoiceId/pdf", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId, 10);
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const user = req.user as any;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const port = parseInt(process.env.PORT || "5000", 10);

      const result = await buildInvoicePacketPdf({
        invoiceId,
        userId: user.id,
        username: user.username,
        role: user.role,
        port,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-packet-${invoiceId}.pdf"`);
      res.setHeader("Content-Length", result.buffer.length);
      res.setHeader("X-Packet-Pages", String(result.totalPages));
      res.send(result.buffer);
    } catch (err: any) {
      console.error("[invoice-packet/pdf]", err);
      res.status(500).json({ message: err.message || "PDF generation failed" });
    }
  });

  // ==========================================
  // AUTOMATION — Telegram / WhatsApp / Bot Inbox
  // ==========================================

  // GET bot settings (redacts token)
  app.get("/api/automation/:platform", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const platform = req.params.platform;
      if (!["telegram", "whatsapp"].includes(platform)) return res.status(400).json({ message: "Invalid platform" });
      const rows = await db.select().from(botSettings).where(eq(botSettings.platform, platform)).limit(1);
      if (!rows.length) return res.json({ platform, enabled: false });
      const row = { ...rows[0], botToken: rows[0].botToken ? "••••" + rows[0].botToken.slice(-4) : null };
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT bot settings
  app.put("/api/automation/:platform", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const platform = req.params.platform;
      if (!["telegram", "whatsapp"].includes(platform)) return res.status(400).json({ message: "Invalid platform" });
      const body = req.body;
      const updateData: any = { platform, enabled: !!body.enabled, updatedAt: new Date() };
      if (body.botUsername !== undefined) updateData.botUsername = body.botUsername;
      if (body.webhookUrl !== undefined) updateData.webhookUrl = body.webhookUrl;
      if (body.verifyToken !== undefined) updateData.verifyToken = body.verifyToken;
      if (body.phoneNumberId !== undefined) updateData.phoneNumberId = body.phoneNumberId;
      if (body.wabaId !== undefined) updateData.wabaId = body.wabaId;
      if (body.settings !== undefined) updateData.settings = body.settings;
      // Only update token if a real token (not masked) is sent
      if (body.botToken && !body.botToken.startsWith("••••")) {
        updateData.botToken = body.botToken;
        updateData.accessTokenHint = body.botToken.slice(-4);
      }
      const existing = await db.select().from(botSettings).where(eq(botSettings.platform, platform)).limit(1);
      let row: any;
      if (existing.length) {
        const updated = await db.update(botSettings).set(updateData).where(eq(botSettings.platform, platform)).returning();
        row = updated[0];
      } else {
        const inserted = await db.insert(botSettings).values(updateData).returning();
        row = inserted[0];
      }
      res.json({ ...row, botToken: row.botToken ? "••••" + row.botToken.slice(-4) : null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Telegram webhook. SECURITY (audit H3): validates Telegram's
  // X-Telegram-Bot-Api-Secret-Token header when a secret is configured
  // (env TELEGRAM_WEBHOOK_SECRET or botSettings.settings.webhookSecret).
  // Set the same secret when calling Telegram's setWebhook API.
  app.post("/api/webhook/telegram", async (req, res) => {
    try {
      const settings = await db.select().from(botSettings).where(eq(botSettings.platform, "telegram")).limit(1);
      if (!settings.length || !settings[0].enabled) return res.sendStatus(200);
      const configuredSecret = TELEGRAM_WEBHOOK_SECRET || (settings[0].settings as any)?.webhookSecret || "";
      if (configuredSecret) {
        const provided = req.headers["x-telegram-bot-api-secret-token"];
        if (provided !== configuredSecret) {
          return res.status(403).json({ message: "Invalid webhook secret" });
        }
      }
      const payload = req.body;
      // Log the webhook
      await db.insert(webhookLogs).values({ platform: "telegram", direction: "inbound", event: payload?.message ? "message" : "update", payload, status: "received" });
      // Handle message
      const msg = payload?.message;
      if (msg) {
        const text = msg.text || "";
        const chatId = String(msg.chat?.id || msg.from?.id);
        const senderName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username;
        // Save to bot inbox if has media or looks like an upload
        const photo = msg.photo?.[msg.photo.length - 1];
        const doc = msg.document;
        if (photo || doc) {
          await db.insert(botUploadInbox).values({
            source: "telegram",
            senderId: chatId,
            senderName: senderName || chatId,
            messageText: text || null,
            mediaType: photo ? "photo" : "document",
            uploadType: "extra",
            rawPayload: payload,
            status: "unlinked",
          });
        }
        await db.update(webhookLogs).set({ status: "processed" }).where(eq(webhookLogs.platform, "telegram"));
      }
      res.sendStatus(200);
    } catch (err: any) {
      await db.insert(webhookLogs).values({ platform: "telegram", direction: "inbound", event: "error", payload: req.body, status: "error", error: err.message }).catch(() => {});
      res.sendStatus(200);
    }
  });

  // WhatsApp Cloud API webhook verification
  app.get("/api/webhook/whatsapp", async (req, res) => {
    try {
      const settings = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
      const verifyToken = settings[0]?.verifyToken || "sunrise_verify";
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === verifyToken) {
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } catch (err: any) {
      res.sendStatus(403);
    }
  });

  // WhatsApp inbound messages
  app.post("/api/webhook/whatsapp", async (req, res) => {
    try {
      const settings = await db.select().from(botSettings).where(eq(botSettings.platform, "whatsapp")).limit(1);
      if (!settings.length || !settings[0].enabled) return res.sendStatus(200);
      const payload = req.body;
      await db.insert(webhookLogs).values({ platform: "whatsapp", direction: "inbound", event: "message", payload, status: "received" });
      // Extract message
      const entry = payload?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const msg = value?.messages?.[0];
      if (msg) {
        const from = msg.from;
        const contacts = value?.contacts || [];
        const contact = contacts.find((c: any) => c.wa_id === from);
        const senderName = contact?.profile?.name || from;
        const msgType = msg.type;
        if (msgType === "image" || msgType === "document" || msgType === "video") {
          await db.insert(botUploadInbox).values({
            source: "whatsapp",
            senderId: from,
            senderName,
            messageText: msg.text?.body || msg.image?.caption || null,
            mediaType: msgType === "image" ? "photo" : "document",
            uploadType: "extra",
            rawPayload: payload,
            status: "unlinked",
          });
        }
      }
      res.sendStatus(200);
    } catch (err: any) {
      await db.insert(webhookLogs).values({ platform: "whatsapp", direction: "inbound", event: "error", payload: req.body, status: "error", error: err.message }).catch(() => {});
      res.sendStatus(200);
    }
  });

  // GET bot upload inbox
  app.get("/api/bot-inbox", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      let query = db.select().from(botUploadInbox).orderBy(botUploadInbox.createdAt);
      const items = await (status ? db.select().from(botUploadInbox).where(eq(botUploadInbox.status, status)) : db.select().from(botUploadInbox));
      res.json(items.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH bot inbox item (map or ignore)
  app.patch("/api/bot-inbox/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, uploadType, mappedClientId, mappedBrandId, mappedEstimateId, mappedDcId, mappedStoreId, remarks } = req.body;
      const updateData: any = { updatedAt: new Date() };
      if (status) updateData.status = status;
      if (uploadType) updateData.uploadType = uploadType;
      if (mappedClientId !== undefined) updateData.mappedClientId = mappedClientId;
      if (mappedBrandId !== undefined) updateData.mappedBrandId = mappedBrandId;
      if (mappedEstimateId !== undefined) updateData.mappedEstimateId = mappedEstimateId;
      if (mappedDcId !== undefined) updateData.mappedDcId = mappedDcId;
      if (mappedStoreId !== undefined) updateData.mappedStoreId = mappedStoreId;
      if (remarks !== undefined) updateData.remarks = remarks;
      if (status === "mapped") { updateData.mappedAt = new Date(); updateData.mappedBy = req.user?.id || null; }
      const updated = await db.update(botUploadInbox).set(updateData).where(eq(botUploadInbox.id, id)).returning();
      res.json(updated[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET webhook logs (last 100)
  app.get("/api/automation/logs/:platform", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const platform = req.params.platform;
      const logs = await db.select().from(webhookLogs)
        .where(eq(webhookLogs.platform, platform))
        .orderBy(webhookLogs.createdAt)
        .limit(100);
      res.json(logs.reverse());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Customer Rate Cards (additive, read-only scaffold)
  // ==========================================
  // Lists rate cards and items. Full CRUD is intentionally NOT exposed yet —
  // the data layer is ready but the admin UI to author cards isn't built.
  // See TODO_REMAINING.md "Customer rate-card resolver" for the full plan.

  app.get("/api/customer-rate-cards", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const cards = await db.select().from(customerRateCards);
      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/customer-rate-cards/:id/items", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const items = await db.select().from(customerRateItems).where(eq(customerRateItems.rateCardId, id));
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * Minimum-viable resolver:
   *   GET /api/customer-rate-cards/resolve?clientId=X&brandId=Y&productId=Z&projectType=CAPEX
   * Returns the most specific active matching rate, or null if no card matches.
   *
   * Specificity ranking (highest first):
   *   1. (client, brand, projectType) all match
   *   2. (client, brand) match, projectType null on card
   *   3. (client, projectType) match, brand null on card
   *   4. client matches, brand null + projectType null
   * Falls back to null; caller (estimate form) keeps using products.rate.
   */
  app.get("/api/customer-rate-cards/resolve", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const clientId = Number(req.query.clientId) || null;
      const brandId = req.query.brandId ? Number(req.query.brandId) : null;
      const productId = req.query.productId ? Number(req.query.productId) : null;
      const materialCodeId = req.query.materialCodeId ? Number(req.query.materialCodeId) : null;
      const projectType = (req.query.projectType as string | undefined) || null;
      const now = new Date();

      if (!clientId) {
        return res.status(400).json({ message: "clientId is required" });
      }

      // Pull all active cards for this client; rank in JS (cheap; rate-card
      // tables are expected to be small).
      const cards = await db.select().from(customerRateCards)
        .where(eq(customerRateCards.clientId, clientId));

      const eligible = cards.filter(c => {
        if (!c.isActive) return false;
        if (c.brandId !== null && brandId !== null && c.brandId !== brandId) return false;
        if (c.projectType && projectType && c.projectType !== projectType) return false;
        if (c.effectiveFrom && new Date(c.effectiveFrom) > now) return false;
        if (c.effectiveTo && new Date(c.effectiveTo) < now) return false;
        return true;
      });

      const score = (c: any): number => {
        let s = 0;
        if (c.brandId === brandId && brandId !== null) s += 4;
        if (c.brandId === null) s += 1;
        if (c.projectType === projectType && projectType) s += 2;
        if (!c.projectType) s += 1;
        return s;
      };
      eligible.sort((a, b) => score(b) - score(a) || new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime());

      // PERF (Phase 2): fetch items for all eligible cards in one IN(...) query,
      // then evaluate in the SAME priority order as before.
      const cardIds = eligible.map((c: any) => c.id);
      const allItems = cardIds.length
        ? await db.select().from(customerRateItems).where(inArray(customerRateItems.rateCardId, cardIds))
        : [];
      const itemsByCard = new Map<number, any[]>();
      for (const it of allItems as any[]) {
        const list = itemsByCard.get(Number(it.rateCardId)) || [];
        list.push(it);
        itemsByCard.set(Number(it.rateCardId), list);
      }
      for (const card of eligible) {
        const items = itemsByCard.get(Number(card.id)) || [];
        const match = items.find(it =>
          it.isActive &&
          ((productId !== null && it.productId === productId) ||
           (materialCodeId !== null && it.materialCodeId === materialCodeId))
        );
        if (match) {
          return res.json({
            rateCardId: card.id,
            productId: match.productId,
            materialCodeId: match.materialCodeId,
            rate: match.rate,
            gstPercent: match.gstPercent,
            uom: match.uom,
            source: "customer_rate_card",
          });
        }
      }

      // No specific card row matched — caller falls back to product default.
      return res.json(null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Compact CRUD additions (master + transaction archive/delete)
  // ==========================================
  // Master-table partial updates. Used by the registers' "Archive" action
  // (PATCH with `{isActive: false}`) and "Edit" (PATCH with arbitrary fields).
  // No date columns on these tables, so no preprocessDateFields call needed.

  app.patch("/api/operations/clients/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates: Partial<typeof clients.$inferInsert> = {};
      if (req.body.name !== undefined) updates.name = normalizeDisplayName(req.body.name);
      if (req.body.email !== undefined) updates.email = req.body.email || null;
      if (req.body.mobile !== undefined) updates.mobile = req.body.mobile || null;
      if (req.body.city !== undefined) updates.city = normalizeDisplayName(req.body.city) || null;
      if (req.body.address !== undefined) updates.address = req.body.address || null;
      if (req.body.gstNumber !== undefined) updates.gstNumber = normalizeGstinPan(req.body.gstNumber) || null;
      if (req.body.format !== undefined) updates.format = normalizeImportFormat(req.body.format);
      if (req.body.isActive !== undefined) updates.isActive = normalizeBool(req.body.isActive, true);
      if (req.body.clientGroupName !== undefined) updates.clientGroupName = normalizeDisplayName(req.body.clientGroupName) || null;
      if (req.body.clientType !== undefined) updates.clientType = req.body.clientType || "normal";
      if (req.body.pan !== undefined) updates.pan = normalizeGstinPan(req.body.pan) || null;
      if (req.body.primaryContactPerson !== undefined) updates.primaryContactPerson = normalizeDisplayName(req.body.primaryContactPerson) || null;
      if (req.body.paymentTerms !== undefined) updates.paymentTerms = req.body.paymentTerms || null;
      if (req.body.vendorCode !== undefined) updates.vendorCode = req.body.vendorCode || null;

      const updated = await db.update(clients).set(updates).where(eq(clients.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Client not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/operations/brands/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates: Partial<typeof brands.$inferInsert> = {};
      if (req.body.name !== undefined) updates.name = normalizeDisplayName(req.body.name);
      if (req.body.isActive !== undefined) updates.isActive = normalizeBool(req.body.isActive, true);
      if (req.body.parentClientId !== undefined) {
        const parentClientId = Number(req.body.parentClientId);
        if (!parentClientId) return res.status(400).json({ message: "Parent client is required" });
        const parentClient = (await db.select().from(clients).where(eq(clients.id, parentClientId)).limit(1))[0];
        if (!parentClient) return res.status(400).json({ message: "Parent client not found" });
        updates.parentClientId = parentClientId;
        updates.parentBrand = normalizeDisplayName(parentClient.name) || null;
      }
      const updated = await db.update(brands).set(updates).where(eq(brands.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Brand not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/operations/stores/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = {
        ...req.body,
        ...(req.body.name !== undefined ? { name: normalizeDisplayName(req.body.name) } : {}),
        ...(req.body.location !== undefined ? { location: normalizeDisplayName(req.body.location) || null } : {}),
        ...(req.body.contactPerson !== undefined ? { contactPerson: normalizeDisplayName(req.body.contactPerson) || null } : {}),
        ...(req.body.city !== undefined ? { city: normalizeDisplayName(req.body.city) || null } : {}),
        ...(req.body.state !== undefined ? { state: normalizeDisplayName(req.body.state) || null } : {}),
        ...(req.body.contact !== undefined ? { contact: normalizeDisplayName(req.body.contact) || null } : {}),
      };
      const updated = await db.update(stores).set(updates).where(eq(stores.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Store not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/operations/products/:id", authenticateToken, requireRole(["admin", "manager", "accounts", "designer"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const body = { ...req.body };
      if (req.body.category !== undefined) {
        body.category = await normalizeProductCategory(req.body.category);
      }
      const updated = await db.update(products).set(body).where(eq(products.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Product not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Invoice partial update — used to mark status, adjust paidAmount/balanceAmount
  // after manual reconciliation, or "archive" via status="archived".
  app.patch("/api/finance/invoices/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = preprocessDateFields(req.body, ["date", "dueDate"]);
      const updated = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Invoice not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Transaction hard-delete. Admin-only. Estimates/DCs/invoices should be
  // archived via PATCH `{status: "archived"}` from the UI; these endpoints
  // are reserved for cases where the row was created in error and must be
  // truly removed (e.g. duplicate payments).

  app.delete("/api/finance/payments/:id", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      // If the payment was linked to an invoice, reverse its balance/paidAmount.
      const existing = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
      if (!existing[0]) return res.status(404).json({ message: "Payment not found" });
      const p = existing[0];
      if (p.invoiceId) {
        const inv = (await db.select().from(invoices).where(eq(invoices.id, p.invoiceId)).limit(1))[0];
        if (inv) {
          const newPaid = Math.max(0, Number(inv.paidAmount || 0) - Number(p.amount || 0));
          const newBalance = Number(inv.totalAmount || 0) - newPaid;
          await db.update(invoices).set({
            paidAmount: newPaid,
            balanceAmount: newBalance,
            status: newPaid === 0 ? "unpaid" : newPaid >= Number(inv.totalAmount || 0) ? "paid" : "partial",
          }).where(eq(invoices.id, p.invoiceId));
        }
      }
      await db.delete(payments).where(eq(payments.id, id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/advances/:id", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const deleted = await db.delete(staffAdvances).where(eq(staffAdvances.id, id)).returning();
      if (!deleted[0]) return res.status(404).json({ message: "Advance not found" });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/attendance/:id", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const deleted = await db.delete(attendance).where(eq(attendance.id, id)).returning();
      if (!deleted[0]) return res.status(404).json({ message: "Attendance entry not found" });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Estimate "delete" = soft archive via PATCH already supported.
  // Frontend convention: call PATCH /api/operations/estimates/:id with
  // {status: "archived"} and filter archived rows out of the register by
  // default. Same for delivery-challans (already PATCH-able).

  // ==========================================
  // Customer Rate Card — full CRUD
  // ==========================================

  app.post("/api/customer-rate-cards", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const { effectiveFrom, effectiveTo, ...rest } = req.body;
      const created = await db.insert(customerRateCards).values({
        ...rest,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      }).returning();
      res.status(201).json(created[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/customer-rate-cards/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { effectiveFrom, effectiveTo, ...rest } = req.body;
      const updates: any = { ...rest };
      if (effectiveFrom !== undefined) updates.effectiveFrom = effectiveFrom ? new Date(effectiveFrom) : null;
      if (effectiveTo !== undefined) updates.effectiveTo = effectiveTo ? new Date(effectiveTo) : null;
      const updated = await db.update(customerRateCards).set(updates).where(eq(customerRateCards.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Rate card not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/customer-rate-cards/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      await db.delete(customerRateCards).where(eq(customerRateCards.id, id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/customer-rate-cards/:id/items", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const rateCardId = parseInt(req.params.id, 10);
      const created = await db.insert(customerRateItems).values({ ...req.body, rateCardId }).returning();
      res.status(201).json(created[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.patch("/api/customer-rate-cards/:cardId/items/:itemId", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const itemId = parseInt(req.params.itemId, 10);
      const updated = await db.update(customerRateItems).set(req.body).where(eq(customerRateItems.id, itemId)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Rate item not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/customer-rate-cards/:cardId/items/:itemId", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const itemId = parseInt(req.params.itemId, 10);
      await db.delete(customerRateItems).where(eq(customerRateItems.id, itemId));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==========================================
  // Tally XML Export
  // ==========================================

  app.get("/api/tally/export-xml/:invoiceId", authenticateBrowserRequest, requireRole(["admin", "accounts", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.invoiceId, 10);
      const allInvoices = await storage.getAllInvoices();
      const invoice = allInvoices.find(i => i.id === id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const allClients = await storage.getAllClients();
      const client = allClients.find((c: any) => c.id === invoice.clientId);
      const partyName = (invoice as any).partyName || client?.name || "Unknown";
      const gstin = client?.gstNumber || "";
      const invoiceDate = invoice.date ? new Date(invoice.date as any).toISOString().split("T")[0].replace(/-/g, "") : "";
      const dueDate = (invoice as any).dueDate ? new Date((invoice as any).dueDate as any).toISOString().split("T")[0].replace(/-/g, "") : invoiceDate;
      const amount = Number(invoice.totalAmount || 0);
      const taxable = Number(invoice.amount || amount);
      const cgst = Number(invoice.taxAmount ? Number(invoice.taxAmount) / 2 : 0);
      const sgst = Number(invoice.taxAmount ? Number(invoice.taxAmount) / 2 : 0);
      const igst = 0;
      const narration = `${invoice.invoiceNumber} — ${partyName}`;

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>##COMPANYNAME##</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="${invoice.invoiceNumber}" VCHTYPE="Sales" ACTION="Create">
            <DATE>${invoiceDate}</DATE>
            <NARRATION>${narration}</NARRATION>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${invoice.invoiceNumber}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
            <GUID>${invoice.invoiceNumber}</GUID>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${partyName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${invoice.invoiceNumber}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${taxable.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
            ${igst > 0 ? `<ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>IGST</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${igst.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>` : ""}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

      // Mark invoice as exported
      await db.update(invoices).set({
        tallyExportStatus: "exported_xml",
        tallyExportedAt: new Date(),
      } as any).where(eq(invoices.id, id));

      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="tally_${invoice.invoiceNumber}.xml"`);
      res.send(xml);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Manually flip an invoice's Tally status. Used by accounts after they
  // confirm Tally accepted the voucher.
  app.patch("/api/tally/invoice/:invoiceId/status", authenticateToken, requireRole(["admin", "accounts", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.invoiceId, 10);
      const status = String(req.body?.status || "");
      const allowed = ["not_exported", "exported_xml", "pushed_to_tally", "failed"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });
      const updated = await db.update(invoices).set({
        tallyExportStatus: status,
        tallyExportedAt: status === "not_exported" ? null : new Date(),
      } as any).where(eq(invoices.id, id)).returning();
      if (!updated[0]) return res.status(404).json({ message: "Invoice not found" });
      res.json(updated[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/tally/settings", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const s = await storage.getAppSetting("tally_settings");
      res.json(s ? (typeof s === "string" ? JSON.parse(s) : s) : {
        enabled: false,
        tallyUrl: "http://localhost:9000",
        companyName: "",
        salesLedger: "Sales",
        cgstLedger: "CGST",
        sgstLedger: "SGST",
        igstLedger: "IGST",
        voucherType: "Sales",
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/tally/settings", authenticateToken, requireRole(["admin", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      await storage.setAppSetting("tally_settings", JSON.stringify(req.body));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==========================================
  // Project Store Status (per-store completion overrides for multi-store jobs)
  // ==========================================

  app.get("/api/project-store-status/:estimateId", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const eid = parseInt(req.params.estimateId, 10);
      const rows = await db.select().from(projectStoreStatus).where(eq(projectStoreStatus.estimateId, eid));
      res.json(rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/project-store-status/:estimateId/:storeCode", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const eid = parseInt(req.params.estimateId, 10);
      const storeCode = req.params.storeCode;
      const { status, remarks } = req.body || {};
      const allowed = ["pending", "in_progress", "completed", "blocked", "completed_pending_photos", "pending_execution", "proof_received"];
      if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

      // Upsert: try to find existing row, else insert.
      const existing = await db.select().from(projectStoreStatus)
        .where(eq(projectStoreStatus.estimateId, eid));
      const found = existing.find(r => r.storeCode === storeCode);
      if (found) {
        const updated = await db.update(projectStoreStatus)
          .set({ status, remarks: remarks ?? null, updatedAt: new Date(), updatedBy: req.user?.id ?? null })
          .where(eq(projectStoreStatus.id, found.id))
          .returning();
        return res.json(updated[0]);
      }
      const created = await db.insert(projectStoreStatus).values({
        estimateId: eid,
        storeCode,
        status,
        remarks: remarks ?? null,
        updatedBy: req.user?.id ?? null,
      }).returning();
      res.status(201).json(created[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ==========================================
  // Document Numbering (FY-aware) — Estimate / DC / Invoice
  // Reads "numbering.<kind>" jsonb config from app_settings:
  //   { prefix: "SM/INV", startAt: 101, fyAware: true }
  // Indian FY runs Apr 1 → Mar 31. Format example: SM/INV/26-27/101.
  // ==========================================
  const docKindMap: Record<string, { table: any; column: string }> = {
    invoice:  { table: invoices,          column: "invoiceNumber" },
    estimate: { table: estimates,         column: "estimateNumber" },
    dc:       { table: deliveryChallans,  column: "dcNumber" },
  };

  const estimateFyStartAtOverrides: Record<string, number> = {
    "26-27": 201,
  };

  function fyForDate(d: Date): { label: string; start: Date; end: Date } {
    const y = d.getFullYear();
    const startYear = d.getMonth() < 3 ? y - 1 : y;
    const start = new Date(startYear, 3, 1, 0, 0, 0, 0);
    const end = new Date(startYear + 1, 2, 31, 23, 59, 59, 999);
    const label = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
    return { label, start, end };
  }

  async function loadNumberingConfig(kind: string): Promise<{ prefix: string; startAt: number; fyAware: boolean }> {
    const fallback = {
      invoice:  { prefix: "SM/INV", startAt: 101, fyAware: true },
      estimate: { prefix: "SM/E",   startAt: 101, fyAware: true },
      dc:       { prefix: "SM/DC",  startAt: 101, fyAware: true },
    }[kind] ?? { prefix: "DOC", startAt: 1, fyAware: false };
    try {
      const value = await storage.getAppSetting(`numbering.${kind}`);
      const v = (value as any) ?? {};
      return {
        prefix: typeof v.prefix === "string" ? v.prefix : fallback.prefix,
        startAt: Number.isFinite(Number(v.startAt)) ? Number(v.startAt) : fallback.startAt,
        fyAware: v.fyAware !== false,
      };
    } catch {
      return fallback;
    }
  }

  async function nextDocumentNumber(kind: "invoice" | "estimate" | "dc"): Promise<string> {
    const cfg = await loadNumberingConfig(kind);
    const map = docKindMap[kind];
    const all = (await db.select().from(map.table)) as any[];
    const fy = fyForDate(new Date());
    const startAt = kind === "estimate"
      ? estimateFyStartAtOverrides[fy.label] ?? cfg.startAt
      : cfg.startAt;
    const fyMatcher = cfg.fyAware
      ? new RegExp(`^${escapeReg(cfg.prefix)}/${escapeReg(fy.label)}/(\\d+)$`)
      : new RegExp(`^${escapeReg(cfg.prefix)}/(\\d+)$`);
    let maxSeq = startAt - 1;
    for (const row of all) {
      const docNum = String(row[map.column] || "");
      const m = docNum.match(fyMatcher);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }
    const next = maxSeq + 1;
    return cfg.fyAware
      ? `${cfg.prefix}/${fy.label}/${next}`
      : `${cfg.prefix}/${next}`;
  }

  function escapeReg(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  app.get("/api/numbering/:kind/next", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const kind = req.params.kind;
      if (!docKindMap[kind]) return res.status(400).json({ message: "Unknown numbering kind" });
      const number = await nextDocumentNumber(kind as any);
      res.json({ number });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Invoice: get one (with line items + linked DC + estimate + payments)
  // ==========================================
  app.get("/api/finance/invoices/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const inv = (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0];
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      let estimate: any = null;
      let estimateItems_: any[] = [];
      let dc: any = null;
      if (inv.estimateId) {
        estimate = (await db.select().from(estimates).where(eq(estimates.id, inv.estimateId)).limit(1))[0] || null;
        if (estimate) {
          estimateItems_ = orderedEstimateItems(await storage.getEstimateItems(estimate.id));
        }
      }
      if (inv.deliveryChallanId) {
        dc = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, inv.deliveryChallanId)).limit(1))[0] || null;
      }
      const linkedPayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
      res.json({ invoice: inv, estimate, estimateItems: estimateItems_, deliveryChallan: dc, payments: linkedPayments });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Invoice: cancel (soft) — status="cancelled" with reason + audit fields
  // ==========================================
  app.post("/api/finance/invoices/:id/cancel", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reason = (req.body?.reason ?? "").toString();
      const inv = (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0];
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      // Block cancel if there is non-zero paid amount unless explicitly forced
      if ((inv.paidAmount || 0) > 0 && !req.body?.force) {
        return res.status(400).json({ message: "Invoice has recorded payments; remove payments before cancelling, or pass { force: true }." });
      }
      await db.update(invoices).set({
        status: "cancelled",
        cancelReason: reason || "Cancelled by user",
        cancelledAt: new Date(),
        cancelledBy: req.user?.id ?? null,
      }).where(eq(invoices.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Hard-delete an invoice (admin only, only if no payments and either draft or cancelled).
  app.delete("/api/finance/invoices/:id", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const inv = (await db.select().from(invoices).where(eq(invoices.id, id)).limit(1))[0];
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      if ((inv.paidAmount || 0) > 0) {
        return res.status(400).json({ message: "Invoice has payments; cancel instead." });
      }
      // Remove journal entries first to avoid orphans.
      const { journalEntries: jeTable, journalEntryLines: jelTable } = await import("../shared/schema");
      const orphanEntries = await db.select().from(jeTable).where(eq(jeTable.referenceNumber, inv.invoiceNumber));
      for (const je of orphanEntries) {
        await db.delete(jelTable).where(eq(jelTable.journalEntryId, je.id));
        await db.delete(jeTable).where(eq(jeTable.id, je.id));
      }
      await db.delete(invoices).where(eq(invoices.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Delivery Challan: hard-delete (admin only, only if no linked invoice)
  // ==========================================
  app.delete("/api/operations/delivery-challans/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const linkedInv = (await db.select().from(invoices).where(eq(invoices.deliveryChallanId, id)).limit(1))[0];
      if (linkedInv) {
        return res.status(400).json({ message: `DC is linked to invoice ${linkedInv.invoiceNumber}; cancel that invoice first.` });
      }
      const deleted = await db.delete(deliveryChallans).where(eq(deliveryChallans.id, id)).returning();
      if (!deleted[0]) return res.status(404).json({ message: "DC not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Estimate: hard-delete (admin/manager only, only if no DC/invoice exists)
  // ==========================================
  app.delete("/api/operations/estimates/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const linkedDc = (await db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, id)).limit(1))[0];
      if (linkedDc) return res.status(400).json({ message: `Estimate is linked to DC ${linkedDc.dcNumber}; delete that first.` });
      const linkedInv = (await db.select().from(invoices).where(eq(invoices.estimateId, id)).limit(1))[0];
      if (linkedInv) return res.status(400).json({ message: `Estimate is linked to invoice ${linkedInv.invoiceNumber}; cancel that first.` });
      await db.delete(estimates).where(eq(estimates.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Estimate: duplicate — copies all fields + items, assigns new number, status=draft
  // ==========================================
  app.post("/api/operations/estimates/:id/duplicate", authenticateToken, requireRole(["admin", "manager", "designer"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [original] = await db.select().from(estimates).where(eq(estimates.id, id));
      if (!original) return res.status(404).json({ message: "Estimate not found" });
      const originalItems = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, id));
      const newNumber = await nextDocumentNumber("estimate");
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = original as any;
      const [newEst] = await db.insert(estimates).values({
        ...rest,
        estimateNumber: newNumber,
        status: "draft",
        poNumber: null,
        poDate: null,
        poFilePath: null,
        poAmount: null,
        followUpStatus: "none",
        followUpNote: null,
        followUpAt: null,
        promiseDate: null,
      }).returning();
      if (originalItems.length > 0) {
        await db.insert(estimateItems).values(
          originalItems.map(({ id: _iid, estimateId: _eid, ...item }: any) => ({ ...item, estimateId: newEst.id }))
        );
      }
      res.json(newEst);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Product: smart delete. Hard-delete if unused; soft (isActive=false) if in use.
  // ==========================================
  app.delete("/api/operations/products/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { isSystemServiceProduct } = await import("../shared/systemServices");
      const target = (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
      if (target && isSystemServiceProduct(target as any)) {
        return res.status(409).json({
          message: `"${target.name}" is a system service product used by the Estimate Builder buttons. It cannot be deleted. Deactivate it instead.`,
          isSystemService: true,
        });
      }
      // Check if used by any estimate item
      const { estimateItems: estItemsTable } = await import("../shared/schema");
      const usedRow = (await db.select().from(estItemsTable).where(eq(estItemsTable.productId, id)).limit(1))[0];
      if (usedRow) {
        await db.update(products).set({ isActive: false }).where(eq(products.id, id));
        return res.json({ success: true, soft: true, message: "Product deactivated — it is used in one or more estimates." });
      }
      await db.delete(products).where(eq(products.id, id));
      res.json({ success: true, soft: false });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Brand / Store / Client: hard-delete if no dependencies, else 400.
  // Soft archive (isActive=false) is still available via the existing PATCH.
  // ==========================================
  app.delete("/api/operations/brands/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const linkedStore = (await db.select().from(stores).where(eq(stores.brandId, id)).limit(1))[0];
      if (linkedStore) return res.status(400).json({ message: "Brand has linked stores; archive instead." });
      const linkedEst = (await db.select().from(estimates).where(eq(estimates.brandId, id)).limit(1))[0];
      if (linkedEst) return res.status(400).json({ message: "Brand has linked estimates; archive instead." });
      await db.delete(brands).where(eq(brands.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operations/stores/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const linkedEst = (await db.select().from(estimates).where(eq(estimates.storeId, id)).limit(1))[0];
      if (linkedEst) {
        await db.update(stores).set({ isActive: false }).where(eq(stores.id, id));
        return res.json({ success: true, soft: true, message: "Store deactivated — it is used in estimates." });
      }
      await db.delete(stores).where(eq(stores.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operations/clients/:id", authenticateToken, requireRole(["admin", "manager"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const linkedEst = (await db.select().from(estimates).where(eq(estimates.clientId, id)).limit(1))[0];
      if (linkedEst) {
        await db.update(clients).set({ isActive: false }).where(eq(clients.id, id));
        return res.json({ success: true, soft: true, message: "Client deactivated — it is used in estimates." });
      }
      await db.delete(clients).where(eq(clients.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ==========================================
  // Sample import templates download
  // ==========================================

  // ════════════════════ PHASE 3: AUDIT LOGS ════════════════════
  app.get("/api/audit-logs", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : null;
      const invoiceId = req.query.invoiceId ? Number(req.query.invoiceId) : null;
      const entityType = (req.query.entityType as string) || null;
      const conditions: any[] = [];
      if (estimateId) conditions.push(eq(auditLogs.estimateId, estimateId));
      if (invoiceId) conditions.push(eq(auditLogs.invoiceId, invoiceId));
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
      const base = db.select().from(auditLogs);
      const rows = await (conditions.length ? base.where(andOp(...conditions)) : base)
        .orderBy(desc(auditLogs.createdAt))
        .limit(Math.min(Number(req.query.limit) || 100, 500));
      res.json(rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ════════════════════ PHASE 3: NOTIFICATIONS ════════════════════
  app.get("/api/notifications", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      await refreshNotificationsThrottled(); // derive at most every 60s
      const rows = await db.select().from(notifications)
        .where(isNull(notifications.resolvedAt))
        .orderBy(desc(notifications.createdAt))
        .limit(200);
      const role = req.user!.role;
      const visible = (rows as any[]).filter(n => !n.forRole || n.forRole === role || role === "admin");
      res.json(visible.map(n => ({ ...n, read: Array.isArray(n.readBy) && n.readBy.includes(req.user!.id) })));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/notifications/refresh", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (_req: AuthRequest, res: Response) => {
    try { res.json(await deriveNotifications()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/notifications/:id/read", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Not found" });
      const readBy: number[] = Array.isArray((row as any).readBy) ? (row as any).readBy : [];
      if (!readBy.includes(req.user!.id)) readBy.push(req.user!.id);
      await db.update(notifications).set({ readBy }).where(eq(notifications.id, id));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ════════════════════ PHASE 3: APPROVAL WORKFLOW ════════════════════
  // Role chains are configurable in app_settings key "approval_rules":
  //   { estimate: { roles: ["manager","admin"] }, po: { roles: ["admin"] },
  //     invoice: { roles: ["accounts","admin"] }, enforce: false }
  // Approvals are recorded in the audit log (action approve/reject) — the
  // permanent who/when trail — and estimates additionally move to their
  // existing approved status so current UI filters keep working.
  const DEFAULT_APPROVAL_RULES: any = {
    estimate: { roles: ["manager", "admin"] },
    po: { roles: ["admin", "manager"] },
    invoice: { roles: ["accounts", "admin"] },
    enforce: false,
  };
  const getApprovalRules = async () => ({ ...DEFAULT_APPROVAL_RULES, ...((await storage.getAppSetting("approval_rules")) || {}) });

  app.get("/api/approvals/rules", authenticateToken, async (_req: AuthRequest, res: Response) => {
    res.json(await getApprovalRules());
  });
  app.put("/api/approvals/rules", authenticateToken, requireRole(["admin"]), async (req: AuthRequest, res: Response) => {
    await storage.setAppSetting("approval_rules", { ...DEFAULT_APPROVAL_RULES, ...(req.body || {}) });
    res.json(await getApprovalRules());
  });

  app.post("/api/approvals/:kind/:id/:decision", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { kind, decision } = req.params as { kind: string; decision: string };
      const id = Number(req.params.id);
      if (!["estimate", "po", "invoice"].includes(kind)) return res.status(400).json({ message: "Unknown approval kind" });
      if (!["approve", "reject"].includes(decision)) return res.status(400).json({ message: "Decision must be approve or reject" });
      const rules = await getApprovalRules();
      const allowed: string[] = rules[kind]?.roles || ["admin"];
      if (!allowed.includes(req.user!.role)) {
        return res.status(403).json({ message: `Approval for ${kind} requires role: ${allowed.join("/")}` });
      }

      let entityLabel: string | null = null;
      let estimateId: number | null = null;
      let invoiceId: number | null = null;

      if (kind === "estimate" || kind === "po") {
        const [est] = await db.select().from(estimates).where(eq(estimates.id, id)).limit(1);
        if (!est) return res.status(404).json({ message: "Estimate not found" });
        entityLabel = (est as any).estimateNumber; estimateId = id;
        if (kind === "estimate") {
          // Uses the estimate's EXISTING status vocabulary — no new statuses.
          const newStatus = decision === "approve" ? "approved" : "rejected";
          await db.update(estimates).set({ status: newStatus }).where(eq(estimates.id, id));
        }
        // PO approval is recorded in the audit trail only (the PO itself
        // already lives on the estimate via poNumber/poFilePath).
      } else {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
        if (!inv) return res.status(404).json({ message: "Invoice not found" });
        entityLabel = (inv as any).invoiceNumber; invoiceId = id; estimateId = (inv as any).estimateId ?? null;
      }

      (res as any).__auditDone = true;
      audit(req, {
        action: decision === "approve" ? "approve" : "reject",
        entityType: kind === "po" ? "purchase_order" : kind,
        entityId: id, entityLabel, estimateId, invoiceId,
        newValue: { decision, by: req.user!.username, role: req.user!.role },
      });
      res.json({ ok: true, kind, id, decision, by: req.user!.username });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Approval history for an entity (read from the audit trail)
  app.get("/api/approvals/:kind/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const kind = req.params.kind === "po" ? "purchase_order" : req.params.kind;
      const rows = await db.select().from(auditLogs)
        .where(andOp(eq(auditLogs.entityType, kind), eq(auditLogs.entityId, Number(req.params.id))))
        .orderBy(desc(auditLogs.createdAt)).limit(50);
      res.json((rows as any[]).filter(r => r.action === "approve" || r.action === "reject"));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ════════════════════ PHASE 3: FINANCE COMPLETION ════════════════════
  // AR Aging — 0-30 / 31-60 / 61-90 / 90+ buckets per client
  app.get("/api/finance/aging", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db.select().from(invoices);
      const now = Date.now();
      const byClient = new Map<string, any>();
      for (const inv of rows as any[]) {
        if (inv.type !== "sales" || inv.status === "cancelled" || inv.status === "paid") continue;
        const balance = Number(inv.balanceAmount ?? (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
        if (balance <= 0) continue;
        const key = inv.clientId ? `c${inv.clientId}` : inv.partyName || "unknown";
        const entry = byClient.get(key) || {
          clientId: inv.clientId ?? null, partyName: inv.partyName,
          current: 0, b30: 0, b60: 0, b90: 0, over90: 0, total: 0, invoices: 0, oldestDays: 0,
        };
        const days = inv.dueDate ? Math.max(0, Math.floor((now - new Date(inv.dueDate).getTime()) / 86400000)) : 0;
        if (days <= 0) entry.current += balance;
        else if (days <= 30) entry.b30 += balance;
        else if (days <= 60) entry.b60 += balance;
        else if (days <= 90) entry.b90 += balance;
        else entry.over90 += balance;
        entry.total += balance; entry.invoices += 1;
        entry.oldestDays = Math.max(entry.oldestDays, days);
        byClient.set(key, entry);
      }
      const clientsAging = Array.from(byClient.values()).sort((a, b) => b.total - a.total);
      const totals = clientsAging.reduce((t, c) => ({
        current: t.current + c.current, b30: t.b30 + c.b30, b60: t.b60 + c.b60,
        b90: t.b90 + c.b90, over90: t.over90 + c.over90, total: t.total + c.total,
      }), { current: 0, b30: 0, b60: 0, b90: 0, over90: 0, total: 0 });
      res.json({ clients: clientsAging, totals, asOf: new Date().toISOString() });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Customer outstanding + collection working list (one endpoint powers both)
  app.get("/api/finance/collections", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await db.select().from(invoices);
      const now = Date.now();
      const open = (rows as any[])
        .filter(inv => inv.type === "sales" && !["cancelled", "paid"].includes(inv.status))
        .map(inv => {
          const balance = Number(inv.balanceAmount ?? (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
          const daysOverdue = inv.dueDate ? Math.floor((now - new Date(inv.dueDate).getTime()) / 86400000) : 0;
          return {
            id: inv.id, invoiceNumber: inv.invoiceNumber, partyName: inv.partyName, clientId: inv.clientId,
            estimateId: inv.estimateId, totalAmount: inv.totalAmount, paidAmount: inv.paidAmount || 0,
            balance, dueDate: inv.dueDate, daysOverdue: Math.max(0, daysOverdue),
            followUpStatus: inv.followUpStatus || "none", followUpNote: inv.followUpNote,
            followUpAt: inv.followUpAt, promiseDate: inv.promiseDate,
          };
        })
        .filter(x => x.balance > 0)
        .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance);
      res.json(open);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Payment follow-up update
  app.patch("/api/finance/invoices/:id/follow-up", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [prior] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!prior) return res.status(404).json({ message: "Invoice not found" });
      const allowedStatuses = ["none", "promised", "partial_promised", "disputed", "escalated", "legal"];
      const updates: any = { followUpAt: new Date() };
      if (req.body.followUpStatus !== undefined) {
        if (!allowedStatuses.includes(req.body.followUpStatus)) return res.status(400).json({ message: "Invalid followUpStatus" });
        updates.followUpStatus = req.body.followUpStatus;
      }
      if (req.body.followUpNote !== undefined) updates.followUpNote = String(req.body.followUpNote).slice(0, 2000);
      if (req.body.promiseDate !== undefined) updates.promiseDate = req.body.promiseDate ? new Date(req.body.promiseDate) : null;
      const [updated] = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
      (res as any).__auditDone = true;
      const d = diffForAudit(prior, { ...prior, ...updates });
      audit(req, { action: "update", entityType: "invoice_follow_up", entityId: id,
        entityLabel: (prior as any).invoiceNumber, invoiceId: id, estimateId: (prior as any).estimateId ?? null,
        oldValue: d.oldValue, newValue: d.newValue });
      res.json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ════════════════════ PHASE 5A: TELEGRAM BOT DELIVERY ════════════════════
  // Send an existing/just-created field link to a recipient (an ERP user with
  // a telegram_chat_id) via the Telegram Bot API. Creates a delivery row,
  // attempts send, records outcome. Does NOT modify field_access_links.
  app.post("/api/operations/telegram/send", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const { estimateId, fieldLinkId, recipientUserId, url } = req.body || {};
      if (!estimateId || !url) return res.status(400).json({ message: "estimateId and url are required" });

      const [estimate] = await db.select().from(estimates).where(eq(estimates.id, Number(estimateId))).limit(1);
      if (!estimate) return res.status(404).json({ message: "Estimate not found" });

      // Resolve recipient (must be an ERP user with a chat id).
      const [recipient] = await db.select().from(users).where(eq(users.id, Number(recipientUserId))).limit(1);
      if (!recipient) return res.status(404).json({ message: "Recipient user not found" });
      if (!recipient.telegramChatId) return res.status(400).json({ message: "Recipient has no Telegram chat ID set in their profile" });

      // Store count for the estimate (execution stores), for the message body.
      const storeRows = await db.select().from(executionStores).where(eq(executionStores.estimateId, Number(estimateId)));
      const storeCount = storeRows.length || 1;

      // Find the link's expiry if a fieldLinkId was given.
      let expiresAt: Date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (fieldLinkId) {
        const [link] = await db.select().from(fieldAccessLinks).where(eq(fieldAccessLinks.id, Number(fieldLinkId))).limit(1);
        if (link?.expiresAt) expiresAt = new Date(link.expiresAt as any);
      }

      const message = buildDeliveryMessage({
        estimateNumber: (estimate as any).estimateNumber,
        storeCount, url, expiresAt,
      });

      const [created] = await db.insert(telegramDeliveries).values({
        fieldLinkId: fieldLinkId ? Number(fieldLinkId) : null,
        estimateId: Number(estimateId),
        recipientUserId: recipient.id,
        recipientName: recipient.name,
        chatId: recipient.telegramChatId,
        message,
        status: "pending",
        createdBy: req.user?.id ?? null,
      }).returning();

      const updated = await dispatchDelivery(created.id);
      // Never leak chatId hashes/token; chatId is operational, returned to admins only.
      res.status(updated.status === "sent" ? 200 : 502).json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Per-project delivery log (Message Log UI).
  app.get("/api/operations/telegram/deliveries", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : null;
      const base = db.select().from(telegramDeliveries);
      const rows = await (estimateId ? base.where(eq(telegramDeliveries.estimateId, estimateId)) : base)
        .orderBy(desc(telegramDeliveries.createdAt)).limit(200);
      res.json(rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Retry a failed delivery.
  app.post("/api/operations/telegram/deliveries/:id/retry", authenticateToken, requireRole(["admin", "manager", "production"]), async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [delivery] = await db.select().from(telegramDeliveries).where(eq(telegramDeliveries.id, id)).limit(1);
      if (!delivery) return res.status(404).json({ message: "Delivery not found" });
      // Bump retry count, then re-dispatch.
      await db.update(telegramDeliveries)
        .set({ retryCount: Number(delivery.retryCount || 0) + 1, status: "pending", error: null })
        .where(eq(telegramDeliveries.id, id));
      const updated = await dispatchDelivery(id);
      res.status(updated.status === "sent" ? 200 : 502).json(updated);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Chat-ID discovery (admin) — find chat IDs of users who messaged the bot.
  app.get("/api/operations/telegram/discover-chats", authenticateToken, requireRole(["admin", "manager"]), async (_req: AuthRequest, res: Response) => {
    try {
      const token = await getBotToken();
      const result = await discoverChats(token);
      if (!result.ok) return res.status(502).json({ message: result.error });
      res.json(result.chats);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/templates/:name", authenticateBrowserRequest, async (req, res) => {
    const name = req.params.name;
    const allowed = ["CLIENTS_TEMPLATE","CLIENT_GST_PROFILES_TEMPLATE","ABLBL_GST_IMPORT_FORMAT","BRANDS_TEMPLATE","STORES_TEMPLATE","PRODUCTS_TEMPLATE","MATERIAL_CODES_TEMPLATE","CUSTOMER_RATE_CARDS_TEMPLATE","CUSTOMER_RATE_CARD_ITEMS_TEMPLATE","STAFF_TEMPLATE","OPENING_OUTSTANDING_TEMPLATE"];
    if (!allowed.includes(name)) return res.status(404).json({ message: "Template not found" });
    const filePath = path.join(process.cwd(), "client", "public", "templates", `${name}.xlsx`);
    res.download(filePath, `${name}.xlsx`, (err) => {
      if (err) res.status(404).json({ message: "Template file not generated yet. Run: node scripts/generate-templates.mjs" });
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}
