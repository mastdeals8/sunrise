import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Indian Financial Year: Apr 1 → Mar 31.
export function fyForDate(d: Date): { label: string; start: Date; end: Date } {
  const y = d.getFullYear();
  const startYear = d.getMonth() < 3 ? y - 1 : y;
  const start = new Date(startYear, 3, 1, 0, 0, 0, 0);
  const end = new Date(startYear + 1, 2, 31, 23, 59, 59, 999);
  const label = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  return { label, start, end };
}

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per-FY startAt overrides for estimate numbering.
const estimateFyStartAtOverrides: Record<string, number> = {
  "26-27": 201,
};

async function loadNumberingConfig(
  db: SupabaseClient,
  kind: string,
  fyLabel?: string,
  companyId?: number,
): Promise<{ prefix: string; startAt: number; fyAware: boolean }> {
  if (companyId) {
    try {
      const { data: comp } = await db
        .from("companies")
        .select("invoice_prefix, estimate_prefix, dc_prefix, numbering_config")
        .eq("id", companyId)
        .maybeSingle();
      if (comp) {
        const compPrefix = kind === "invoice" ? comp.invoice_prefix : kind === "estimate" ? comp.estimate_prefix : comp.dc_prefix;
        const numCfg = (comp.numbering_config as any)?.[kind] || {};
        let startAt = Number.isFinite(Number(numCfg.startAt)) ? Number(numCfg.startAt) : (companyId === 1 ? 101 : 1);
        if (kind === "invoice") {
          const tallyStart = Number(
            (fyLabel && numCfg.fySequences?.[fyLabel]) ||
            numCfg.tallyCurrentNumber ||
            numCfg.startAt ||
            (companyId === 1 && fyLabel === "26-27" ? 170 : 0)
          );
          if (tallyStart > 0) startAt = Math.max(startAt, tallyStart);
        }
        return {
          prefix: compPrefix || (companyId === 1 ? "SM" : "INV"),
          startAt,
          fyAware: numCfg.fyAware !== false,
        };
      }
    } catch {
      // Fall through to app_settings
    }
  }

  const fallback = ({
    invoice:  { prefix: "SM",     startAt: 101, fyAware: true },
    estimate: { prefix: "SM/E",   startAt: 101, fyAware: true },
    dc:       { prefix: "SM/DC",  startAt: 101, fyAware: true },
  } as Record<string, { prefix: string; startAt: number; fyAware: boolean }>)[kind]
    ?? { prefix: "DOC", startAt: 1, fyAware: false };
  try {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", `numbering.${kind}`)
      .maybeSingle();
    const v = (data?.value as any) ?? {};
    let startAt = Number.isFinite(Number(v.startAt)) ? Number(v.startAt) : fallback.startAt;
    if (kind === "invoice") {
      const tallyStart = Number(
        (fyLabel && v.fySequences?.[fyLabel]) ||
        (fyLabel && v.tallyStartSeq?.[fyLabel]) ||
        v.tallyCurrentNumber ||
        v.startAt ||
        0
      );
      if (tallyStart > 0) startAt = Math.max(startAt, tallyStart);
    }
    return {
      prefix: typeof v.prefix === "string" ? v.prefix : fallback.prefix,
      startAt,
      fyAware: v.fyAware !== false,
    };
  } catch {
    return fallback;
  }
}

const tableForKind: Record<string, { table: string; column: string }> = {
  invoice:  { table: "invoices",          column: "invoice_number" },
  estimate: { table: "estimates",         column: "estimate_number" },
  dc:       { table: "delivery_challans", column: "dc_number" },
};

export async function nextDocumentNumber(
  db: SupabaseClient,
  kind: "invoice" | "estimate" | "dc",
  docDate: Date = new Date(),
  companyId?: number,
): Promise<string> {
  // Call the atomic SQL function first (preserves company isolation and lock serialization)
  try {
    const { data, error } = await db.rpc("next_sunrise_document_number", {
      p_kind: kind,
      p_date: docDate.toISOString().slice(0, 10),
      p_company_id: companyId || null,
    });
    if (!error && typeof data === "string" && data) return data;
  } catch {
    // Compatibility fallback
  }

  const fy = fyForDate(docDate);
  const cfg = await loadNumberingConfig(db, kind, fy.label, companyId);
  const map = tableForKind[kind];

  const startAt =
    kind === "estimate"
      ? estimateFyStartAtOverrides[fy.label] ?? cfg.startAt
      : cfg.startAt;

  let query = db.from(map.table).select(map.column);
  if (companyId) {
    query = (query as any).eq("company_id", companyId);
  }
  const { data: rows } = await query;

  let maxSeq = startAt - 1;

  if (kind === "invoice") {
    // Required invoice format: <FY>/<prefix>/<number> (e.g. 26-27/SM/171, 26-27/DEL/001)
    const prefix = cfg.prefix || "SM";
    const stdMatcher = new RegExp(`^${escapeReg(fy.label)}/${escapeReg(prefix)}/(\\d+)$`, "i");
    const legMatcher = new RegExp(`^${escapeReg(prefix)}/INV/${escapeReg(fy.label)}/(\\d+)$`, "i");

    for (const row of (rows ?? [])) {
      const docNum = String((row as any)[map.column] || "").trim();
      const m = docNum.match(stdMatcher) || docNum.match(legMatcher);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }
    const next = maxSeq + 1;
    return `${fy.label}/${prefix}/${String(next).padStart(3, "0")}`;
  }

  const fyMatcher = cfg.fyAware
    ? new RegExp(`^${escapeReg(cfg.prefix)}/${escapeReg(fy.label)}/(\\d+)$`)
    : new RegExp(`^${escapeReg(cfg.prefix)}/(\\d+)$`);

  for (const row of (rows ?? [])) {
    const docNum = String((row as any)[map.column] || "");
    const m = docNum.match(fyMatcher);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  const next = maxSeq + 1;
  return cfg.fyAware
    ? `${cfg.prefix}/${fy.label}/${String(next).padStart(3, "0")}`
    : `${cfg.prefix}/${String(next).padStart(3, "0")}`;
}
