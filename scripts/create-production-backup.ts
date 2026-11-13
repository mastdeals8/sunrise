/**
 * Production Database Backup Script
 * Connects directly to production Supabase database via pool
 * Snapshots all public tables and rows into a structured backup JSON.
 */

import { pool } from "../server/db";
import * as fs from "fs";
import * as path from "path";

async function backupDatabase() {
  console.log("=================================================================");
  console.log("PRODUCTION DATABASE BACKUP — PRE-MIGRATION SNAPSHOT");
  console.log("=================================================================\n");

  const client = await pool.connect();
  try {
    // 1. Get all public table names
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tableNames: string[] = tablesRes.rows.map((r: any) => r.table_name);
    console.log(`Found ${tableNames.length} tables in public schema.`);

    const backupData: {
      timestamp: string;
      project: string;
      database: string;
      totalTables: number;
      totalRows: number;
      tables: Record<string, { rowCount: number; rows: any[] }>;
    } = {
      timestamp: new Date().toISOString(),
      project: "kbnjiidfpqnklaljtuoj",
      database: "postgres",
      totalTables: tableNames.length,
      totalRows: 0,
      tables: {},
    };

    let totalRowCount = 0;

    for (const tableName of tableNames) {
      const rowsRes = await client.query(`SELECT * FROM "${tableName}"`);
      const rowCount = rowsRes.rows.length;
      totalRowCount += rowCount;
      backupData.tables[tableName] = {
        rowCount,
        rows: rowsRes.rows,
      };
      console.log(`  ✓ Backed up "${tableName}": ${rowCount} rows`);
    }

    backupData.totalRows = totalRowCount;

    const backupDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const filename = `production_backup_kbnjiidfpqnklaljtuoj_${Date.now()}.json`;
    const fullPath = path.join(backupDir, filename);

    fs.writeFileSync(fullPath, JSON.stringify(backupData, null, 2), "utf8");
    const stats = fs.statSync(fullPath);

    console.log("\n=================================================================");
    console.log(`BACKUP COMPLETED SUCCESSFULLY!`);
    console.log(`File: ${fullPath}`);
    console.log(`Size: ${(stats.size / 1024).toFixed(2)} KB (${totalRowCount} total rows)`);
    console.log("=================================================================");
  } finally {
    client.release();
  }
}

backupDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
