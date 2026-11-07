/**
 * spreadsheetParser.ts
 *
 * Universal client-side spreadsheet and CSV parser for Master Data Import.
 * Works seamlessly in both Bolt preview mode and Express mode without server dependencies.
 *
 * Capabilities:
 * - Robust CSV parsing with quoted fields, newlines, and commas (RFC 4180).
 * - Multi-encoding support: UTF-8 with BOM, standard UTF-8, Windows-1252/CP1252, and MacRoman.
 *   Ensures punctuation in Indian addresses (e.g. en-dash, quotes, slashes) is never corrupted.
 * - Automatic blank-row filtering (completely ignores empty rows).
 * - Native Excel (.xlsx, .xls) parsing via xlsx-js-style.
 */

export interface ParsedSpreadsheetResult {
  headers: string[];
  allRows: Record<string, any>[];
  previewRows: Record<string, any>[];
  totalRows: number;
  blankRowsCount: number;
}

/**
 * Decode array buffer using multi-encoding fallback:
 * 1. UTF-8 (strict fatal check)
 * 2. MacRoman / macintosh
 * 3. Windows-1252 / CP1252
 */
export function decodeBufferToString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // Check for UTF-8 BOM
  let startOffset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    startOffset = 3;
  }

  const effectiveSlice = buffer.slice(startOffset);

  // 1. Try strict UTF-8
  try {
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    return utf8Decoder.decode(effectiveSlice);
  } catch {
    // UTF-8 failed, inspect bytes for MacRoman vs Windows-1252 indicators
  }

  // 2. Try Macintosh (MacRoman)
  try {
    const macDecoder = new TextDecoder("macintosh", { fatal: false });
    const decoded = macDecoder.decode(effectiveSlice);
    // If it contains en-dash \u2013 or curly quotes without replacement chars, it is very likely MacRoman
    if (decoded.includes("\u2013") || decoded.includes("\u201c") || decoded.includes("\u201d")) {
      return decoded;
    }
  } catch {}

  // 3. Fallback to Windows-1252 / CP1252
  try {
    const winDecoder = new TextDecoder("windows-1252", { fatal: false });
    const decoded = winDecoder.decode(effectiveSlice);
    // Normalize any lingering raw CP1252 artifacts if needed
    return decoded
      .replace(/\u0096/g, "–")
      .replace(/\u0097/g, "—")
      .replace(/\u0091/g, "‘")
      .replace(/\u0092/g, "’")
      .replace(/\u0093/g, "“")
      .replace(/\u0094/g, "”");
  } catch {
    // Ultimate fallback
    return new TextDecoder("utf-8", { fatal: false }).decode(effectiveSlice);
  }
}

/**
 * Robust CSV parser that handles quotes, escaped quotes (""), commas, and newlines.
 */
export function parseCsvText(text: string): { headers: string[]; allRows: Record<string, any>[]; blankRowsCount: number } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentCell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && nextChar === "\n") i++;
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { headers: [], allRows: [], blankRowsCount: 0 };
  }

  // Find the header row (first non-empty row)
  let headerIndex = -1;
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].some(c => c && c.trim().length > 0)) {
      headerIndex = r;
      break;
    }
  }

  if (headerIndex === -1) {
    return { headers: [], allRows: [], blankRowsCount: rows.length };
  }

  const rawHeaders = rows[headerIndex];
  const headers = rawHeaders.map(h => (h || "").trim()).filter(Boolean);

  let blankRowsCount = 0;
  const dataRows: Record<string, any>[] = [];

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const isBlank = row.every(val => !val || val.trim().length === 0);
    if (isBlank) {
      blankRowsCount++;
      continue;
    }

    const obj: Record<string, any> = {};
    rawHeaders.forEach((header, idx) => {
      const hTrim = (header || "").trim();
      if (hTrim) {
        const val = row[idx] !== undefined ? row[idx].trim() : "";
        obj[hTrim] = val;
      }
    });
    dataRows.push(obj);
  }

  return { headers, allRows: dataRows, blankRowsCount };
}

/**
 * Universal file parser for browser File object.
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheetResult> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  if (isExcel) {
    const arrayBuffer = await file.arrayBuffer();
    const XLSX = (await import("xlsx-js-style")).default || (await import("xlsx-js-style"));
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The uploaded spreadsheet contains no sheets.");
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as any[][];

    if (!rawRows || rawRows.length === 0) {
      throw new Error("The uploaded spreadsheet is empty.");
    }

    // Find first non-empty header row
    let headerIdx = -1;
    for (let r = 0; r < rawRows.length; r++) {
      if (rawRows[r].some((c: any) => String(c || "").trim().length > 0)) {
        headerIdx = r;
        break;
      }
    }

    if (headerIdx === -1) throw new Error("No headers found in spreadsheet.");

    const rawHeaders = rawRows[headerIdx].map((h: any) => String(h || "").trim());
    const headers = rawHeaders.filter(Boolean);

    let blankRowsCount = 0;
    const dataRows: Record<string, any>[] = [];

    for (let r = headerIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      const isBlank = row.every((c: any) => String(c ?? "").trim().length === 0);
      if (isBlank) {
        blankRowsCount++;
        continue;
      }

      const obj: Record<string, any> = {};
      rawHeaders.forEach((h: string, idx: number) => {
        if (h) {
          const rawVal = row[idx];
          obj[h] = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : "";
        }
      });
      dataRows.push(obj);
    }

    return {
      headers,
      allRows: dataRows,
      previewRows: dataRows.slice(0, 20),
      totalRows: dataRows.length,
      blankRowsCount,
    };
  }

  // Handle CSV
  const arrayBuffer = await file.arrayBuffer();
  const text = decodeBufferToString(arrayBuffer);
  const { headers, allRows, blankRowsCount } = parseCsvText(text);

  if (headers.length === 0) {
    throw new Error("The uploaded CSV file is empty or missing headers.");
  }

  return {
    headers,
    allRows,
    previewRows: allRows.slice(0, 20),
    totalRows: allRows.length,
    blankRowsCount,
  };
}
