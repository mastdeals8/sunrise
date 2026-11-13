import { createWorker } from "tesseract.js";
import pdfParse from "pdf-parse";

export interface OcrResult {
  success: boolean;
  rawText: string;
  vendor: string | null;
  receiptNumber: string | null;
  date: string | null;
  taxableAmount: number | null;
  gstAmount: number | null;
  totalAmount: number | null;
  category: string;
  gstin: string | null;
  message?: string;
}

/**
 * Extracts structured financial and vendor information from raw receipt text.
 * Strictly avoids fabricating values when text is absent or ambiguous.
 */
export function parseReceiptText(rawText: string): OcrResult {
  const clean = (rawText || "").trim();
  if (!clean || clean.length < 5) {
    return {
      success: false,
      rawText: clean,
      vendor: null,
      receiptNumber: null,
      date: null,
      taxableAmount: null,
      gstAmount: null,
      totalAmount: null,
      category: "other",
      gstin: null,
      message: "Image or document contains no legible text. Please enter values manually.",
    };
  }

  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. GSTIN detection (Indian GSTIN format: 2 digits state + 10 PAN + 1 entity + 1 'Z' + 1 check digit)
  let gstin: string | null = null;
  const gstinMatch = clean.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/);
  if (gstinMatch) {
    gstin = gstinMatch[0];
  }

  // 2. Vendor identification
  // Usually appears in first 4 lines, excluding generic receipt header titles
  const genericHeaders = /^(tax\s*invoice|invoice|cash\s*memo|receipt|bill\s*of\s*supply|retail\s*invoice|original|duplicate|triplicate|estimate|challan|welcome|gstin)/i;
  let vendor: string | null = null;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    if (line.length >= 3 && !genericHeaders.test(line) && !/^\d+$/.test(line) && !line.includes("GSTIN")) {
      // Remove trailing non-alphanumeric punctuation
      vendor = line.replace(/^[#\-*.:\s]+|[#\-*.:\s]+$/g, "");
      break;
    }
  }

  // 3. Receipt / Bill Number
  let receiptNumber: string | null = null;
  // First look for explicit Invoice No / Receipt No / Bill No / Inv #
  const explicitBillMatch = clean.match(/(?:inv(?:oice)?|bill|receipt|rcpt)[\s.:\/-]*(?:no\.?|num(?:ber)?\.?|#)[\s:.]*([a-z0-9\/-]{2,30})/i);
  if (explicitBillMatch && explicitBillMatch[1] && !/^(no|date|amount|total|cash|memo|tax)$/i.test(explicitBillMatch[1])) {
    receiptNumber = explicitBillMatch[1].trim();
  } else {
    // Secondary fallback with stricter negative filter
    const billMatch = clean.match(/(?:inv(?:oice)?|bill|receipt|rcpt|doc|token)[\s#.:\/-]*(?:no\.?|num(?:ber)?\.?|#)?[\s:.]*([a-z0-9\/-]{2,30})/i);
    if (billMatch && billMatch[1] && !/^(no|date|amount|total|cash|memo|tax|retail|of|supply)$/i.test(billMatch[1])) {
      receiptNumber = billMatch[1].trim();
    }
  }

  // 4. Date extraction
  let date: string | null = null;
  // Patterns like DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const dateMatch = clean.match(/\b(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/);
  if (dateMatch) {
    const rawDateStr = dateMatch[0].replace(/[.]/g, "-").replace(/[\/]/g, "-");
    const parts = rawDateStr.split("-");
    if (parts.length === 3) {
      let y = 0, m = 0, d = 0;
      if (parts[0].length === 4) {
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
        d = parseInt(parts[2], 10);
      } else {
        d = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
        y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
      }
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100) {
        date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }

  // 5. Amount parsing
  let totalAmount: number | null = null;
  let gstAmount: number | null = null;
  let taxableAmount: number | null = null;

  // Search explicitly for Grand Total first, then Total / Net Amount
  const grandTotalMatch = clean.match(/(?:grand\s*total|net\s*payable|amount\s*payable|paid\s*amount)[\s:₹rs.]*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i);
  if (grandTotalMatch) {
    const parsed = parseFloat(grandTotalMatch[1].replace(/,/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      totalAmount = parsed;
    }
  }

  if (!totalAmount) {
    const totalMatch = clean.match(/(?:total\s*amount|net\s*amount|\btotal\b)[\s:₹rs.]*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i);
    if (totalMatch) {
      const parsed = parseFloat(totalMatch[1].replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0) {
        totalAmount = parsed;
      }
    }
  }

  // Extract GST amount (exclude % rates)
  const gstRegex = /(?:total\s*gst|gst\s*amount|tax\s*amount)[\s:₹rs.]*([0-9,]+\.[0-9]{2})/i;
  const gstMatch = clean.match(gstRegex);
  if (gstMatch) {
    const val = parseFloat(gstMatch[1].replace(/,/g, ""));
    if (!isNaN(val) && val > 0 && (!totalAmount || val < totalAmount)) {
      gstAmount = val;
    }
  }

  // If no explicit "Total GST" label, look for lines with GST followed by an amount (not a percentage)
  if (!gstAmount) {
    const generalGstMatch = clean.match(/(?:gst|igst)[\s:₹rs.]*([0-9,]+\.[0-9]{2})(?!\s*%)/i);
    if (generalGstMatch) {
      const val = parseFloat(generalGstMatch[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0 && (!totalAmount || val < totalAmount)) {
        gstAmount = val;
      }
    }
  }

  // If no explicit "total" label was matched, find the largest reasonable monetary figure
  if (!totalAmount) {
    const monetaryRegex = /(?:₹|rs\.?|inr)?\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})/gi;
    let max = 0;
    let m: RegExpExecArray | null;
    while ((m = monetaryRegex.exec(clean)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val) && val > max && val < 500000) {
        max = val;
      }
    }
    if (max > 0) totalAmount = max;
  }

  if (totalAmount != null) {
    taxableAmount = gstAmount != null ? +(totalAmount - gstAmount).toFixed(2) : totalAmount;
  }

  // 6. Category classification based on lexical context
  const lower = clean.toLowerCase();
  let category = "other";
  if (/\b(restaurant|cafe|coffee|tea|snacks|meal|food|canteen|zomato|swiggy|bakery|lunch|dinner|breakfast|hotel|beverage)\b/.test(lower)) {
    category = "food";
  } else if (/\b(taxi|cab|uber|ola|auto|petrol|diesel|fuel|toll|parking|courier|transport|travel|flight|train|fastag|bus)\b/.test(lower)) {
    category = "transport";
  } else if (/\b(stationery|stationary|xerox|print|printing|paper|cartridge|toner|pen|binder|folder|notebook|office\s*supplies)\b/.test(lower)) {
    category = "office_supplies";
  } else if (/\b(hardware|plywood|timber|acrylic|vinyl|screw|bolt|paint|led|wire|cable|fastener|clamp|tools|metal|iron|steel)\b/.test(lower)) {
    category = "hardware";
  } else if (/\b(electricity|water|broadband|internet|wifi|airtel|jio|subscription|mobile\s*recharge|software|hosting|domain)\b/.test(lower)) {
    category = "utilities";
  }

  return {
    success: !!(vendor || totalAmount || receiptNumber),
    rawText: clean,
    vendor,
    receiptNumber,
    date,
    taxableAmount,
    gstAmount,
    totalAmount,
    category,
    gstin,
    message: totalAmount || vendor ? "Receipt details extracted successfully." : "Limited data could be identified. Please verify.",
  };
}

/**
 * Performs actual optical character recognition on an image or PDF buffer.
 */
export async function performGenuineOcr(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<OcrResult> {
  const isPdf = mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf");

  try {
    let rawText = "";

    if (isPdf) {
      // PDF text extraction using pdf-parse
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text || "";
    } else {
      // Image OCR using Tesseract.js engine
      const worker = await createWorker("eng");
      const ret = await worker.recognize(buffer);
      await worker.terminate();
      rawText = ret.data.text || "";
    }

    return parseReceiptText(rawText);
  } catch (err: any) {
    console.error("[OCR Engine Error]:", err);
    return {
      success: false,
      rawText: "",
      vendor: null,
      receiptNumber: null,
      date: null,
      taxableAmount: null,
      gstAmount: null,
      totalAmount: null,
      category: "other",
      gstin: null,
      message: `OCR processing failed: ${err.message || "Unknown error"}. Please enter values manually.`,
    };
  }
}
