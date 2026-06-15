import React, { useEffect, useState, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Plus, Pencil, Trash2, Archive, Copy, Download, Upload, Eye, X, Save,
  FileSpreadsheet, Sparkles, ArrowRight, Database, Building2, Tag, Layers,
} from "lucide-react";

interface RateCard {
  id: number;
  name: string | null;
  clientId: number;
  brandId: number | null;
  projectType: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}
interface RateItem {
  id: number;
  rateCardId: number;
  productId: number | null;
  materialCodeId: number | null;
  itemName: string | null;
  description: string | null;
  hsn: string | null;
  uom: string;
  calculationType: string | null;
  rate: number;
  gstPercent: number;
  isStandard: boolean;
  isActive: boolean;
}
interface Client { id: number; name: string }
interface Brand { id: number; name: string }
interface Product { id: number; name: string; rate: number; unit: string }
interface MaterialCode { id: number; code: string; description: string | null; uom: string; gstPercent: number; hsn: string | null }

interface ResolvedRate {
  rateCardId: number;
  productId: number | null;
  materialCodeId: number | null;
  rate: number;
  gstPercent: number;
  uom: string;
  source: string;
}

const PROJECT_TYPES = ["", "normal", "letter_signage", "SELEX", "CAPEX", "rollout", "custom"];

export default function CustomerRateCards() {
  const { token } = useAuth();
  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materialCodes, setMaterialCodes] = useState<MaterialCode[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  // Active card detail
  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [activeItems, setActiveItems] = useState<RateItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Create/edit card dialog
  const [showCardDialog, setShowCardDialog] = useState(false);
  const [editingCard, setEditingCard] = useState<Partial<RateCard> | null>(null);

  // Create/edit item dialog
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<RateItem> | null>(null);

  // Resolver widget
  const [showResolver, setShowResolver] = useState(false);
  const [rClientId, setRClientId] = useState("");
  const [rBrandId, setRBrandId] = useState("");
  const [rProductId, setRProductId] = useState("");
  const [rMaterialCodeId, setRMaterialCodeId] = useState("");
  const [rProjectType, setRProjectType] = useState("");
  const [resolved, setResolved] = useState<ResolvedRate | null | undefined>(undefined);
  const [resolving, setResolving] = useState(false);

  // Filter
  const [filterClientId, setFilterClientId] = useState("");
  const [filterBrandId, setFilterBrandId] = useState("");
  const [filterProjectType, setFilterProjectType] = useState("");

  const reload = async () => {
    if (!token) return;
    const [c1, c2, c3, c4, c5] = await Promise.all([
      fetch("/api/customer-rate-cards", auth),
      fetch("/api/operations/clients", auth),
      fetch("/api/operations/brands", auth),
      fetch("/api/operations/products", auth),
      fetch("/api/operations/material-codes", auth),
    ]);
    setRateCards(c1.ok ? await c1.json() : []);
    setClients(c2.ok ? await c2.json() : []);
    setBrands(c3.ok ? await c3.json() : []);
    setProducts(c4.ok ? await c4.json() : []);
    setMaterialCodes(c5.ok ? await c5.json() : []);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [token]);

  // Honour ?clientId=N / ?brandId=N / ?projectType=X query params so external
  // pages (e.g. the Clients register's "Rate cards" deep link) can land on a
  // pre-filtered view.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("clientId")) setFilterClientId(p.get("clientId")!);
    if (p.get("brandId")) setFilterBrandId(p.get("brandId")!);
    if (p.get("projectType")) setFilterProjectType(p.get("projectType")!);
  }, []);

  const loadItems = async (cardId: number) => {
    setActiveCardId(cardId);
    setLoadingItems(true);
    try {
      const r = await fetch(`/api/customer-rate-cards/${cardId}/items`, auth);
      setActiveItems(r.ok ? await r.json() : []);
    } finally {
      setLoadingItems(false);
    }
  };

  const filteredCards = rateCards.filter(rc => {
    if (!showArchived && !rc.isActive) return false;
    if (filterClientId && String(rc.clientId) !== filterClientId) return false;
    if (filterBrandId && String(rc.brandId ?? "") !== filterBrandId) return false;
    if (filterProjectType && (rc.projectType ?? "") !== filterProjectType) return false;
    return true;
  });

  const clientName = (id: number | null) => id ? (clients.find(c => c.id === id)?.name ?? `#${id}`) : "—";
  const brandName = (id: number | null) => id ? (brands.find(b => b.id === id)?.name ?? `#${id}`) : "Any brand";
  const productName = (id: number | null) => id ? (products.find(p => p.id === id)?.name ?? `#${id}`) : "—";
  const materialCodeText = (id: number | null) => id ? (materialCodes.find(m => m.id === id)?.code ?? `#${id}`) : "—";

  const openNewCard = () => {
    setEditingCard({
      name: "",
      clientId: clients[0]?.id,
      brandId: null,
      projectType: "",
      effectiveFrom: "",
      effectiveTo: "",
      isActive: true,
      notes: "",
    });
    setShowCardDialog(true);
  };

  const openEditCard = (rc: RateCard) => {
    setEditingCard({
      ...rc,
      effectiveFrom: rc.effectiveFrom ? new Date(rc.effectiveFrom).toISOString().slice(0, 10) : "",
      effectiveTo: rc.effectiveTo ? new Date(rc.effectiveTo).toISOString().slice(0, 10) : "",
    });
    setShowCardDialog(true);
  };

  const saveCard = async () => {
    if (!editingCard) return;
    const payload: any = {
      name: editingCard.name || null,
      clientId: editingCard.clientId,
      brandId: editingCard.brandId || null,
      projectType: editingCard.projectType || null,
      effectiveFrom: editingCard.effectiveFrom || null,
      effectiveTo: editingCard.effectiveTo || null,
      isActive: editingCard.isActive ?? true,
      notes: editingCard.notes || null,
    };
    const url = editingCard.id ? `/api/customer-rate-cards/${editingCard.id}` : `/api/customer-rate-cards`;
    const method = editingCard.id ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      setShowCardDialog(false);
      setEditingCard(null);
      await reload();
    } else {
      alert("Save failed: " + (await r.text()));
    }
  };

  const archiveCard = async (rc: RateCard) => {
    if (!confirm(`Archive rate card "${rc.name || `#${rc.id}`}"? It will hide from active lists.`)) return;
    await fetch(`/api/customer-rate-cards/${rc.id}`, {
      method: "PATCH",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    await reload();
  };
  const restoreCard = async (rc: RateCard) => {
    await fetch(`/api/customer-rate-cards/${rc.id}`, {
      method: "PATCH",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    await reload();
  };
  const duplicateCard = async (rc: RateCard) => {
    const r1 = await fetch("/api/customer-rate-cards", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: (rc.name || "Rate card") + " (copy)",
        clientId: rc.clientId,
        brandId: rc.brandId,
        projectType: rc.projectType,
        effectiveFrom: null,
        effectiveTo: null,
        isActive: true,
        notes: rc.notes,
      }),
    });
    if (!r1.ok) return alert("Duplicate failed.");
    const created = await r1.json();
    // Copy items
    const itemsRes = await fetch(`/api/customer-rate-cards/${rc.id}/items`, auth);
    if (itemsRes.ok) {
      const its: RateItem[] = await itemsRes.json();
      for (const it of its) {
        await fetch(`/api/customer-rate-cards/${created.id}/items`, {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: it.productId,
            materialCodeId: it.materialCodeId,
            itemName: it.itemName,
            description: it.description,
            hsn: it.hsn,
            uom: it.uom,
            calculationType: it.calculationType,
            rate: it.rate,
            gstPercent: it.gstPercent,
            isStandard: it.isStandard,
            isActive: it.isActive,
          }),
        });
      }
    }
    await reload();
    loadItems(created.id);
  };

  const deleteItem = async (it: RateItem) => {
    if (!activeCardId) return;
    if (!confirm(`Delete item from rate card?`)) return;
    await fetch(`/api/customer-rate-cards/${activeCardId}/items/${it.id}`, { method: "DELETE", headers: auth.headers });
    await loadItems(activeCardId);
  };
  const openNewItem = () => {
    setEditingItem({
      productId: null,
      materialCodeId: null,
      itemName: "",
      description: "",
      hsn: "",
      uom: "nos",
      calculationType: "fixed",
      rate: 0,
      gstPercent: 18,
      isStandard: true,
      isActive: true,
    });
    setShowItemDialog(true);
  };
  const openEditItem = (it: RateItem) => {
    setEditingItem({ ...it });
    setShowItemDialog(true);
  };
  const saveItem = async () => {
    if (!editingItem || !activeCardId) return;
    const url = editingItem.id
      ? `/api/customer-rate-cards/${activeCardId}/items/${editingItem.id}`
      : `/api/customer-rate-cards/${activeCardId}/items`;
    const method = editingItem.id ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify(editingItem),
    });
    if (r.ok) {
      setShowItemDialog(false);
      setEditingItem(null);
      loadItems(activeCardId);
    } else {
      alert("Save failed: " + (await r.text()));
    }
  };

  const resolve = async () => {
    if (!rClientId) return;
    setResolving(true);
    setResolved(undefined);
    try {
      const params = new URLSearchParams({ clientId: rClientId });
      if (rBrandId) params.set("brandId", rBrandId);
      if (rProductId) params.set("productId", rProductId);
      if (rMaterialCodeId) params.set("materialCodeId", rMaterialCodeId);
      if (rProjectType) params.set("projectType", rProjectType);
      const r = await fetch(`/api/customer-rate-cards/resolve?${params.toString()}`, { headers: auth.headers });
      setResolved(r.ok ? await r.json() : null);
    } catch { setResolved(null); }
    finally { setResolving(false); }
  };

  const activeCard = activeCardId ? rateCards.find(rc => rc.id === activeCardId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-600" /> Customer Rate Cards
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Per-client, per-brand, per-project rate sheets. Auto-fills the rate column on estimates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/templates/CUSTOMER_RATE_CARDS_TEMPLATE"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md"
            title="Download header template"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Card Template
          </a>
          <a
            href="/api/templates/CUSTOMER_RATE_CARD_ITEMS_TEMPLATE"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Items Template
          </a>
          <button
            onClick={() => setShowResolver(s => !s)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md"
          >
            <Sparkles className="w-3.5 h-3.5 text-orange-600" /> Resolver
          </button>
          <button
            onClick={openNewCard}
            disabled={!clients.length}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white text-xs font-bold rounded-md"
          >
            <Plus className="w-3.5 h-3.5" /> New Rate Card
          </button>
        </div>
      </div>

      {showResolver && (
        <div className="bg-white border border-slate-200 rounded-md p-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-xs">
            <Field label="Client">
              <select value={rClientId} onChange={e => setRClientId(e.target.value)} className="input-compact">
                <option value="">— Pick client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Brand">
              <select value={rBrandId} onChange={e => setRBrandId(e.target.value)} className="input-compact">
                <option value="">Any</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Product">
              <select value={rProductId} onChange={e => setRProductId(e.target.value)} className="input-compact">
                <option value="">Any</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Material code">
              <select value={rMaterialCodeId} onChange={e => setRMaterialCodeId(e.target.value)} className="input-compact">
                <option value="">Any</option>
                {materialCodes.map(m => <option key={m.id} value={m.id}>{m.code}</option>)}
              </select>
            </Field>
            <Field label="Project type">
              <select value={rProjectType} onChange={e => setRProjectType(e.target.value)} className="input-compact">
                {PROJECT_TYPES.map(t => <option key={t} value={t}>{t || "Any"}</option>)}
              </select>
            </Field>
            <button onClick={resolve} disabled={!rClientId || resolving} className="flex items-center justify-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white text-xs font-bold rounded-md">
              <ArrowRight className="w-3.5 h-3.5" /> Resolve
            </button>
          </div>
          {resolved === null && (
            <p className="text-xs text-slate-500 mt-2">No matching rate card — caller would fall back to product default.</p>
          )}
          {resolved && (
            <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-100 rounded text-xs flex flex-wrap items-center gap-x-6 gap-y-1">
              <span><b>Matched card:</b> #{resolved.rateCardId}</span>
              <span><b>Rate:</b> ₹{Number(resolved.rate).toLocaleString()} / {resolved.uom}</span>
              <span><b>GST:</b> {resolved.gstPercent}%</span>
              <span className="text-[10px] text-slate-500">source = <span className="font-mono">{resolved.source}</span></span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card list */}
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-700">Rate Cards ({filteredCards.length})</span>
            <select value={filterClientId} onChange={e => setFilterClientId(e.target.value)} className="input-compact ml-auto">
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterBrandId} onChange={e => setFilterBrandId(e.target.value)} className="input-compact">
              <option value="">All brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={filterProjectType} onChange={e => setFilterProjectType(e.target.value)} className="input-compact">
              {PROJECT_TYPES.map(t => <option key={t} value={t}>{t || "All types"}</option>)}
            </select>
            <label className="flex items-center gap-1 cursor-pointer select-none text-slate-600 ml-1">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Archived
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-slate-500 uppercase text-[10px] font-bold">
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Client</th>
                  <th className="px-2 py-1.5">Brand</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Active</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCards.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 italic">No rate cards. Click "New Rate Card" to begin.</td></tr>
                )}
                {filteredCards.map(rc => (
                  <tr
                    key={rc.id}
                    onClick={() => loadItems(rc.id)}
                    className={`cursor-pointer hover:bg-orange-50/50 ${activeCardId === rc.id ? "bg-orange-50 border-l-2 border-orange-500" : ""}`}
                  >
                    <td className="px-2 py-1.5 font-semibold text-slate-800">{rc.name || `Rate Card #${rc.id}`}</td>
                    <td className="px-2 py-1.5 text-slate-600">{clientName(rc.clientId)}</td>
                    <td className="px-2 py-1.5 text-slate-600">{brandName(rc.brandId)}</td>
                    <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-bold uppercase">{rc.projectType || "any"}</span></td>
                    <td className="px-2 py-1.5">{rc.isActive ? <span className="text-emerald-700 text-[10px] font-bold">YES</span> : <span className="text-slate-400 text-[10px] font-bold">ARCHIVED</span>}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <button title="View" onClick={() => loadItems(rc.id)} className="p-1 hover:bg-slate-100 rounded"><Eye className="w-3.5 h-3.5 text-slate-500" /></button>
                        <button title="Edit" onClick={() => openEditCard(rc)} className="p-1 hover:bg-slate-100 rounded"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                        <button title="Duplicate" onClick={() => duplicateCard(rc)} className="p-1 hover:bg-slate-100 rounded"><Copy className="w-3.5 h-3.5 text-slate-500" /></button>
                        {rc.isActive ? (
                          <button title="Archive" onClick={() => archiveCard(rc)} className="p-1 hover:bg-slate-100 rounded"><Archive className="w-3.5 h-3.5 text-amber-600" /></button>
                        ) : (
                          <button title="Restore" onClick={() => restoreCard(rc)} className="p-1 hover:bg-slate-100 rounded"><Archive className="w-3.5 h-3.5 text-emerald-600 rotate-180" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active card items */}
        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2 text-xs">
            {activeCard ? (
              <>
                <Layers className="w-3.5 h-3.5 text-orange-600" />
                <span className="font-bold text-slate-700">
                  {activeCard.name || `Rate Card #${activeCard.id}`} — {clientName(activeCard.clientId)} / {brandName(activeCard.brandId)} / {activeCard.projectType || "any"}
                </span>
                <button onClick={openNewItem} className="ml-auto flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded text-[10px] font-bold">
                  <Plus className="w-3 h-3" /> Add Item
                </button>
              </>
            ) : (
              <span className="text-slate-400">Pick a rate card on the left to view items.</span>
            )}
          </div>
          <div className="overflow-x-auto">
            {!activeCardId ? (
              <p className="px-3 py-6 text-xs text-slate-400 italic text-center">No card selected.</p>
            ) : loadingItems ? (
              <p className="px-3 py-6 text-xs text-slate-400">Loading…</p>
            ) : activeItems.length === 0 ? (
              <p className="px-3 py-6 text-xs text-slate-400 italic text-center">No items yet — click "Add Item".</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-500 uppercase text-[10px] font-bold">
                    <th className="px-2 py-1.5">Item / Product</th>
                    <th className="px-2 py-1.5">Mat Code</th>
                    <th className="px-2 py-1.5">HSN</th>
                    <th className="px-2 py-1.5">UOM</th>
                    <th className="px-2 py-1.5 text-right">Rate</th>
                    <th className="px-2 py-1.5 text-right">GST</th>
                    <th className="px-2 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeItems.map(it => (
                    <tr key={it.id}>
                      <td className="px-2 py-1.5 text-slate-800">
                        <div className="font-semibold">{it.itemName || productName(it.productId)}</div>
                        {it.description && <div className="text-[10px] text-slate-400 truncate max-w-[260px]">{it.description}</div>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-orange-700">{materialCodeText(it.materialCodeId)}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500">{it.hsn || "—"}</td>
                      <td className="px-2 py-1.5 text-slate-600">{it.uom}</td>
                      <td className="px-2 py-1.5 text-right text-slate-800 font-semibold">₹{Number(it.rate).toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right text-slate-600">{it.gstPercent}%</td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-1">
                          <button title="Edit" onClick={() => openEditItem(it)} className="p-1 hover:bg-slate-100 rounded"><Pencil className="w-3 h-3 text-blue-600" /></button>
                          <button title="Delete" onClick={() => deleteItem(it)} className="p-1 hover:bg-slate-100 rounded"><Trash2 className="w-3 h-3 text-red-500" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Card dialog */}
      {showCardDialog && editingCard && (
        <Modal onClose={() => { setShowCardDialog(false); setEditingCard(null); }}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">{editingCard.id ? "Edit Rate Card" : "New Rate Card"}</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Card Name" full>
              <input type="text" value={editingCard.name ?? ""} onChange={e => setEditingCard({ ...editingCard, name: e.target.value })} placeholder="e.g. Peter England CAPEX 2026" className="input-compact" />
            </Field>
            <Field label="Client *">
              <select value={editingCard.clientId ?? ""} onChange={e => setEditingCard({ ...editingCard, clientId: Number(e.target.value) })} className="input-compact">
                <option value="">— Select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Brand (optional)">
              <select value={editingCard.brandId ?? ""} onChange={e => setEditingCard({ ...editingCard, brandId: e.target.value ? Number(e.target.value) : null })} className="input-compact">
                <option value="">Any brand</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Project Type">
              <select value={editingCard.projectType ?? ""} onChange={e => setEditingCard({ ...editingCard, projectType: e.target.value })} className="input-compact">
                {PROJECT_TYPES.map(t => <option key={t} value={t}>{t || "Any"}</option>)}
              </select>
            </Field>
            <Field label="Active?">
              <select value={editingCard.isActive ? "1" : "0"} onChange={e => setEditingCard({ ...editingCard, isActive: e.target.value === "1" })} className="input-compact">
                <option value="1">Active</option>
                <option value="0">Archived</option>
              </select>
            </Field>
            <Field label="Effective From">
              <input type="date" value={editingCard.effectiveFrom as any ?? ""} onChange={e => setEditingCard({ ...editingCard, effectiveFrom: e.target.value })} className="input-compact" />
            </Field>
            <Field label="Effective To">
              <input type="date" value={editingCard.effectiveTo as any ?? ""} onChange={e => setEditingCard({ ...editingCard, effectiveTo: e.target.value })} className="input-compact" />
            </Field>
            <Field label="Notes" full>
              <textarea rows={2} value={editingCard.notes ?? ""} onChange={e => setEditingCard({ ...editingCard, notes: e.target.value })} className="input-compact" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
            <button onClick={() => { setShowCardDialog(false); setEditingCard(null); }} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
            <button onClick={saveCard} disabled={!editingCard.clientId} className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white text-xs font-bold rounded-md">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </Modal>
      )}

      {/* Item dialog */}
      {showItemDialog && editingItem && (
        <Modal onClose={() => { setShowItemDialog(false); setEditingItem(null); }}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">{editingItem.id ? "Edit Rate Item" : "New Rate Item"}</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Product" full>
              <select
                value={editingItem.productId ?? ""}
                onChange={e => {
                  const pid = e.target.value ? Number(e.target.value) : null;
                  const p = products.find(pr => pr.id === pid);
                  setEditingItem({
                    ...editingItem,
                    productId: pid,
                    itemName: editingItem.itemName || p?.name || "",
                    rate: editingItem.rate || (p?.rate ?? 0),
                    uom: editingItem.uom || (p?.unit ?? "nos"),
                  });
                }}
                className="input-compact"
              >
                <option value="">— None —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Material Code">
              <select
                value={editingItem.materialCodeId ?? ""}
                onChange={e => {
                  const mid = e.target.value ? Number(e.target.value) : null;
                  const m = materialCodes.find(mc => mc.id === mid);
                  setEditingItem({
                    ...editingItem,
                    materialCodeId: mid,
                    hsn: editingItem.hsn || m?.hsn || "",
                    uom: editingItem.uom || (m?.uom ?? "nos"),
                  });
                }}
                className="input-compact"
              >
                <option value="">— None —</option>
                {materialCodes.map(m => <option key={m.id} value={m.id}>{m.code} — {m.description || ""}</option>)}
              </select>
            </Field>
            <Field label="Item Display Name">
              <input type="text" value={editingItem.itemName ?? ""} onChange={e => setEditingItem({ ...editingItem, itemName: e.target.value })} className="input-compact" />
            </Field>
            <Field label="HSN/SAC">
              <input type="text" value={editingItem.hsn ?? ""} onChange={e => setEditingItem({ ...editingItem, hsn: e.target.value })} className="input-compact" />
            </Field>
            <Field label="UOM">
              <input type="text" value={editingItem.uom ?? "nos"} onChange={e => setEditingItem({ ...editingItem, uom: e.target.value })} className="input-compact" />
            </Field>
            <Field label="Calculation Type">
              <select value={editingItem.calculationType ?? "fixed"} onChange={e => setEditingItem({ ...editingItem, calculationType: e.target.value })} className="input-compact">
                <option value="fixed">fixed</option>
                <option value="sqft">sqft</option>
                <option value="running_inch">running_inch</option>
                <option value="percentage">percentage</option>
                <option value="manual">manual</option>
              </select>
            </Field>
            <Field label="Rate *">
              <input type="number" step="0.01" value={editingItem.rate ?? 0} onChange={e => setEditingItem({ ...editingItem, rate: Number(e.target.value) })} className="input-compact" />
            </Field>
            <Field label="GST %">
              <input type="number" step="0.01" value={editingItem.gstPercent ?? 18} onChange={e => setEditingItem({ ...editingItem, gstPercent: Number(e.target.value) })} className="input-compact" />
            </Field>
            <Field label="Standard?">
              <select value={editingItem.isStandard ? "1" : "0"} onChange={e => setEditingItem({ ...editingItem, isStandard: e.target.value === "1" })} className="input-compact">
                <option value="1">Standard</option>
                <option value="0">Non-standard</option>
              </select>
            </Field>
            <Field label="Active?">
              <select value={editingItem.isActive ? "1" : "0"} onChange={e => setEditingItem({ ...editingItem, isActive: e.target.value === "1" })} className="input-compact">
                <option value="1">Yes</option>
                <option value="0">Archived</option>
              </select>
            </Field>
            <Field label="Description / Specification" full>
              <textarea rows={2} value={editingItem.description ?? ""} onChange={e => setEditingItem({ ...editingItem, description: e.target.value })} className="input-compact" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
            <button onClick={() => { setShowItemDialog(false); setEditingItem(null); }} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
            <button onClick={saveItem} className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode; full?: boolean }> = ({ label, children, full }) => (
  <div className={full ? "col-span-2" : ""}>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
    {children}
  </div>
);

const Modal: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-md shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
      <button onClick={onClose} className="absolute right-3 top-3 p-1 hover:bg-slate-100 rounded">
        <X className="w-4 h-4 text-slate-500" />
      </button>
      {children}
    </div>
  </div>
);
