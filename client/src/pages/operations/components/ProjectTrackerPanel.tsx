import React from "react";
import { Link } from "wouter";
import { Clock, Briefcase, CheckCircle, MapPin } from "lucide-react";
import type { Client, Brand, Store, Estimate, DeliveryChallan } from "../types";
import { displayFormatLabel, isAblblFormat, normalizeDisplayName } from "../../../../../shared/textFormat";
import { KpiCard, StatusBadge, SectionHeader, Card } from "@/components/ui-kit";
import { TrendingUp, Package, IndianRupee, AlertTriangle, Link2, ChevronDown } from "lucide-react";
import { FieldLinkManager } from "@/components/FieldLinkManager";

interface Invoice {
  id: number;
  invoiceNumber: string;
  estimateId: number | null;
  status: string;
  dueDate: string;
}

interface ProjectTrackerPanelProps {
  estimates: Estimate[];
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  challans: DeliveryChallan[];
  invoices: Invoice[];
  formatCurrency: (n: number) => string;
}

const FieldLinksFooter: React.FC<{ estimateId: number; estimateNumber: string }> = ({ estimateId, estimateNumber }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-t border-slate-100">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-2.5 flex items-center justify-between text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50/60 transition"
      >
        <span className="flex items-center gap-2"><Link2 className="w-3.5 h-3.5 text-orange-400" /> Field Upload Links</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <FieldLinkManager estimateId={estimateId} estimateNumber={estimateNumber} />
        </div>
      )}
    </div>
  );
};

const ProjectTrackerPanel: React.FC<ProjectTrackerPanelProps> = ({
  estimates,
  clients,
  brands,
  stores,
  challans,
  invoices,
  formatCurrency,
}) => {
  // KPI summary — purely derived from the same data the table already uses.
  const kpiActive = estimates.filter(e => !["paid", "cancelled", "rejected"].includes(e.status)).length;
  const kpiPoReceived = estimates.filter(e => e.status === "po_received" || !!e.poNumber).length;
  const kpiInvoiced = estimates.filter(e => invoices.some(i => i.estimateId === e.id)).length;
  const kpiOverdue = invoices.filter(i => i.status !== "paid" && i.dueDate && new Date(i.dueDate) < new Date()).length;
  const kpiValue = estimates.reduce((s, e) => s + (e.totalAmount || 0), 0);

  return (
    <div className="space-y-6">
      <Card padded>
        <SectionHeader
          icon={<Clock className="w-5 h-5" />}
          title="Project Pipeline Tracker"
          subtitle="Store-wise job status from estimate creation through PO receipt, delivery, and final payment."
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard label="Active" value={kpiActive} icon={<TrendingUp className="w-4 h-4" />} tone="blue" />
          <KpiCard label="PO Received" value={kpiPoReceived} icon={<Package className="w-4 h-4" />} tone="green" />
          <KpiCard label="Invoiced" value={kpiInvoiced} icon={<CheckCircle className="w-4 h-4" />} tone="violet" />
          <KpiCard label="Overdue" value={kpiOverdue} icon={<AlertTriangle className="w-4 h-4" />} tone={kpiOverdue > 0 ? "red" : "slate"} />
          <KpiCard label="Pipeline Value" value={formatCurrency(kpiValue)} icon={<IndianRupee className="w-4 h-4" />} tone="amber" />
        </div>
      </Card>

      {estimates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-semibold">No estimates yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {estimates.map(est => {
            const client = clients.find(c => c.id === est.clientId);
            const brand = brands.find(b => b.id === est.brandId);
            const estChallans = challans.filter(d => d.estimateId === est.id);
            const estInvoice = invoices.find(i => i.estimateId === est.id);
            const isAbfrl = isAblblFormat(est.clientFormat);

            // Build store rows: ABFRL = one row per store group; normal = one row for main store
            const storeRows: { storeId: number; label: string }[] = [];
            if (isAbfrl && est.storeGrouping) {
              Object.keys(est.storeGrouping as Record<string, any>).forEach(sid => {
                const s = stores.find(x => x.id === Number(sid));
                storeRows.push({ storeId: Number(sid), label: s ? `${s.storeCode || ""} — ${s.name}` : `Store #${sid}` });
              });
            } else {
              const s = stores.find(x => x.id === est.storeId);
              storeRows.push({ storeId: est.storeId, label: s ? s.name : "—" });
            }

            type PipelineStage = { key: string; label: string; done: boolean; warn?: boolean };
            const stages: PipelineStage[] = [
              { key: "estimate", label: "Estimate Sent", done: ["sent","approved","awaiting_po","po_received"].includes(est.status) },
              { key: "po", label: "PO Received", done: est.status === "po_received" || !!est.poNumber },
              { key: "delivery", label: "Delivered", done: estChallans.length > 0 },
              { key: "invoice", label: "Invoice Raised", done: !!estInvoice },
              { key: "payment", label: "Payment Collected", done: !!estInvoice && estInvoice.status === "paid",
                warn: !!estInvoice && estInvoice.status !== "paid" && new Date(estInvoice.dueDate) < new Date()
              },
            ];

            return (
              <div key={est.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Estimate header row */}
                <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Link href={`/estimates#est-${est.id}`} className="font-mono font-black text-orange-700 hover:underline text-xs">{est.estimateNumber}</Link>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                      isAbfrl ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-blue-50 text-blue-700 border-blue-100"
                    }`}>{isAbfrl ? displayFormatLabel(est.clientFormat) : "Normal"}</span>
                    <span className="text-xs font-semibold text-slate-700">{normalizeDisplayName(client?.name)}</span>
                    {brand && <span className="text-xs text-slate-400">- {normalizeDisplayName(brand.name)}</span>}
                    {est.poNumber && <span className="font-mono text-[10px] text-purple-700 px-1.5 py-0.5 bg-purple-50 border border-purple-200 rounded">PO {est.poNumber}</span>}
                    {estChallans.map(dc => (
                      <Link key={dc.id} href={`/delivery-challans#dc-${dc.id}`} className="font-mono text-[10px] text-amber-700 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded hover:underline">{dc.dcNumber}</Link>
                    ))}
                    {estInvoice && (
                      <Link href={`/invoices#inv-${estInvoice.id}`} className="font-mono text-[10px] text-blue-700 px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded hover:underline">{estInvoice.invoiceNumber}</Link>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono text-slate-500">{formatCurrency(est.totalAmount)}</span>
                    <StatusBadge status={est.status} />
                  </div>
                </div>

                {/* Pipeline stages bar */}
                <div className="px-5 py-3">
                  <div className="flex items-center gap-0 overflow-x-auto">
                    {stages.map((stage, i) => (
                      <div key={stage.key} className="flex items-center">
                        <div className={`flex flex-col items-center min-w-[90px]`}>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border-2 ${
                            stage.warn ? "bg-red-100 border-red-500 text-red-700" :
                            stage.done ? "bg-green-100 border-green-500 text-green-700" :
                            "bg-slate-100 border-slate-300 text-slate-400"
                          }`}>
                            {stage.done ? <CheckCircle className="w-3.5 h-3.5" /> : <span>{i + 1}</span>}
                          </div>
                          <span className={`text-[9px] font-bold mt-1 text-center leading-tight ${
                            stage.warn ? "text-red-600" : stage.done ? "text-green-700" : "text-slate-400"
                          }`}>{stage.label}{stage.warn ? " ⚠" : ""}</span>
                        </div>
                        {i < stages.length - 1 && (
                          <div className={`h-0.5 w-8 mx-1 ${stage.done && stages[i+1].done ? "bg-green-400" : "bg-slate-200"}`} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Store rows */}
                {storeRows.length > 0 && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {storeRows.map(row => {
                      const storeChallan = estChallans.find(d =>
                        d.metadata && (d.metadata as any).storeCode &&
                        stores.find(s => s.id === row.storeId)?.storeCode === (d.metadata as any).storeCode
                      ) || (storeRows.length === 1 ? estChallans[0] : undefined);
                      return (
                        <div key={row.storeId} className="px-5 py-2.5 flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3 h-3 text-orange-400" />
                            <span className="font-semibold text-slate-700">{row.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {storeChallan ? (
                              <span className="px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded text-[9px] font-black">DC/WCC Issued</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-slate-50 text-slate-400 border border-slate-100 rounded text-[9px] font-bold">Pending Delivery</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Field links (collapsible; loads on demand) */}
                <FieldLinksFooter estimateId={est.id} estimateNumber={est.estimateNumber} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectTrackerPanel;
