// Bolt-style Client Workspace — a per-client dashboard at /clients/:id.
// Pulls data filtered by clientId from existing endpoints and shows
// compact tables across tabs (Overview, GST Profiles, Brands, Stores,
// Rate Cards, Estimates, WCC/DC, Invoices, Ledger). Read-only summaries;
// every "Edit" link jumps to the existing master page so this file owns
// no business logic.

import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "../contexts/AuthContext";
import {
  Building2, FileText, MapPin, Tag, Receipt, Wallet, Database, ChevronRight,
  Briefcase, Truck, ArrowLeft,
} from "lucide-react";

type Tab =
  | "overview"
  | "gst"
  | "brands"
  | "stores"
  | "rate_cards"
  | "estimates"
  | "challans"
  | "invoices"
  | "ledger";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview",   label: "Overview",      icon: Building2 },
  { key: "gst",        label: "GST Profiles",  icon: Database },
  { key: "brands",     label: "Brands",        icon: Tag },
  { key: "stores",     label: "Stores",        icon: MapPin },
  { key: "rate_cards", label: "Rate Cards",    icon: Receipt },
  { key: "estimates",  label: "Estimates",     icon: FileText },
  { key: "challans",   label: "WCC / DC",      icon: Truck },
  { key: "invoices",   label: "Invoices",      icon: Briefcase },
  { key: "ledger",     label: "Ledger",        icon: Wallet },
];

interface Client {
  id: number;
  name: string;
  format: string;
  city: string | null;
  mobile: string | null;
  email: string | null;
  gstNumber: string | null;
  paymentTerms: string | null;
  clientGroupName: string | null;
}

interface BillingProfile {
  id: number; legalCompanyName: string; gstin: string; state: string;
  stateCode: string; billingAddress: string; isDefault: boolean;
}

interface Brand { id: number; name: string; clientId: number | null; }
interface Store { id: number; storeCode: string; storeName: string; clientId: number; city: string | null; state: string | null; }
interface Estimate { id: number; estimateNumber: string; title: string; clientId: number; brandId: number | null; clientFormat: string; status: string; totalAmount: number; createdAt: string; poNumber: string | null; }
interface Invoice { id: number; invoiceNumber: string; clientId: number | null; estimateId: number | null; totalAmount: number; status: string; date: string; balanceAmount: number; }
interface Challan { id: number; dcNumber: string; estimateId: number | null; status: string; deliveryDate: string; clientFormat: string; }
interface RateCard { id: number; name: string | null; brandId: number | null; projectType: string | null; isActive: boolean; effectiveFrom: string | null; effectiveTo: string | null; }
interface LedgerRow { date: string; ref: string; type: string; debitAmount: number; creditAmount: number; balance: number; remarks: string | null; }

const fmtINR = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ClientWorkspace: React.FC = () => {
  const { token } = useAuth();
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);
  const [tab, setTab] = useState<Tab>("overview");

  const [client, setClient] = useState<Client | null>(null);
  const [billing, setBilling] = useState<BillingProfile[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  useEffect(() => {
    if (!token || !clientId) return;
    const h = { Authorization: `Bearer ${token}` };
    (async () => {
      const [cs, bp, br, st, es, inv, ch, rc] = await Promise.all([
        fetch("/api/operations/clients", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`/api/operations/clients/${clientId}/billing-profiles`, { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/operations/brands", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/operations/stores", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/operations/estimates", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/finance/invoices", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/operations/delivery-challans", { headers: h }).then(r => r.ok ? r.json() : []),
        fetch("/api/customer-rate-cards", { headers: h }).then(r => r.ok ? r.json() : []),
      ]);
      const allEstimates: Estimate[] = Array.isArray(es) ? es : [];
      const myEstimates = allEstimates.filter((e) => e.clientId === clientId);
      const myEstimateIds = new Set(myEstimates.map(e => e.id));
      const me = Array.isArray(cs) ? cs.find((c: Client) => c.id === clientId) : null;
      setClient(me || null);
      setBilling(Array.isArray(bp) ? bp : []);
      setBrands(Array.isArray(br) ? br : []);
      setStores((Array.isArray(st) ? st : []).filter((s: Store) => s.clientId === clientId));
      setEstimates(myEstimates);
      setInvoices((Array.isArray(inv) ? inv : []).filter((i: Invoice) => i.clientId === clientId));
      setChallans((Array.isArray(ch) ? ch : []).filter((c: Challan) => c.estimateId !== null && myEstimateIds.has(c.estimateId)));
      setRateCards((Array.isArray(rc) ? rc : []).filter((r: any) => r.clientId === clientId));
    })();
  }, [token, clientId]);

  // Ledger loaded separately — endpoint returns { statement: [...] }
  useEffect(() => {
    if (!token || !clientId || tab !== "ledger") return;
    const h = { Authorization: `Bearer ${token}` };
    fetch(`/api/finance/ledgers/client/${clientId}`, { headers: h })
      .then(r => r.ok ? r.json() : { statement: [] })
      .then(d => setLedger(Array.isArray(d?.statement) ? d.statement : []));
  }, [token, clientId, tab]);

  const totals = useMemo(() => {
    const billed = invoices.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
    const balance = invoices.reduce((s, i) => s + (Number(i.balanceAmount) || 0), 0);
    const inProgress = estimates.filter(e => e.status === "approved" || e.status === "in_progress").length;
    return { billed, balance, inProgress, estimates: estimates.length, invoices: invoices.length, stores: stores.length };
  }, [estimates, invoices, stores]);

  if (!client) {
    return (
      <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Link href="/clients" className="hover:text-slate-800">Clients</Link>
          <ChevronRight className="w-4 h-4" />
          <span>Loading…</span>
        </div>
        <div className="h-32 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto px-2 sm:px-4">
      {/* Breadcrumb + title */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/clients" className="flex items-center gap-1 hover:text-slate-800"><ArrowLeft className="w-3.5 h-3.5" /> Clients</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-700 font-semibold">{client.name}</span>
      </div>
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-2 gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{client.name}</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            {client.clientGroupName || client.format}
            {client.city ? ` • ${client.city}` : ""}
            {client.gstNumber ? ` • GST ${client.gstNumber}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/estimates?new=1&clientId=${client.id}`}>
            <a className="px-3 py-1.5 text-xs font-bold rounded-md border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100">+ New Estimate</a>
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <StatCard label="Total Billed" value={fmtINR(totals.billed)} />
        <StatCard label="Outstanding" value={fmtINR(totals.balance)} accent="amber" />
        <StatCard label="Estimates" value={String(totals.estimates)} />
        <StatCard label="In Progress" value={String(totals.inProgress)} />
        <StatCard label="Invoices" value={String(totals.invoices)} />
        <StatCard label="Stores" value={String(totals.stores)} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto whitespace-nowrap bg-white rounded-md shadow-sm">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-bold border-b-2 transition flex items-center gap-1.5 ${active ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
        {tab === "overview" && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <InfoRow label="Format"        value={client.format} />
            <InfoRow label="Group"         value={client.clientGroupName || "—"} />
            <InfoRow label="Primary GSTIN" value={client.gstNumber || "—"} />
            <InfoRow label="City"          value={client.city || "—"} />
            <InfoRow label="Email"         value={client.email || "—"} />
            <InfoRow label="Mobile"        value={client.mobile || "—"} />
            <InfoRow label="Payment Terms" value={client.paymentTerms || "—"} />
            <InfoRow label="Billing Profiles" value={`${billing.length} configured`} />
          </div>
        )}

        {tab === "gst" && (
          <CompactTable
            head={["Legal Name", "GSTIN", "State", "Code", "Billing Address", "Default"]}
            rows={billing.map(b => [
              b.legalCompanyName,
              b.gstin,
              b.state,
              b.stateCode,
              b.billingAddress,
              b.isDefault ? "★" : "",
            ])}
            emptyText="No GST profiles configured. Add from the client master."
          />
        )}

        {tab === "brands" && (
          <CompactTable
            head={["Brand"]}
            rows={brands.map(b => [b.name])}
            emptyText="No brands. Brands are global — link by selecting on each estimate."
          />
        )}

        {tab === "stores" && (
          <CompactTable
            head={["Code", "Store", "City", "State"]}
            rows={stores.map(s => [s.storeCode, s.storeName, s.city || "—", s.state || "—"])}
            emptyText="No stores tied to this client."
          />
        )}

        {tab === "rate_cards" && (
          <CompactTable
            head={["Card Name", "Brand", "Type", "Active", "Effective"]}
            rows={rateCards.map(r => [
              r.name || "(unnamed)",
              brands.find(b => b.id === r.brandId)?.name || "—",
              r.projectType || "—",
              r.isActive ? "Yes" : "No",
              [r.effectiveFrom, r.effectiveTo].filter(Boolean).join(" → ") || "—",
            ])}
            emptyText="No customer rate cards configured."
            footer={<Link href="/customer-rate-cards" className="text-orange-600 hover:underline">Manage rate cards →</Link>}
          />
        )}

        {tab === "estimates" && (
          <CompactTable
            head={["Estimate", "PO", "Title", "Format", "Status", "Amount"]}
            rows={estimates.map(e => [
              e.estimateNumber,
              e.poNumber || "—",
              e.title,
              e.clientFormat,
              e.status,
              fmtINR(Number(e.totalAmount)),
            ])}
            emptyText="No estimates yet."
            footer={<Link href={`/estimates?clientId=${client.id}`} className="text-orange-600 hover:underline">Open Estimate Register →</Link>}
          />
        )}

        {tab === "challans" && (
          <CompactTable
            head={["DC/WCC No", "Estimate", "Date", "Format", "Status"]}
            rows={challans.map(c => [
              c.dcNumber,
              c.estimateId ? estimates.find(e => e.id === c.estimateId)?.estimateNumber || `#${c.estimateId}` : "—",
              c.deliveryDate?.slice(0, 10) || "—",
              c.clientFormat,
              c.status,
            ])}
            emptyText="No DC/WCC issued."
            footer={<Link href="/delivery-challans" className="text-orange-600 hover:underline">Open DC/WCC Register →</Link>}
          />
        )}

        {tab === "invoices" && (
          <CompactTable
            head={["Invoice", "Estimate", "Date", "Total", "Balance", "Status"]}
            rows={invoices.map(i => [
              i.invoiceNumber,
              i.estimateId ? estimates.find(e => e.id === i.estimateId)?.estimateNumber || `#${i.estimateId}` : "—",
              i.date?.slice(0, 10) || "—",
              fmtINR(Number(i.totalAmount)),
              fmtINR(Number(i.balanceAmount)),
              i.status,
            ])}
            emptyText="No invoices raised."
            footer={<Link href="/submitted-invoices" className="text-orange-600 hover:underline">Open Submitted Invoices →</Link>}
          />
        )}

        {tab === "ledger" && (
          <CompactTable
            head={["Date", "Ref", "Type", "Debit", "Credit", "Balance", "Remarks"]}
            rows={ledger.map(l => [
              l.date?.slice(0, 10) || "—",
              l.ref,
              l.type,
              fmtINR(l.debitAmount),
              fmtINR(l.creditAmount),
              fmtINR(l.balance),
              l.remarks || "",
            ])}
            emptyText="No ledger entries."
            footer={<Link href="/client-ledger" className="text-orange-600 hover:underline">Open Client Ledger →</Link>}
          />
        )}
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; accent?: "amber" | "default" }> = ({ label, value, accent }) => (
  <div className={`bg-white border ${accent === "amber" ? "border-amber-200" : "border-slate-200"} rounded-md px-3 py-2`}>
    <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">{label}</div>
    <div className={`text-sm font-bold mt-0.5 ${accent === "amber" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
    <span className="text-slate-500">{label}</span>
    <span className="font-semibold text-slate-800 truncate text-right">{value}</span>
  </div>
);

const CompactTable: React.FC<{
  head: string[];
  rows: React.ReactNode[][];
  emptyText?: string;
  footer?: React.ReactNode;
}> = ({ head, rows, emptyText, footer }) => (
  <div>
    <div className="overflow-x-auto">
      <table className="w-full text-xs table-compact">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            {head.map(h => (
              <th key={h} className="text-left text-[10px] uppercase font-bold tracking-wider text-slate-500 px-3 py-2 border-b border-slate-200">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="px-3 py-6 text-center text-slate-400 italic">{emptyText || "No rows"}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/60">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 text-slate-700">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {footer && <div className="px-3 py-2 text-xs border-t border-slate-100 bg-slate-50/40">{footer}</div>}
  </div>
);

export default ClientWorkspace;
