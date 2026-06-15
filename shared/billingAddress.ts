// Shared utilities for the structured billing address.
//
// The DB still stores a single `billing_address` TEXT column for backward
// compatibility. Newly composed addresses are saved as multi-line strings
// using "\n" between Address Line 1, Address Line 2, "City - Pincode", and
// State. Legacy single-line entries continue to work as-is.

export type BillingAddressParts = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
};

const EMPTY: BillingAddressParts = { line1: "", line2: "", city: "", state: "", pincode: "" };

const safe = (v: string | null | undefined) => String(v ?? "").trim();

// Compose 5 structured parts into the multi-line address stored in DB.
// City + State + Pincode are combined into a single line — format:
//   "City, State - Pincode"
// Returns "" when every part is empty.
export const composeBillingAddress = (parts: Partial<BillingAddressParts>): string => {
  const line1 = safe(parts.line1);
  const line2 = safe(parts.line2);
  const city = safe(parts.city);
  const state = safe(parts.state);
  const pincode = safe(parts.pincode);
  // Build "City, State - Pincode" with each piece optional
  const cityState = [city, state].filter(Boolean).join(", ");
  const csp = [cityState, pincode].filter(Boolean).join(" - ");
  return [line1, line2, csp].filter(Boolean).join("\n");
};

// Parse a stored billing address back into the 5 structured fields.
// - Multi-line (preferred new format): each \n line maps to a structured field
//   based on position and heuristics (last 6-digit token is pincode, etc.).
// - Single-line legacy data: dumps everything into line1 so editing still works.
// Never throws — returns sensible defaults for empty/malformed input.
export const parseBillingAddress = (raw: string | null | undefined): BillingAddressParts => {
  const text = safe(raw);
  if (!text) return { ...EMPTY };
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ...EMPTY };
  if (lines.length === 1) return { ...EMPTY, line1: lines[0] };

  // Try to detect "City - Pincode" pattern in any line
  const cityPincodeIdx = lines.findIndex(l => /\b\d{6}\b/.test(l));
  let line1 = "";
  let line2 = "";
  let city = "";
  let pincode = "";
  let state = "";

  if (cityPincodeIdx >= 0) {
    const cpLine = lines[cityPincodeIdx];
    // Match "City, State - Pincode" or "City - Pincode, State" etc.
    const pinMatch = cpLine.match(/(\d{6})/);
    pincode = pinMatch ? pinMatch[1] : "";
    const rest = cpLine.replace(/\d{6}/, "").replace(/[-,\s]+$/, "").replace(/^[-,\s]+/, "").trim();
    // Split rest on comma — first part is city, second is state
    const restParts = rest.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
    if (restParts.length >= 2) {
      city = restParts[0];
      state = restParts.slice(1).join(", ");
    } else {
      city = restParts[0] || "";
      // State may be on the next line (legacy "City - Pincode\nState" format)
      state = lines[cityPincodeIdx + 1] || "";
    }
    // Lines before cityPincodeIdx are address lines
    line1 = lines[0] !== cpLine ? lines[0] : "";
    line2 = cityPincodeIdx >= 2 ? lines[1] : "";
  } else {
    // No pincode found — assign positionally
    line1 = lines[0] || "";
    line2 = lines[1] || "";
    city = lines[2] || "";
    state = lines[3] || lines[lines.length - 1] || "";
  }

  return { line1, line2, city, state, pincode };
};

// True when the value already contains explicit line breaks (i.e. the new
// structured format). Used by renderers to avoid re-wrapping.
export const isStructuredBillingAddress = (value: string | null | undefined): boolean => {
  return /\n/.test(String(value ?? ""));
};
