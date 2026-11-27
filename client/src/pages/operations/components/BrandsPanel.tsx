import React, { useMemo, useState, useEffect } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Save, X, Search, Trash2, Copy, ShieldCheck, Check, Settings2 } from "lucide-react";
import type { Brand, Client } from "../types";
import { normalizeDisplayName } from "../../../../../shared/textFormat";
import { masterDataSave, fetchInvoicePacketRequirements, saveInvoicePacketRequirements, getActiveCompanyId } from "../../../lib/api";
import {
  InvoicePacketRequirements,
  DEFAULT_INVOICE_PACKET_REQUIREMENTS,
  resolveInvoicePacketRequirements,
  RequirementSource,
} from "../../../../../shared/packetRequirements";

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

  // Invoice Packet Requirements state
  const [allRequirements, setAllRequirements] = useState<any[]>([]);
  const [createRequirements, setCreateRequirements] = useState<InvoicePacketRequirements>({
    ...DEFAULT_INVOICE_PACKET_REQUIREMENTS,
  });
  const [editRequirements, setEditRequirements] = useState<InvoicePacketRequirements>({
    ...DEFAULT_INVOICE_PACKET_REQUIREMENTS,
  });
  const [editReqSource, setEditReqSource] = useState<RequirementSource>("default");
  const [isClientOverride, setIsClientOverride] = useState(false);

  const loadRequirements = () => {
    fetchInvoicePacketRequirements(token || null)
      .then((data) => {
        if (Array.isArray(data)) setAllRequirements(data);
      })
      .catch((err) => console.warn("Failed to load packet requirements:", err));
  };

  useEffect(() => {
    loadRequirements();
  }, [token]);

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

  const handleOpenEdit = (b: Brand) => {
    const pClientId = parentClientIdForBrand(b);
    setEdit({ ...b, parentClientId: pClientId });
    const resolved = resolveInvoicePacketRequirements(allRequirements, {
      companyId: getActiveCompanyId(),
      brandId: b.id,
      clientId: pClientId,
      parentBrandName: b.parentBrand,
      allBrands: brands,
    });
    setEditRequirements(resolved.requirements);
    setEditReqSource(resolved.source);
    setIsClientOverride(resolved.source === "client_brand_override");
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
      const newBrand = await masterDataSave(token, "brands", "POST", null, {
        name: normalizeDisplayName(newName),
        parentClientId: parentClientIdForBrand(b),
        isActive: true,
      });
      const resolved = resolveInvoicePacketRequirements(allRequirements, {
        companyId: getActiveCompanyId(),
        brandId: b.id,
        clientId: parentClientIdForBrand(b),
        parentBrandName: b.parentBrand,
        allBrands: brands,
      });
      if (newBrand?.id) {
        await saveInvoicePacketRequirements(token, {
          brandId: newBrand.id,
          ...resolved.requirements,
        });
      }
      reload && reload();
      loadRequirements();
    } catch (err: any) { alert(err.message || "Duplicate failed"); }
  };

  const onSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName || !brandParent) return;

    try {
      const created = await masterDataSave(token || null, "brands", "POST", null, {
        name: normalizeDisplayName(brandName),
        parentClientId: Number(brandParent),
        isActive: true,
      });
      if (created?.id) {
        await saveInvoicePacketRequirements(token || null, {
          brandId: created.id,
          ...createRequirements,
        });
      }
      setShowBrandForm(false);
      setBrandName("");
      setBrandParent("");
      setCreateRequirements({ ...DEFAULT_INVOICE_PACKET_REQUIREMENTS });
      reload && reload();
      loadRequirements();
    } catch (err: any) {
      console.error("Brand creation failed:", err);
      alert(err.message || "Brand creation failed");
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands.filter(b => (showArchived || b.isActive)
      && (!q || normalizeDisplayName(b.name).toLowerCase().includes(q) || clientNameForBrand(b).toLowerCase().includes(q)));
  }, [brands, showArchived, search, clients]);

  const getBrandRequirementBadge = (brand: Brand) => {
    const resolved = resolveInvoicePacketRequirements(allRequirements, {
      companyId: getActiveCompanyId(),
      brandId: brand.id,
      clientId: brand.parentClientId,
      parentBrandName: brand.parentBrand,
      allBrands: brands,
    });
    const req = resolved.requirements;
    const reqCount = Object.values(req).filter(Boolean).length;
    if (resolved.source === "client_brand_override") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200" title={`Client override: ${reqCount}/8 documents required`}>
          Client Override ({reqCount}/8)
        </span>
      );
    }
    if (resolved.source === "brand") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title={`Custom requirements: ${reqCount}/8 documents required`}>
          Custom ({reqCount}/8)
        </span>
      );
    }
    if (resolved.source === "parent_brand") {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" title={`Inherited from parent brand: ${reqCount}/8 documents required`}>
          Inherited ({reqCount}/8)
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-50 text-slate-500 border border-slate-200" title={`Default system requirements: ${reqCount}/8 documents required`}>
        Default ({reqCount}/8)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Retail Brands Registry</h3>
          <p className="text-xs text-slate-400">Manage sub-brands (e.g. Peter England, Louis Philippe) under corporate groups and invoice packet compliance rules.</p>
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
        <form onSubmit={onSubmitCreate} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-xl mx-auto grid grid-cols-1 gap-4">
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

          {/* Invoice Packet Requirements Section */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Invoice Packet Requirements</h4>
                <p className="text-[11px] text-slate-500">Select which documents are compulsory for invoice packets of this brand.</p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">
                {Object.values(createRequirements).filter(Boolean).length} Required
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1 text-xs text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.taxInvoice}
                  onChange={e => setCreateRequirements(r => ({ ...r, taxInvoice: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Tax Invoice</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.estimate}
                  onChange={e => setCreateRequirements(r => ({ ...r, estimate: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Estimate Copy</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.purchaseOrder}
                  onChange={e => setCreateRequirements(r => ({ ...r, purchaseOrder: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Purchase Order (PO)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.installationPhotos}
                  onChange={e => setCreateRequirements(r => ({ ...r, installationPhotos: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Installation Photos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.generatedWcc}
                  onChange={e => setCreateRequirements(r => ({ ...r, generatedWcc: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Generated WCC</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.signedWcc}
                  onChange={e => setCreateRequirements(r => ({ ...r, signedWcc: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Signed WCC</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.transportReceipt}
                  onChange={e => setCreateRequirements(r => ({ ...r, transportReceipt: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Transport Receipt</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createRequirements.otherDocs}
                  onChange={e => setCreateRequirements(r => ({ ...r, otherDocs: e.target.checked }))}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <span>Other Documents</span>
              </label>
            </div>
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden max-w-4xl mx-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-550 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Brand Name</th>
                <th className="px-4 py-3">Parent Corporate Group</th>
                <th className="px-4 py-3">Packet Requirements</th>
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
                    {getBrandRequirementBadge(b)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide border ${b.isActive ? "bg-green-50 text-green-700 border-green-100" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                      {b.isActive ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit Brand & Packet Requirements" onClick={() => handleOpenEdit(b)} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
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
          <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <button onClick={() => setEdit(null)} className="absolute right-4 top-4 p-1 hover:bg-slate-100 rounded text-slate-500"><X className="w-4 h-4" /></button>
            <h3 className="text-base font-bold text-slate-800 mb-1">Edit Brand</h3>
            <p className="text-xs text-slate-400 mb-4">Update corporate parentage and compulsory invoice packet requirements.</p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Brand Name</label>
                <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} className="input-compact w-full" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Parent Corporate Client</label>
                <input
                  type="search"
                  value={editClientSearch}
                  onChange={e => setEditClientSearch(e.target.value)}
                  className="input-compact w-full mb-1.5"
                  placeholder="Search clients"
                />
                <select
                  required
                  value={edit.parentClientId != null ? String(edit.parentClientId) : ""}
                  onChange={e => setEdit({ ...edit, parentClientId: e.target.value ? Number(e.target.value) : null })}
                  className="input-compact w-full"
                >
                  <option value="">Select client</option>
                  {filteredEditClients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
                </select>
              </div>

              {/* Invoice Packet Requirements in Edit Brand */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Invoice Packet Requirements</h4>
                    <p className="text-[11px] text-slate-500">Configure which documents are compulsory before invoicing.</p>
                  </div>
                  <div>
                    {editReqSource === "client_brand_override" ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">Client Override</span>
                    ) : editReqSource === "brand" ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Custom Brand Settings</span>
                    ) : editReqSource === "parent_brand" ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Inherited</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">System Defaults</span>
                    )}
                  </div>
                </div>

                {edit.parentClientId && (
                  <label className="flex items-center gap-2 p-2 rounded-md bg-white border border-slate-200 text-slate-700 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isClientOverride}
                      onChange={e => setIsClientOverride(e.target.checked)}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Save as client-specific override for {clientNameForBrand(edit)}</span>
                  </label>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1 text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.taxInvoice}
                      onChange={e => setEditRequirements(r => ({ ...r, taxInvoice: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Tax Invoice</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.estimate}
                      onChange={e => setEditRequirements(r => ({ ...r, estimate: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Estimate Copy</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.purchaseOrder}
                      onChange={e => setEditRequirements(r => ({ ...r, purchaseOrder: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Purchase Order (PO)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.installationPhotos}
                      onChange={e => setEditRequirements(r => ({ ...r, installationPhotos: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Installation Photos</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.generatedWcc}
                      onChange={e => setEditRequirements(r => ({ ...r, generatedWcc: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Generated WCC</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.signedWcc}
                      onChange={e => setEditRequirements(r => ({ ...r, signedWcc: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Signed WCC</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.transportReceipt}
                      onChange={e => setEditRequirements(r => ({ ...r, transportReceipt: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Transport Receipt</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={editRequirements.otherDocs}
                      onChange={e => setEditRequirements(r => ({ ...r, otherDocs: e.target.checked }))}
                      className="rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>Other Documents</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
              <button
                onClick={async () => {
                  if (!edit.parentClientId) {
                    alert("Parent client is required");
                    return;
                  }
                  try {
                    await patch(edit.id, {
                      name: normalizeDisplayName(edit.name),
                      parentClientId: edit.parentClientId,
                    });
                    await saveInvoicePacketRequirements(token || null, {
                      brandId: edit.id,
                      clientId: isClientOverride ? edit.parentClientId : null,
                      ...editRequirements,
                    });
                    setEdit(null);
                    loadRequirements();
                  } catch (err: any) {
                    alert(err.message || "Save failed");
                  }
                }}
                className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md shadow-sm"
              >
                <Save className="w-3.5 h-3.5" /> Save Brand & Requirements
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandsPanel;
