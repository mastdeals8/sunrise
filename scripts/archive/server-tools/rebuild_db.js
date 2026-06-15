import pg from 'pg';
import bcrypt from 'bcryptjs';
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

const dropQueries = [
  "DROP TABLE IF EXISTS payroll CASCADE;",
  "DROP TABLE IF EXISTS staff_advances CASCADE;",
  "DROP TABLE IF EXISTS delivery_challans CASCADE;",
  "DROP TABLE IF EXISTS estimate_items CASCADE;",
  "DROP TABLE IF EXISTS estimates CASCADE;",
  "DROP TABLE IF EXISTS products CASCADE;",
  "DROP TABLE IF EXISTS stores CASCADE;",
  "DROP TABLE IF EXISTS brands CASCADE;",
  "DROP TABLE IF EXISTS clients CASCADE;",
  "DROP TABLE IF EXISTS payments CASCADE;",
  "DROP TABLE IF EXISTS journal_entry_lines CASCADE;",
  "DROP TABLE IF EXISTS journal_entries CASCADE;",
  "DROP TABLE IF EXISTS invoices CASCADE;",
  "DROP TABLE IF EXISTS chart_of_accounts CASCADE;",
  "DROP TABLE IF EXISTS uploads CASCADE;",
  "DROP TABLE IF EXISTS tasks CASCADE;",
  "DROP TABLE IF EXISTS petty_cash_expenses CASCADE;",
  "DROP TABLE IF EXISTS attendance CASCADE;",
  "DROP TABLE IF EXISTS users CASCADE;"
];

const createQueries = [
  // 1. Users/Staff
  `CREATE TABLE users (
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
    joining_date TIMESTAMP DEFAULT NOW(),
    basic_salary REAL DEFAULT 0,
    allowances REAL DEFAULT 0,
    profile_photo_url TEXT,
    bank_account_number TEXT,
    ifsc_code TEXT,
    address TEXT,
    daily_wage REAL DEFAULT 0,
    advance_balance REAL DEFAULT 0,
    emergency_contact TEXT,
    emergency_contact_phone TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 2. Attendance
  `CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    date TIMESTAMP NOT NULL,
    check_in_time TIMESTAMP,
    check_out_time TIMESTAMP,
    working_hours REAL DEFAULT 0,
    overtime_hours REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'present',
    leave_type TEXT,
    notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );`,

  // 3. Petty Cash
  `CREATE TABLE petty_cash_expenses (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    vendor TEXT,
    description TEXT,
    paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    receipt_image_url TEXT,
    extracted_data JSONB,
    expense_date TIMESTAMP NOT NULL DEFAULT NOW(),
    added_by INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 4. Uploads metadata
  `CREATE TABLE uploads (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    category TEXT DEFAULT 'general',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 5. Tasks
  `CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TIMESTAMP,
    start_date TIMESTAMP,
    completed_date TIMESTAMP,
    tags TEXT[],
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_by INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );`,

  // 6. Chart of Accounts
  `CREATE TABLE chart_of_accounts (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    normal_balance TEXT NOT NULL DEFAULT 'debit',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_header BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 7. Invoices
  `CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    due_date TIMESTAMP NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 8. Journal Entries
  `CREATE TABLE journal_entries (
    id SERIAL PRIMARY KEY,
    entry_number TEXT NOT NULL UNIQUE,
    entry_date TIMESTAMP NOT NULL DEFAULT NOW(),
    source_module TEXT,
    reference_number TEXT,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 9. Journal Entry Lines
  `CREATE TABLE journal_entry_lines (
    id SERIAL PRIMARY KEY,
    journal_entry_id INTEGER REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
    account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE CASCADE NOT NULL,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    description TEXT,
    line_number INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 10. Payments
  `CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    voucher_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    party_name TEXT NOT NULL,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    description TEXT,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 11. Clients (Sunrise Custom)
  `CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT,
    mobile TEXT,
    city TEXT,
    address TEXT,
    gst_number TEXT,
    format TEXT NOT NULL DEFAULT 'normal',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 12. Brands (Sunrise Custom)
  `CREATE TABLE brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    parent_brand TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 13. Stores/Sites (Sunrise Custom)
  `CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    location TEXT,
    address TEXT,
    contact_person TEXT,
    contact_phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 14. Products/Rates (Sunrise Custom)
  `CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    unit TEXT NOT NULL DEFAULT 'pcs',
    rate REAL NOT NULL DEFAULT 0,
    description TEXT,
    hsn_sac TEXT,
    is_standard BOOLEAN NOT NULL DEFAULT true,
    calculation_type TEXT NOT NULL DEFAULT 'fixed',
    gst_percent REAL NOT NULL DEFAULT 18,
    default_specification TEXT,
    warranty TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 15. Estimates (Sunrise Custom)
  `CREATE TABLE estimates (
    id SERIAL PRIMARY KEY,
    estimate_number TEXT NOT NULL UNIQUE,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
    store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    client_format TEXT NOT NULL DEFAULT 'normal',
    subject TEXT,
    billing_to TEXT,
    shipping_to TEXT,
    gstin TEXT,
    pan TEXT,
    state_code TEXT,
    vendor_code TEXT,
    gst_type TEXT NOT NULL DEFAULT 'CGST+SGST',
    packing_percent REAL DEFAULT 0,
    implementation_percent REAL DEFAULT 0,
    transport_amount REAL DEFAULT 0,
    store_grouping JSONB,
    po_number TEXT,
    po_date TIMESTAMP,
    po_amount REAL,
    po_file_path TEXT,
    po_remarks TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 16. Estimate Items (Sunrise Custom)
  `CREATE TABLE estimate_items (
    id SERIAL PRIMARY KEY,
    estimate_id INTEGER REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    description TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'pcs',
    rate REAL NOT NULL DEFAULT 0,
    total_price REAL NOT NULL DEFAULT 0,
    sl INTEGER,
    is_standard BOOLEAN DEFAULT true,
    hsn TEXT,
    width REAL,
    height REAL,
    total_size REAL,
    cgst_percent REAL DEFAULT 9,
    cgst_amount REAL DEFAULT 0,
    sgst_percent REAL DEFAULT 9,
    sgst_amount REAL DEFAULT 0,
    igst_percent REAL DEFAULT 0,
    igst_amount REAL DEFAULT 0,
    total_amount REAL DEFAULT 0
  );`,

  // 17. Delivery Challans (Sunrise Custom)
  `CREATE TABLE delivery_challans (
    id SERIAL PRIMARY KEY,
    dc_number TEXT NOT NULL UNIQUE,
    estimate_id INTEGER REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
    delivery_date TIMESTAMP DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'draft',
    items JSONB,
    delivered_by TEXT,
    received_by TEXT,
    remarks TEXT,
    signed_challan_path TEXT,
    photo_path TEXT,
    transport_receipt_path TEXT,
    extra_doc_path TEXT,
    client_format TEXT NOT NULL DEFAULT 'normal',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 18. Staff Advances
  `CREATE TABLE staff_advances (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    amount REAL NOT NULL,
    date TIMESTAMP NOT NULL DEFAULT NOW(),
    payment_mode TEXT NOT NULL DEFAULT 'cash',
    reason TEXT,
    proof_url TEXT,
    is_adjusted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  );`,

  // 19. Payroll
  `CREATE TABLE payroll (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    basic_salary REAL NOT NULL DEFAULT 0,
    daily_wage REAL DEFAULT 0,
    present_days REAL NOT NULL DEFAULT 0,
    half_days REAL NOT NULL DEFAULT 0,
    absent_days REAL NOT NULL DEFAULT 0,
    overtime_pay REAL DEFAULT 0,
    advances_paid REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    net_salary REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );`
];

async function rebuild() {
  console.log("🔥 Starting Clean Database Rebuild...");
  const client = await pool.connect();
  try {
    // Drop old tables
    console.log("🗑️ Safely dropping existing public tables...");
    for (const dropQ of dropQueries) {
      await client.query(dropQ);
    }
    console.log("✅ Dropped tables.");

    // Create new tables
    console.log("🏗️ Creating clean database schema tables...");
    for (const createQ of createQueries) {
      await client.query(createQ);
    }
    console.log("✅ Created clean tables.");

    // Seeding datasets
    console.log("🌱 Seeding high-fidelity basic ERP datasets...");
    
    // Hash passwords
    const adminPass = await bcrypt.hash("admin123", 10);
    const staffPass = await bcrypt.hash("staff123", 10);

    // 1. Seed Users
    const adminUserRes = await client.query(`
      INSERT INTO users (username, email, password, name, role, employee_id, department, designation, basic_salary)
      VALUES ('admin', 'admin@sunrisemedia.in', $1, 'Admin Director', 'admin', 'SUN-001', 'Management', 'Director', 120000)
      RETURNING id;
    `, [adminPass]);
    const adminId = adminUserRes.rows[0].id;

    const staffUserRes = await client.query(`
      INSERT INTO users (username, email, password, name, role, employee_id, department, designation, basic_salary)
      VALUES ('staff', 'staff@sunrisemedia.in', $1, 'Rohit Kumar', 'staff', 'SUN-002', 'Creative', 'Art Director & Editor', 45000)
      RETURNING id;
    `, [staffPass]);
    const staffId = staffUserRes.rows[0].id;

    // 2. Seed Client: Aditya Birla / ABFRL
    const clientRes = await client.query(`
      INSERT INTO clients (name, email, mobile, city, address, gst_number, format)
      VALUES ('Aditya Birla Fashion and Retail Ltd (ABFRL)', 'billing@abfrl.adityabirla.com', '9876543210', 'Mumbai', 'Piramal Agastya Corporate Park, Kurla, Mumbai', '27AAACA1234F1Z5', 'ABFRL')
      RETURNING id;
    `);
    const clientId = clientRes.rows[0].id;

    // 2b. Seed Client: Apollo (Normal Customer)
    const normalClientRes = await client.query(`
      INSERT INTO clients (name, email, mobile, city, address, gst_number, format)
      VALUES ('Apollo Clinics', 'accounts@apolloclinics.com', '9988776655', 'Bangalore', 'Richmond Road, Bangalore', '29AAACA5678D1Z9', 'normal')
      RETURNING id;
    `);
    const normalClientId = normalClientRes.rows[0].id;

    // 3. Seed Brands
    const brands = ['Peter England', 'Louis Philippe', 'Allen Solly', 'Pantaloons', 'Van Heusen'];
    const brandIds = [];
    for (const name of brands) {
      const bRes = await client.query(`
        INSERT INTO brands (name, parent_brand)
        VALUES ($1, 'ABFRL')
        RETURNING id;
      `, [name]);
      brandIds.push(bRes.rows[0].id);
    }

    // 3b. Seed Brand for Apollo
    const apolloBrandRes = await client.query(`
      INSERT INTO brands (name, parent_brand)
      VALUES ('Apollo Healthcare', 'Apollo')
      RETURNING id;
    `);
    const apolloBrandId = apolloBrandRes.rows[0].id;

    // 4. Seed Stores
    const stores = [
      { name: 'Peter England Select Citywalk', location: 'Delhi', address: 'Select Citywalk Mall, Saket, New Delhi' },
      { name: 'Allen Solly Connaught Place', location: 'Delhi', address: 'E-Block, Connaught Place, New Delhi' },
      { name: 'Pantaloons Ambience Mall', location: 'Gurugram', address: 'Ambience Mall, NH-8, Gurugram' }
    ];
    for (let i = 0; i < stores.length; i++) {
      const store = stores[i];
      const brandId = brandIds[i % brandIds.length];
      await client.query(`
        INSERT INTO stores (name, client_id, brand_id, location, address, contact_person, contact_phone)
        VALUES ($1, $2, $3, $4, $5, 'Store Manager', '9999988888')
      `, [store.name, clientId, brandId, store.location, store.address]);
    }

    // 4b. Seed Store for Apollo
    await client.query(`
      INSERT INTO stores (name, client_id, brand_id, location, address, contact_person, contact_phone)
      VALUES ('Apollo Clinic Richmond Road', $1, $2, 'Bangalore', ' Richmond Road, Bangalore', 'Dr. Suresh', '9888877777')
    `, [normalClientId, apolloBrandId]);

    // 5. Seed Products
    const products = [
      { name: 'ACP Signboard', category: 'Signage', unit: 'sqft', rate: 250, description: 'Aluminum Composite Panel Signboard structure', hsn_sac: '998712', is_standard: true, calculation_type: 'sqft', gst_percent: 18, default_specification: '3mm ACP with iron framing and vinyl print' },
      { name: 'Acrylic Letters', category: 'Letters', unit: 'inch', rate: 450, description: '3D Solid LED Acrylic Letters fabrication', hsn_sac: '998712', is_standard: true, calculation_type: 'running_inch', gst_percent: 18, default_specification: 'Solid LED acrylic letters 3-inch height' },
      { name: 'Channel Letters', category: 'Letters', unit: 'inch', rate: 600, description: 'Premium LED back-lit Channel Letters', hsn_sac: '998712', is_standard: true, calculation_type: 'running_inch', gst_percent: 18, default_specification: 'Premium led back-lit letters' },
      { name: 'Vinyl Printing', category: 'Printing', unit: 'sqft', rate: 45, description: 'High quality eco-solvent self-adhesive vinyl print', hsn_sac: '998713', is_standard: true, calculation_type: 'sqft', gst_percent: 18, default_specification: 'Star vinyl premium printing' },
      { name: 'Sunboard Printing', category: 'Printing', unit: 'sqft', rate: 85, description: 'Direct UV print on 5mm thick Sunboard', hsn_sac: '998713', is_standard: true, calculation_type: 'sqft', gst_percent: 18, default_specification: '5mm sunboard direct uv printing' },
      { name: 'Flex Printing', category: 'Printing', unit: 'sqft', rate: 25, description: 'Star media frontlit flex banner printing', hsn_sac: '998713', is_standard: true, calculation_type: 'sqft', gst_percent: 18, default_specification: 'Frontlit premium flex printing' },
      { name: 'Installation', category: 'Services', unit: 'nos', rate: 5000, description: 'On-site standard dual mounting installation fees', hsn_sac: '998715', is_standard: true, calculation_type: 'fixed', gst_percent: 18, default_specification: 'Standard site mounting installation' },
      { name: 'Packing Charges', category: 'Packaging', unit: 'percentage', rate: 2, description: 'Protective bubble wrapping packing cost', hsn_sac: '998716', is_standard: true, calculation_type: 'percentage', gst_percent: 18, default_specification: 'Standard packing charge' },
      { name: 'Transport', category: 'Logistics', unit: 'nos', rate: 6000, description: 'Tata Ace logistics delivery', hsn_sac: '998717', is_standard: true, calculation_type: 'fixed', gst_percent: 18, default_specification: 'Transit logistics' },
      { name: 'Electrical Work', category: 'Services', unit: 'nos', rate: 3500, description: 'Electrical wire bindings adapters work', hsn_sac: '998718', is_standard: true, calculation_type: 'fixed', gst_percent: 18, default_specification: 'Site cabling adapters work' }
    ];
    for (const prod of products) {
      await client.query(`
        INSERT INTO products (name, category, unit, rate, description, hsn_sac, is_standard, calculation_type, gst_percent, default_specification)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [prod.name, prod.category, prod.unit, prod.rate, prod.description, prod.hsn_sac, prod.is_standard, prod.calculation_type, prod.gst_percent, prod.default_specification]);
    }

    // 6. Seed Chart of Accounts
    const defaultAccounts = [
      { code: "111000", name: "Cash on Hand", type: "asset", balance: "debit" },
      { code: "112000", name: "Bank Balance (HDFC)", type: "asset", balance: "debit" },
      { code: "120000", name: "Accounts Receivable", type: "asset", balance: "debit" },
      { code: "210000", name: "Accounts Payable", type: "liability", balance: "credit" },
      { code: "310000", name: "Owner's Equity", type: "equity", balance: "credit" },
      { code: "410000", name: "Sales Revenue", type: "revenue", balance: "credit" },
      { code: "510000", name: "Cost of Goods Sold (COGS)", type: "expense", balance: "debit" },
      { code: "520000", name: "Salary Expense", type: "expense", balance: "debit" },
      { code: "530000", name: "Office & Transport Expense", type: "expense", balance: "debit" }
    ];
    for (const acc of defaultAccounts) {
      await client.query(`
        INSERT INTO chart_of_accounts (code, name, account_type, normal_balance)
        VALUES ($1, $2, $3, $4)
      `, [acc.code, acc.name, acc.type, acc.balance]);
    }

    console.log("🌱 Seeding finished successfully!");
    console.log("✅ Rebuild COMPLETE! All Sunrise Media ERP tables ready.");
  } catch (err) {
    console.error("❌ Rebuild failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

rebuild();
