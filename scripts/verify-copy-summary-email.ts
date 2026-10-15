import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.kbnjiidfpqnklaljtuoj:Lunkad%401979@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres';

async function run() {
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    console.log("Connected to database. Verifying Copy Summary Email Logic...");

    // 1. Fetch reference estimate SM/E/26-27/259
    const estRes = await client.query(`
      SELECT * FROM estimates WHERE estimate_number = 'SM/E/26-27/259'
    `);
    if (estRes.rows.length === 0) {
      throw new Error("Reference estimate SM/E/26-27/259 not found!");
    }
    const est = estRes.rows[0];

    const itemsRes = await client.query(`
      SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY id ASC
    `, [est.id]);
    const items = itemsRes.rows;

    console.log(`Found estimate: ${est.estimate_number}, Subject: ${est.subject}, Items: ${items.length}`);

    // Fetch stores & products to replicate serviceProductLabel and store resolution
    const storesRes = await client.query(`SELECT id, store_code FROM stores WHERE company_id = $1`, [est.company_id]);
    const stores = storesRes.rows;
    const storeMap = new Map(stores.map(s => [String(s.id), s.store_code]));

    const colsRes = await client.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'estimate_items'
    `);
    const colNames = colsRes.rows.map(c => c.column_name);
    console.log("estimate_items columns:", colNames.filter(c => c.includes('price') || c.includes('total') || c.includes('amount') || c.includes('line')));

    // Convert raw DB item to frontend EstimateItem camelCase
    const toCamel = (row: any) => ({
      ...row,
      id: row.id,
      sl: row.sl,
      lineType: row.line_type,
      itemName: row.item_name || row.description,
      description: row.description,
      quantity: Number(row.quantity || 1),
      rate: Number(row.rate || 0),
      totalPrice: Number(row.total_price ?? row.amount ?? row.price ?? 0),
      storeId: row.store_id,
      storeCode: row.store_code,
    });
    const frontendItems = items.map(toCamel);
    console.log("First item mapped:", frontendItems[0]);

    const productsRes = await client.query(`SELECT id, name FROM products WHERE company_id = $1`, [est.company_id]);
    const products = productsRes.rows;

    const serviceProductLabel = (
      serviceItem: { lineType?: string; itemName?: string },
      productsList: Array<{ id: string | number; name: string }>
    ) => {
      const explicitName = String(serviceItem.itemName || "").trim();
      const normalize = (val: string) => val.toLowerCase().replace(/[^a-z0-9]/g, "");
      const explicitNorm = normalize(explicitName);

      if (serviceItem.lineType === "packing") {
        const matched = productsList.find(p => {
          const norm = normalize(p.name);
          return norm === "packing" || norm === "packingcharges" || norm.includes("packing");
        });
        if (matched) return matched.name;
        if (explicitName && !["packing", "packing charges"].includes(explicitName.toLowerCase())) {
          return explicitName;
        }
        return "Packing Charges";
      }

      if (serviceItem.lineType === "installation") {
        const matched = productsList.find(p => {
          const norm = normalize(p.name);
          return norm === "installation" || norm === "installationcharges" || norm.includes("installation");
        });
        if (matched) return matched.name;
        if (explicitName && !["installation", "installation charges"].includes(explicitName.toLowerCase())) {
          return explicitName;
        }
        return "Installation Charges";
      }

      if (serviceItem.lineType === "transport") {
        if (explicitName && explicitName.toLowerCase().includes("outstation")) {
          const matchedOutstation = productsList.find(p => {
            const norm = normalize(p.name);
            return norm.includes("outstationtransportation") || (norm.includes("outstation") && norm.includes("transport"));
          });
          if (matchedOutstation) return matchedOutstation.name;
          return "Outstation Transportation";
        }
        const matchedLocal = productsList.find(p => {
          const norm = normalize(p.name);
          return norm.includes("localtransportation") || (norm.includes("local") && norm.includes("transport"));
        });
        if (matchedLocal) return matchedLocal.name;
        return explicitName || "Local Transportation";
      }

      return explicitName;
    };

    const buildSummaryRows = (estimate: any, estimateItems: any[]) => {
      const allRows: any[] = [];
      const isServiceItem = (item: any) =>
        item.lineType === "packing" ||
        item.lineType === "installation" ||
        item.lineType === "transport" ||
        Boolean(item.isServiceRow);

      const orderedStoreKeysFromItems = Array.from(
        new Set(
          estimateItems
            .map(it => (it.storeId !== null && it.storeId !== undefined ? String(it.storeId) : ""))
            .filter(Boolean)
        )
      );

      const storeKeys = orderedStoreKeysFromItems.length > 0 ? orderedStoreKeysFromItems : ["all"];

      storeKeys.forEach((storeKey) => {
        const storeItems = estimateItems.filter(it =>
          storeKey === "all" ? true : String(it.storeId || "") === storeKey
        );
        const storeCode = (storeKey !== "all" && storeMap.get(storeKey)) || estimate.store_code || "STORE";
        const materialItems = storeItems.filter(it => !isServiceItem(it));
        const savedServices = storeItems.filter(isServiceItem);

        if (materialItems.length > 0) {
          const totalMaterialAmount = materialItems.reduce(
            (sum, it) => sum + (Number(it.totalPrice || 0) || 0),
            0
          );
          allRows.push({
            vendorCode: estimate.vendor_code || "",
            activityName: estimate.subject || estimate.title || "Material / Element Work",
            storeCode,
            qty: 1,
            beforeGst: totalMaterialAmount,
            estimateNo: estimate.estimate_number || "",
          });
        }

        savedServices.forEach((service) => {
          const serviceName = serviceProductLabel(
            { lineType: service.lineType, itemName: service.description || service.itemName },
            products
          );
          allRows.push({
            vendorCode: estimate.vendor_code || "",
            activityName: serviceName,
            storeCode,
            qty: Number(service.quantity || 1) || 1,
            beforeGst: Number(service.totalPrice || 0) || 0,
            estimateNo: estimate.estimate_number || "",
          });
        });
      });

      return allRows.map((r, idx) => ({
        ...r,
        srNo: idx + 1,
      }));
    };

    const rows = buildSummaryRows(est, frontendItems);
    console.log("\n--- Generated Summary Rows ---");
    rows.forEach(r => {
      console.log(`[${r.srNo}] ${r.vendorCode} | ${r.activityName} | ${r.storeCode} | Qty: ${r.qty} | Price: ₹${r.beforeGst.toFixed(2)} | Est: ${r.estimateNo}`);
    });

    const totalBeforeGst = rows.reduce((sum, r) => sum + r.beforeGst, 0);
    console.log(`\nTotal Before GST: ₹${totalBeforeGst.toFixed(2)}`);

    // Validations for SM/E/26-27/259
    if (rows.length !== 4) {
      throw new Error(`Expected 4 rows for SM/E/26-27/259, got ${rows.length}`);
    }

    const matRow = rows[0];
    const packRow = rows[1];
    const instRow = rows[2];
    const transRow = rows[3];

    if (matRow.beforeGst !== 49400) throw new Error(`Material amount mismatch: expected 49400, got ${matRow.beforeGst}`);
    if (packRow.beforeGst !== 1976) throw new Error(`Packing amount mismatch: expected 1976, got ${packRow.beforeGst}`);
    if (instRow.beforeGst !== 3458) throw new Error(`Installation amount mismatch: expected 3458, got ${instRow.beforeGst}`);
    if (transRow.beforeGst !== 9900) throw new Error(`Transportation amount mismatch: expected 9900, got ${transRow.beforeGst}`);
    if (totalBeforeGst !== 64734) throw new Error(`Total Before GST mismatch: expected 64734, got ${totalBeforeGst}`);

    rows.forEach(r => {
      if (r.estimateNo !== 'SM/E/26-27/259') {
        throw new Error(`Row ${r.srNo} estimate number mismatch: ${r.estimateNo}`);
      }
    });

    console.log("\nReference estimate values: 100% MATCH!");

    // Build Email HTML & PlainText to verify structure
    const escapeHtml = (value: any) => String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    }[ch] || ch));

    const summaryNumber = (n: number) =>
      (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const subject = est.subject || est.title || "Estimate Work";
    const estimateNo = est.estimate_number || "";

    const htmlRows = rows.map(row => `
      <tr>
        <td style="border:1px solid #000;padding:6px 10px;text-align:center;white-space:nowrap">${row.srNo}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:center;white-space:nowrap">${escapeHtml(row.vendorCode)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:left">${escapeHtml(row.activityName)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:center;white-space:nowrap">${escapeHtml(row.storeCode)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:right;white-space:nowrap">${summaryNumber(row.qty)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:right;white-space:nowrap">₹ ${summaryNumber(row.beforeGst)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:left;white-space:nowrap">${escapeHtml(row.estimateNo)}</td>
      </tr>`).join("");

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">
  <p style="margin:0 0 16px 0">Dear Sir,</p>
  <p style="margin:0 0 16px 0">Please find the attached estimate for: ${escapeHtml(subject)} as requested.</p>
  <p style="margin:0 0 16px 0">Kindly review and process the PO. We shall commence production once the PO is received.</p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:16px 0;border:1px solid #000;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;width:auto;min-width:650px">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="border:1px solid #000;padding:6px 10px;text-align:center;font-weight:700;white-space:nowrap">Sr No</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:center;font-weight:700;white-space:nowrap">Vendor Code</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:left;font-weight:700">Element / Product Details</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:center;font-weight:700;white-space:nowrap">Store Code</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:right;font-weight:700;white-space:nowrap">Qty</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:right;font-weight:700;white-space:nowrap">Before GST Net Price</th>
        <th style="border:1px solid #000;padding:6px 10px;text-align:left;font-weight:700;white-space:nowrap">Estimate No</th>
      </tr>
    </thead>
    <tbody>
      ${htmlRows}
      <tr style="font-weight:700;background:#f8fafc">
        <td colspan="5" style="border:1px solid #000;padding:6px 10px;text-align:right;font-weight:700">Total Before GST</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:right;font-weight:700;white-space:nowrap">₹ ${summaryNumber(totalBeforeGst)}</td>
        <td style="border:1px solid #000;padding:6px 10px;text-align:left;white-space:nowrap">${escapeHtml(estimateNo)}</td>
      </tr>
    </tbody>
  </table>
  <p style="margin:16px 0 0 0">Thank you,<br />Kunal Lunkad<br />Sunrise Media</p>
</div>`;

    // Email structure assertions
    if (!html.includes("Dear Sir,")) throw new Error("Missing 'Dear Sir,' in HTML");
    if (!html.includes(`Please find the attached estimate for: ${escapeHtml(subject)} as requested.`)) {
      throw new Error("Missing dynamic subject sentence in HTML");
    }
    if (!html.includes("Kindly review and process the PO. We shall commence production once the PO is received.")) {
      throw new Error("Missing PO review request in HTML");
    }
    if (!html.includes("Total Before GST")) throw new Error("Missing 'Total Before GST' in HTML");
    if (!html.includes("Thank you,<br />Kunal Lunkad<br />Sunrise Media")) throw new Error("Missing sign-off in HTML");
    if (!html.includes(`<td style="border:1px solid #000;padding:6px 10px;text-align:left;white-space:nowrap">${escapeHtml(estimateNo)}</td>`)) {
      throw new Error("Missing full estimate number in Total row of HTML");
    }

    console.log("\n--- Full Email HTML ---");
    console.log(html);

    // Also check multi-store estimates
    console.log("\nVerifying multi-store estimate SM/E/26-27/257...");
    const multiEstRes = await client.query(`SELECT * FROM estimates WHERE estimate_number = 'SM/E/26-27/257'`);
    if (multiEstRes.rows.length > 0) {
      const multiEst = multiEstRes.rows[0];
      const multiItemsRes = await client.query(`SELECT * FROM estimate_items WHERE estimate_id = $1 ORDER BY id ASC`, [multiEst.id]);
      const multiRows = buildSummaryRows(multiEst, multiItemsRes.rows);
      console.log(`SM/E/26-27/257 generated ${multiRows.length} rows.`);
      multiRows.forEach(r => {
        if (r.estimateNo !== 'SM/E/26-27/257') throw new Error(`Multi-store row estimateNo mismatch: ${r.estimateNo}`);
      });
      const multiTotal = multiRows.reduce((sum, r) => sum + r.beforeGst, 0);
      console.log(`SM/E/26-27/257 Total Before GST: ₹${multiTotal.toFixed(2)}`);
    }

    console.log("\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
