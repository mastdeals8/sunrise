// Seed the four system service products into Product Master under category
// "Services". Idempotent — INSERT … WHERE NOT EXISTS so re-running is a no-op.
// No schema change required; the products table already supports `category`
// (text) and `calculationType` (text).
//
// Rows seeded here are recognised as SYSTEM services by
// `shared/systemServices.ts` (matched by name + category). System services are:
//   - editable    (rate / HSN / GST% / calc type / description)
//   - disable-able (isActive → false)
//   - not deletable (the DELETE /products/:id route blocks them with HTTP 409)
//
// Reversal: DELETE FROM products WHERE category = 'Services' AND name IN
//   ('Packing Charges','Installation Charges','Local Transportation','Outstation Charges');
//
// Usage: node scripts/migrate-seed-services.mjs

import { Pool } from "pg";
import "dotenv/config";

const SERVICES = [
  {
    name: "Packing Charges",
    description: "Packing Charges",
    hsnSac: "996511",
    materialCode: "OT_PACKING000N",
    unit: "job",
    calculationType: "percentage",
    rate: 4,
    gstPercent: 18,
    isStandard: true,
    isActive: true,
  },
  {
    name: "Installation Charges",
    description: "Installation Charges",
    hsnSac: "995415",
    materialCode: "OT_INSTALLATION00N",
    unit: "job",
    calculationType: "percentage",
    rate: 7,
    gstPercent: 18,
    isStandard: true,
    isActive: true,
  },
  {
    name: "Local Transportation",
    description: "Local Transportation",
    hsnSac: "996511",
    materialCode: "OT_TRANSPORT001N",
    unit: "job",
    calculationType: "fixed",
    rate: 1000,
    gstPercent: 18,
    isStandard: true,
    isActive: true,
  },
  {
    name: "Outstation Charges",
    description: "Outstation Charges (Per KM)",
    hsnSac: "996511",
    materialCode: "OT_TRANSPORT001N",
    unit: "km",
    calculationType: "per_km",
    rate: 18,
    gstPercent: 18,
    isStandard: true,
    isActive: true,
  },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const seedOne = async (svc) => {
  const res = await pool.query(
    `INSERT INTO products
       (name, category, description, hsn_sac, material_code, unit,
        calculation_type, rate, gst_percent, is_standard, is_active)
     SELECT $1, 'Services', $2, $3, $4, $5, $6, $7, $8, $9, $10
     WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = $1)
     RETURNING id, name`,
    [
      svc.name, svc.description, svc.hsnSac, svc.materialCode, svc.unit,
      svc.calculationType, svc.rate, svc.gstPercent, svc.isStandard, svc.isActive,
    ],
  );
  if (res.rowCount === 0) {
    console.log(`SKIP  ${svc.name} (already exists)`);
  } else {
    console.log(`ADDED ${svc.name}  (id=${res.rows[0].id})`);
  }
};

const main = async () => {
  await pool.query("BEGIN");
  try {
    for (const svc of SERVICES) await seedOne(svc);
    await pool.query("COMMIT");
    console.log("Done.");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("ROLLBACK due to error:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
