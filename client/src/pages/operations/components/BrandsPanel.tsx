import React, { useMemo, useState } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Save, X, Search, Trash2, Copy } from "lucide-react";
import type { Brand, Client } from "../types";
import { normalizeDisplayName } from "../../../../../shared/textFormat";
import { masterDataSave } from "../../../lib/api";

interface BrandsPanelProps {
  brands: Brand[];
  clients: Client[];
  token?: string | null;
  reload?: () => void;
  showBrandForm: boolean;
  setShowBrandForm: (v: boolean) => void;
  brandName: string;
  setBrandName: (v: string) => void;
  brandParent: string;
  setBrandParent: (v: string) => void;
  handleCreateBrand: (e: React.FormEvent) => void;
}

const BrandsPanel: React.FC<BrandsPanelProps> = ({
  brands,
  clients,
  token,
  reload,
  showBrandForm,
  setShowBrandForm,
  brandName,
  setBrandName,
  brandParent,
  setBrandParent,
  handleCreateBrand,
}) => {
  const [edit, setEdit] = useState<Brand | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [editClientSearch, setEditClientSearch] = useState("");
  const activeClients = useMemo(() => clients.filter(c => c.isActive), [clients]);
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return activeClients.filter(c => !q || normalizeDisplayName(c.name).toLowerCase().includes(q));
  }, [activeClients, clientSearch]);
  const filteredEditClients = useMemo(() => {
    const q = editClientSearch.trim().toLowerCase();
    const base = activeClients.filter(c => !q || normalizeDisplayName(c.name).toLowerCase().includes(q));
    // Always include the currently-selected parent client so the select shows
    // its label even when the search filter would hide it.
    if (edit?.parentClientId) {
      const selected = clients.find(c => c.id === edit.parentClientId);
      if (selected && !base.some(c => c.id === selected.id)) base.unshift(selected);
    }
    return base;
  }, [activeClients, editClientSearch, edit?.parentClientId, clients]);
  const clientNameForBrand = (brand: Brand) => {
    const linked = brand.parentClientId ? clients.find(c => c.id === brand.parentClientId) : null;
    return normalizeDisplayName(linked?.name || brand.parentBrand) || "-";
  };
  const parentClientIdForBrand = (brand: Brand) => {
    if (brand.parentClientId) return brand.parentClientId;
    const legacyName = normalizeDisplayName(brand.parentBrand).toLowerCase();
    return clients.find(c =>
      normalizeDisplayName(c.name).toLowerCase() === legacyName
      || normalizeDisplayName(c.clientGroupName || "").toLowerCase() === legacyName
    )?.id || null;
  };
  const patch = async (id: number, body: any) => {
    if (!token) return;
    try {
      await masterDataSave(token, "brands", "PATCH", id, body);
      reload && reload();
    } catch (err: any) { alert(err.message || "Update failed"); }
  };
  const hardDelete = async (b: Brand) => {
    if (!token) return;
    if (!confirm(`Delete brand "${b.name}" permanently? This cannot be undone.`)) return;
    try {
      await masterDataSave(token, "brands", "DELETE", b.id);
      reload && reload();
    } catch (err: any) { alert(err.message || "Delete failed"); }
  };
  const duplicate = async (b: Brand) => {
    if (!token) return;
    const newName = prompt(`Duplicate "${b.name}" — new name?`, `${b.name} (copy)`);
    if (!newName) return;
    try {
      await masterDataSave(token, "brands", "POST", null, {
        name: normalizeDisplayName(newName),
        parentClientId: parentClientIdForBrand(b),
        isActive: true,
      });
      reload && reload();
    } catch (err: any) { alert(err.message || "Duplicate failed"); }
  };
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands.filter(b => (showArchived || b.isActive)
      && (!q || normalizeDisplayName(b.name).toLowerCase().includes(q) || clientNameForBrand(b).toLowerCase().includes(q)));
  }, [brands, showArchived, search, clients]);
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Retail Brands Registry</h3>
          <p className="text-xs text-slate-400">Manage sub-brands (e.g. Peter England, Louis Philippe) under corporate groups.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-md bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search brands" className="bg-transparent outline-none text-xs w-40" />
          </div>
          <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button
            onClick={() => setShowBrandForm(!showBrandForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            Register Sub-Brand
          </button>
        </div>
      </div>

      {showBrandForm && (
        <form onSubmit={handleCreateBrand} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-xl mx-auto grid grid-cols-1 gap-4">
          {activeClients.length === 0 && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-md">
              Create client first
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Brand Name</label>
            <input
              type="text"
              required
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              placeholder="e.g. Louis Philippe"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Parent Client</label>
            <input
              type="search"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="w-full px-4 py-2 mb-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              placeholder="Search clients"
              disabled={activeClients.length === 0}
            />
            <select
              required
              value={brandParent}
              onChange={(e) => setBrandParent(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              disabled={activeClients.length === 0}
            >
              <option value="">Select client</option>
              {filteredClients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setShowBrandForm(false)}
              className="py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-slate-700 text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={activeClients.length === 0}
              className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition"
            >
              Create Brand
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden max-w-3xl mx-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-550 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Brand Name</th>
                <th className="px-4 py-3">Parent Corporate Group</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visible.map((b) => (
                <tr key={b.id} className={`hover:bg-slate-50/50 transition ${b.isActive ? "" : "opacity-60 italic"}`}>
                  <td className="px-4 py-2.5 text-slate-900 font-bold">{normalizeDisplayName(b.name)}</td>
                  <td className="px-4 py-2.5 text-orange-600 font-semibold text-xs">{clientNameForBrand(b)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide border ${b.isActive ? "bg-green-50 text-green-700 border-green-100" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                      {b.isActive ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" onClick={() => setEdit({ ...b, parentClientId: parentClientIdForBrand(b) })} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                      <button title="Duplicate" onClick={() => duplicate(b)} className="btn-action"><Copy className="w-3.5 h-3.5 text-slate-500" /></button>
                      <a title="Rate cards" href={`/customer-rate-cards?brandId=${b.id}`} className="btn-action text-orange-600 text-[10px] font-bold">RC</a>
                      {b.isActive
                        ? <button title="Archive" onClick={() => confirm(`Archive brand ${b.name}?`) && patch(b.id, { isActive: false })} className="btn-action"><Archive className="w-3.5 h-3.5 text-amber-600" /></button>
                        : <button title="Restore" onClick={() => patch(b.id, { isActive: true })} className="btn-action"><ArchiveRestore className="w-3.5 h-3.5 text-emerald-600" /></button>}
                      <button title="Delete permanently" onClick={() => hardDelete(b)} className="btn-action"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setEdit(null)}>
          <div className="relative bg-white rounded-md shadow-2xl border border-slate-200 max-w-md w-full p-4" onClick={e => e.stopPropagation()}>
            <button onClick={() => setEdit(null)} className="absolute right-3 top-3 p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
            <h3 className="text-sm font-bold text-slate-800 mb-3">Edit Brand</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Name</label>
                <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} className="input-compact" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Parent client</label>
                <input
                  type="search"
                  value={editClientSearch}
                  onChange={e => setEditClientSearch(e.target.value)}
                  className="input-compact mb-2"
                  placeholder="Search clients"
                />
                <select
                  required
                  value={edit.parentClientId != null ? String(edit.parentClientId) : ""}
                  onChange={e => setEdit({ ...edit, parentClientId: e.target.value ? Number(e.target.value) : null })}
                  className="input-compact"
                >
                  <option value="">Select client</option>
                  {filteredEditClients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
              <button
                onClick={async () => {
                  if (!edit.parentClientId) {
                    alert("Parent client is required");
                    return;
                  }
                  await patch(edit.id, {
                    name: normalizeDisplayName(edit.name),
                    parentClientId: edit.parentClientId,
                  });
                  setEdit(null);
                }}
                className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md"
              >
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandsPanel;
