import pg from 'pg';
import fs from 'fs';
import path from 'path';
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

// Strip query parameters
const cleanUrl = process.env.DATABASE_URL.split("?")[0];

const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

const tables = [
  "attendance", "brands", "clients", "delivery_challans", "estimate_items", 
  "estimates", "invoice_packet_pages", "invoices", "material_codes", "payments", 
  "petty_cash_expenses", "products", "project_files", "projects", "purchase_orders", 
  "stores", "tasks", "users"
];

async function backup() {
  console.log("💾 Running safety database backup...");
  const client = await pool.connect();
  const backupData = {
    backupDate: new Date().toISOString(),
    tables: {}
  };

  try {
    for (const table of tables) {
      console.log(`Backing up table: "${table}"...`);
      // Fetch table records
      const recordsRes = await client.query(`SELECT * FROM "${table}";`);
      backupData.tables[table] = {
        rowCount: recordsRes.rowCount,
        rows: recordsRes.rows
      };
    }

    // Ensure backups folder exists
    const backupsDir = path.resolve(import.meta.dirname, "..", "backups");
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    const backupFilePath = path.join(backupsDir, `db_backup_${Date.now()}.json`);
    fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), "utf-8");
    console.log(`✅ Safety database backup saved successfully to: ${backupFilePath}`);
  } catch (err) {
    console.error("❌ Backup failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

backup();
