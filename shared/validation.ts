// Validation utilities for Sunrise Media ERP
// Phase 7: Essential validation rules

/**
 * Validate GSTIN format (15 characters)
 * Format: 2 digits (state) + 10 alphanumeric (PAN) + 1 digit + 1 letter + 1 alphanumeric
 */
export function validateGstin(gstin: string): { valid: boolean; error?: string } {
  if (!gstin || gstin.trim() === "") {
    return { valid: true }; // Optional field
  }
  const cleaned = gstin.trim().toUpperCase();
  if (cleaned.length !== 15) {
    return { valid: false, error: "GSTIN must be exactly 15 characters" };
  }
  const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
  if (!gstinPattern.test(cleaned)) {
    return { valid: false, error: "Invalid GSTIN format" };
  }
  return { valid: true };
}

/**
 * Validate PAN format (10 characters)
 * Format: 5 letters + 4 digits + 1 letter
 */
export function validatePan(pan: string): { valid: boolean; error?: string } {
  if (!pan || pan.trim() === "") {
    return { valid: true }; // Optional field
  }
  const cleaned = pan.trim().toUpperCase();
  if (cleaned.length !== 10) {
    return { valid: false, error: "PAN must be exactly 10 characters" };
  }
  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panPattern.test(cleaned)) {
    return { valid: false, error: "Invalid PAN format (e.g., ABCDE1234F)" };
  }
  return { valid: true };
}

/**
 * Validate email format
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || email.trim() === "") {
    return { valid: true }; // Optional field
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email.trim())) {
    return { valid: false, error: "Invalid email format" };
  }
  return { valid: true };
}

/**
 * Validate phone format (10 digits, optional +91 prefix)
 */
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone || phone.trim() === "") {
    return { valid: true }; // Optional field
  }
  const cleaned = phone.trim().replace(/[\s\-\(\)]/g, "");
  const phonePattern = /^(\+91)?[6-9][0-9]{9}$/;
  if (!phonePattern.test(cleaned)) {
    return { valid: false, error: "Invalid phone number (must be 10 digits starting with 6-9)" };
  }
  return { valid: true };
}

/**
 * Validate HSN/SAC code (4, 6, or 8 digits)
 */
export function validateHsn(hsn: string): { valid: boolean; error?: string } {
  if (!hsn || hsn.trim() === "") {
    return { valid: true }; // Optional field
  }
  const cleaned = hsn.trim();
  if (!/^[0-9]{4}$|^[0-9]{6}$|^[0-9]{8}$/.test(cleaned)) {
    return { valid: false, error: "HSN/SAC must be 4, 6, or 8 digits" };
  }
  return { valid: true };
}

/**
 * Validate GST percentage (must be 0, 5, 12, 18, or 28)
 */
export function validateGstPercent(gst: number): { valid: boolean; error?: string } {
  const validRates = [0, 5, 12, 18, 28];
  if (!validRates.includes(gst)) {
    return { valid: false, error: "GST rate must be 0, 5, 12, 18, or 28" };
  }
  return { valid: true };
}

/**
 * Validate quantity (must be greater than 0)
 */
export function validateQuantity(qty: number): { valid: boolean; error?: string } {
  if (qty <= 0) {
    return { valid: false, error: "Quantity must be greater than 0" };
  }
  return { valid: true };
}

/**
 * Validate rate (must not be negative)
 */
export function validateRate(rate: number): { valid: boolean; error?: string } {
  if (rate < 0) {
    return { valid: false, error: "Rate cannot be negative" };
  }
  return { valid: true };
}

const serviceLineTypes = ["packing", "installation", "transport"];

function parseEstimateRate(value: any): number {
  const cleaned = String(value ?? "")
    .replace(/[₹,\s]/g, "")
    .replace(/%/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Validate estimate has at least one row
 */
export function validateEstimateItems(items: any[]): { valid: boolean; error?: string } {
  if (!items || items.length === 0) {
    return { valid: false, error: "Estimate must have at least one item" };
  }
  return { valid: true };
}

/**
 * Validate invoice has a linked DC
 */
export function validateInvoiceHasDc(dcId: number | null | undefined): { valid: boolean; error?: string } {
  if (!dcId) {
    return { valid: false, error: "Invoice must be linked to a Delivery Challan" };
  }
  return { valid: true };
}

/**
 * Validate due date is not before invoice date
 */
export function validateDueDate(invoiceDate: string | Date, dueDate: string | Date): { valid: boolean; error?: string } {
  const invDate = new Date(invoiceDate);
  const dueDateObj = new Date(dueDate);

  if (dueDateObj < invDate) {
    return { valid: false, error: "Due date cannot be before invoice date" };
  }
  return { valid: true };
}

/**
 * Batch validate all estimate items
 */
export function validateEstimateItemsBatch(items: any[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  items.forEach((item, index) => {
    const rowNum = item.sl || index + 1;

    // Validate HSN if provided
    if (item.hsn) {
      const hsnResult = validateHsn(item.hsn);
      if (!hsnResult.valid) {
        errors.push(`Row ${rowNum}: ${hsnResult.error}`);
      }
    }

    // Validate quantity
    const qtyResult = validateQuantity(Number(item.quantity) || 0);
    if (!qtyResult.valid) {
      errors.push(`Row ${rowNum}: ${qtyResult.error}`);
    }

    // Validate rate
    const rateValue = parseEstimateRate(item.rate);
    const rateResult = validateRate(Number.isFinite(rateValue) ? rateValue : -1);
    if (!rateResult.valid) {
      errors.push(`Row ${rowNum}: ${rateResult.error}`);
    }
  });

  return { valid: errors.length === 0, errors };
}
