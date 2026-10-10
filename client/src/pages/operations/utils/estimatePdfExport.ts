// Estimate PDF Export utilities
// Uses the canonical EstimateDocument renderer and Playwright backend
// to generate individual A4 PDFs or combined print PDFs without altering
// estimate data or numbering.

import { PDFDocument } from "pdf-lib";
import { zipSync } from "fflate";
import { isBoltMode } from "../../../lib/supabase";

/**
 * Sanitize strings for cross-platform filesystem compatibility.
 * Replaces slashes with hyphens, cleans spacing around hyphens, and removes illegal characters.
 */
export function sanitizeFilenamePart(str: string): string {
  return String(str || "")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function sanitizeFilename(str: string): string {
  return sanitizeFilenamePart(str);
}

/**
 * Build canonical estimate PDF filename:
 * - Single store: EstimateNo_StoreName.pdf (e.g. SM-E-26-27-248_Kharadi-R007.pdf)
 * - Multi store: EstimateNo_Multi-Store.pdf
 */
export function getEstimatePdfFilename(est: any, stores: any[] = []): string {
  const estNumberSanitized = sanitizeFilenamePart(est?.estimateNumber || `Estimate-${est?.id || "draft"}`);

  // Check if estimate has multiple stores in storeGrouping or is marked multi-store format
  const groupKeys = est?.storeGrouping && typeof est.storeGrouping === "object"
    ? Object.keys(est.storeGrouping).filter(k => k && k !== "undefined" && k !== "null")
    : [];

  const isMultiStoreFormat = est?.formatProfileCode === "ABFRL_MULTI_STORE" ||
    (typeof est?.formatProfileCode === "string" && est.formatProfileCode.includes("MULTI"));

  if (groupKeys.length > 1 || (isMultiStoreFormat && !est?.storeId && groupKeys.length === 0)) {
    return `${estNumberSanitized}_Multi-Store.pdf`;
  }

  let storeName = "";
  if (groupKeys.length === 1) {
    const sid = groupKeys[0];
    const s = stores.find((st: any) => String(st.id) === sid || String(st.storeCode) === sid);
    storeName = s?.name || est.storeGrouping[sid]?.storeName || s?.storeCode || "";
  } else if (est?.storeId) {
    const s = stores.find((st: any) => st.id === est.storeId || String(st.id) === String(est.storeId));
    storeName = s?.name || est?.storeName || est?.store_name || s?.storeCode || est?.storeCode || est?.store_code || "";
  } else if (est?.storeName || est?.store_name) {
    storeName = est?.storeName || est?.store_name;
  } else if (est?.storeCode || est?.store_code) {
    storeName = est?.storeCode || est?.store_code;
  }

  if (storeName) {
    const sanitizedStore = sanitizeFilenamePart(storeName);
    if (sanitizedStore) {
      return `${estNumberSanitized}_${sanitizedStore}.pdf`;
    }
  }

  return `${estNumberSanitized}.pdf`;
}

/**
 * Fetch canonical individual PDF bytes directly from the server.
 * Uses the exact same renderer, print CSS, logo, and page setup options
 * as the approved individual export.
 */
export async function fetchEstimateCanonicalPdf(
  token: string | null | undefined,
  estimateId: number,
  options?: {
    scale?: number;
    density?: "normal" | "compact";
    layout?: "portrait" | "landscape";
  }
): Promise<Uint8Array> {
  if (isBoltMode) {
    throw new Error("Bulk PDF generation requires the full server environment.");
  }

  const query = new URLSearchParams();
  if (options?.scale) query.set("scale", String(options.scale));
  if (options?.density) query.set("density", options.density);
  if (options?.layout) query.set("layout", options.layout);

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/operations/estimates/${estimateId}/pdf?${query.toString()}`, {
    headers,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`PDF generation failed (${res.status}): ${errText || res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Packages a dictionary or array of filenames and Uint8Array bytes into a ZIP Blob.
 */
export function packagePdfsIntoZip(
  files: Record<string, Uint8Array> | Array<{ filename: string; bytes: Uint8Array }>
): Blob {
  const fileMap: Record<string, Uint8Array> = {};
  if (Array.isArray(files)) {
    for (const item of files) {
      if (item && item.filename && item.bytes) {
        fileMap[item.filename] = item.bytes;
      }
    }
  } else if (files && typeof files === "object") {
    Object.assign(fileMap, files);
  }
  const zipBytes = zipSync(fileMap, { level: 6 });
  return new Blob([zipBytes], { type: "application/zip" });
}

/**
 * Trigger browser file download for a Blob.
 */
export function downloadFileBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
