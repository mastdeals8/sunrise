import pg from 'pg';

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
const SUPABASE_CONNECTION = process.env.DATABASE_URL;

const pool = new pg.Pool({
  connectionString: SUPABASE_CONNECTION,
  ssl: {
    rejectUnauthorized: false
  }
});

const queries = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    phone TEXT,
    employee_id TEXT UNIQUE,
    department TEXT,
    designation TEXT,
    joining_date TIMESTAMP,
    basic_salary REAL DEFAULT 0,
    allowances REAL DEFAULT 0,
    profile_photo_url TEXT,
    bank_account_number TEXT,
    ifsc_code TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) NOT NULL,
    date TIMESTAMP NOT NULL,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    working_hours REAL DEFAULT 0,
    overtime_hours REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'present',
    leave_type TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TIMESTAMP,
    start_date TIMESTAMP,
    completed_date TIMESTAMP,
    tags TEXT[],
    assigned_to INTEGER REFERENCES users(id),
    assigned_by INTEGER REFERENCES users(id) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS petty_cash_expenses (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    vendor TEXT,
    description TEXT,
    paid_by INTEGER REFERENCES users(id),
    receipt_image_url TEXT,
    extracted_data JSONB,
    expense_date TIMESTAMP NOT NULL,
    added_by INTEGER REFERENCES users(id) NOT NULL,
    approved_by INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS uploads (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    category TEXT DEFAULT 'general',
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    normal_balance TEXT NOT NULL DEFAULT 'debit',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_header BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    date TIMESTAMP NOT NULL,
    due_date TIMESTAMP NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS journal_entries (
    id SERIAL PRIMARY KEY,
    entry_number TEXT NOT NULL UNIQUE,
    entry_date TIMESTAMP NOT NULL,
    source_module TEXT,
    reference_number TEXT,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id SERIAL PRIMARY KEY,
    journal_entry_id INTEGER REFERENCES journal_entries(id) NOT NULL,
    account_id INTEGER REFERENCES chart_of_accounts(id) NOT NULL,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    description TEXT,
    line_number INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    voucher_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    date TIMESTAMP NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    description TEXT,
    invoice_id INTEGER REFERENCES invoices(id),
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );`
];

async function run() {
  console.log("🔄 Starting direct PostgreSQL schema push...");
  const client = await pool.connect();
  try {
    for (let i = 0; i < queries.length; i++) {
      console.log(`Executing query ${i + 1}/${queries.length}...`);
      await client.query(queries[i]);
    }
    console.log("✅ All tables created/verified successfully in Supabase!");
  } catch (err) {
    console.error("❌ SQL execution error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
