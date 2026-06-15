const UPPERCASE_WORDS = new Set([
  "GST",
  "GSTIN",
  "PAN",
  "PO",
  "DC",
  "WCC",
  "HSN",
  "SAC",
  "LED",
  "ACP",
  "PVC",
  "MDF",
  "MS",
  "ID",
  "ABLBL",
  "ABFRL",
]);

const LOWERCASE_WORDS = new Set(["and", "or", "of", "the", "in", "at", "as", "per", "for", "to"]);

const BRAND_OVERRIDES: Record<string, string> = {
  "peter england": "Peter England",
  "louis philippe": "Louis Philippe",
  "allen solly": "Allen Solly",
  "aditya birla lifestyle brands limited": "Aditya Birla Lifestyle Brands Limited",
  "aditya birla fashion and retail ltd": "Aditya Birla Fashion and Retail Ltd",
  "aditya birla fashion retail ltd": "Aditya Birla Fashion Retail Ltd",
};

export const ABLBL_LEGAL_NAME = "Aditya Birla Lifestyle Brands Limited";

export function normalizeGstinPan(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isAblblFormat(format: unknown): boolean {
  const normalized = String(format ?? "").trim().toLowerCase();
  return ["abfrl", "abfrl_multi_store", "ablbl", "ablbl_multi_store"].includes(normalized);
}

export function normalizeFormatMode(format: unknown): "normal" | "ABLBL" {
  return isAblblFormat(format) ? "ABLBL" : "normal";
}

export function displayFormatLabel(format: unknown): string {
  if (isAblblFormat(format)) return "ABLBL";
  return "Standard / Normal";
}

function titleToken(token: string, index: number): string {
  if (!token) return token;
  const parts = token.split(/([-/&])/);
  return parts.map(part => {
    if (!part || /^[-/&]$/.test(part)) return part;
    const upper = part.toUpperCase();
    const lower = part.toLowerCase();
    if (UPPERCASE_WORDS.has(upper)) return upper;
    if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower;
    if (/^\d/.test(part)) return part;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
}

export function smartTitleCase(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const override = BRAND_OVERRIDES[raw.toLowerCase()];
  if (override) return override;
  return raw.split(" ").map(titleToken).join(" ");
}

export function normalizeDisplayName(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, " ");
  const lower = compact.toLowerCase();
  if (BRAND_OVERRIDES[lower]) return BRAND_OVERRIDES[lower];
  if (/\b(abfrl|ablbl)\b/i.test(compact) && /aditya birla/i.test(compact)) {
    return ABLBL_LEGAL_NAME;
  }
  return smartTitleCase(compact);
}

// Comparison key for fuzzy-equal name matching. Strips all non-alphanumerics
// (so "Aditya Birla", "ADITYA-BIRLA", "aditya  birla" all collapse to the
// same key), lowercases, and trims. Use this when matching imported rows
// against existing master rows by name.
export function nameMatchKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// Levenshtein distance (iterative, O(m*n) time, O(min) space). Used to flag
// near-duplicate names during import preview (e.g. "Aditya Birla" vs
// "Adityabilra"). Not exported as a general utility — kept simple.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// Returns a similarity score in [0,1] between two names (using nameMatchKey
// to normalise). 1.0 = identical after normalisation. Returns 0 for either
// side blank.
export function nameSimilarity(a: unknown, b: unknown): number {
  const ka = nameMatchKey(a);
  const kb = nameMatchKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const dist = levenshtein(ka, kb);
  const longest = Math.max(ka.length, kb.length);
  return longest === 0 ? 0 : 1 - dist / longest;
}

// "Aditya Birla" vs "Adityabilra" → 0.82. Threshold of 0.82 catches typical
// typos / dropped spaces / single-character transpositions without being so
// loose that "Apollo" matches "Allen". Tuned empirically against the brand
// override list and a small set of test pairs.
export const NAME_SIMILAR_THRESHOLD = 0.82;
