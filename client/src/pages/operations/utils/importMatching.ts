// Matching + preview engine for the Master Data Import wizard.
//
// Goal: user shouldn't have to know internal IDs. We match by business data
// (GSTIN, normalised name, store code) against the current masters and tell
// them up front what each row will do once imported.

import type { Brand, Client, Store } from "../types";
import {
  NAME_SIMILAR_THRESHOLD,
  nameMatchKey,
  nameSimilarity,
  normalizeDisplayName,
  normalizeGstinPan,
} from "../../../../../shared/textFormat";

export type ImportRowOutcome =
  | "create"
  | "update"
  | "duplicate"
  | "missing_ref"
  | "error";

export interface ImportRowReport {
  index: number;            // 0-based row index in the source file
  excelRow: number;         // 1-based, header row = 1, so first data row = 2
  outcome: ImportRowOutcome;
  matchedId?: number | null;
  matchedField?: string;    // e.g. "GSTIN", "Name", "Store Code"
  warnings: string[];
  errors: string[];
  // Convenience labels for the preview table
  primaryLabel: string;     // e.g. brand name or client name
  secondaryLabel?: string;
}

export interface ImportPreviewSummary {
  total: number;
  toCreate: number;
  toUpdate: number;
  duplicates: number;       // rows whose primary identifier matched twice in the source file
  missingRefs: number;      // rows whose required parent (client/brand) couldn't be resolved
  errors: number;
  warnings: number;
  rows: ImportRowReport[];
}

export interface BillingProfileLite {
  id: number;
  clientId: number;
  gstin: string;
}

export interface ImportContext {
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  billingProfiles?: BillingProfileLite[];
}

const ID_FIELDS = new Set(["id", "clientId", "brandId", "storeId", "billingProfileId"]);

// Drop blank ID values + trim string values up front so downstream code can
// treat the row as already cleaned. We DON'T trust IDs that look invalid
// (NaN, ≤0) — the spec is "ignore blank IDs and use only if valid".
export function cleanImportRow<T extends Record<string, any>>(row: T): T {
  const out: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === "string" ? v.trim() : v;
    if (s === "") continue;
    if (ID_FIELDS.has(k)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[k] = n;
    } else {
      out[k] = s;
    }
  }
  return out as T;
}

function pushIf<T>(arr: T[], v: T | null | undefined) { if (v !== undefined && v !== null && v !== "") arr.push(v); }

// Find the closest existing row by name. Returns the matched row + similarity
// when it's at or above the soft threshold but below an exact match — useful
// for "did you mean?" warnings.
function fuzzyNameMatch<T extends { name: string }>(rows: T[], name: string) {
  const target = nameMatchKey(name);
  if (!target) return null;
  let best: { row: T; score: number } | null = null;
  for (const row of rows) {
    const score = nameSimilarity(row.name, name);
    if (!best || score > best.score) best = { row, score };
  }
  return best;
}

export function previewClients(
  rows: Record<string, any>[],
  ctx: ImportContext,
): ImportPreviewSummary {
  const reports: ImportRowReport[] = [];
  const seenGstins = new Map<string, number>();
  const seenNameKeys = new Map<string, number>();
  let toCreate = 0, toUpdate = 0, duplicates = 0, missingRefs = 0, errors = 0, warnings = 0;

  rows.forEach((rawRow, idx) => {
    const row = cleanImportRow(rawRow);
    const r: ImportRowReport = {
      index: idx, excelRow: idx + 2, outcome: "create",
      warnings: [], errors: [],
      primaryLabel: normalizeDisplayName(row.name) || "(no name)",
    };
    const name = normalizeDisplayName(row.name);
    const gstin = normalizeGstinPan(row.gstNumber);

    if (!name) { r.outcome = "error"; r.errors.push("Missing client name"); errors++; reports.push(r); return; }

    // Within-file duplicate detection
    if (gstin) {
      const prior = seenGstins.get(gstin);
      if (prior !== undefined) {
        r.outcome = "duplicate";
        r.warnings.push(`Duplicate GSTIN with row ${prior + 2}`);
        duplicates++;
      } else {
        seenGstins.set(gstin, idx);
      }
    }
    if (r.outcome !== "duplicate") {
      const key = nameMatchKey(name);
      const prior = seenNameKeys.get(key);
      if (prior !== undefined) {
        r.outcome = "duplicate";
        r.warnings.push(`Duplicate client name with row ${prior + 2}`);
        duplicates++;
      } else {
        seenNameKeys.set(key, idx);
      }
    }

    // Match against existing masters
    if (r.outcome !== "duplicate") {
      let match: Client | undefined;
      if (gstin) {
        match = ctx.clients.find(c => normalizeGstinPan(c.gstNumber) === gstin);
        if (match) r.matchedField = "GSTIN";
      }
      if (!match) {
        const key = nameMatchKey(name);
        match = ctx.clients.find(c => nameMatchKey(c.name) === key);
        if (match) r.matchedField = "Name";
      }
      if (match) {
        r.outcome = "update";
        r.matchedId = match.id;
        toUpdate++;
        // Spelling mismatch warning if exact-equal-by-key but display differs
        if (normalizeDisplayName(match.name) !== name) {
          r.warnings.push(`Existing display name is "${normalizeDisplayName(match.name)}"`);
          warnings++;
        }
      } else {
        // Fuzzy near-match warning (e.g. typo): flag without blocking.
        const near = fuzzyNameMatch(ctx.clients, name);
        if (near && near.score >= NAME_SIMILAR_THRESHOLD) {
          r.warnings.push(`Possible duplicate of "${normalizeDisplayName(near.row.name)}" (${(near.score * 100).toFixed(0)}% similar)`);
          warnings++;
        }
        toCreate++;
      }
    }
    pushIf(r.warnings, gstin && gstin.length !== 15 ? `GSTIN should be 15 chars (got ${gstin.length})` : null);
    reports.push(r);
  });

  return { total: rows.length, toCreate, toUpdate, duplicates, missingRefs, errors, warnings, rows: reports };
}

export function previewBrands(
  rows: Record<string, any>[],
  ctx: ImportContext,
): ImportPreviewSummary {
  const reports: ImportRowReport[] = [];
  const seen = new Map<string, number>();
  let toCreate = 0, toUpdate = 0, duplicates = 0, missingRefs = 0, errors = 0, warnings = 0;

  rows.forEach((rawRow, idx) => {
    const row = cleanImportRow(rawRow);
    const name = normalizeDisplayName(row.name);
    const r: ImportRowReport = {
      index: idx, excelRow: idx + 2, outcome: "create",
      warnings: [], errors: [], primaryLabel: name || "(no name)",
    };
    if (!name) { r.outcome = "error"; r.errors.push("Missing brand name"); errors++; reports.push(r); return; }

    // Resolve parent client by ID first (if numeric and in masters), then by name
    let client: Client | undefined;
    if (typeof row.clientId === "number") client = ctx.clients.find(c => c.id === row.clientId);
    if (!client && row.clientName) {
      const key = nameMatchKey(row.clientName);
      client = ctx.clients.find(c => nameMatchKey(c.name) === key);
      if (!client) {
        const near = fuzzyNameMatch(ctx.clients, String(row.clientName));
        if (near && near.score >= NAME_SIMILAR_THRESHOLD) {
          r.warnings.push(`Client "${row.clientName}" not found exactly — closest: "${normalizeDisplayName(near.row.name)}"`);
          warnings++;
        }
      }
    }
    if (!client) {
      r.outcome = "missing_ref";
      r.errors.push(`Could not resolve parent client (clientName="${row.clientName ?? ""}")`);
      missingRefs++;
      reports.push(r); return;
    }
    r.secondaryLabel = `→ ${normalizeDisplayName(client.name)}`;

    const dedupeKey = `${client.id}|${nameMatchKey(name)}`;
    const prior = seen.get(dedupeKey);
    if (prior !== undefined) {
      r.outcome = "duplicate";
      r.warnings.push(`Duplicate brand+client with row ${prior + 2}`);
      duplicates++;
    } else {
      seen.set(dedupeKey, idx);
    }

    if (r.outcome !== "duplicate") {
      const key = nameMatchKey(name);
      const match = ctx.brands.find(b =>
        nameMatchKey(b.name) === key && (b.parentClientId === client!.id || !b.parentClientId)
      );
      if (match) {
        r.outcome = "update";
        r.matchedId = match.id;
        r.matchedField = "Brand+Client";
        toUpdate++;
      } else {
        const near = fuzzyNameMatch(ctx.brands.filter(b => b.parentClientId === client!.id), name);
        if (near && near.score >= NAME_SIMILAR_THRESHOLD) {
          r.warnings.push(`Possible duplicate of "${normalizeDisplayName(near.row.name)}" under same client`);
          warnings++;
        }
        toCreate++;
      }
    }
    reports.push(r);
  });

  return { total: rows.length, toCreate, toUpdate, duplicates, missingRefs, errors, warnings, rows: reports };
}

export function previewStores(
  rows: Record<string, any>[],
  ctx: ImportContext,
): ImportPreviewSummary {
  const reports: ImportRowReport[] = [];
  const seenCodes = new Map<string, number>();
  const seenNames = new Map<string, number>();
  let toCreate = 0, toUpdate = 0, duplicates = 0, missingRefs = 0, errors = 0, warnings = 0;

  rows.forEach((rawRow, idx) => {
    const row = cleanImportRow(rawRow);
    const name = normalizeDisplayName(row.name);
    const code = String(row.storeCode ?? "").trim();
    const r: ImportRowReport = {
      index: idx, excelRow: idx + 2, outcome: "create",
      warnings: [], errors: [], primaryLabel: name || code || "(no name)",
    };
    if (!name && !code) { r.outcome = "error"; r.errors.push("Missing store name and code"); errors++; reports.push(r); return; }

    let client: Client | undefined;
    if (typeof row.clientId === "number") client = ctx.clients.find(c => c.id === row.clientId);
    if (!client && row.clientName) {
      const key = nameMatchKey(row.clientName);
      client = ctx.clients.find(c => nameMatchKey(c.name) === key);
    }
    if (!client) {
      r.outcome = "missing_ref";
      r.errors.push(`Could not resolve parent client (clientName="${row.clientName ?? ""}")`);
      missingRefs++; reports.push(r); return;
    }

    let brand: Brand | undefined;
    if (typeof row.brandId === "number") brand = ctx.brands.find(b => b.id === row.brandId);
    if (!brand && row.brandName) {
      const key = nameMatchKey(row.brandName);
      brand = ctx.brands.find(b =>
        nameMatchKey(b.name) === key &&
        (b.parentClientId === client!.id || !b.parentClientId)
      );
    }
    if (!brand) {
      r.outcome = "missing_ref";
      r.errors.push(`Could not resolve brand "${row.brandName ?? ""}" under client "${normalizeDisplayName(client.name)}"`);
      missingRefs++; reports.push(r); return;
    }
    r.secondaryLabel = `${normalizeDisplayName(client.name)} / ${normalizeDisplayName(brand.name)}`;

    // Within-file duplicate detection
    if (code) {
      const dKey = `${client.id}|${brand.id}|${code.toLowerCase()}`;
      const prior = seenCodes.get(dKey);
      if (prior !== undefined) {
        r.outcome = "duplicate";
        r.warnings.push(`Duplicate store code with row ${prior + 2}`);
        duplicates++;
      } else seenCodes.set(dKey, idx);
    }
    if (r.outcome !== "duplicate" && name) {
      const dKey = `${client.id}|${brand.id}|${nameMatchKey(name)}`;
      const prior = seenNames.get(dKey);
      if (prior !== undefined) {
        r.outcome = "duplicate";
        r.warnings.push(`Duplicate store name with row ${prior + 2}`);
        duplicates++;
      } else seenNames.set(dKey, idx);
    }

    if (r.outcome !== "duplicate") {
      // Match priority: store_code + client/brand, else name + client/brand
      let match: Store | undefined;
      if (code) {
        match = ctx.stores.find(s =>
          (s.storeCode || "").toLowerCase() === code.toLowerCase() &&
          s.clientId === client!.id && s.brandId === brand!.id
        );
        if (match) r.matchedField = "Store Code";
      }
      if (!match && name) {
        const key = nameMatchKey(name);
        match = ctx.stores.find(s =>
          nameMatchKey(s.name) === key &&
          s.clientId === client!.id && s.brandId === brand!.id
        );
        if (match) r.matchedField = "Name";
      }
      if (match) { r.outcome = "update"; r.matchedId = match.id; toUpdate++; }
      else toCreate++;
    }
    reports.push(r);
  });

  return { total: rows.length, toCreate, toUpdate, duplicates, missingRefs, errors, warnings, rows: reports };
}

export function previewBillingProfiles(
  rows: Record<string, any>[],
  ctx: ImportContext,
): ImportPreviewSummary {
  const reports: ImportRowReport[] = [];
  const seen = new Map<string, number>();
  let toCreate = 0, toUpdate = 0, duplicates = 0, missingRefs = 0, errors = 0, warnings = 0;
  const profiles = ctx.billingProfiles || [];

  rows.forEach((rawRow, idx) => {
    const row = cleanImportRow(rawRow);
    const gstin = normalizeGstinPan(row.gstin);
    const r: ImportRowReport = {
      index: idx, excelRow: idx + 2, outcome: "create",
      warnings: [], errors: [], primaryLabel: gstin || "(no GSTIN)",
    };
    if (!gstin) { r.outcome = "error"; r.errors.push("Missing GSTIN"); errors++; reports.push(r); return; }
    if (gstin.length !== 15) { r.warnings.push(`GSTIN should be 15 chars (got ${gstin.length})`); warnings++; }

    let client: Client | undefined;
    if (typeof row.clientId === "number") client = ctx.clients.find(c => c.id === row.clientId);
    if (!client && row.clientName) {
      const key = nameMatchKey(row.clientName);
      client = ctx.clients.find(c => nameMatchKey(c.name) === key);
    }
    if (!client) {
      r.outcome = "missing_ref";
      r.errors.push(`Could not resolve parent client (clientName="${row.clientName ?? ""}")`);
      missingRefs++; reports.push(r); return;
    }
    r.secondaryLabel = `→ ${normalizeDisplayName(client.name)}`;

    const dKey = `${client.id}|${gstin}`;
    const prior = seen.get(dKey);
    if (prior !== undefined) {
      r.outcome = "duplicate";
      r.warnings.push(`Duplicate GSTIN+Client with row ${prior + 2}`);
      duplicates++;
    } else seen.set(dKey, idx);

    if (r.outcome !== "duplicate") {
      const match = profiles.find(p => p.clientId === client!.id && normalizeGstinPan(p.gstin) === gstin);
      if (match) { r.outcome = "update"; r.matchedId = match.id; r.matchedField = "GSTIN+Client"; toUpdate++; }
      else toCreate++;
    }
    reports.push(r);
  });

  return { total: rows.length, toCreate, toUpdate, duplicates, missingRefs, errors, warnings, rows: reports };
}

export function buildPreview(
  type: string,
  rows: Record<string, any>[],
  ctx: ImportContext,
): ImportPreviewSummary {
  if (type === "clients") return previewClients(rows, ctx);
  if (type === "brands") return previewBrands(rows, ctx);
  if (type === "stores") return previewStores(rows, ctx);
  if (type === "billing_profiles") return previewBillingProfiles(rows, ctx);
  // Fallback: counts only
  return {
    total: rows.length,
    toCreate: rows.length, toUpdate: 0, duplicates: 0, missingRefs: 0, errors: 0, warnings: 0,
    rows: rows.map((_, idx) => ({
      index: idx, excelRow: idx + 2, outcome: "create",
      warnings: [], errors: [], primaryLabel: `Row ${idx + 2}`,
    })),
  };
}
