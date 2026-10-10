const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL.replace(/(\?|&)sslmode=[^&]*/, ''),
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const file = process.argv[2];
  if (!file) {
    console.error("Please supply a sql file path");
    process.exit(1);
  }
  const fullPath = path.resolve(file);
  console.log(`Running migration from ${fullPath}...`);
  const sql = fs.readFileSync(fullPath, 'utf8');

  try {
    await pool.query(sql);
    console.log(`Successfully applied ${path.basename(file)}!`);

    // Quick verification tests
    const testC1 = await pool.query("SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 1) as doc");
    console.log("Verified next invoice Company 1 (Sunrise Media):", testC1.rows[0].doc);

    const testC2 = await pool.query("SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 2) as doc");
    console.log("Verified next invoice Company 2 (Delhi Company):", testC2.rows[0].doc);

    const testC3 = await pool.query("SELECT public.next_sunrise_document_number('invoice', CURRENT_DATE, 3) as doc");
    console.log("Verified next invoice Company 3 (Rika Store):", testC3.rows[0].doc);

    const testEst1 = await pool.query("SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 1) as doc");
    console.log("Verified next estimate Company 1 (Sunrise Media):", testEst1.rows[0].doc);

    const testEst2 = await pool.query("SELECT public.next_sunrise_document_number('estimate', CURRENT_DATE, 2) as doc");
    console.log("Verified next estimate Company 2 (Delhi Company):", testEst2.rows[0].doc);

    pool.end();
  } catch (err) {
    console.error("Error applying migration:", err);
    pool.end();
    process.exit(1);
  }
}

run();
