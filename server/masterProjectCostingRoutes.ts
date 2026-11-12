import type { Express, Response } from "express";
import { db } from "./db";
import {
  masterProjects,
  projectEstimates,
  projectCostAllocations,
  contractorWorkOrders,
  estimates,
  estimateItems,
  invoices,
  clients,
  brands,
  stores,
  executionStores,
  pettyCashExpenses,
  insertMasterProjectSchema,
  insertProjectCostAllocationSchema,
  insertContractorWorkOrderSchema,
} from "../shared/schema";
import { eq, and, ne, sql, desc, or, inArray, ilike } from "drizzle-orm";
import type { AuthRequest } from "./auth";
import { authenticateToken, requireRole } from "./auth";

export function registerMasterProjectCostingRoutes(app: Express) {
  // ==========================================
  // 1. MASTER PROJECTS: List & Create
  // ==========================================

  app.get("/api/operations/master-projects", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const statusFilter = req.query.status as string | undefined;
      const clientIdFilter = req.query.clientId ? Number(req.query.clientId) : undefined;
      const search = (req.query.search as string || "").trim();

      const conditions = [eq(masterProjects.companyId, companyId)];
      if (statusFilter && statusFilter !== "all") {
        conditions.push(eq(masterProjects.status, statusFilter));
      }
      if (clientIdFilter) {
        conditions.push(eq(masterProjects.clientId, clientIdFilter));
      }
      if (search) {
        conditions.push(
          or(
            ilike(masterProjects.name, `%${search}%`),
            ilike(masterProjects.projectCode, `%${search}%`)
          )!
        );
      }

      const projectsList = await db
        .select({
          id: masterProjects.id,
          companyId: masterProjects.companyId,
          clientId: masterProjects.clientId,
          projectCode: masterProjects.projectCode,
          name: masterProjects.name,
          description: masterProjects.description,
          status: masterProjects.status,
          startDate: masterProjects.startDate,
          targetCompletionDate: masterProjects.targetCompletionDate,
          actualCompletionDate: masterProjects.actualCompletionDate,
          budgetRevenue: masterProjects.budgetRevenue,
          budgetCost: masterProjects.budgetCost,
          notes: masterProjects.notes,
          createdAt: masterProjects.createdAt,
          clientName: clients.name,
        })
        .from(masterProjects)
        .leftJoin(clients, eq(masterProjects.clientId, clients.id))
        .where(and(...conditions))
        .orderBy(desc(masterProjects.createdAt));

      // Enrich with linked estimate count, store count, quoted total, invoiced total, and recognized costs
      const enriched = await Promise.all(
        projectsList.map(async (p) => {
          const linkedEsts = await db
            .select({
              estimateId: projectEstimates.estimateId,
              subtotal: estimates.subtotal,
              totalAmount: estimates.totalAmount,
            })
            .from(projectEstimates)
            .innerJoin(estimates, eq(projectEstimates.estimateId, estimates.id))
            .where(
              and(
                eq(projectEstimates.projectId, p.id),
                eq(projectEstimates.status, "active")
              )
            );

          const estimateIds = linkedEsts.map((e) => e.estimateId);

          let storeCount = 0;
          let invoicedSales = 0;
          let collections = 0;

          if (estimateIds.length > 0) {
            // Count distinct stores from executionStores
            const storesRes = await db
              .select({ count: sql<number>`count(distinct ${executionStores.storeCode})` })
              .from(executionStores)
              .where(inArray(executionStores.estimateId, estimateIds));
            storeCount = Number(storesRes[0]?.count || 0);

            // Fetch sales invoices linked to these estimates
            const invs = await db
              .select({
                amount: invoices.amount,
                totalAmount: invoices.totalAmount,
                paidAmount: invoices.paidAmount,
                type: invoices.type,
                status: invoices.status,
              })
              .from(invoices)
              .where(
                and(
                  inArray(invoices.estimateId, estimateIds),
                  ne(invoices.status, "cancelled")
                )
              );

            for (const inv of invs) {
              const amt = Number(inv.amount || 0);
              const paid = Number(inv.paidAmount || 0);
              if (inv.type === "sales") {
                invoicedSales += amt;
                collections += paid;
              } else if (inv.type === "credit_note") {
                invoicedSales -= amt;
              }
            }
          }

          // Fetch recognized costs from project_cost_allocations
          const costRes = await db
            .select({
              totalCost: sql<number>`COALESCE(sum(${projectCostAllocations.recognisedCost}), 0)`,
            })
            .from(projectCostAllocations)
            .where(
              and(
                eq(projectCostAllocations.projectId, p.id),
                eq(projectCostAllocations.status, "active")
              )
            );
          const actualCost = Number(costRes[0]?.totalCost || 0);

          const quotedTotal = linkedEsts.reduce((sum, e) => sum + (Number(e.totalAmount) || 0), 0);
          const quotedSubtotal = linkedEsts.reduce((sum, e) => sum + (Number(e.subtotal) || 0), 0);
          const actualProfit = invoicedSales - actualCost;
          const actualMarginPercent = invoicedSales > 0 ? +((actualProfit / invoicedSales) * 100).toFixed(2) : 0;

          return {
            ...p,
            linkedEstimatesCount: linkedEsts.length,
            storesCount: storeCount,
            quotedTotal: +quotedTotal.toFixed(2),
            quotedSubtotal: +quotedSubtotal.toFixed(2),
            invoicedSales: +invoicedSales.toFixed(2),
            collections: +collections.toFixed(2),
            actualRecognisedCost: +actualCost.toFixed(2),
            actualProfit: +actualProfit.toFixed(2),
            actualMarginPercent,
          };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch master projects" });
    }
  });

  app.post("/api/operations/master-projects", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const { estimateIds, ...projectData } = req.body || {};

      const parsed = insertMasterProjectSchema.safeParse({
        ...projectData,
        companyId,
        createdBy: req.user?.id || null,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid project data", errors: parsed.error.errors });
      }

      // Project code unique check within company
      const [existingCode] = await db
        .select()
        .from(masterProjects)
        .where(
          and(
            eq(masterProjects.companyId, companyId),
            eq(masterProjects.projectCode, parsed.data.projectCode.trim())
          )
        )
        .limit(1);
      if (existingCode) {
        return res.status(409).json({ message: `Project Code "${parsed.data.projectCode}" is already in use.` });
      }

      const created = await db.transaction(async (tx) => {
        const [proj] = await tx.insert(masterProjects).values(parsed.data).returning();

        if (Array.isArray(estimateIds) && estimateIds.length > 0) {
          // Validate each estimate
          for (const eid of estimateIds) {
            const [est] = await tx.select().from(estimates).where(eq(estimates.id, Number(eid))).limit(1);
            if (!est) {
              throw new Error(`Estimate #${eid} does not exist`);
            }
            if (est.companyId !== companyId) {
              throw new Error(`Cross-company assignment forbidden: Estimate #${est.estimateNumber} belongs to another company`);
            }
            if (est.clientId !== parsed.data.clientId) {
              throw new Error(`Client mismatch: Estimate #${est.estimateNumber} belongs to a different client`);
            }

            // Ensure not already linked to another active master project
            const [alreadyLinked] = await tx
              .select({
                peId: projectEstimates.id,
                projectName: masterProjects.name,
                projectCode: masterProjects.projectCode,
              })
              .from(projectEstimates)
              .innerJoin(masterProjects, eq(projectEstimates.projectId, masterProjects.id))
              .where(
                and(
                  eq(projectEstimates.estimateId, Number(eid)),
                  eq(projectEstimates.companyId, companyId),
                  eq(projectEstimates.status, "active"),
                  ne(masterProjects.status, "archived")
                )
              )
              .limit(1);

            if (alreadyLinked) {
              throw new Error(
                `Estimate #${est.estimateNumber} is already linked to Master Project "${alreadyLinked.projectName}" (${alreadyLinked.projectCode}). An estimate cannot be linked to multiple active projects.`
              );
            }

            const [existingLink] = await tx
              .select()
              .from(projectEstimates)
              .where(
                and(
                  eq(projectEstimates.projectId, proj.id),
                  eq(projectEstimates.estimateId, Number(eid)),
                  eq(projectEstimates.companyId, companyId)
                )
              )
              .limit(1);

            if (existingLink) {
              await tx
                .update(projectEstimates)
                .set({
                  status: "active",
                  linkedAt: new Date(),
                  linkedBy: req.user?.id || null,
                  unlinkedAt: null,
                  unlinkedBy: null,
                })
                .where(eq(projectEstimates.id, existingLink.id));
            } else {
              await tx.insert(projectEstimates).values({
                companyId,
                projectId: proj.id,
                estimateId: Number(eid),
                status: "active",
                linkedBy: req.user?.id || null,
              });
            }
          }
        }

        return proj;
      });

      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create master project" });
    }
  });

  // ==========================================
  // 2. MASTER PROJECT: Detail & Update
  // ==========================================

  app.get("/api/operations/master-projects/:id", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

      const [proj] = await db
        .select({
          id: masterProjects.id,
          companyId: masterProjects.companyId,
          clientId: masterProjects.clientId,
          projectCode: masterProjects.projectCode,
          name: masterProjects.name,
          description: masterProjects.description,
          status: masterProjects.status,
          startDate: masterProjects.startDate,
          targetCompletionDate: masterProjects.targetCompletionDate,
          actualCompletionDate: masterProjects.actualCompletionDate,
          budgetRevenue: masterProjects.budgetRevenue,
          budgetCost: masterProjects.budgetCost,
          notes: masterProjects.notes,
          createdAt: masterProjects.createdAt,
          clientName: clients.name,
        })
        .from(masterProjects)
        .leftJoin(clients, eq(masterProjects.clientId, clients.id))
        .where(and(eq(masterProjects.id, id), eq(masterProjects.companyId, companyId)))
        .limit(1);

      if (!proj) return res.status(404).json({ message: "Master Project not found" });

      // Fetch linked estimates with store info
      const linkedEstimateRows = await db
        .select({
          id: estimates.id,
          estimateNumber: estimates.estimateNumber,
          title: estimates.title,
          clientId: estimates.clientId,
          brandId: estimates.brandId,
          poNumber: estimates.poNumber,
          poDate: estimates.poDate,
          subtotal: estimates.subtotal,
          taxAmount: estimates.taxAmount,
          totalAmount: estimates.totalAmount,
          status: estimates.status,
          clientFormat: estimates.clientFormat,
          estimateDate: estimates.estimateDate,
          createdAt: estimates.createdAt,
          linkedAt: projectEstimates.linkedAt,
          brandName: brands.name,
        })
        .from(projectEstimates)
        .innerJoin(estimates, eq(projectEstimates.estimateId, estimates.id))
        .leftJoin(brands, eq(estimates.brandId, brands.id))
        .where(
          and(
            eq(projectEstimates.projectId, id),
            eq(projectEstimates.status, "active")
          )
        )
        .orderBy(estimates.id);

      // Collect stores for each estimate
      const estimatesWithStores = await Promise.all(
        linkedEstimateRows.map(async (est) => {
          const storeRows = await db
            .select({
              storeId: executionStores.storeId,
              storeCode: executionStores.storeCode,
              storeName: executionStores.storeName,
              storeCity: executionStores.storeCity,
              storeState: executionStores.storeState,
              billingReady: executionStores.billingReady,
            })
            .from(executionStores)
            .where(eq(executionStores.estimateId, est.id));

          return {
            ...est,
            stores: storeRows,
            storeCount: storeRows.length || 1,
          };
        })
      );

      res.json({
        project: proj,
        estimates: estimatesWithStores,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch master project" });
    }
  });

  app.patch("/api/operations/master-projects/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

      const [existingProj] = await db
        .select()
        .from(masterProjects)
        .where(and(eq(masterProjects.id, id), eq(masterProjects.companyId, companyId)))
        .limit(1);
      if (!existingProj) return res.status(404).json({ message: "Master Project not found" });

      const { estimateIds, ...updates } = req.body || {};

      const updated = await db.transaction(async (tx) => {
        // 1. Update project metadata
        const [proj] = await tx
          .update(masterProjects)
          .set({
            ...updates,
            updatedAt: new Date(),
          })
          .where(eq(masterProjects.id, id))
          .returning();

        // 2. If estimateIds specified, synchronize project_estimates
        if (Array.isArray(estimateIds)) {
          const newIds = estimateIds.map(Number).filter(Boolean);

          // Validate new additions
          for (const eid of newIds) {
            const [est] = await tx.select().from(estimates).where(eq(estimates.id, eid)).limit(1);
            if (!est) throw new Error(`Estimate #${eid} not found`);
            if (est.companyId !== companyId) throw new Error(`Cross-company assignment forbidden`);
            if (est.clientId !== existingProj.clientId) throw new Error(`Client mismatch for Estimate #${est.estimateNumber}`);

            // Ensure not already linked to another active master project
            const [alreadyLinked] = await tx
              .select({
                peId: projectEstimates.id,
                projectId: projectEstimates.projectId,
                projectName: masterProjects.name,
                projectCode: masterProjects.projectCode,
              })
              .from(projectEstimates)
              .innerJoin(masterProjects, eq(projectEstimates.projectId, masterProjects.id))
              .where(
                and(
                  eq(projectEstimates.estimateId, eid),
                  eq(projectEstimates.companyId, companyId),
                  eq(projectEstimates.status, "active"),
                  ne(projectEstimates.projectId, id),
                  ne(masterProjects.status, "archived")
                )
              )
              .limit(1);

            if (alreadyLinked) {
              throw new Error(
                `Estimate #${est.estimateNumber} is already linked to Master Project "${alreadyLinked.projectName}" (${alreadyLinked.projectCode})`
              );
            }
          }

          // Soft-unlink removed estimates (preserves historical audit record)
          await tx
            .update(projectEstimates)
            .set({
              status: "unlinked",
              unlinkedAt: new Date(),
              unlinkedBy: req.user?.id || null,
            })
            .where(
              and(
                eq(projectEstimates.projectId, id),
                eq(projectEstimates.status, "active"),
                newIds.length > 0 ? sql`${projectEstimates.estimateId} NOT IN (${sql.join(newIds, sql`, `)})` : sql`TRUE`
              )
            );

          // Insert or reactivate newly added estimates
          for (const eid of newIds) {
            const [existingLink] = await tx
              .select()
              .from(projectEstimates)
              .where(
                and(
                  eq(projectEstimates.projectId, id),
                  eq(projectEstimates.estimateId, eid),
                  eq(projectEstimates.companyId, companyId)
                )
              )
              .limit(1);

            if (existingLink) {
              if (existingLink.status !== "active") {
                await tx
                  .update(projectEstimates)
                  .set({
                    status: "active",
                    linkedAt: new Date(),
                    linkedBy: req.user?.id || null,
                    unlinkedAt: null,
                    unlinkedBy: null,
                  })
                  .where(eq(projectEstimates.id, existingLink.id));
              }
            } else {
              await tx.insert(projectEstimates).values({
                companyId,
                projectId: id,
                estimateId: eid,
                status: "active",
                linkedBy: req.user?.id || null,
              });
            }
          }
        }

        return proj;
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update master project" });
    }
  });

  // ==========================================
  // 3. DYNAMIC ESTIMATE SELECTOR (Unlinked Only)
  // ==========================================

  app.get("/api/operations/estimates/available-for-project", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
      const brandId = req.query.brandId ? Number(req.query.brandId) : undefined;
      const search = (req.query.search as string || "").trim();
      const currentProjectId = req.query.currentProjectId ? Number(req.query.currentProjectId) : undefined;

      // Base query: All estimates for company
      const conditions: any[] = [eq(estimates.companyId, companyId)];

      if (clientId) {
        conditions.push(eq(estimates.clientId, clientId));
      }
      if (brandId) {
        conditions.push(eq(estimates.brandId, brandId));
      }
      if (search) {
        conditions.push(
          or(
            ilike(estimates.estimateNumber, `%${search}%`),
            ilike(estimates.title, `%${search}%`),
            ilike(estimates.poNumber, `%${search}%`)
          )
        );
      }

      // Exclude estimates linked to ANY other active master project
      const subquery = db
        .select({ estimateId: projectEstimates.estimateId })
        .from(projectEstimates)
        .innerJoin(masterProjects, eq(projectEstimates.projectId, masterProjects.id))
        .where(
          and(
            eq(projectEstimates.companyId, companyId),
            eq(projectEstimates.status, "active"),
            ne(masterProjects.status, "archived"),
            currentProjectId ? ne(projectEstimates.projectId, currentProjectId) : sql`TRUE`
          )
        );

      conditions.push(sql`${estimates.id} NOT IN (${subquery})`);

      const availableEstimates = await db
        .select({
          id: estimates.id,
          estimateNumber: estimates.estimateNumber,
          title: estimates.title,
          clientId: estimates.clientId,
          brandId: estimates.brandId,
          poNumber: estimates.poNumber,
          poDate: estimates.poDate,
          subtotal: estimates.subtotal,
          taxAmount: estimates.taxAmount,
          totalAmount: estimates.totalAmount,
          status: estimates.status,
          clientFormat: estimates.clientFormat,
          createdAt: estimates.createdAt,
          clientName: clients.name,
          brandName: brands.name,
        })
        .from(estimates)
        .leftJoin(clients, eq(estimates.clientId, clients.id))
        .leftJoin(brands, eq(estimates.brandId, brands.id))
        .where(and(...conditions))
        .orderBy(desc(estimates.createdAt))
        .limit(150);

      // Collect store codes for each estimate
      const enriched = await Promise.all(
        availableEstimates.map(async (est) => {
          const storeRows = await db
            .select({
              storeCode: executionStores.storeCode,
              storeName: executionStores.storeName,
            })
            .from(executionStores)
            .where(eq(executionStores.estimateId, est.id));

          return {
            ...est,
            stores: storeRows,
            storeCount: storeRows.length || 1,
          };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch available estimates" });
    }
  });

  // ==========================================
  // 4. PROJECT PROFITABILITY & STORE-WISE P&L
  // ==========================================

  app.get("/api/finance/master-projects/:id/profitability", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      if (isNaN(id) || id <= 0) return res.status(400).json({ message: "Invalid project ID" });

      const [proj] = await db
        .select()
        .from(masterProjects)
        .where(and(eq(masterProjects.id, id), eq(masterProjects.companyId, companyId)))
        .limit(1);
      if (!proj) return res.status(404).json({ message: "Master Project not found" });

      // 1. Linked estimates
      const linkedEsts = await db
        .select({
          estimateId: projectEstimates.estimateId,
          estimateNumber: estimates.estimateNumber,
          title: estimates.title,
          subtotal: estimates.subtotal,
          taxAmount: estimates.taxAmount,
          totalAmount: estimates.totalAmount,
        })
        .from(projectEstimates)
        .innerJoin(estimates, eq(projectEstimates.estimateId, estimates.id))
        .where(
          and(
            eq(projectEstimates.projectId, id),
            eq(projectEstimates.status, "active")
          )
        );

      const estimateIds = linkedEsts.map((e) => e.estimateId);

      // 2. Sales Invoices
      let totalInvoicedSales = 0; // Net of credit notes, excluding output GST
      let totalCollections = 0;
      const invoiceStoreMap: Record<string, { invoiced: number; collections: number }> = {};

      if (estimateIds.length > 0) {
        const invs = await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            estimateId: invoices.estimateId,
            storeId: invoices.storeId,
            storeCode: invoices.storeCode,
            storeName: invoices.storeName,
            amount: invoices.amount, // Taxable revenue
            taxAmount: invoices.taxAmount,
            totalAmount: invoices.totalAmount,
            paidAmount: invoices.paidAmount,
            type: invoices.type,
            status: invoices.status,
            lineItems: invoices.lineItems,
          })
          .from(invoices)
          .where(
            and(
              inArray(invoices.estimateId, estimateIds),
              ne(invoices.status, "cancelled")
            )
          );

        for (const inv of invs) {
          const amt = Number(inv.amount || 0);
          const paid = Number(inv.paidAmount || 0);

          if (inv.type === "sales") {
            totalInvoicedSales += amt;
            totalCollections += paid;
          } else if (inv.type === "credit_note") {
            totalInvoicedSales -= amt;
          }

          // Distribute across stores: Check if header has storeCode, or line items have storeCode
          const headerStoreCode = inv.storeCode ? inv.storeCode.trim().toUpperCase() : null;
          const rawLines = Array.isArray(inv.lineItems) ? inv.lineItems : [];
          const linesWithStores = rawLines.filter((l: any) => l && l.storeCode);

          if (headerStoreCode) {
            if (!invoiceStoreMap[headerStoreCode]) {
              invoiceStoreMap[headerStoreCode] = { invoiced: 0, collections: 0 };
            }
            if (inv.type === "sales") {
              invoiceStoreMap[headerStoreCode].invoiced += amt;
              invoiceStoreMap[headerStoreCode].collections += paid;
            } else if (inv.type === "credit_note") {
              invoiceStoreMap[headerStoreCode].invoiced -= amt;
            }
          } else if (linesWithStores.length > 0) {
            // Compute total amount of lines to prorate collections
            const sumLineAmts = rawLines.reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0);
            for (const line of rawLines) {
              const lineScode = (line.storeCode || "GENERAL").trim().toUpperCase();
              const lineAmt = Number(line.amount || 0);
              const linePaid = sumLineAmts > 0 ? (lineAmt / sumLineAmts) * paid : 0;

              if (!invoiceStoreMap[lineScode]) {
                invoiceStoreMap[lineScode] = { invoiced: 0, collections: 0 };
              }

              if (inv.type === "sales") {
                invoiceStoreMap[lineScode].invoiced += lineAmt;
                invoiceStoreMap[lineScode].collections += linePaid;
              } else if (inv.type === "credit_note") {
                invoiceStoreMap[lineScode].invoiced -= lineAmt;
              }
            }
          } else {
            // General / Unassigned to specific store
            const scode = "GENERAL";
            if (!invoiceStoreMap[scode]) {
              invoiceStoreMap[scode] = { invoiced: 0, collections: 0 };
            }
            if (inv.type === "sales") {
              invoiceStoreMap[scode].invoiced += amt;
              invoiceStoreMap[scode].collections += paid;
            } else if (inv.type === "credit_note") {
              invoiceStoreMap[scode].invoiced -= amt;
            }
          }
        }
      }

      // 3. Recognized Costs from project_cost_allocations
      const costAllocations = await db
        .select()
        .from(projectCostAllocations)
        .where(
          and(
            eq(projectCostAllocations.projectId, id),
            eq(projectCostAllocations.status, "active")
          )
        )
        .orderBy(desc(projectCostAllocations.createdAt));

      let totalRecognisedCost = 0;
      let totalRecoverableGst = 0;
      let totalIneligibleGst = 0;

      // Group costs by store
      const storeCostMap: Record<
        string,
        {
          materials: number;
          printing: number;
          fabrication: number;
          installation: number;
          transport: number;
          pettyCash: number;
          other: number;
          totalCost: number;
        }
      > = {};

      const projectWideOverhead: any[] = [];

      for (const alloc of costAllocations) {
        const cost = Number(alloc.recognisedCost || 0);
        totalRecognisedCost += cost;
        totalRecoverableGst += alloc.isRecoverableGst ? Number(alloc.gstAmount || 0) : 0;
        totalIneligibleGst += Number(alloc.ineligibleGstAmount || 0);

        if (!alloc.storeCode) {
          projectWideOverhead.push(alloc);
        } else {
          const scode = alloc.storeCode.trim().toUpperCase();
          if (!storeCostMap[scode]) {
            storeCostMap[scode] = {
              materials: 0,
              printing: 0,
              fabrication: 0,
              installation: 0,
              transport: 0,
              pettyCash: 0,
              other: 0,
              totalCost: 0,
            };
          }

          storeCostMap[scode].totalCost += cost;
          const cat = alloc.costCategory.toLowerCase();
          if (cat === "materials" || cat === "raw_materials") storeCostMap[scode].materials += cost;
          else if (cat === "printing") storeCostMap[scode].printing += cost;
          else if (cat === "fabrication" || cat === "acrylic_fabrication") storeCostMap[scode].fabrication += cost;
          else if (cat === "installation") storeCostMap[scode].installation += cost;
          else if (cat === "transport" || cat === "local_transport" || cat === "outstation_transport") storeCostMap[scode].transport += cost;
          else if (alloc.sourceType === "petty_cash") storeCostMap[scode].pettyCash += cost;
          else storeCostMap[scode].other += cost;
        }
      }

      // 4. Open Contractor Commitments
      const workOrders = await db
        .select()
        .from(contractorWorkOrders)
        .where(
          and(
            eq(contractorWorkOrders.projectId, id),
            ne(contractorWorkOrders.status, "cancelled")
          )
        );

      let totalOpenCommitments = 0;
      for (const wo of workOrders) {
        const committed = Number(wo.committedAmount || 0);
        const billed = Number(wo.billedAmount || 0);
        const remaining = Math.max(0, committed - billed);
        totalOpenCommitments += remaining;
      }

      // 5. Consolidated Calculations
      const quotedRevenue = linkedEsts.reduce((sum, e) => sum + (Number(e.totalAmount) || 0), 0);
      const quotedSubtotal = linkedEsts.reduce((sum, e) => sum + (Number(e.subtotal) || 0), 0);
      const actualProfit = +(totalInvoicedSales - totalRecognisedCost).toFixed(2);
      const actualMarginPercent = totalInvoicedSales > 0 ? +((actualProfit / totalInvoicedSales) * 100).toFixed(2) : 0;
      const forecastProfit = +(totalInvoicedSales - (totalRecognisedCost + totalOpenCommitments)).toFixed(2);
      const forecastMarginPercent = totalInvoicedSales > 0 ? +((forecastProfit / totalInvoicedSales) * 100).toFixed(2) : 0;

      // 6. Build Consolidated Store Matrix
      // Collect all stores across executionStores for linked estimates
      let allStores: any[] = [];
      if (estimateIds.length > 0) {
        allStores = await db
          .select({
            storeId: executionStores.storeId,
            storeCode: executionStores.storeCode,
            storeName: executionStores.storeName,
            storeCity: executionStores.storeCity,
            storeState: executionStores.storeState,
            estimateId: executionStores.estimateId,
          })
          .from(executionStores)
          .where(inArray(executionStores.estimateId, estimateIds));
      }

      // De-duplicate stores by storeCode
      const storeMap = new Map<string, any>();
      for (const st of allStores) {
        const code = (st.storeCode || "").trim().toUpperCase();
        if (code && !storeMap.has(code)) {
          storeMap.set(code, st);
        }
      }

      // Ensure stores with direct costs are included in the matrix
      for (const code of Object.keys(storeCostMap)) {
        if (!storeMap.has(code)) {
          storeMap.set(code, {
            storeId: null,
            storeCode: code,
            storeName: `Store ${code}`,
            storeCity: "-",
            storeState: "-",
            estimateId: null,
          });
        }
      }

      // Ensure stores with billed revenue are included in the matrix
      for (const code of Object.keys(invoiceStoreMap)) {
        if (code !== "GENERAL" && !storeMap.has(code)) {
          storeMap.set(code, {
            storeId: null,
            storeCode: code,
            storeName: `Store ${code}`,
            storeCity: "-",
            storeState: "-",
            estimateId: null,
          });
        }
      }

      const storeRows = Array.from(storeMap.values()).map((st) => {
        const code = st.storeCode.trim().toUpperCase();
        const invoiced = invoiceStoreMap[code]?.invoiced || 0;
        const collections = invoiceStoreMap[code]?.collections || 0;
        const costs = storeCostMap[code] || {
          materials: 0,
          printing: 0,
          fabrication: 0,
          installation: 0,
          transport: 0,
          pettyCash: 0,
          other: 0,
          totalCost: 0,
        };

        const storeProfit = +(invoiced - costs.totalCost).toFixed(2);
        const storeMargin = invoiced > 0 ? +((storeProfit / invoiced) * 100).toFixed(2) : 0;

        return {
          storeCode: st.storeCode,
          storeName: st.storeName || st.storeCode,
          city: st.storeCity,
          state: st.storeState,
          estimateId: st.estimateId,
          invoicedRevenue: +invoiced.toFixed(2),
          collections: +collections.toFixed(2),
          directCosts: {
            materials: +costs.materials.toFixed(2),
            printing: +costs.printing.toFixed(2),
            fabrication: +costs.fabrication.toFixed(2),
            installation: +costs.installation.toFixed(2),
            transport: +costs.transport.toFixed(2),
            pettyCash: +costs.pettyCash.toFixed(2),
            other: +costs.other.toFixed(2),
          },
          totalCost: +costs.totalCost.toFixed(2),
          profit: storeProfit,
          marginPercent: storeMargin,
        };
      });

      // If there is unassigned rollout revenue (not tied to a specific store code), add a reconciling row
      const generalInvoiced = invoiceStoreMap["GENERAL"]?.invoiced || 0;
      const generalCollections = invoiceStoreMap["GENERAL"]?.collections || 0;
      if (generalInvoiced > 0 || generalCollections > 0) {
        storeRows.push({
          storeCode: "SHARED-REVENUE",
          storeName: "Rollout-wide / Unassigned Revenue",
          city: "-",
          state: "-",
          estimateId: null,
          invoicedRevenue: +generalInvoiced.toFixed(2),
          collections: +generalCollections.toFixed(2),
          directCosts: {
            materials: 0,
            printing: 0,
            fabrication: 0,
            installation: 0,
            transport: 0,
            pettyCash: 0,
            other: 0,
          },
          totalCost: 0,
          profit: +generalInvoiced.toFixed(2),
          marginPercent: 100,
        });
      }

      res.json({
        summary: {
          quotedRevenue: +quotedRevenue.toFixed(2),
          quotedSubtotal: +quotedSubtotal.toFixed(2),
          invoicedSales: +totalInvoicedSales.toFixed(2),
          collections: +totalCollections.toFixed(2),
          actualRecognisedCost: +totalRecognisedCost.toFixed(2),
          paidCost: +totalCollections.toFixed(2), // Estimated baseline
          outstandingSupplierCost: Math.max(0, +(totalRecognisedCost - totalCollections).toFixed(2)),
          openCommitments: +totalOpenCommitments.toFixed(2),
          recoverableGst: +totalRecoverableGst.toFixed(2),
          ineligibleGst: +totalIneligibleGst.toFixed(2),
          actualProfit,
          actualMarginPercent,
          forecastProfit,
          forecastMarginPercent,
        },
        storeBreakdown: storeRows,
        projectWideOverhead: {
          totalOverhead: +projectWideOverhead.reduce((s, it) => s + (Number(it.recognisedCost) || 0), 0).toFixed(2),
          items: projectWideOverhead,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to calculate profitability" });
    }
  });

  // ==========================================
  // 5. COST ALLOCATION ENGINE (Single & Multi-Store Split)
  // ==========================================

  app.get("/api/finance/project-cost-allocations", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const estimateId = req.query.estimateId ? Number(req.query.estimateId) : undefined;
      const sourceId = req.query.sourceId ? Number(req.query.sourceId) : undefined;
      const sourceType = req.query.sourceType as string | undefined;

      const conditions: any[] = [eq(projectCostAllocations.companyId, companyId)];
      if (projectId) conditions.push(eq(projectCostAllocations.projectId, projectId));
      if (estimateId) conditions.push(eq(projectCostAllocations.estimateId, estimateId));
      if (sourceId) conditions.push(eq(projectCostAllocations.sourceId, sourceId));
      if (sourceType) conditions.push(eq(projectCostAllocations.sourceType, sourceType));

      const rows = await db
        .select()
        .from(projectCostAllocations)
        .where(and(...conditions))
        .orderBy(desc(projectCostAllocations.createdAt));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch cost allocations" });
    }
  });

  app.post("/api/finance/project-cost-allocations", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const payload = req.body;
      const items: any[] = Array.isArray(payload) ? payload : [payload];

      if (items.length === 0) {
        return res.status(400).json({ message: "No allocation items provided" });
      }

      const created = await db.transaction(async (tx) => {
        const results: any[] = [];

        // Track invoice allocations in this batch to prevent exceeding invoice base amount
        const invoiceAllocationTotals = new Map<number, number>();

        // Validate each allocation
        for (const item of items) {
          const parsed = insertProjectCostAllocationSchema.safeParse({
            ...item,
            companyId,
            createdBy: req.user?.id || null,
          });
          if (!parsed.success) {
            throw new Error(`Invalid allocation: ${parsed.error.errors.map((e) => e.message).join(", ")}`);
          }

          const baseAmt = Number(parsed.data.baseAmount);
          if (isNaN(baseAmt) || baseAmt <= 0) {
            throw new Error(`Allocated base amount must be greater than zero`);
          }

          // If allocation is linked to a purchase invoice, validate that total allocated does not exceed invoice base amount
          if (parsed.data.sourceType === "purchase_invoice" && parsed.data.sourceId) {
            const invoiceId = Number(parsed.data.sourceId);
            const [inv] = await tx
              .select()
              .from(invoices)
              .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));

            if (!inv) {
              throw new Error(`Purchase invoice #${invoiceId} not found`);
            }

            const currentBatchTotal = (invoiceAllocationTotals.get(invoiceId) || 0) + baseAmt;
            invoiceAllocationTotals.set(invoiceId, currentBatchTotal);

            const existingAllocations = await tx
              .select()
              .from(projectCostAllocations)
              .where(
                and(
                  eq(projectCostAllocations.sourceType, "purchase_invoice"),
                  eq(projectCostAllocations.sourceId, invoiceId),
                  eq(projectCostAllocations.status, "active")
                )
              );

            const alreadyAllocated = existingAllocations.reduce((sum, a) => sum + Number(a.baseAmount || 0), 0);
            const maxAllowed = Number(inv.amount || inv.totalAmount || 0);

            if (alreadyAllocated + currentBatchTotal > maxAllowed + 0.01) {
              throw new Error(
                `Total allocated amount (₹${(alreadyAllocated + currentBatchTotal).toFixed(2)}) exceeds invoice base amount (₹${maxAllowed.toFixed(2)})`
              );
            }
          }

          // Calculate recognised cost: If GST is recoverable, cost is base amount.
          // If ineligible, GST is added to project cost.
          const isRecoverable = parsed.data.isRecoverableGst !== false;
          const inelig = Number(parsed.data.ineligibleGstAmount || 0);
          const recognisedCost = +(baseAmt + (isRecoverable ? 0 : inelig || Number(parsed.data.gstAmount || 0))).toFixed(2);

          const [inserted] = await tx
            .insert(projectCostAllocations)
            .values({
              ...parsed.data,
              recognisedCost: String(recognisedCost.toFixed(2)),
            })
            .returning();

          results.push(inserted);
        }

        return results;
      });

      res.status(201).json(Array.isArray(payload) ? created : created[0]);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create cost allocations" });
    }
  });

  app.post("/api/finance/project-cost-allocations/:id/reverse", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);
      const reason = (req.body?.reason || "").toString().trim();
      if (!reason) return res.status(400).json({ message: "Reversal reason is required" });

      const [existing] = await db
        .select()
        .from(projectCostAllocations)
        .where(and(eq(projectCostAllocations.id, id), eq(projectCostAllocations.companyId, companyId)))
        .limit(1);

      if (!existing) return res.status(404).json({ message: "Allocation not found" });
      if (existing.status === "reversed") return res.status(400).json({ message: "Allocation is already reversed" });

      const [updated] = await db
        .update(projectCostAllocations)
        .set({
          status: "reversed",
          reversalReason: reason,
          reversedAt: new Date(),
          reversedBy: req.user?.id || null,
        })
        .where(eq(projectCostAllocations.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to reverse allocation" });
    }
  });

  // ==========================================
  // 6. CONTRACTOR WORK ORDERS & COMMITMENTS
  // ==========================================

  app.get("/api/operations/contractor-work-orders", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;

      const conditions = [eq(contractorWorkOrders.companyId, companyId)];
      if (projectId) conditions.push(eq(contractorWorkOrders.projectId, projectId));

      const rows = await db
        .select()
        .from(contractorWorkOrders)
        .where(and(...conditions))
        .orderBy(desc(contractorWorkOrders.createdAt));

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch work orders" });
    }
  });

  app.post("/api/operations/contractor-work-orders", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const parsed = insertContractorWorkOrderSchema.safeParse({
        ...req.body,
        companyId,
        createdBy: req.user?.id || null,
      });

      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid work order data", errors: parsed.error.errors });
      }

      const [wo] = await db.insert(contractorWorkOrders).values(parsed.data).returning();
      res.status(201).json(wo);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create work order" });
    }
  });

  app.patch("/api/operations/contractor-work-orders/:id", authenticateToken, requireRole(["admin", "manager", "accounts"]), async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.companyId || 1;
      const id = Number(req.params.id);

      const [wo] = await db
        .update(contractorWorkOrders)
        .set(req.body)
        .where(and(eq(contractorWorkOrders.id, id), eq(contractorWorkOrders.companyId, companyId)))
        .returning();

      if (!wo) return res.status(404).json({ message: "Work order not found" });
      res.json(wo);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update work order" });
    }
  });
}

// ==========================================
// 7. CROSS-MODULE ACCOUNTING SYNCHRONIZERS
// ==========================================

/**
 * Synchronizes a Petty Cash expense with its Master Project cost allocation.
 * - If approved and linked to a project: creates or updates the active cost allocation.
 * - If rejected/cancelled/unlinked: reverses the active allocation with an audit note.
 * - Ensures idempotency: editing an expense never creates a duplicate allocation.
 */
export async function syncPettyCashExpenseAllocation(
  expense: any,
  userId?: number | null,
  executor: any = db
): Promise<void> {
  if (!expense || !expense.id) return;
  const ext = (expense.extractedData || expense.extracted_data || {}) as Record<string, any>;
  const projectId = ext.masterProjectId ? Number(ext.masterProjectId) : null;

  // If no project is linked, check if an active allocation previously existed and reverse it
  if (!projectId) {
    await executor
      .update(projectCostAllocations)
      .set({
        status: "reversed",
        reversalReason: "Petty cash expense unlinked from Master Project",
        reversedAt: new Date(),
        reversedBy: userId || null,
      })
      .where(
        and(
          eq(projectCostAllocations.sourceType, "petty_cash"),
          eq(projectCostAllocations.sourceId, expense.id),
          eq(projectCostAllocations.status, "active")
        )
      );
    return;
  }

  // If approved, create or update the allocation
  if (expense.status === "approved") {
    const existing = await executor
      .select()
      .from(projectCostAllocations)
      .where(
        and(
          eq(projectCostAllocations.sourceType, "petty_cash"),
          eq(projectCostAllocations.sourceId, expense.id)
        )
      )
      .limit(1);

    const amount = Number(expense.amount || 0);
    const formattedAmount = amount.toFixed(2);
    const storeCode = ext.storeCode ? String(ext.storeCode).trim().toUpperCase() : null;
    let estimateId: number | null = null;
    if (ext.estimateId) {
      const eid = Number(ext.estimateId);
      const [link] = await executor
        .select({ id: projectEstimates.id })
        .from(projectEstimates)
        .where(
          and(
            eq(projectEstimates.projectId, projectId),
            eq(projectEstimates.estimateId, eid),
            eq(projectEstimates.status, "active")
          )
        )
        .limit(1);
      if (link) {
        estimateId = eid;
      }
    }
    const desc = expense.description || `Petty cash: ${expense.category || "General"}`;

    if (existing[0]) {
      await executor
        .update(projectCostAllocations)
        .set({
          projectId,
          estimateId,
          storeCode,
          baseAmount: formattedAmount,
          totalAmount: formattedAmount,
          recognisedCost: formattedAmount,
          costCategory: "petty_cash",
          description: desc,
          status: "active",
          reversalReason: null,
          reversedAt: null,
          reversedBy: null,
        })
        .where(eq(projectCostAllocations.id, existing[0].id));
    } else {
      await executor.insert(projectCostAllocations).values({
        companyId: expense.companyId || 1,
        projectId,
        estimateId,
        storeCode,
        sourceType: "petty_cash",
        sourceId: expense.id,
        sourceReference: `PC-${expense.id}`,
        costCategory: "petty_cash",
        description: desc,
        baseAmount: formattedAmount,
        gstRate: "0.00",
        gstAmount: "0.00",
        totalAmount: formattedAmount,
        isRecoverableGst: false,
        ineligibleGstAmount: "0.00",
        recognisedCost: formattedAmount,
        status: "active",
        createdBy: userId || expense.addedBy || null,
      });
    }
  } else {
    // If not approved (e.g. pending, rejected, cancelled), reverse active allocation
    await executor
      .update(projectCostAllocations)
      .set({
        status: "reversed",
        reversalReason: `Petty cash expense status is ${expense.status}`,
        reversedAt: new Date(),
        reversedBy: userId || null,
      })
      .where(
        and(
          eq(projectCostAllocations.sourceType, "petty_cash"),
          eq(projectCostAllocations.sourceId, expense.id),
          eq(projectCostAllocations.status, "active")
        )
      );
  }
}

/**
 * Reverses all active project cost allocations linked to a cancelled purchase invoice.
 */
export async function cancelInvoiceCostAllocations(
  invoiceId: number,
  invoiceNumber: string,
  userId?: number | null,
  executor: any = db
): Promise<void> {
  await executor
    .update(projectCostAllocations)
    .set({
      status: "reversed",
      reversalReason: `Source purchase invoice #${invoiceNumber} cancelled`,
      reversedAt: new Date(),
      reversedBy: userId || null,
    })
    .where(
      and(
        eq(projectCostAllocations.sourceType, "purchase_invoice"),
        eq(projectCostAllocations.sourceId, invoiceId),
        eq(projectCostAllocations.status, "active")
      )
    );
}
