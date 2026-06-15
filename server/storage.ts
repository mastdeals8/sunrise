import { db } from './db';
import {
  users,
  attendance,
  tasks,
  pettyCashExpenses,
  uploads,
  chartOfAccounts,
  invoices,
  journalEntries,
  journalEntryLines,
  payments,
  clients,
  brands,
  stores,
  products,
  estimates,
  estimateItems,
  deliveryChallans,
  staffAdvances,
  payroll,
  clientBillingProfiles,
  materialCodes,
  appSettings,
} from "../shared/schema";
import { eq, and, or, isNull, gte, lte, desc, sql } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import type {
  User, InsertUser,
  Attendance, InsertAttendance,
  Task, InsertTask,
  PettyCashExpense, InsertPettyCashExpense,
  Upload, InsertUpload,
  ChartOfAccount, InsertChartOfAccount,
  Invoice, InsertInvoice,
  JournalEntry, InsertJournalEntry,
  JournalEntryLine, InsertJournalEntryLine,
  Payment, InsertPayment,
  Client, InsertClient,
  Brand, InsertBrand,
  Store, InsertStore,
  Product, InsertProduct,
  Estimate, InsertEstimate,
  EstimateItem, InsertEstimateItem,
  DeliveryChallan, InsertDeliveryChallan,
  StaffAdvance, InsertStaffAdvance,
  Payroll, InsertPayroll,
  ClientBillingProfile, InsertClientBillingProfile
} from "../shared/schema";

export interface IStorage {
  // Users / Staff
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;

  // Attendance
  getAttendance(userId: number, dateStr: string): Promise<Attendance | undefined>;
  getAttendanceByUser(userId: number): Promise<Attendance[]>;
  getAllAttendance(dateStr?: string): Promise<Attendance[]>;
  createAttendance(att: InsertAttendance): Promise<Attendance>;
  updateAttendance(id: number, updates: Partial<InsertAttendance>): Promise<Attendance | undefined>;

  // Tasks
  getTask(id: number): Promise<Task | undefined>;
  getAllTasks(filters?: { assignedTo?: number; status?: string }): Promise<Task[]>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: number): Promise<boolean>;

  // Petty Cash
  getPettyCashExpense(id: number): Promise<PettyCashExpense | undefined>;
  getAllPettyCashExpenses(filters?: { category?: string; status?: string }): Promise<PettyCashExpense[]>;
  createPettyCashExpense(expense: InsertPettyCashExpense): Promise<PettyCashExpense>;
  updatePettyCashExpense(id: number, updates: Partial<InsertPettyCashExpense>): Promise<PettyCashExpense | undefined>;
  deletePettyCashExpense(id: number): Promise<boolean>;

  // Uploads
  createUpload(file: InsertUpload): Promise<Upload>;
  getUpload(id: number): Promise<Upload | undefined>;
  getAllUploads(): Promise<Upload[]>;

  // Chart of Accounts
  getAccount(id: number): Promise<ChartOfAccount | undefined>;
  getAccountByCode(code: string): Promise<ChartOfAccount | undefined>;
  getAllAccounts(): Promise<ChartOfAccount[]>;
  createAccount(account: InsertChartOfAccount): Promise<ChartOfAccount>;
  seedChartOfAccounts(): Promise<void>;

  // Invoices
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined>;
  getAllInvoices(filters?: { type?: string; status?: string }): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, updates: Partial<InsertInvoice>): Promise<Invoice | undefined>;

  // Ledger / Journal Entries
  getJournalEntry(id: number): Promise<JournalEntry | undefined>;
  getAllJournalEntries(): Promise<JournalEntry[]>;
  getJournalLines(entryId: number): Promise<JournalEntryLine[]>;
  getLedgerLines(accountId: number): Promise<any[]>;
  createJournalEntry(entry: InsertJournalEntry, lines: InsertJournalEntryLine[]): Promise<JournalEntry>;

  // Payments
  getPayment(id: number): Promise<Payment | undefined>;
  getAllPayments(filters?: { type?: string }): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  createPaymentWithAllocations(payment: InsertPayment, allocations: any[]): Promise<Payment>;

  // Clients
  getAllClients(): Promise<Client[]>;
  createClient(client: InsertClient): Promise<Client>;
  
  // Client Billing Profiles
  getAllBillingProfiles(): Promise<ClientBillingProfile[]>;
  getClientBillingProfiles(clientId: number): Promise<ClientBillingProfile[]>;
  getBillingProfile(id: number): Promise<ClientBillingProfile | undefined>;
  createBillingProfile(profile: InsertClientBillingProfile): Promise<ClientBillingProfile>;
  updateBillingProfile(id: number, updates: Partial<InsertClientBillingProfile>): Promise<ClientBillingProfile | undefined>;
  deleteBillingProfile(id: number): Promise<boolean>;
  
  // Brands
  getAllBrands(clientId?: number): Promise<Brand[]>;
  createBrand(brand: InsertBrand): Promise<Brand>;

  // Stores
  getAllStores(clientId?: number, brandId?: number): Promise<Store[]>;
  createStore(store: InsertStore): Promise<Store>;

  // Products
  getAllProducts(): Promise<Product[]>;
  createProduct(product: InsertProduct): Promise<Product>;

  // Estimates
  getAllEstimates(): Promise<Estimate[]>;
  getEstimate(id: number): Promise<Estimate | undefined>;
  createEstimate(estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<Estimate>;
  getEstimateItems(estimateId: number): Promise<EstimateItem[]>;
  updateEstimate(id: number, updates: Partial<InsertEstimate>): Promise<Estimate | undefined>;

  // Delivery Challans
  getAllDeliveryChallans(): Promise<DeliveryChallan[]>;
  getDeliveryChallan(id: number): Promise<DeliveryChallan | undefined>;
  getDeliveryChallansByEstimate(estimateId: number): Promise<DeliveryChallan[]>;
  createDeliveryChallan(dc: InsertDeliveryChallan): Promise<DeliveryChallan>;
  updateDeliveryChallan(id: number, updates: Partial<InsertDeliveryChallan>): Promise<DeliveryChallan | undefined>;

  // Staff Advances
  getAllAdvances(): Promise<StaffAdvance[]>;
  getAdvancesByUser(userId: number): Promise<StaffAdvance[]>;
  createAdvance(advance: InsertStaffAdvance): Promise<StaffAdvance>;

  // Payroll
  getPayrollByMonthYear(month: number, year: number): Promise<Payroll[]>;
  createPayroll(pay: InsertPayroll): Promise<Payroll>;
  updatePayroll(id: number, updates: Partial<InsertPayroll>): Promise<Payroll | undefined>;
}

/**
 * Final hardening: strip sensitive fields from any user object before it
 * leaves the API. Used by client-facing user responses. Auth flows use the
 * raw record internally (password hash needed for comparePassword) and never
 * pass through here.
 */
export const SENSITIVE_USER_FIELDS = ["password", "passwordHash", "resetToken", "refreshToken"] as const;
export function sanitizeUser<T extends Record<string, any>>(user: T): Omit<T, "password"> {
  if (!user) return user;
  const clean: any = { ...user };
  for (const f of SENSITIVE_USER_FIELDS) delete clean[f];
  return clean;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.seedChartOfAccounts();
  }

  // ==========================================
  // Users / Staff
  // ==========================================
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    if (!user.employeeId) {
      const lastUser = await db.select({ id: users.id }).from(users).orderBy(desc(users.id)).limit(1);
      const nextId = lastUser[0] ? lastUser[0].id + 1 : 1;
      user.employeeId = `SUN-${nextId.toString().padStart(3, '0')}`;
    }
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    const result = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    const rows = await db.select().from(users).where(eq(users.isActive, true));
    // SECURITY (final hardening): never return password hashes to clients.
    return rows.map(sanitizeUser) as User[];
  }

  async deleteUser(id: number): Promise<boolean> {
    await db.update(users).set({ isActive: false }).where(eq(users.id, id));
    return true;
  }

  // ==========================================
  // Attendance
  // ==========================================
  async getAttendance(userId: number, dateStr: string): Promise<Attendance | undefined> {
    const startOfDay = new Date(dateStr);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db.select().from(attendance)
      .where(and(
        eq(attendance.userId, userId),
        gte(attendance.date, startOfDay),
        lte(attendance.date, endOfDay)
      ))
      .limit(1);
    return result[0];
  }

  async getAttendanceByUser(userId: number): Promise<Attendance[]> {
    return db.select().from(attendance).where(eq(attendance.userId, userId)).orderBy(desc(attendance.date));
  }

  async getAllAttendance(dateStr?: string): Promise<Attendance[]> {
    if (dateStr) {
      const startOfDay = new Date(dateStr);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateStr);
      endOfDay.setHours(23, 59, 59, 999);

      return db.select().from(attendance)
        .where(and(
          gte(attendance.date, startOfDay),
          lte(attendance.date, endOfDay)
        ))
        .orderBy(desc(attendance.date));
    }
    return db.select().from(attendance).orderBy(desc(attendance.date));
  }

  async createAttendance(att: InsertAttendance): Promise<Attendance> {
    const result = await db.insert(attendance).values(att).returning();
    return result[0];
  }

  async updateAttendance(id: number, updates: Partial<InsertAttendance>): Promise<Attendance | undefined> {
    const result = await db.update(attendance).set(updates).where(eq(attendance.id, id)).returning();
    return result[0];
  }

  // ==========================================
  // Tasks
  // ==========================================
  async getTask(id: number): Promise<Task | undefined> {
    const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return result[0];
  }

  async getAllTasks(filters?: { assignedTo?: number; status?: string }): Promise<Task[]> {
    let query = db.select().from(tasks);
    
    if (filters?.assignedTo && filters?.status) {
      return query.where(and(eq(tasks.assignedTo, filters.assignedTo), eq(tasks.status, filters.status))).orderBy(desc(tasks.createdAt));
    } else if (filters?.assignedTo) {
      return query.where(eq(tasks.assignedTo, filters.assignedTo)).orderBy(desc(tasks.createdAt));
    } else if (filters?.status) {
      return query.where(eq(tasks.status, filters.status)).orderBy(desc(tasks.createdAt));
    }
    return query.orderBy(desc(tasks.createdAt));
  }

  async createTask(task: InsertTask): Promise<Task> {
    const result = await db.insert(tasks).values(task).returning();
    return result[0];
  }

  async updateTask(id: number, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const result = await db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return result[0];
  }

  async deleteTask(id: number): Promise<boolean> {
    await db.delete(tasks).where(eq(tasks.id, id));
    return true;
  }

  // ==========================================
  // Petty Cash
  // ==========================================
  async getPettyCashExpense(id: number): Promise<PettyCashExpense | undefined> {
    const result = await db.select().from(pettyCashExpenses).where(eq(pettyCashExpenses.id, id)).limit(1);
    return result[0];
  }

  async getAllPettyCashExpenses(filters?: { category?: string; status?: string }): Promise<PettyCashExpense[]> {
    let query = db.select().from(pettyCashExpenses);
    
    if (filters?.category && filters?.status) {
      return query.where(and(eq(pettyCashExpenses.category, filters.category), eq(pettyCashExpenses.status, filters.status))).orderBy(desc(pettyCashExpenses.expenseDate));
    } else if (filters?.category) {
      return query.where(eq(pettyCashExpenses.category, filters.category)).orderBy(desc(pettyCashExpenses.expenseDate));
    } else if (filters?.status) {
      return query.where(eq(pettyCashExpenses.status, filters.status)).orderBy(desc(pettyCashExpenses.expenseDate));
    }
    return query.orderBy(desc(pettyCashExpenses.expenseDate));
  }

  async createPettyCashExpense(expense: InsertPettyCashExpense): Promise<PettyCashExpense> {
    const result = await db.insert(pettyCashExpenses).values(expense).returning();
    
    // Automatically generate General Ledger entries if approved
    if (expense.status === 'approved') {
      await this.generatePettyCashJournal(result[0]);
    }
    
    return result[0];
  }

  async updatePettyCashExpense(id: number, updates: Partial<InsertPettyCashExpense>): Promise<PettyCashExpense | undefined> {
    const result = await db.update(pettyCashExpenses).set(updates).where(eq(pettyCashExpenses.id, id)).returning();
    
    if (updates.status === 'approved' && result[0]) {
      await this.generatePettyCashJournal(result[0]);
    }
    
    return result[0];
  }

  async deletePettyCashExpense(id: number): Promise<boolean> {
    await db.delete(pettyCashExpenses).where(eq(pettyCashExpenses.id, id));
    return true;
  }

  private async generatePettyCashJournal(expense: PettyCashExpense) {
    // debit expense account, credit cash/bank account
    const debitAccount = await this.getAccountByCode("530000"); // Office & Transport Expense
    const creditAccount = await this.getAccountByCode("111000"); // Cash on Hand
    
    if (debitAccount && creditAccount) {
      const entryNumber = `JV-PC-${expense.id}-${Date.now().toString().slice(-4)}`;
      await this.createJournalEntry({
        entryNumber,
        entryDate: expense.expenseDate,
        sourceModule: "petty_cash",
        referenceNumber: `PC-${expense.id}`,
        description: `Petty Cash: ${expense.description || expense.category}`,
        createdBy: expense.addedBy
      }, [
        { journalEntryId: 0, accountId: debitAccount.id, debit: expense.amount, credit: 0, description: "Petty Cash Debit", lineNumber: 1 },
        { journalEntryId: 0, accountId: creditAccount.id, debit: 0, credit: expense.amount, description: "Petty Cash Credit", lineNumber: 2 }
      ]);
    }
  }

  // ==========================================
  // Uploads
  // ==========================================
  async createUpload(file: InsertUpload): Promise<Upload> {
    const result = await db.insert(uploads).values(file).returning();
    return result[0];
  }

  async getUpload(id: number): Promise<Upload | undefined> {
    const result = await db.select().from(uploads).where(eq(uploads.id, id)).limit(1);
    return result[0];
  }

  async getAllUploads(): Promise<Upload[]> {
    return db.select().from(uploads).orderBy(desc(uploads.createdAt));
  }

  // ==========================================
  // Chart of Accounts
  // ==========================================
  async getAccount(id: number): Promise<ChartOfAccount | undefined> {
    const result = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, id)).limit(1);
    return result[0];
  }

  async getAccountByCode(code: string): Promise<ChartOfAccount | undefined> {
    const result = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.code, code)).limit(1);
    return result[0];
  }

  async getAllAccounts(): Promise<ChartOfAccount[]> {
    return db.select().from(chartOfAccounts).orderBy(chartOfAccounts.code);
  }

  async createAccount(account: InsertChartOfAccount): Promise<ChartOfAccount> {
    const result = await db.insert(chartOfAccounts).values(account).returning();
    return result[0];
  }

  async seedChartOfAccounts(): Promise<void> {
    const existing = await db.select().from(chartOfAccounts).limit(1);
    if (existing.length > 0) return;

    const defaultAccounts: InsertChartOfAccount[] = [
      { code: "111000", name: "Cash on Hand", accountType: "asset", normalBalance: "debit", isHeader: false, isActive: true },
      { code: "112000", name: "Bank Balance (HDFC)", accountType: "asset", normalBalance: "debit", isHeader: false, isActive: true },
      { code: "120000", name: "Accounts Receivable", accountType: "asset", normalBalance: "debit", isHeader: false, isActive: true },
      { code: "210000", name: "Accounts Payable", accountType: "liability", normalBalance: "credit", isHeader: false, isActive: true },
      { code: "310000", name: "Owner's Equity", accountType: "equity", normalBalance: "credit", isHeader: false, isActive: true },
      { code: "410000", name: "Sales Revenue", accountType: "revenue", normalBalance: "credit", isHeader: false, isActive: true },
      { code: "510000", name: "Cost of Goods Sold (COGS)", accountType: "expense", normalBalance: "debit", isHeader: false, isActive: true },
      { code: "520000", name: "Salary Expense", accountType: "expense", normalBalance: "debit", isHeader: false, isActive: true },
      { code: "530000", name: "Office & Transport Expense", accountType: "expense", normalBalance: "debit", isHeader: false, isActive: true }
    ];

    for (const acc of defaultAccounts) {
      await db.insert(chartOfAccounts).values(acc);
    }
    console.log("✓ Seeded Chart of Accounts successfully");
  }

  // ==========================================
  // Invoices
  // ==========================================
  async getInvoice(id: number): Promise<Invoice | undefined> {
    const result = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return result[0];
  }

  async getInvoiceByNumber(invoiceNumber: string): Promise<Invoice | undefined> {
    const result = await db.select().from(invoices).where(eq(invoices.invoiceNumber, invoiceNumber)).limit(1);
    return result[0];
  }

  async getAllInvoices(filters?: { type?: string; status?: string }): Promise<Invoice[]> {
    let query = db.select().from(invoices);
    
    if (filters?.type && filters?.status) {
      return query.where(and(eq(invoices.type, filters.type), eq(invoices.status, filters.status))).orderBy(desc(invoices.date));
    } else if (filters?.type) {
      return query.where(eq(invoices.type, filters.type)).orderBy(desc(invoices.date));
    } else if (filters?.status) {
      return query.where(eq(invoices.status, filters.status)).orderBy(desc(invoices.date));
    }
    return query.orderBy(desc(invoices.date));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const payload = {
      ...invoice,
      paidAmount: invoice.paidAmount !== undefined && invoice.paidAmount !== null ? invoice.paidAmount : 0,
      balanceAmount: invoice.balanceAmount !== undefined && invoice.balanceAmount !== null ? invoice.balanceAmount : invoice.totalAmount
    };
    const result = await db.insert(invoices).values(payload as any).returning();
    const createdInvoice = result[0];

    // Generate Journal Entries for double-entry bookkeeping!
    await this.generateInvoiceJournal(createdInvoice);

    return createdInvoice;
  }

  async updateInvoice(id: number, updates: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const result = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
    return result[0];
  }

  private async generateInvoiceJournal(inv: Invoice) {
    if (inv.type === 'sales') {
      // Debit: Accounts Receivable (120000), Credit: Sales Revenue (410000)
      const arAccount = await this.getAccountByCode("120000");
      const revAccount = await this.getAccountByCode("410000");

      if (arAccount && revAccount) {
        const entryNumber = `JV-SL-${inv.id}-${Date.now().toString().slice(-4)}`;
        await this.createJournalEntry({
          entryNumber,
          entryDate: inv.date,
          sourceModule: "invoices",
          referenceNumber: inv.invoiceNumber,
          description: `Sales Invoice: ${inv.partyName}`,
          createdBy: 1 // default system/admin
        }, [
          { journalEntryId: 0, accountId: arAccount.id, debit: inv.totalAmount, credit: 0, description: "Receivable Debit", lineNumber: 1 },
          { journalEntryId: 0, accountId: revAccount.id, debit: 0, credit: inv.totalAmount, description: "Revenue Credit", lineNumber: 2 }
        ]);
      }
    } else {
      // Purchase invoice: Debit: COGS (510000), Credit: Accounts Payable (210000)
      const cogsAccount = await this.getAccountByCode("510000");
      const apAccount = await this.getAccountByCode("210000");

      if (cogsAccount && apAccount) {
        const entryNumber = `JV-PR-${inv.id}-${Date.now().toString().slice(-4)}`;
        await this.createJournalEntry({
          entryNumber,
          entryDate: inv.date,
          sourceModule: "invoices",
          referenceNumber: inv.invoiceNumber,
          description: `Purchase Invoice: ${inv.partyName}`,
          createdBy: 1
        }, [
          { journalEntryId: 0, accountId: cogsAccount.id, debit: inv.totalAmount, credit: 0, description: "COGS Debit", lineNumber: 1 },
          { journalEntryId: 0, accountId: apAccount.id, debit: 0, credit: inv.totalAmount, description: "Payable Credit", lineNumber: 2 }
        ]);
      }
    }
  }

  // ==========================================
  // Ledger / Journal Entries
  // ==========================================
  async getJournalEntry(id: number): Promise<JournalEntry | undefined> {
    const result = await db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
    return result[0];
  }

  async getAllJournalEntries(): Promise<JournalEntry[]> {
    return db.select().from(journalEntries).orderBy(desc(journalEntries.entryDate));
  }

  async getJournalLines(entryId: number): Promise<JournalEntryLine[]> {
    return db.select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entryId)).orderBy(journalEntryLines.lineNumber);
  }

  async getLedgerLines(accountId: number): Promise<any[]> {
    // Join lines with entries for ledger displays
    const lines = await db.select({
      id: journalEntryLines.id,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      description: journalEntryLines.description,
      lineNumber: journalEntryLines.lineNumber,
      entryDate: journalEntries.entryDate,
      entryNumber: journalEntries.entryNumber,
      sourceModule: journalEntries.sourceModule,
      referenceNumber: journalEntries.referenceNumber
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(eq(journalEntryLines.accountId, accountId))
    .orderBy(journalEntries.entryDate, journalEntryLines.lineNumber);

    return lines;
  }

  async createJournalEntry(entry: InsertJournalEntry, lines: InsertJournalEntryLine[]): Promise<JournalEntry> {
    const result = await db.insert(journalEntries).values(entry).returning();
    const createdEntry = result[0];

    // PERF (audit): batch insert instead of one INSERT per line (N+1 write).
    if (lines.length > 0) {
      await db.insert(journalEntryLines).values(
        lines.map((line) => ({ ...line, journalEntryId: createdEntry.id }))
      );
    }

    return createdEntry;
  }

  // ==========================================
  // Payments
  // ==========================================
  async getPayment(id: number): Promise<Payment | undefined> {
    const result = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return result[0];
  }

  async getAllPayments(filters?: { type?: string }): Promise<Payment[]> {
    let query = db.select().from(payments);
    if (filters?.type) {
      return query.where(eq(payments.type, filters.type)).orderBy(desc(payments.date));
    }
    return query.orderBy(desc(payments.date));
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    // Phase 3 consistency fix: payment insert + invoice-balance update are now
    // atomic. Previously a failure after insert could leave the payment (and
    // its journal) recorded while the invoice still showed unpaid.
    const createdPayment = await db.transaction(async (tx) => {
      const result = await tx.insert(payments).values(payment).returning();
      const created = result[0];

      if (payment.invoiceId) {
        const invoiceList = await tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
        const invoice = invoiceList[0];
        if (invoice) {
          // Round to paise to avoid float drift (e.g. 0.1+0.2 issues).
          const newPaid = Math.round((Number(invoice.paidAmount || 0) + Number(payment.amount)) * 100) / 100;
          const newBalance = Math.max(0, Math.round((Number(invoice.totalAmount) - newPaid) * 100) / 100);
          const newStatus = newBalance <= 0 ? "paid" : (newPaid > 0 ? "partial" : "unpaid");
          await tx.update(invoices).set({ paidAmount: newPaid, balanceAmount: newBalance, status: newStatus })
            .where(eq(invoices.id, payment.invoiceId));
        }
      }
      return created;
    });

    // Journal generation stays outside the txn (its own consistency domain),
    // unchanged from prior behaviour.
    await this.generatePaymentJournal(createdPayment);
    return createdPayment;
  }

  async createPaymentWithAllocations(payment: InsertPayment, allocations: any[]): Promise<Payment> {
    const result = await db.insert(payments).values({
      ...payment,
      allocatedInvoices: allocations
    } as any).returning();
    const createdPayment = result[0];

    // Trigger Double-Entry accounting logic on payment or receipt!
    await this.generatePaymentJournal(createdPayment);

    // Update each allocated invoice's ledger balance
    for (const alloc of allocations) {
      const invoiceId = Number(alloc.invoiceId);
      const allocAmount = Number(alloc.amount);
      if (!invoiceId || !allocAmount) continue;

      const invoiceList = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      const invoice = invoiceList[0];
      if (invoice) {
        const newPaid = Number(invoice.paidAmount || 0) + allocAmount;
        const newBalance = Math.max(0, Number(invoice.totalAmount) - newPaid);
        const newStatus = newBalance <= 0 ? "paid" : (newPaid > 0 ? "partial" : "unpaid");

        await db.update(invoices).set({
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus
        }).where(eq(invoices.id, invoiceId));
      }
    }

    return createdPayment;
  }

  private async generatePaymentJournal(pay: Payment) {
    const bankAccount = await this.getAccountByCode("112000"); // Bank Account
    
    if (pay.type === 'receipt') {
      // Customer payment received: Debit: Bank (112000), Credit: Accounts Receivable (120000)
      const arAccount = await this.getAccountByCode("120000");
      if (bankAccount && arAccount) {
        const entryNumber = `JV-PY-${pay.id}-${Date.now().toString().slice(-4)}`;
        await this.createJournalEntry({
          entryNumber,
          entryDate: pay.date,
          sourceModule: "payments",
          referenceNumber: pay.voucherNumber,
          description: `Customer Receipt: ${pay.partyName}`,
          createdBy: 1
        }, [
          { journalEntryId: 0, accountId: bankAccount.id, debit: pay.amount, credit: 0, description: "Bank Deposit", lineNumber: 1 },
          { journalEntryId: 0, accountId: arAccount.id, debit: 0, credit: pay.amount, description: "AR Credit", lineNumber: 2 }
        ]);
      }
    } else {
      // Supplier payment paid: Debit: Accounts Payable (210000), Credit: Bank (112000)
      const apAccount = await this.getAccountByCode("210000");
      if (bankAccount && apAccount) {
        const entryNumber = `JV-PY-${pay.id}-${Date.now().toString().slice(-4)}`;
        await this.createJournalEntry({
          entryNumber,
          entryDate: pay.date,
          sourceModule: "payments",
          referenceNumber: pay.voucherNumber,
          description: `Supplier Payment: ${pay.partyName}`,
          createdBy: 1
        }, [
          { journalEntryId: 0, accountId: apAccount.id, debit: pay.amount, credit: 0, description: "AP Debit", lineNumber: 1 },
          { journalEntryId: 0, accountId: bankAccount.id, debit: 0, credit: pay.amount, description: "Bank Withdrawal", lineNumber: 2 }
        ]);
      }
    }
  }

  // ==========================================
  // Sunrise Custom Business Operations
  // ==========================================
  async getAllClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async createClient(client: InsertClient): Promise<Client> {
    const result = await db.insert(clients).values(client).returning();
    return result[0];
  }

  // ==========================================
  // Client Billing Profiles
  // ==========================================
  async getAllBillingProfiles(): Promise<ClientBillingProfile[]> {
    return db.select().from(clientBillingProfiles).orderBy(desc(clientBillingProfiles.createdAt));
  }

  async getClientBillingProfiles(clientId: number): Promise<ClientBillingProfile[]> {
    return db.select().from(clientBillingProfiles).where(eq(clientBillingProfiles.clientId, clientId)).orderBy(desc(clientBillingProfiles.createdAt));
  }

  async getBillingProfile(id: number): Promise<ClientBillingProfile | undefined> {
    const result = await db.select().from(clientBillingProfiles).where(eq(clientBillingProfiles.id, id)).limit(1);
    return result[0];
  }

  async createBillingProfile(profile: InsertClientBillingProfile): Promise<ClientBillingProfile> {
    if (profile.isDefault) {
      await db.update(clientBillingProfiles)
        .set({ isDefault: false })
        .where(eq(clientBillingProfiles.clientId, profile.clientId));
    }
    const result = await db.insert(clientBillingProfiles).values(profile).returning();
    return result[0];
  }

  async updateBillingProfile(id: number, updates: Partial<InsertClientBillingProfile>): Promise<ClientBillingProfile | undefined> {
    const existing = await this.getBillingProfile(id);
    if (!existing) return undefined;

    if (updates.isDefault) {
      await db.update(clientBillingProfiles)
        .set({ isDefault: false })
        .where(eq(clientBillingProfiles.clientId, existing.clientId));
    }

    const result = await db.update(clientBillingProfiles)
      .set(updates)
      .where(eq(clientBillingProfiles.id, id))
      .returning();
    return result[0];
  }

  async deleteBillingProfile(id: number): Promise<boolean> {
    const result = await db.delete(clientBillingProfiles).where(eq(clientBillingProfiles.id, id)).returning();
    return result.length > 0;
  }

  async getAllBrands(clientId?: number): Promise<Brand[]> {
    let q: any = db.select().from(brands);
    if (clientId) {
      q = q.where(eq(brands.parentClientId, clientId));
    }
    return q.orderBy(desc(brands.createdAt));
  }

  async createBrand(brand: InsertBrand): Promise<Brand> {
    const result = await db.insert(brands).values(brand).returning();
    return result[0];
  }

  async getAllStores(clientId?: number, brandId?: number): Promise<Store[]> {
    let q: any = db.select().from(stores);
    const conds: any[] = [];
    if (clientId) conds.push(eq(stores.clientId, clientId));
    if (brandId) conds.push(eq(stores.brandId, brandId));
    if (conds.length === 1) q = q.where(conds[0]);
    else if (conds.length > 1) q = q.where(and(...conds));
    return q.orderBy(desc(stores.createdAt));
  }

  async createStore(store: InsertStore): Promise<Store> {
    const result = await db.insert(stores).values(store).returning();
    return result[0];
  }

  async getAllProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(desc(products.createdAt));
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const result = await db.insert(products).values(product).returning();
    return result[0];
  }

  async getAllEstimates(): Promise<Estimate[]> {
    return db.select().from(estimates).orderBy(desc(estimates.createdAt));
  }

  async getEstimate(id: number): Promise<Estimate | undefined> {
    const result = await db.select().from(estimates).where(eq(estimates.id, id)).limit(1);
    return result[0];
  }

  async createEstimate(estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<Estimate> {
    return db.transaction(async (tx) => {
      const result = await tx.insert(estimates).values(estimate).returning();
      const createdEstimate = result[0];

      // PERF (audit): batch insert instead of one INSERT per item (N+1 write).
      // Matches the batched pattern already used by the estimate update route.
      if (items.length > 0) {
        await tx.insert(estimateItems).values(
          items.map((item) => ({ ...item, estimateId: createdEstimate.id }))
        );
      }

      return createdEstimate;
    });
  }

  async getEstimateItems(estimateId: number): Promise<EstimateItem[]> {
    return db
      .select()
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, estimateId))
      .orderBy(
        sql`COALESCE(${estimateItems.storeSortOrder}, ${estimateItems.sl}, ${estimateItems.id})`,
        sql`COALESCE(${estimateItems.rowSortOrder}, ${estimateItems.sl}, ${estimateItems.id})`,
        sql`COALESCE(${estimateItems.sl}, ${estimateItems.id})`,
        estimateItems.id,
      );
  }

  async updateEstimate(id: number, updates: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const result = await db.update(estimates).set(updates).where(eq(estimates.id, id)).returning();
    return result[0];
  }

  async getAllDeliveryChallans(): Promise<DeliveryChallan[]> {
    return db.select().from(deliveryChallans).orderBy(desc(deliveryChallans.createdAt));
  }

  async getDeliveryChallan(id: number): Promise<DeliveryChallan | undefined> {
    const result = await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, id)).limit(1);
    return result[0];
  }

  async getDeliveryChallansByEstimate(estimateId: number): Promise<DeliveryChallan[]> {
    return db.select().from(deliveryChallans).where(eq(deliveryChallans.estimateId, estimateId)).orderBy(desc(deliveryChallans.createdAt));
  }

  async createDeliveryChallan(dc: InsertDeliveryChallan): Promise<DeliveryChallan> {
    const result = await db.insert(deliveryChallans).values(dc).returning();
    return result[0];
  }

  async updateDeliveryChallan(id: number, updates: Partial<InsertDeliveryChallan>): Promise<DeliveryChallan | undefined> {
    const result = await db.update(deliveryChallans).set(updates).where(eq(deliveryChallans.id, id)).returning();
    return result[0];
  }

  // ==========================================
  // Staff Advances
  // ==========================================
  async getAllAdvances(): Promise<StaffAdvance[]> {
    return db.select().from(staffAdvances).orderBy(desc(staffAdvances.createdAt));
  }

  async getAdvancesByUser(userId: number): Promise<StaffAdvance[]> {
    return db.select().from(staffAdvances).where(eq(staffAdvances.userId, userId)).orderBy(desc(staffAdvances.date));
  }

  async createAdvance(advance: InsertStaffAdvance): Promise<StaffAdvance> {
    const result = await db.insert(staffAdvances).values(advance).returning();
    const created = result[0];
    
    // Increment staff advance balance!
    const staffMember = await this.getUser(advance.userId);
    if (staffMember) {
      const currentBalance = staffMember.advanceBalance || 0;
      await this.updateUser(advance.userId, {
        advanceBalance: currentBalance + advance.amount
      });
    }

    return created;
  }

  // ==========================================
  // Payroll / Salary Calculation
  // ==========================================
  async getPayrollByMonthYear(month: number, year: number): Promise<Payroll[]> {
    return db.select().from(payroll).where(and(eq(payroll.month, month), eq(payroll.year, year)));
  }

  async createPayroll(pay: InsertPayroll): Promise<Payroll> {
    const result = await db.insert(payroll).values(pay).returning();
    return result[0];
  }

  async updatePayroll(id: number, updates: Partial<InsertPayroll>): Promise<Payroll | undefined> {
    const result = await db.update(payroll).set(updates).where(eq(payroll.id, id)).returning();

    // If status is updated to 'paid', adjust staff advance balance if deductions were made
    if (updates.status === "paid" && result[0]) {
      const p = result[0];
      const advancesPaid = p.advancesPaid || 0;
      if (advancesPaid > 0) {
        const staffMember = await this.getUser(p.userId);
        if (staffMember) {
          const currentBalance = staffMember.advanceBalance || 0;
          await this.updateUser(p.userId, {
            advanceBalance: Math.max(0, currentBalance - advancesPaid)
          });
        }
      }
    }

    return result[0];
  }

  // ==========================================
  // Material Codes (additive)
  // ==========================================
  async getAllMaterialCodes(filters?: { clientId?: number; brandId?: number }) {
    try {
      let q: any = db.select().from(materialCodes);
      const conds: any[] = [];

      // If clientId provided, filter by clientId
      if (filters?.clientId) {
        conds.push(eq(materialCodes.clientId, filters.clientId));

        // If brandId also provided, show brand-specific + client-level codes
        // Logic: clientId = X AND (brandId = Y OR brandId IS NULL)
        if (filters?.brandId) {
          conds.push(
            or(
              eq(materialCodes.brandId, filters.brandId),
              isNull(materialCodes.brandId)
            )
          );
        }
      } else if (filters?.brandId) {
        // If only brandId provided (no clientId), just filter by brandId
        conds.push(eq(materialCodes.brandId, filters.brandId));
      }

      if (conds.length === 1) q = q.where(conds[0]);
      else if (conds.length > 1) q = q.where(and(...conds));
      return await q.orderBy(desc(materialCodes.createdAt));
    } catch (err) {
      console.warn("[storage] material_codes table not ready:", (err as any)?.message);
      return [];
    }
  }

  async createMaterialCode(mc: any) {
    const result = await db.insert(materialCodes).values(mc).returning();
    return result[0];
  }

  async updateMaterialCode(id: number, updates: any) {
    const result = await db.update(materialCodes).set(updates).where(eq(materialCodes.id, id)).returning();
    return result[0];
  }

  async deleteMaterialCode(id: number): Promise<boolean> {
    const r = await db.delete(materialCodes).where(eq(materialCodes.id, id)).returning();
    return r.length > 0;
  }

  // ==========================================
  // App Settings (additive single-row key/value)
  // ==========================================
  // PERF (Phase 2): settings are read many times per request (numbering,
  // seller profile, print settings). 30s TTL cache; writes invalidate.
  private settingsCache = new Map<string, { value: any; at: number }>();
  private static SETTINGS_TTL_MS = 30_000;

  async getAppSetting(key: string) {
    const hit = this.settingsCache.get(key);
    if (hit && Date.now() - hit.at < DatabaseStorage.SETTINGS_TTL_MS) return hit.value;
    try {
      const r = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
      const value = r[0]?.value ?? null;
      this.settingsCache.set(key, { value, at: Date.now() });
      return value;
    } catch (err) {
      console.warn("[storage] app_settings table not ready:", (err as any)?.message);
      return null;
    }
  }

  async setAppSetting(key: string, value: any) {
    this.settingsCache.delete(key);
    try {
      const existing = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
      if (existing[0]) {
        const r = await db.update(appSettings)
          .set({ value, updatedAt: new Date() })
          .where(eq(appSettings.key, key))
          .returning();
        return r[0];
      } else {
        const r = await db.insert(appSettings).values({ key, value }).returning();
        return r[0];
      }
    } catch (err: any) {
      console.warn("[storage] app_settings table not ready:", err?.message);
      throw err;
    }
  }

  async listAppSettings() {
    try {
      return await db.select().from(appSettings);
    } catch (err) {
      console.warn("[storage] app_settings table not ready");
      return [];
    }
  }

  // ==========================================
  // Uploads list (read-all for Project Documents)
  // ==========================================
  async listAllUploads() {
    try {
      return await db.select().from(uploads).orderBy(desc(uploads.createdAt));
    } catch (err) {
      console.warn("[storage] uploads list failed:", (err as any)?.message);
      return [];
    }
  }
}

export const storage = new DatabaseStorage();
