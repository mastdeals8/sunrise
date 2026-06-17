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
        fetch("/api/finance/invoices", { headers }),
        fetch("/api/finance/ledgers/summary", { headers }),
      ]);
      if (invRes.ok) {
        const rows = await invRes.json();
        setInvoices(
          applyRange(rows, (r: Invoice) => r.date || r.createdAt)
        );
      }
      if (sumRes.ok) setLedgerSummary(await sumRes.json());
    } catch (err) {
      console.error("Error loading ledger data:", err);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [token, globalRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const t0 = performance.now();

      if (isBoltMode) {
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
        await fetchLedgerData();
        console.log(`[fetchData bolt] ${Math.round(performance.now() - t0)}ms`);
        return;
      }

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
    fetchEstimates: fetchEstimatesOnly,
    fetchData,
  };
};
