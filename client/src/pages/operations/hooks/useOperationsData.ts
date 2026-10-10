import { useCallback, useEffect, useState } from "react";
import { isDateInRange, type DateRange } from "../../../contexts/GlobalDateContext";
import type { Brand, Client, DeliveryChallan, Estimate, MaterialCodeRow, Product, Store } from "../types";
import { isBoltMode } from "../../../lib/supabase";
import {
  fetchClients,
  fetchBrands,
  fetchStores,
  fetchProducts,
  fetchMaterialCodes,
  fetchEstimates,
  fetchDeliveryChallans,
  fetchInvoices,
  fetchLedgerSummary,
  apiFetch,
  getActiveCompanyId,
} from "../../../lib/api";

export interface Invoice {
  id: number;
  invoiceNumber: string;
  type: string;
  partyName: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  date: string;
  dueDate: string;
  status: string;
  estimateId: number | null;
  clientId: number | null;
  paidAmount: number;
  balanceAmount: number;
  packetSettings: any | null;
  remarks: string | null;
  createdAt: string;
}

export interface LedgerSummary {
  clientId: number;
  clientName: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  status: string;
}

export const useOperationsData = (token?: string | null, globalRange?: DateRange, companyId?: number) => {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCodeRow[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary[]>([]);

  const effectiveCompanyId = companyId ?? getActiveCompanyId();

  const applyRange = <T,>(rows: T[], dateKey: (r: T) => string | undefined) =>
    globalRange
      ? rows.filter((r) => isDateInRange(dateKey(r), globalRange))
      : rows;

  const fetchLedgerData = useCallback(async () => {
    try {
      if (isBoltMode) {
        const [inv, summary] = await Promise.all([
          fetchInvoices(token ?? null),
          fetchLedgerSummary(token ?? null),
        ]);
        setInvoices(
          applyRange(inv as Invoice[], (r) => (r as any).date || (r as any).createdAt)
        );
        setLedgerSummary(summary as LedgerSummary[]);
        return;
      }

      const [invRes, sumRes] = await Promise.all([
        apiFetch("/api/finance/invoices", token ?? null),
        apiFetch("/api/finance/ledgers/summary", token ?? null),
      ]);
      if (invRes.ok) {
        const rows = await invRes.json();
        setInvoices(
          applyRange(rows, (r: Invoice) => r.date || (r as any).createdAt)
        );
      }
      if (sumRes.ok) setLedgerSummary(await sumRes.json());
    } catch (err) {
      console.error("Error loading ledger data:", err);
    }
  }, [token, effectiveCompanyId, globalRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchEstimatesOnly = useCallback(async () => {
    try {
      const t0 = performance.now();
      const rows = await fetchEstimates(token ?? null);
      setEstimates(
        applyRange(rows as Estimate[], (r) =>
          (r as any).estimateDate || (r as any).createdAt
        )
      );
      console.log(`[fetchEstimates] ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      console.error("Error loading estimates:", err);
    }
  }, [token, effectiveCompanyId, globalRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const t0 = performance.now();

      if (isBoltMode) {
        const ledgerPromise = fetchLedgerData();
        const [c, b, s, p, mc, e, dc] = await Promise.all([
          fetchClients(token ?? null),
          fetchBrands(token ?? null),
          fetchStores(token ?? null),
          fetchProducts(token ?? null),
          fetchMaterialCodes(token ?? null),
          fetchEstimates(token ?? null),
          fetchDeliveryChallans(token ?? null),
        ]);
        setClients(c as Client[]);
        setBrands(b as Brand[]);
        setStores(s as Store[]);
        setProducts(p as Product[]);
        setMaterialCodes(mc as MaterialCodeRow[]);
        setEstimates(
          applyRange(e as Estimate[], (r) =>
            (r as any).estimateDate || (r as any).createdAt
          )
        );
        setChallans(
          applyRange(dc as DeliveryChallan[], (r) =>
            (r as any).createdAt || (r as any).deliveryDate
          )
        );
        await ledgerPromise;
        console.log(`[fetchData bolt] ${Math.round(performance.now() - t0)}ms`);
        return;
      }

      const [cRes, bRes, sRes, pRes, mcRes, eRes, dRes] = await Promise.all([
        apiFetch("/api/operations/clients", token ?? null),
        apiFetch("/api/operations/brands", token ?? null),
        apiFetch("/api/operations/stores", token ?? null),
        apiFetch("/api/operations/products", token ?? null),
        apiFetch("/api/operations/material-codes", token ?? null).catch(() => null),
        apiFetch("/api/operations/estimates", token ?? null),
        apiFetch("/api/operations/delivery-challans", token ?? null),
      ]);

      if (cRes.ok) setClients(await cRes.json());
      if (bRes.ok) setBrands(await bRes.json());
      if (sRes.ok) setStores(await sRes.json());
      if (pRes.ok) setProducts(await pRes.json());
      if (mcRes?.ok) setMaterialCodes(await mcRes.json());
      if (eRes.ok) {
        const rows = await eRes.json();
        setEstimates(
          applyRange(rows, (r: Estimate) => (r as any).estimateDate || (r as any).createdAt)
        );
      }
      if (dRes.ok) {
        const rows = await dRes.json();
        setChallans(
          applyRange(rows, (r: DeliveryChallan) =>
            (r as any).createdAt || r.deliveryDate
          )
        );
      }
      await fetchLedgerData();
      console.log(`[fetchData] ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      console.error("Error loading operations data:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLedgerData, globalRange, token, effectiveCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle active company switches across the application
  useEffect(() => {
    const handleSwitch = () => {
      setClients([]);
      setBrands([]);
      setStores([]);
      setProducts([]);
      setMaterialCodes([]);
      setEstimates([]);
      setChallans([]);
      setInvoices([]);
      setLedgerSummary([]);
      fetchData();
    };
    window.addEventListener("company-switched", handleSwitch);
    return () => window.removeEventListener("company-switched", handleSwitch);
  }, [fetchData]);

  return {
    loading,
    clients,
    setClients,
    brands,
    setBrands,
    stores,
    setStores,
    products,
    setProducts,
    materialCodes,
    setMaterialCodes,
    estimates,
    setEstimates,
    challans,
    setChallans,
    invoices,
    setInvoices,
    ledgerSummary,
    setLedgerSummary,
    fetchLedgerData,
    fetchEstimates: fetchEstimatesOnly,
    fetchData,
  };
};
