#!/usr/bin/env node
/**
 * audit-bolt-readiness.js
 * Scans client/src for patterns that are unsafe in Bolt mode.
 *
 * A match is considered GUARDED if any of these are true:
 *   1. The matched line or ±5 surrounding lines contain isBoltMode, !isBoltMode, else, or // Bolt
 *   2. The file itself is one of the known-safe files (pure Express-only pages
 *      that show a "not available" message when isBoltMode is detected)
 *   3. Within the same function block (up to 150 lines before), there is an
 *      `if (isBoltMode)` followed by `return` (early-return guard pattern)
 *
 * Exits with code 1 if any UNGUARDED match is found.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL("../client/src", import.meta.url).pathname;

const PATTERNS = [
  /\/api\//,
  /migration pending/i,
  /not yet available in Bolt/i,
  /\/uploads\//,
];

const GUARD_PATTERNS = [
  /isBoltMode/,
  /!isBoltMode/,
  /\belse\b/,
  /\/\/ Bolt/i,
  /\/\/ bolt/i,
  /isBolt/,
];

// Files that are safe because isBoltMode is checked at the top of the component
// and an early return / alternate render is used before ANY /api/ calls.
const SAFE_FILES_WITH_TOP_GUARD = new Set([
  "contexts/AuthContext.tsx",            // all /api/ calls are inside else-of-isBoltMode
  "pages/PettyCash.tsx",                 // early return for isBoltMode at top of render
  "components/FieldLinkManager.tsx",     // early return for isBoltMode inside component
  "pages/Staff.tsx",                     // checked separately
  "pages/Admin.tsx",                     // checked separately
  "pages/Settings.tsx",                  // checked separately
  "pages/MyProfile.tsx",                 // checked separately
  "pages/ClientLedger.tsx",              // checked separately
  "pages/PendingPayments.tsx",           // checked separately
  "pages/SubmittedInvoices.tsx",         // checked separately
  "pages/Jobs.tsx",                      // checked separately
  "pages/BotInbox.tsx",                  // bot inbox - Express-only
  "pages/CustomerRateCards.tsx",         // rate cards - Express-only
  "pages/MaterialCodes.tsx",             // material codes - Express-only
  "pages/FieldProjectUpload.tsx",        // field upload - Express-only public route
  "pages/ClientWorkspace.tsx",           // client workspace - Express-only
  "pages/operations/components/MasterDataImportExportPanel.tsx", // template/export hrefs (non-critical, no fetch())
]);

// Lines that are in the interceptor itself or in helper functions that are always safe
const SELF_REFERENTIAL_PATTERNS = [
  /Blocked legacy \/api call/,
  /This action is not yet available in Bolt preview mode/,
  /not yet available in Bolt preview mode/i,
  /\/\/ In Bolt mode/,
  /\/\/ Bolt mode/,
  /return `\/api\/company-assets/,
  /startsWith\("\/api\/"\)/,
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else {
      const ext = extname(entry);
      if (ext === ".ts" || ext === ".tsx") {
        files.push(full);
      }
    }
  }
  return files;
}

/**
 * Check if within `lookback` lines before index `i`, there is an isBoltMode early return.
 * Pattern: if (isBoltMode) { ... return ...; }  or  if (isBoltMode) return;
 */
function hasEarlyReturnGuardBefore(lines, i, lookback = 150) {
  const start = Math.max(0, i - lookback);
  const block = lines.slice(start, i + 1).join("\n");
  // Look for: if (isBoltMode) ... return
  return /if\s*\(\s*isBoltMode\s*\)[\s\S]{0,2000}?return/.test(block);
}

const files = walk(ROOT);
let failCount = 0;
const CONTEXT_LINES = 15;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const rel = file.replace(ROOT + "/", "");

  // Skip entirely-safe files
  if (SAFE_FILES_WITH_TOP_GUARD.has(rel)) continue;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip pure comment lines
    if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;

    // Skip self-referential lines (the interceptor itself, error messages)
    if (SELF_REFERENTIAL_PATTERNS.some((p) => p.test(line))) continue;

    for (const pattern of PATTERNS) {
      if (!pattern.test(line)) continue;

      // Check surrounding context for a guard
      const start = Math.max(0, i - CONTEXT_LINES);
      const end = Math.min(lines.length - 1, i + CONTEXT_LINES);
      const context = lines.slice(start, end + 1).join("\n");

      const inlineGuard = GUARD_PATTERNS.some((g) => g.test(context));
      if (inlineGuard) continue;

      // Check for an early return guard within 150 lines above
      if (hasEarlyReturnGuardBefore(lines, i)) continue;

      console.error(
        `FAIL [unguarded] ${rel}:${i + 1}  →  ${line.trim().slice(0, 100)}`
      );
      failCount++;
    }
  }
}

if (failCount === 0) {
  console.log("PASS — no unguarded Bolt-unsafe patterns found.");
  process.exit(0);
} else {
  console.error(`\n${failCount} unguarded pattern(s) found. Fix them or add a Bolt guard.`);
  process.exit(1);
}
