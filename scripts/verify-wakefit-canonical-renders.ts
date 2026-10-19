import { renderEstimatePdfBuffer } from "../server/utils/estimatePdfRenderer";
import pg from "pg";
import dotenv from "dotenv";
import assert from "assert";

dotenv.config();

const cleanUrl = process.env.DATABASE_URL!.replace(/([?&])sslmode=[^&]+(&|$)/, "$1").replace(/[?&]$/, "");
const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

async function verifyCanonicalRenders() {
  const client = await pool.connect();
  console.log("=== VERIFYING CANONICAL PDF RENDERING FOR 7 WAKEFIT ESTIMATES ===");

  try {
    const estNumbers = [
      "SM/25-26/238",
      "SM/25-26/239",
      "SM/25-26/240",
      "SM/25-26/241",
      "SM/25-26/242",
      "SM/25-26/243",
      "SM/25-26/246",
    ];

    const estsRes = await client.query(
      "SELECT id, estimate_number, title, store_id, total_amount FROM estimates WHERE estimate_number = ANY($1) ORDER BY estimate_number",
      [estNumbers]
    );

    assert.equal(estsRes.rows.length, 7, "All 7 estimates must exist in database");

    for (const est of estsRes.rows) {
      console.log(`\nRendering PDF for Estimate #${est.id} (${est.estimate_number})...`);
      const { buffer, filename } = await renderEstimatePdfBuffer({
        estimateId: est.id,
        scale: 100,
        density: "normal",
        layout: "portrait",
      });

      console.log(`  ✓ Generated PDF: "${filename}"`);
      console.log(`  ✓ Buffer size: ${buffer.length} bytes`);
      assert.ok(buffer.length > 50000, `PDF buffer too small: ${buffer.length} bytes`);
      assert.ok(buffer.slice(0, 4).toString() === "%PDF", "Must be a valid PDF header");
    }

    console.log("\n🎉 ALL 7 ESTIMATES SUCCESSFULLY RENDERED USING CANONICAL RENDERER!");
  } finally {
    client.release();
    await pool.end();
  }
}

verifyCanonicalRenders().catch(err => {
  console.error("❌ PDF rendering verification failed:", err);
  process.exit(1);
});
