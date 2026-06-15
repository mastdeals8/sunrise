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

  const fetchLedgerData = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const invRes = await fetch("/api/finance/invoices", { headers });
      if (invRes.ok) {
        const rows = await invRes.json();
        setInvoices(globalRange ? rows.filter((row: Invoice) => isDateInRange(row.date || row.createdAt, globalRange)) : rows);
      }

      const sumRes = await fetch("/api/finance/ledgers/summary", { headers });
      if (sumRes.ok) setLedgerSummary(await sumRes.json());
    } catch (err) {
      console.error("Error loading ledger data:", err);
    }
  }, [token]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${token}` };

      const cRes = await fetch("/api/operations/clients", { headers });
      if (cRes.ok) setClients(await cRes.json());

      const bRes = await fetch("/api/operations/brands", { headers });
      if (bRes.ok) setBrands(await bRes.json());

      const sRes = await fetch("/api/operations/stores", { headers });
      if (sRes.ok) setStores(await sRes.json());

      const pRes = await fetch("/api/operations/products", { headers });
      if (pRes.ok) setProducts(await pRes.json());

      try {
        const mcRes = await fetch("/api/operations/material-codes", { headers });
        if (mcRes.ok) setMaterialCodes(await mcRes.json());
      } catch (e) {
        console.warn("Material codes fetch failed:", e);
      }

      const eRes = await fetch("/api/operations/estimates", { headers });
      if (eRes.ok) {
        const rows = await eRes.json();
        setEstimates(globalRange ? rows.filter((row: Estimate) => isDateInRange(row.estimateDate || row.createdAt, globalRange)) : rows);
      }

      const dRes = await fetch("/api/operations/delivery-challans", { headers });
      if (dRes.ok) {
        const rows = await dRes.json();
        setChallans(globalRange ? rows.filter((row: DeliveryChallan) => isDateInRange((row as any).createdAt || row.deliveryDate, globalRange)) : rows);
      }

      await fetchLedgerData();
    } catch (err) {
      console.error("Error loading operations data:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchLedgerData, globalRange, token]);

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
    fetchData,
  };
};
