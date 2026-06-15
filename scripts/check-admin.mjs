import pg from "pg";
import "dotenv/config";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.split("?")[0], ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT id, username, role, email FROM users ORDER BY id");
console.log("Users currently in DB:");
for (const u of r.rows) console.log(" ", u);
await pool.end();
