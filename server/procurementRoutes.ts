import type { Express, Response } from "express";
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { authenticateToken, requireRole, type AuthRequest } from "./auth";
import {
  invoices,
  payments,
  products,
  stores,
  masterProjects,
  projectEstimates,
  projectCostAllocations,
  contractorWorkOrders,
  pettyCashExpenses,
  type Invoice,
} from "../shared/schema";
import { syncPettyCashExpenseAllocation, cancelInvoiceCostAllocations } from "./masterProjectCostingRoutes";

export function registerProcurementRoutes(app: Express) {
  // =========================================================================
  // 1. PURCHASE / SUPPLIER INVOICES & BILLS
  // =========================================================================

  app.get("/api/purchases", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const status = req.query.status as string | undefined;
      const supplier = req.query.supplier as string | undefined;
      const search = (req.query.search as string || "").trim();

      const conditions = [
        eq(invoices.companyId, companyId),
        eq(invoices.type, "purchase"),
        ne(invoices.status, "cancelled"),
      ];

      if (status && status !== "all") {
        conditions.push(eq(invoices.status, status));
      }
      if (supplier && supplier !== "all") {
        conditions.push(eq(invoices.partyName, supplier));
      }
      if (search) {
        conditions.push(
          or(
            ilike(invoices.invoiceNumber, `%${search}%`),
            ilike(invoices.partyName, `%${search}%`),
            ilike(invoices.poNumber, `%${search}%`),
            ilike(invoices.remarks, `%${search}%`)
          ) as any
        );
      }

      const rows = await db
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.date), desc(invoices.id));

      res.json(rows);
    } catch (err: any) {
      console.error("Error fetching purchases:", err);
      res.status(500).json({ message: err.message || "Failed to fetch purchases" });
    }
  });

  app.post("/api/purchases", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const {
        invoiceNumber,
        partyName,
        supplierGstin,
        date,
        dueDate,
        poNumber,
        transportCost,
        remarks,
        lineItems,
        masterProjectId,
        estimateId,
        storeCode,
        isRecoverableGst,
      } = req.body;

      if (!partyName || !String(partyName).trim()) {
        return res.status(400).json({ message: "Supplier name is required" });
      }

      const billNo = (invoiceNumber || "").trim() || `BILL-${Date.now().toString().slice(-6)}`;

      // Calculate totals from line items
      const items: any[] = Array.isArray(lineItems) ? lineItems : [];
      let calculatedBase = 0;
      let calculatedGst = 0;

      const freight = Number(transportCost || 0);

      // Distribute freight across items proportionally by item base amount for landed cost
      const totalItemBase = items.reduce((sum, it) => sum + (Number(it.taxableAmount) || (Number(it.quantity || 1) * Number(it.rate || 0))), 0);

      const processedItems = items.map((it) => {
        const qty = Number(it.quantity) || 1;
        const rate = Number(it.rate) || 0;
        const discountPct = Number(it.discountPercent) || 0;
        const lineBase = qty * rate * (1 - discountPct / 100);
        const gstPct = Number(it.gstPercent) || 0;
        const lineGst = lineBase * (gstPct / 100);
        const lineTotal = lineBase + lineGst;

        calculatedBase += lineBase;
        calculatedGst += lineGst;

        // Proportional freight share
        const freightShare = totalItemBase > 0 ? (lineBase / totalItemBase) * freight : 0;
        // If GST is recoverable (ITC), it does not enter inventory cost. If ineligible, it enters cost.
        const taxShareInLandedCost = isRecoverableGst === false ? lineGst : 0;
        const landedCostTotal = lineBase + freightShare + taxShareInLandedCost;
        const landedCostPerUnit = qty > 0 ? +(landedCostTotal / qty).toFixed(2) : 0;

        return {
          productId: it.productId || null,
          productName: it.productName || it.name || "Item",
          description: it.description || "",
          quantity: qty,
          unit: it.unit || "pcs",
          rate,
          discountPercent: discountPct,
          taxableAmount: +lineBase.toFixed(2),
          gstPercent: gstPct,
          gstAmount: +lineGst.toFixed(2),
          totalAmount: +lineTotal.toFixed(2),
          freightShare: +freightShare.toFixed(2),
          landedCostPerUnit,
        };
      });

      const totalBillAmount = +(calculatedBase + calculatedGst + freight).toFixed(2);

      const [newInvoice] = await db
        .insert(invoices)
        .values({
          companyId,
          type: "purchase",
          invoiceNumber: billNo,
          partyName: partyName.trim(),
          date: date ? new Date(date) : new Date(),
          dueDate: dueDate ? new Date(dueDate) : (date ? new Date(date) : new Date()),
          amount: calculatedBase,
          taxAmount: calculatedGst,
          transportCost: freight,
          totalAmount: totalBillAmount,
          paidAmount: 0,
          balanceAmount: totalBillAmount,
          status: "pending",
          poNumber: poNumber || null,
          remarks: remarks || (supplierGstin ? `GSTIN: ${supplierGstin}` : null),
          lineItems: processedItems,
          storeCode: storeCode ? String(storeCode).trim().toUpperCase() : null,
        })
        .returning();

      // If linked to a Master Project, create active Project Cost Allocation
      if (masterProjectId) {
        const pId = Number(masterProjectId);
        const [proj] = await db
          .select({ id: masterProjects.id })
          .from(masterProjects)
          .where(and(eq(masterProjects.id, pId), eq(masterProjects.companyId, companyId)))
          .limit(1);

        if (proj) {
          const recoverable = isRecoverableGst !== false; // default true
          const ineligibleGst = recoverable ? 0 : calculatedGst;
          const recognisedCost = +(calculatedBase + freight + ineligibleGst).toFixed(2);

          await db.insert(projectCostAllocations).values({
            companyId,
            projectId: pId,
            estimateId: estimateId ? Number(estimateId) : null,
            storeCode: storeCode ? String(storeCode).trim().toUpperCase() : null,
            sourceType: "purchase_invoice",
            sourceId: newInvoice.id,
            sourceReference: newInvoice.invoiceNumber,
            costCategory: "materials",
            description: `Purchase from ${partyName}: ${newInvoice.invoiceNumber}`,
            baseAmount: String(calculatedBase.toFixed(2)),
            gstRate: "18.00",
            gstAmount: String(calculatedGst.toFixed(2)),
            totalAmount: String(totalBillAmount.toFixed(2)),
            isRecoverableGst: recoverable,
            ineligibleGstAmount: String(ineligibleGst.toFixed(2)),
            recognisedCost: String(recognisedCost.toFixed(2)),
            status: "active",
            createdBy: req.user?.id || null,
          });
        }
      }

      res.status(201).json(newInvoice);
    } catch (err: any) {
      console.error("Error creating purchase bill:", err);
      res.status(500).json({ message: err.message || "Failed to create purchase bill" });
    }
  });

  app.post("/api/purchases/:id/pay", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      const { amount, paymentMethod, paymentReference, paymentDate, notes } = req.body;

      const payAmt = Number(amount);
      if (isNaN(payAmt) || payAmt <= 0) {
        return res.status(400).json({ message: "Valid payment amount is required" });
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId), eq(invoices.type, "purchase")))
        .limit(1);

      if (!inv) {
        return res.status(404).json({ message: "Purchase bill not found" });
      }

      const currentPaid = Number(inv.paidAmount || 0);
      const totalAmt = Number(inv.totalAmount || 0);
      const newPaid = +(currentPaid + payAmt).toFixed(2);
      const newBalance = Math.max(0, +(totalAmt - newPaid).toFixed(2));
      const newStatus = newBalance <= 0 ? "paid" : "partial";

      // 1. Update purchase invoice
      const [updatedInv] = await db
        .update(invoices)
        .set({
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus,
        })
        .where(eq(invoices.id, id))
        .returning();

      // 2. Record payment disbursement voucher in payments ledger (type: 'payment')
      const voucherNum = `PV-${Date.now().toString().slice(-6)}`;
      await db.insert(payments).values({
        companyId,
        voucherNumber: voucherNum,
        type: "payment",
        partyName: inv.partyName,
        amount: payAmt,
        date: paymentDate ? new Date(paymentDate) : new Date(),
        method: paymentMethod || "Bank Transfer",
        description: `Payment for Supplier Bill #${inv.invoiceNumber}${paymentReference ? ` (Ref: ${paymentReference})` : ""}${notes ? ` - ${notes}` : ""}`,
        invoiceId: inv.id,
      });

      res.json(updatedInv);
    } catch (err: any) {
      console.error("Error recording purchase payment:", err);
      res.status(500).json({ message: err.message || "Failed to record payment" });
    }
  });

  // =========================================================================
  // 2. SUPPLIER DIRECTORY & AGGREGATE LEDGER
  // =========================================================================

  app.get("/api/suppliers", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;

      // Group purchase invoices by supplier (partyName)
      const purchaseRows = await db
        .select({
          partyName: invoices.partyName,
          totalAmount: invoices.totalAmount,
          paidAmount: invoices.paidAmount,
          balanceAmount: invoices.balanceAmount,
          date: invoices.date,
          status: invoices.status,
          remarks: invoices.remarks,
        })
        .from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.type, "purchase"), ne(invoices.status, "cancelled")));

      const supplierMap = new Map<string, {
        name: string;
        gstin: string | null;
        totalBills: number;
        totalBilled: number;
        totalPaid: number;
        totalBalance: number;
        lastBillDate: string | null;
      }>();

      for (const row of purchaseRows) {
        const name = (row.partyName || "Unknown Supplier").trim();
        if (!name) continue;

        let entry = supplierMap.get(name);
        if (!entry) {
          // Extract GSTIN if present in remarks
          let gstin: string | null = null;
          if (row.remarks) {
            const m = row.remarks.match(/GSTIN:\s*([A-Z0-9]{15})/i);
            if (m) gstin = m[1];
          }
          entry = {
            name,
            gstin,
            totalBills: 0,
            totalBilled: 0,
            totalPaid: 0,
            totalBalance: 0,
            lastBillDate: null,
          };
          supplierMap.set(name, entry);
        }

        entry.totalBills += 1;
        entry.totalBilled += Number(row.totalAmount || 0);
        entry.totalPaid += Number(row.paidAmount || 0);
        entry.totalBalance += Number(row.balanceAmount || 0);

        const dStr = row.date ? new Date(row.date).toISOString().split("T")[0] : null;
        if (dStr && (!entry.lastBillDate || dStr > entry.lastBillDate)) {
          entry.lastBillDate = dStr;
        }
      }

      const list = Array.from(supplierMap.values()).map(s => ({
        ...s,
        totalBilled: +s.totalBilled.toFixed(2),
        totalPaid: +s.totalPaid.toFixed(2),
        totalBalance: +s.totalBalance.toFixed(2),
      })).sort((a, b) => b.totalBalance - a.totalBalance);

      res.json(list);
    } catch (err: any) {
      console.error("Error fetching suppliers:", err);
      res.status(500).json({ message: err.message || "Failed to fetch suppliers" });
    }
  });

  // =========================================================================
  // 3. OPERATING EXPENSES (Rent, Salaries, Utilities, Travel, Telecom, etc.)
  // =========================================================================

  app.get("/api/expenses", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const category = req.query.category as string | undefined;
      const status = req.query.status as string | undefined;
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

      const rows = await db
        .select()
        .from(pettyCashExpenses)
        .where(eq(pettyCashExpenses.companyId, companyId))
        .orderBy(desc(pettyCashExpenses.expenseDate), desc(pettyCashExpenses.id));

      const filtered = rows
        .map((r: any) => ({
          ...r,
          extractedData: r.extractedData || r.extracted_data || {},
        }))
        .filter((r: any) => {
          // If category specified
          if (category && category !== "all" && r.category !== category) return false;
          // If status specified
          if (status && status !== "all" && r.status !== status) return false;
          // If project filter specified
          if (projectId) {
            if (r.extractedData?.masterProjectId !== projectId) return false;
          }
          return true;
        });

      res.json(filtered);
    } catch (err: any) {
      console.error("Error fetching expenses:", err);
      res.status(500).json({ message: err.message || "Failed to fetch expenses" });
    }
  });

  app.post("/api/expenses", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const {
        category,
        amount,
        gstRate,
        gstAmount,
        isRecoverableGst,
        vendor,
        invoiceNumber,
        description,
        expenseDate,
        paymentMethod,
        paymentReference,
        masterProjectId,
        estimateId,
        storeCode,
        receiptImageUrl,
      } = req.body;

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ message: "Valid expense amount is required" });
      }

      const totalAmt = Number(amount);
      const gstVal = Number(gstAmount || 0);
      const baseVal = +(totalAmt - gstVal).toFixed(2);

      const jobData = masterProjectId ? {
        expenseType: "operational",
        masterProjectId: Number(masterProjectId),
        estimateId: estimateId ? Number(estimateId) : null,
        storeCode: storeCode ? String(storeCode).trim().toUpperCase() : null,
        invoiceNumber: invoiceNumber || null,
        gstRate: gstRate ? Number(gstRate) : 0,
        gstAmount: gstVal,
        baseAmount: baseVal,
        isRecoverableGst: isRecoverableGst === true,
        paymentMethod: paymentMethod || "Bank Transfer",
        paymentReference: paymentReference || null,
      } : {
        expenseType: "operational",
        invoiceNumber: invoiceNumber || null,
        gstRate: gstRate ? Number(gstRate) : 0,
        gstAmount: gstVal,
        baseAmount: baseVal,
        isRecoverableGst: isRecoverableGst === true,
        paymentMethod: paymentMethod || "Bank Transfer",
        paymentReference: paymentReference || null,
      };

      const [newExp] = await db
        .insert(pettyCashExpenses)
        .values({
          companyId,
          category: category || "other",
          amount: totalAmt,
          vendor: vendor || null,
          description: description || null,
          expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
          status: "pending",
          receiptImageUrl: receiptImageUrl || null,
          extractedData: jobData,
          addedBy: req.user?.id || 1,
        })
        .returning();

      res.status(201).json(newExp);
    } catch (err: any) {
      console.error("Error logging operating expense:", err);
      res.status(500).json({ message: err.message || "Failed to log expense" });
    }
  });

  // =========================================================================
  // 4. CONTRACTOR WORK ORDERS: BILLING, VARIATIONS & DISBURSEMENT
  // =========================================================================

  app.post("/api/operations/contractor-work-orders/:id/variations", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      const { variationAmount, reason } = req.body;

      const varAmt = Number(variationAmount);
      if (isNaN(varAmt) || varAmt <= 0) {
        return res.status(400).json({ message: "Valid approved variation amount is required" });
      }

      const [wo] = await db
        .select()
        .from(contractorWorkOrders)
        .where(and(eq(contractorWorkOrders.id, id), eq(contractorWorkOrders.companyId, companyId)))
        .limit(1);

      if (!wo) return res.status(404).json({ message: "Work order not found" });

      const currentVariation = Number(wo.approvedVariationAmount || 0);
      const newVariation = +(currentVariation + varAmt).toFixed(2);

      const [updated] = await db
        .update(contractorWorkOrders)
        .set({
          approvedVariationAmount: String(newVariation),
        })
        .where(eq(contractorWorkOrders.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("Error approving contractor variation:", err);
      res.status(500).json({ message: err.message || "Failed to approve variation" });
    }
  });

  app.post("/api/operations/contractor-work-orders/:id/bill", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      const { billNumber, billAmount, billDate, notes } = req.body;

      const bAmt = Number(billAmount);
      if (isNaN(bAmt) || bAmt <= 0) {
        return res.status(400).json({ message: "Valid bill amount is required" });
      }

      const [wo] = await db
        .select()
        .from(contractorWorkOrders)
        .where(and(eq(contractorWorkOrders.id, id), eq(contractorWorkOrders.companyId, companyId)))
        .limit(1);

      if (!wo) return res.status(404).json({ message: "Work order not found" });

      const committed = Number(wo.committedAmount || 0);
      const variation = Number(wo.approvedVariationAmount || 0);
      const currentBilled = Number(wo.billedAmount || 0);
      const maxAllowed = +(committed + variation).toFixed(2);

      const newBilled = +(currentBilled + bAmt).toFixed(2);
      if (newBilled > maxAllowed) {
        return res.status(400).json({
          message: `Bill of ₹${bAmt} exceeds open contract ceiling. Total billed would be ₹${newBilled}, exceeding limit of ₹${maxAllowed}. Approve a variation first.`,
        });
      }

      const newStatus = newBilled >= maxAllowed ? "fully_billed" : "partially_billed";

      const [updated] = await db
        .update(contractorWorkOrders)
        .set({
          billedAmount: String(newBilled),
          status: newStatus,
        })
        .where(eq(contractorWorkOrders.id, id))
        .returning();

      // Automatically sync/create project cost allocation for this contractor bill
      if (wo.projectId) {
        await db.insert(projectCostAllocations).values({
          companyId,
          projectId: wo.projectId,
          estimateId: wo.estimateId || null,
          storeId: wo.storeId || null,
          sourceType: "contractor",
          sourceId: wo.id,
          sourceReference: billNumber ? `BILL-${billNumber}` : `WO-${wo.woNumber}`,
          costCategory: "contractor",
          description: `Contractor bill from ${wo.contractorName}: ${wo.scopeOfWork}${notes ? ` - ${notes}` : ""}`,
          baseAmount: String(bAmt.toFixed(2)),
          gstRate: "0.00",
          gstAmount: "0.00",
          totalAmount: String(bAmt.toFixed(2)),
          isRecoverableGst: true,
          ineligibleGstAmount: "0.00",
          recognisedCost: String(bAmt.toFixed(2)),
          status: "active",
          createdBy: req.user?.id || null,
        });
      }

      res.json(updated);
    } catch (err: any) {
      console.error("Error recording contractor bill:", err);
      res.status(500).json({ message: err.message || "Failed to record contractor bill" });
    }
  });

  // =========================================================================
  // 5. PRODUCT OVERALL & LANDED COST INTELLIGENCE
  // =========================================================================

  app.get("/api/product-costing/summary", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;

      // 1. Fetch products catalog
      const allProducts = await db.select().from(products).where(eq(products.companyId, companyId));

      // 2. Fetch all purchase bills with line items
      const purchaseBills = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          partyName: invoices.partyName,
          date: invoices.date,
          lineItems: invoices.lineItems,
          transportCost: invoices.transportCost,
        })
        .from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.type, "purchase"), ne(invoices.status, "cancelled")))
        .orderBy(desc(invoices.date));

      // Map product purchases
      const productStats = new Map<number, {
        productId: number;
        productName: string;
        category: string;
        unit: string;
        sellingRate: number;
        totalPurchasedQty: number;
        totalLandedExpenditure: number;
        latestPurchaseRate: number;
        latestLandedCostPerUnit: number;
        latestSupplier: string;
        latestPurchaseDate: string | null;
        batchesCount: number;
      }>();

      for (const p of allProducts) {
        productStats.set(p.id, {
          productId: p.id,
          productName: p.name,
          category: p.category || "General",
          unit: p.unit || "pcs",
          sellingRate: Number(p.rate || 0),
          totalPurchasedQty: 0,
          totalLandedExpenditure: 0,
          latestPurchaseRate: 0,
          latestLandedCostPerUnit: 0,
          latestSupplier: "-",
          latestPurchaseDate: null,
          batchesCount: 0,
        });
      }

      for (const bill of purchaseBills) {
        const items = Array.isArray(bill.lineItems) ? bill.lineItems : [];
        const dateStr = bill.date ? new Date(bill.date).toISOString().split("T")[0] : null;

        for (const item of items) {
          const pId = Number(item.productId);
          if (!pId) continue;

          let entry = productStats.get(pId);
          if (!entry) {
            entry = {
              productId: pId,
              productName: item.productName || "Product",
              category: "General",
              unit: item.unit || "pcs",
              sellingRate: 0,
              totalPurchasedQty: 0,
              totalLandedExpenditure: 0,
              latestPurchaseRate: 0,
              latestLandedCostPerUnit: 0,
              latestSupplier: "-",
              latestPurchaseDate: null,
              batchesCount: 0,
            };
            productStats.set(pId, entry);
          }

          const qty = Number(item.quantity) || 1;
          const landedUnit = Number(item.landedCostPerUnit) || Number(item.rate) || 0;
          const lineLandedTotal = qty * landedUnit;

          entry.totalPurchasedQty += qty;
          entry.totalLandedExpenditure += lineLandedTotal;
          entry.batchesCount += 1;

          if (!entry.latestPurchaseDate || (dateStr && dateStr > entry.latestPurchaseDate)) {
            entry.latestPurchaseDate = dateStr;
            entry.latestPurchaseRate = Number(item.rate || 0);
            entry.latestLandedCostPerUnit = landedUnit;
            entry.latestSupplier = bill.partyName || "Supplier";
          }
        }
      }

      const summaryList = Array.from(productStats.values()).map((p) => {
        const avgLandedCost = p.totalPurchasedQty > 0
          ? +(p.totalLandedExpenditure / p.totalPurchasedQty).toFixed(2)
          : p.latestLandedCostPerUnit || p.sellingRate * 0.7; // default estimated 70% if no purchases yet

        const marginPercent = p.sellingRate > 0
          ? +(((p.sellingRate - avgLandedCost) / p.sellingRate) * 100).toFixed(1)
          : 0;

        return {
          ...p,
          averageLandedCost: avgLandedCost,
          grossMarginPercent: marginPercent,
        };
      });

      res.json(summaryList);
    } catch (err: any) {
      console.error("Error computing product landed cost summary:", err);
      res.status(500).json({ message: err.message || "Failed to compute landed cost summary" });
    }
  });
}
