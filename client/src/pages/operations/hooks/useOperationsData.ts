import { useCallback, useEffect, useState } from "react";
import { isDateInRange, type DateRange } from "../../../contexts/GlobalDateContext";
import type { Brand, Client, DeliveryChallan, Estimate, MaterialCodeRow, Product, Store } from "../types";

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

export const useOperationsData = (token?: string | null, globalRange?: DateRange) => {
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

  const headers = { Authorization: `Bearer ${token}` };

  const fetchLedgerData = useCallback(async () => {
    try {
      const [invRes, sumRes] = await Promise.all([
        fetch("/api/finance/invoices", { headers }),
        fetch("/api/finance/ledgers/summary", { headers }),
      ]);
      if (invRes.ok) {
        const rows = await invRes.json();
        setInvoices(globalRange ? rows.filter((row: Invoice) => isDateInRange(row.date || row.createdAt, globalRange)) : rows);
      }
      if (sumRes.ok) setLedgerSummary(await sumRes.json());
    } catch (err) {
      console.error("Error loading ledger data:", err);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Targeted: only refresh the estimates list. Used after estimate save/update
  // so the register shows updated amounts without waiting for all other data.
  const fetchEstimates = useCallback(async () => {
    try {
      const t0 = performance.now();
      const res = await fetch("/api/operations/estimates", { headers });
      if (res.ok) {
        const rows = await res.json();
        setEstimates(globalRange ? rows.filter((row: Estimate) => isDateInRange(row.estimateDate || row.createdAt, globalRange)) : rows);
      }
      console.log(`[fetchEstimates] completed in ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      console.error("Error loading estimates:", err);
    }
  }, [token, globalRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full refresh — runs all requests in parallel so total time ≈ slowest single
  // request, not the sum of all requests.
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const t0 = performance.now();

      const [cRes, bRes, sRes, pRes, mcRes, eRes, dRes] = await Promise.all([
        fetch("/api/operations/clients", { headers }),
        fetch("/api/operations/brands", { headers }),
        fetch("/api/operations/stores", { headers }),
        fetch("/api/operations/products", { headers }),
        fetch("/api/operations/material-codes", { headers }).catch(() => null),
        fetch("/api/operations/estimates", { headers }),
        fetch("/api/operations/delivery-challans", { headers }),
      ]);

      if (cRes.ok) setClients(await cRes.json());
      if (bRes.ok) setBrands(await bRes.json());
      if (sRes.ok) setStores(await sRes.json());
      if (pRes.ok) setProducts(await pRes.json());
      if (mcRes?.ok) setMaterialCodes(await mcRes.json());

      if (eRes.ok) {
        const rows = await eRes.json();
        setEstimates(globalRange ? rows.filter((row: Estimate) => isDateInRange(row.estimateDate || row.createdAt, globalRange)) : rows);
      }
      if (dRes.ok) {
        const rows = await dRes.json();
        setChallans(globalRange ? rows.filter((row: DeliveryChallan) => isDateInRange((row as any).createdAt || row.deliveryDate, globalRange)) : rows);
      }

      await fetchLedgerData();
      console.log(`[fetchData] all data loaded in ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      console.error("Error loading operations data:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLedgerData, globalRange, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
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
    fetchEstimates,
    fetchData,
  };
};
