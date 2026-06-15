import pg from 'pg';
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

// Strip query parameters that cause conflicts with ssl options
const cleanUrl = process.env.DATABASE_URL.split("?")[0];

const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function inspect() {
  console.log("🔍 Auditing Supabase public schema...");
  const client = await pool.connect();
  try {
    // 1. List all tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} tables in public schema:`);
    
    for (const table of tables) {
      // Get record count
      const countRes = await client.query(`SELECT COUNT(*) as count FROM "${table}";`);
      const count = countRes.rows[0].count;
      
      // Determine origin
      let origin = "unknown";
      if (["users", "attendance", "petty_cash_expenses", "tasks", "uploads", "chart_of_accounts", "invoices", "journal_entries", "journal_entry_lines", "payments"].includes(table)) {
        origin = "Current Sunrise Media ERP (boilerplate)";
      } else if (["clients", "products", "categories", "material_requests", "request_items", "quotes", "quote_items", "bom_calculations", "bom_items", "bom_settings", "bot_settings", "work_orders", "production_schedules", "quality_checks", "production_tasks"].includes(table)) {
        origin = "Old Codex/Furnili attempt";
      } else if (["crm_customers", "crm_leads", "crm_deals", "crm_followups", "crm_activities", "crm_quotations", "crm_site_visits", "brands", "supplier_brands", "supplier_products", "audit_logs", "project_logs", "project_files", "project_tasks", "moodboards"].includes(table)) {
        origin = "Old CRM/Anzen/Furnili mix attempts";
      }
      
      console.log(`- 📋 Table: "${table}" | Record Count: ${count} | Origin: ${origin}`);
    }
  } catch (err) {
    console.error("❌ Audit failed:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

inspect();
