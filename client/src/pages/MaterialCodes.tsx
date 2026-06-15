import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Database, Plus, Edit, Trash2, Search, X, Tag } from "lucide-react";

interface Client { id: number; name: string; format?: string }
interface Brand { id: number; name: string; parentClientId?: number | null }
interface MaterialCode {
  id: number;
  clientId: number | null;
  brandId: number | null;
  code: string;
  productName: string | null;
  description: string | null;
  hsn: string | null;
  uom: string | null;
  gstPercent: number | null;
  defaultRate: number | null;
  category: string | null;
  isStandard: boolean;
  isActive: boolean;
  notes: string | null;
}

interface FormState {
  id?: number;
  clientId: string;
  brandId: string;
  code: string;
  productName: string;
  description: string;
  hsn: string;
  uom: string;
  gstPercent: string;
  defaultRate: string;
  category: string;
  isStandard: boolean;
  isActive: boolean;
  notes: string;
}

const emptyForm: FormState = {
  clientId: "", brandId: "", code: "", productName: "", description: "", hsn: "",
  uom: "nos", gstPercent: "18", defaultRate: "0", category: "", isStandard: true, isActive: true, notes: ""
};

const UOMS = ["nos", "sqft", "running_inch", "job", "km", "kg", "ltr", "set", "pcs"];

const MaterialCodesPage: React.FC = () => {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<MaterialCode[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("all");
  const [filterBrand, setFilterBrand] = useState("all");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const canEdit = ["admin", "manager", "designer", "accounts"].includes((user?.role || "").toLowerCase());

  const loadAll = async () => {
    setLoading(true);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch("/api/operations/material-codes", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/operations/clients", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/operations/brands", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (r1.ok) setRows(await r1.json());
      if (r2.ok) setClients(await r2.json());
      if (r3.ok) setBrands(await r3.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  const showMsg = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const openCreate = () => { setForm(emptyForm); setEditId(null); setShowForm(true); };
  const openEdit = (m: MaterialCode) => {
    setForm({
      id: m.id,
      clientId: m.clientId?.toString() || "",
      brandId: m.brandId?.toString() || "",
      code: m.code,
      productName: m.productName || "",
      description: m.description || "",
      hsn: m.hsn || "",
      uom: m.uom || "nos",
      gstPercent: String(m.gstPercent ?? 18),
      defaultRate: String(m.defaultRate ?? 0),
      category: m.category || "",
      isStandard: m.isStandard ?? true,
      isActive: m.isActive,
      notes: m.notes || ""
    });
    setEditId(m.id); setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      clientId: form.clientId ? parseInt(form.clientId, 10) : null,
      brandId: form.brandId ? parseInt(form.brandId, 10) : null,
      code: form.code,
      productName: form.productName || null,
      description: form.description || null,
      hsn: form.hsn || null,
      uom: form.uom,
      gstPercent: form.gstPercent ? parseFloat(form.gstPercent) : 18,
      defaultRate: form.defaultRate ? parseFloat(form.defaultRate) : 0,
      category: form.category || null,
      isStandard: form.isStandard,
      isActive: form.isActive,
      notes: form.notes || null,
    };
    try {
      const url = editId ? `/api/operations/material-codes/${editId}` : "/api/operations/material-codes";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ message: "Save failed" }));
        showMsg("err", e.message || "Save failed");
        return;
      }
      showMsg("ok", editId ? "Updated" : "Created");
      setShowForm(false); setEditId(null); setForm(emptyForm);
      loadAll();
    } catch (err: any) {
      showMsg("err", err.message || "Save failed");
    }
  };

  const remove = async (m: MaterialCode) => {
    if (!confirm(`Delete material code "${m.code}"?`)) return;
    try {
      const res = await fetch(`/api/operations/material-codes/${m.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showMsg("ok", "Deleted");
        loadAll();
      } else {
        showMsg("err", "Delete failed");
      }
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  const clientName = (id: number | null) => clients.find(c => c.id === id)?.name || "—";
  const brandName = (id: number | null) => brands.find(b => b.id === id)?.name || "—";

  const visible = useMemo(() => rows.filter((m) => {
    if (filterClient !== "all" && String(m.clientId || "") !== filterClient) return false;
    if (filterBrand !== "all" && String(m.brandId || "") !== filterBrand) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!m.code.toLowerCase().includes(q) && !(m.description || "").toLowerCase().includes(q) && !(m.hsn || "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, filterClient, filterBrand, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Tag className="w-7 h-7 text-orange-600" /> Material Codes
          </h1>
          <p className="text-slate-500 text-sm mt-1">Brand-wise material codes used in ABLBL Capex-style estimates.</p>
        </div>
        <button
          onClick={openCreate}
          disabled={!canEdit}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 text-white font-semibold rounded-lg text-sm shadow-md disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add Material Code
        </button>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm border ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"}`}>
          {msg.text}
        </div>
      )}

      <div className="glass-panel p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code/description/HSN" className="bg-transparent border-0 outline-none text-sm flex-1" />
        </div>
        <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)} className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white">
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)} className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white">
          <option value="all">All brands</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <span className="text-xs text-slate-500">{visible.length} of {rows.length}</span>
      </div>

      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <Database className="w-8 h-8 text-slate-300" /> No material codes yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Code</th>
                  <th className="text-left px-4 py-3 font-semibold">Alias</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-left px-4 py-3 font-semibold">Client</th>
                  <th className="text-left px-4 py-3 font-semibold">Brand</th>
                  <th className="text-left px-4 py-3 font-semibold">HSN</th>
                  <th className="text-left px-4 py-3 font-semibold">UOM</th>
                  <th className="text-right px-4 py-3 font-semibold">GST%</th>
                  <th className="text-right px-4 py-3 font-semibold">Rate</th>
                  <th className="text-left px-4 py-3 font-semibold">Standard</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(m => (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono font-bold text-xs">{m.code}</td>
                    <td className="px-4 py-3 text-sm">{m.productName || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{m.category || "—"}</td>
                    <td className="px-4 py-3 text-xs">{clientName(m.clientId)}</td>
                    <td className="px-4 py-3 text-xs">{brandName(m.brandId)}</td>
                    <td className="px-4 py-3 text-xs font-mono">{m.hsn || "—"}</td>
                    <td className="px-4 py-3 text-xs">{m.uom}</td>
                    <td className="px-4 py-3 text-right">{m.gstPercent}</td>
                    <td className="px-4 py-3 text-right">{m.defaultRate}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${m.isStandard ? "text-blue-700" : "text-amber-700"}`}>
                        {m.isStandard ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${m.isActive ? "text-emerald-700" : "text-slate-400"}`}>
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(m)} disabled={!canEdit} className="p-2 rounded-md text-slate-600 hover:text-orange-600 hover:bg-orange-50 disabled:opacity-40">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(m)} disabled={!canEdit} className="p-2 rounded-md text-slate-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold">{editId ? "Edit Material Code" : "Add Material Code"}</h2>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Client *</label>
                <select required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                  <option value="">Select Client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Brand (optional)</label>
                <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                  <option value="">— Client-level code —</option>
                  {brands.filter(b => !form.clientId || b.parentClientId === parseInt(form.clientId)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Material Code *</label>
                <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm font-mono" placeholder="e.g. OT_PACKING000N" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">HSN/SAC</label>
                <input value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm font-mono" placeholder="e.g. 996511" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-600">Alias</label>
                <input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. Packing Charges" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-600">Description</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" placeholder="Detailed description (editable in estimate)" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Category / Material Group</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. Operational, Signage" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">UOM</label>
                <select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white">
                  {UOMS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">GST %</label>
                <input type="number" step="0.01" value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-600">Default Rate</label>
                <input type="number" step="0.01" value={form.defaultRate} onChange={(e) => setForm({ ...form, defaultRate: e.target.value })} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" placeholder="0 if not applicable" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold uppercase text-slate-600">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <input id="standard" type="checkbox" checked={form.isStandard} onChange={(e) => setForm({ ...form, isStandard: e.target.checked })} />
                <label htmlFor="standard" className="text-sm">Standard</label>
              </div>
              <div className="flex items-center gap-2">
                <input id="active" type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <label htmlFor="active" className="text-sm">Active</label>
              </div>
              <div className="md:col-span-2 pt-4 border-t flex justify-end gap-2">
                <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 rounded-md border text-sm">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-md bg-gradient-to-r from-orange-600 to-amber-500 text-white font-semibold text-sm shadow">
                  {editId ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialCodesPage;
