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
): Promise<{ prefix: string; startAt: number; fyAware: boolean }> {
  const fallback = ({
    invoice:  { prefix: "SM/INV", startAt: 101, fyAware: true },
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
    return {
      prefix: typeof v.prefix === "string" ? v.prefix : fallback.prefix,
      startAt: Number.isFinite(Number(v.startAt)) ? Number(v.startAt) : fallback.startAt,
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
): Promise<string> {
  const cfg = await loadNumberingConfig(db, kind);
  const map = tableForKind[kind];
  const fy = fyForDate(new Date());
  const startAt =
    kind === "estimate"
      ? estimateFyStartAtOverrides[fy.label] ?? cfg.startAt
      : cfg.startAt;

  const { data: rows } = await db
    .from(map.table)
    .select(map.column);

  const fyMatcher = cfg.fyAware
    ? new RegExp(`^${escapeReg(cfg.prefix)}/${escapeReg(fy.label)}/(\\d+)$`)
    : new RegExp(`^${escapeReg(cfg.prefix)}/(\\d+)$`);

  let maxSeq = startAt - 1;
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
    ? `${cfg.prefix}/${fy.label}/${next}`
    : `${cfg.prefix}/${next}`;
}
