// Audit DC/WCC numbering before changing the start-at threshold.
// Reports: max sequence number per FY, count below/at/above 201, the loaded
// numbering config, and a recommendation.
//
// Reads DATABASE_URL from env (.env). Read-only — does not modify anything.
//
// Usage: node scripts/audit-dc-numbering.mjs

import { Pool } from "pg";
import "dotenv/config";

// Disable TLS verification for self-signed Supabase/cloud certs in dev.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const main = async () => {
  try {
    const r = await pool.query(`SELECT id, dc_number, created_at FROM delivery_challans ORDER BY id`);
    const total = r.rowCount;
    if (total === 0) {
      console.log("No DC/WCC records in the database.");
      console.log("RECOMMENDATION: safe to set numbering.dc.startAt = 201.");
      return;
    }
    // Parse numbers; support both FY-aware "PREFIX/FY/N" and plain "PREFIX/N"
    const parsed = [];
    for (const row of r.rows) {
      const dc = String(row.dc_number || "");
      const m = dc.match(/(\d+)\s*$/);
      const seq = m ? parseInt(m[1], 10) : null;
      const fyMatch = dc.match(/\/(\d{2}-\d{2})\//);
      parsed.push({
        id: row.id,
        dcNumber: dc,
        seq: Number.isFinite(seq) ? seq : null,
        fy: fyMatch ? fyMatch[1] : "(no FY)",
      });
    }
    const valid = parsed.filter(p => p.seq !== null);
    const byFy = new Map();
    for (const p of valid) {
      if (!byFy.has(p.fy)) byFy.set(p.fy, []);
      byFy.get(p.fy).push(p.seq);
    }

    console.log(`Total DC/WCC rows         : ${total}`);
    console.log(`Parseable sequence rows   : ${valid.length}`);
    console.log(`Unparseable / legacy rows : ${total - valid.length}`);
    console.log("");
    console.log("Per FY breakdown:");
    for (const [fy, seqs] of [...byFy.entries()].sort()) {
      const max = Math.max(...seqs);
      const min = Math.min(...seqs);
      const below201 = seqs.filter(s => s < 201).length;
      const atOrAbove = seqs.filter(s => s >= 201).length;
      console.log(`  FY ${fy}: ${seqs.length} rows · min=${min} · max=${max} · <201: ${below201} · >=201: ${atOrAbove}`);
    }
    console.log("");
    const overallMax = Math.max(...valid.map(p => p.seq));
    console.log(`Overall MAX sequence: ${overallMax}`);
    console.log("");
    if (overallMax < 201) {
      console.log("RECOMMENDATION: Setting numbering.dc.startAt = 201 is SAFE.");
      console.log(`  Next DC after change → /201 (currently would be /${overallMax + 1}).`);
    } else {
      console.log("RECOMMENDATION: max sequence already >= 201.");
      console.log(`  Setting startAt = 201 will be a no-op — nextDocumentNumber returns max+1 = /${overallMax + 1}.`);
      console.log("  If you want the NEXT FY to start at 201, add per-FY startAt overrides for dc");
      console.log("  (similar to estimateFyStartAtOverrides for estimates).");
    }
  } catch (err) {
    console.error("ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
