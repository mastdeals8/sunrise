import React, { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Eye, Save, X, Search, Copy, Archive, ArchiveRestore, Download, Lock } from "lucide-react";
import type { Product, MaterialCodeRow } from "../types";
import { normalizeDisplayName } from "../../../../../shared/textFormat";
import { isSystemServiceProduct } from "../../../../../shared/systemServices";
import CategoryAutocomplete, { categoryKey, normalizeCategoryLabel } from "./CategoryAutocomplete";
import ProductForm, { type ProductFormValue } from "./ProductForm";

interface ProductsPanelProps {
  products: Product[];
  materialCodes: MaterialCodeRow[];
  token?: string | null;
  reload?: () => void;
  showProductForm: boolean;
  setShowProductForm: (v: boolean) => void;
  prodName: string;
  setProdName: (v: string) => void;
  prodCat: string;
  setProdCat: (v: string) => void;
  prodUnit: string;
  setProdUnit: (v: string) => void;
  prodCalcType: string;
  setProdCalcType: (v: string) => void;
  prodRate: string;
  setProdRate: (v: string) => void;
  prodGst: string;
  setProdGst: (v: string) => void;
  prodHsn: string;
  setProdHsn: (v: string) => void;
  prodIsStandard: boolean;
  setProdIsStandard: (v: boolean) => void;
  prodSpecs: string;
  setProdSpecs: (v: string) => void;
  prodWarranty: string;
  setProdWarranty: (v: string) => void;
  prodMaterialCodeId: string;
  setProdMaterialCodeId: (v: string) => void;
  prodDesc: string;
  setProdDesc: (v: string) => void;
  handleCreateProduct: (e: React.FormEvent) => void;
  formatCurrency: (n: number) => string;
}

// CategoryAutocomplete + helpers extracted to ./CategoryAutocomplete.tsx — imported above.

const ProductsPanel: React.FC<ProductsPanelProps> = ({
  products,
  materialCodes,
  token,
  reload,
  showProductForm,
  setShowProductForm,
  prodName,
  setProdName,
  prodCat,
  setProdCat,
  prodUnit,
  setProdUnit,
  prodCalcType,
  setProdCalcType,
  prodRate,
  setProdRate,
  prodGst,
  setProdGst,
  prodHsn,
  setProdHsn,
  prodIsStandard,
  setProdIsStandard,
  prodSpecs,
  setProdSpecs,
  prodWarranty,
  setProdWarranty,
  prodMaterialCodeId,
  setProdMaterialCodeId,
  prodDesc,
  setProdDesc,
  handleCreateProduct,
  formatCurrency,
}) => {
  const [search, setSearch] = useState("");
  const [filterCalc, setFilterCalc] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState<Product | null>(null);
  const [edit, setEdit] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  // Sortable header state. Default = name ascending. Click same header to
  // toggle dir; click different header to switch field and reset to asc.
  type SortField = "name" | "category" | "hsnSac" | "rate" | "gstPercent" | "calculationType" | "unit" | "isActive";
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (field: SortField) => {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const categories = useMemo(() => {
    const byKey = new Map<string, string>();
    products.forEach(product => {
      const label = normalizeCategoryLabel(product.category);
      if (!label) return;
      const key = categoryKey(label);
      if (!byKey.has(key)) byKey.set(key, label);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const hsnCodes = useMemo(() => {
    const byKey = new Map<string, string>();
    products.forEach(product => {
      const label = String(product.hsnSac ?? "").trim().toUpperCase();
      if (!label) return;
      const key = categoryKey(label);
      if (!byKey.has(key)) byKey.set(key, label);
    });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const patch = async (id: number, body: any) => {
    if (!token) return;
    const r = await fetch(`/api/operations/products/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) reload && reload();
    else alert("Update failed");
  };
  const hardDelete = async (p: Product) => {
    if (!token) return;
    if (!confirm(`Delete product "${p.name}"? If used in an estimate it will be deactivated instead.`)) return;
    const r = await fetch(`/api/operations/products/${p.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.message || "Delete failed"); return; }
    if (j.soft) alert(j.message || "Product deactivated.");
    reload && reload();
  };
  const duplicate = async (p: Product) => {
    if (!token) return;
    const newName = prompt(`Duplicate product "${p.name}" — new name?`, `${p.name} (copy)`);
    if (!newName) return;
    const r = await fetch(`/api/operations/products`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        category: p.category,
        unit: p.unit,
        rate: p.rate,
        description: p.description,
        hsnSac: p.hsnSac,
        materialCode: p.materialCode,
        isStandard: p.isStandard,
        calculationType: p.calculationType,
        gstPercent: p.gstPercent,
        defaultSpecification: p.defaultSpecification,
        warranty: p.warranty,
        isActive: true,
        materialCodeId: p.materialCodeId,
      }),
    });
    if (r.ok) reload && reload();
    else { const j = await r.json().catch(() => ({})); alert(j.message || "Duplicate failed"); }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await patch(edit.id, {
        name: edit.name,
        category: normalizeCategoryLabel(edit.category) || null,
        unit: edit.unit,
        rate: Number(edit.rate),
        description: edit.description,
        hsnSac: String(edit.hsnSac || "").trim().toUpperCase() || null,
        materialCode: edit.materialCode,
        isStandard: edit.isStandard,
        calculationType: edit.calculationType,
        gstPercent: Number(edit.gstPercent),
        defaultSpecification: edit.defaultSpecification,
        warranty: edit.warranty,
        materialCodeId: edit.materialCodeId,
      });
      setEdit(null);
    } finally { setSaving(false); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = products.filter(p =>
      (showInactive || p.isActive)
      && (filterCalc === "all" || p.calculationType === filterCalc)
      && (!q
        || p.name.toLowerCase().includes(q)
        || (p.description || "").toLowerCase().includes(q)
        || (p.hsnSac || "").toLowerCase().includes(q)
        || (p.materialCode || "").toLowerCase().includes(q)
        || (p.category || "").toLowerCase().includes(q))
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (sortField === "rate" || sortField === "gstPercent") {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
        return (av - bv) * dir;
      }
      if (sortField === "isActive") {
        return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
      }
      const as = String(av ?? "").toLowerCase();
      const bs = String(bv ?? "").toLowerCase();
      return as.localeCompare(bs) * dir;
    });
  }, [products, search, filterCalc, showInactive, sortField, sortDir]);

  const SortArrow: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return <span className="ml-1 text-slate-300">↕</span>;
    return <span className="ml-1 text-orange-600">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const exportCsv = () => {
    const rows = [
      ["Alias", "Description", "HSN/SAC", "Rate", "GST %", "UOM", "Calculation Type", "Standard", "Active", "Sizing Specs"].join(","),
      ...visible.map(p => [
        p.name, p.description || "", p.hsnSac || "", p.rate, p.gstPercent,
        p.unit, p.calculationType, p.isStandard ? "yes" : "no",
        p.isActive ? "yes" : "no", p.defaultSpecification || "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex-wrap gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Products & Rates</h3>
          <p className="text-xs text-slate-400">Register catalog products and their UOM / GST / standard rate.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-md bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alias / description / HSN" className="bg-transparent outline-none text-xs w-56" />
          </div>
          <select value={filterCalc} onChange={e => setFilterCalc(e.target.value)} className="px-2 py-1 border border-slate-200 rounded-md bg-white text-xs">
            <option value="all">All calc types</option>
            <option value="sqft">sqft</option>
            <option value="running_inch">running_inch</option>
            <option value="fixed">fixed</option>
            <option value="percentage">percentage</option>
            <option value="per_km">per_km</option>
            <option value="manual">manual</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show inactive
          </label>
          <button onClick={exportCsv} className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => setShowProductForm(!showProductForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {showProductForm && (() => {
        // Adapt the parent's individual setter props to a single ProductFormValue.
        const addValue: ProductFormValue = {
          name: prodName,
          category: prodCat,
          unit: prodUnit,
          calculationType: prodCalcType,
          rate: String(prodRate ?? ""),
          gstPercent: String(prodGst ?? ""),
          hsnSac: prodHsn,
          isStandard: !!prodIsStandard,
          defaultSpecification: prodSpecs,
          warranty: prodWarranty,
          materialCodeId: prodMaterialCodeId ? Number(prodMaterialCodeId) : null,
          description: prodDesc,
        };
        const fanOut = (next: ProductFormValue) => {
          if (next.name !== addValue.name) setProdName(next.name);
          if (next.category !== addValue.category) setProdCat(next.category);
          if (next.unit !== addValue.unit) setProdUnit(next.unit);
          if (next.calculationType !== addValue.calculationType) setProdCalcType(next.calculationType);
          if (next.rate !== addValue.rate) setProdRate(next.rate);
          if (next.gstPercent !== addValue.gstPercent) setProdGst(next.gstPercent);
          if (next.hsnSac !== addValue.hsnSac) setProdHsn(next.hsnSac);
          if (next.isStandard !== addValue.isStandard) setProdIsStandard(next.isStandard);
          if (next.defaultSpecification !== addValue.defaultSpecification) setProdSpecs(next.defaultSpecification || "");
          if (next.warranty !== addValue.warranty) setProdWarranty(next.warranty || "");
          if (next.description !== addValue.description) setProdDesc(next.description || "");
        };
        return (
          <form
            onSubmit={handleCreateProduct}
            className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-3xl mx-auto space-y-4"
          >
            <ProductForm
              value={addValue}
              onChange={fanOut}
              categories={categories}
              hsnCodes={hsnCodes}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowProductForm(false)} className="py-2 px-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-xs font-bold">Cancel</button>
              <button type="submit" className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg">Create Product</button>
            </div>
          </form>
        );
      })()}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-550 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort("name")}>Alias<SortArrow field="name" /></th>
                <th className="px-4 py-3 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort("category")}>Category<SortArrow field="category" /></th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort("hsnSac")}>HSN<SortArrow field="hsnSac" /></th>
                <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort("rate")}>Rate<SortArrow field="rate" /></th>
                <th className="px-4 py-3 cursor-pointer select-none hover:text-slate-900" onClick={() => toggleSort("gstPercent")}>GST<SortArrow field="gstPercent" /></th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visible.map((p) => {
                const isSystem = isSystemServiceProduct(p as any);
                return (
                  <tr key={p.id} className={`hover:bg-slate-50/50 transition cursor-pointer ${p.isActive ? "" : "opacity-60 italic"}`} onClick={() => setView(p)}>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">
                      <button onClick={(e) => { e.stopPropagation(); setView(p); }} className="hover:text-orange-600 hover:underline text-left">{p.name}</button>
                      {isSystem && (
                        <span
                          title="System service used by the Estimate Builder service buttons. Editable and disable-able; cannot be deleted."
                          className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[9px] rounded font-bold not-italic uppercase tracking-wide"
                        >
                          <Lock className="w-2.5 h-2.5" /> System
                        </span>
                      )}
                      {!p.isActive && <span className="ml-2 px-1 py-0.5 bg-slate-100 text-slate-500 text-[9px] rounded font-normal not-italic">INACTIVE</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 text-xs">
                      {p.category ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[11px]">{p.category}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs max-w-[420px] whitespace-normal">{p.description || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{p.hsnSac || "—"}</td>
                    <td className="px-4 py-2.5 text-right text-orange-600 font-extrabold font-mono">{formatCurrency(p.rate)} / {p.unit}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs font-mono">{p.gstPercent}%</td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button title="View" onClick={() => setView(p)} className="btn-action"><Eye className="w-3.5 h-3.5 text-slate-500" /></button>
                        <button title="Edit" onClick={() => setEdit({ ...p })} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                        <button title="Duplicate" onClick={() => duplicate(p)} className="btn-action"><Copy className="w-3.5 h-3.5 text-slate-500" /></button>
                        {p.isActive ? (
                          <button title="Deactivate" onClick={() => confirm(`Deactivate "${p.name}"?`) && patch(p.id, { isActive: false })} className="btn-action"><Archive className="w-3.5 h-3.5 text-amber-600" /></button>
                        ) : (
                          <button title="Activate" onClick={() => patch(p.id, { isActive: true })} className="btn-action"><ArchiveRestore className="w-3.5 h-3.5 text-emerald-600" /></button>
                        )}
                        {isSystem ? (
                          <button
                            title="System service products cannot be deleted. Deactivate them instead."
                            disabled
                            className="btn-action opacity-30 cursor-not-allowed"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        ) : (
                          <button title="Delete (soft if in use)" onClick={() => hardDelete(p)} className="btn-action"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-xs text-slate-400">No products match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {view && (
        <Drawer onClose={() => setView(null)} title="Product details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Term k="Alias" v={view.name} />
            <Term k="Category" v={view.category} />
            <Term k="HSN/SAC" v={view.hsnSac} />
            {/* DEPRECATED: Material code field hidden */}
            {/* <Term k="Material code" v={view.materialCode} /> */}
            <Term k="Calc type" v={view.calculationType} />
            <Term k="UOM" v={view.unit} />
            <Term k="Rate" v={formatCurrency(view.rate)} />
            <Term k="GST %" v={`${view.gstPercent}`} />
            <Term k="Standard?" v={view.isStandard ? "yes" : "no"} />
            <Term k="Sizing Specs" v={view.defaultSpecification} />
            <Term k="Warranty" v={view.warranty} />
            <Term k="Active?" v={view.isActive ? "yes" : "no"} />
          </dl>
          {view.description && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <dt className="text-[10px] uppercase text-slate-500 font-bold mb-1">Description</dt>
              <dd className="text-xs text-slate-800 whitespace-pre-wrap">{view.description}</dd>
            </div>
          )}
        </Drawer>
      )}

      {edit && (() => {
        const editValue: ProductFormValue = {
          name: edit.name,
          category: edit.category || "",
          unit: edit.unit,
          calculationType: edit.calculationType,
          rate: String(edit.rate ?? ""),
          gstPercent: String(edit.gstPercent ?? ""),
          hsnSac: edit.hsnSac || "",
          isStandard: edit.isStandard,
          defaultSpecification: edit.defaultSpecification || "",
          warranty: edit.warranty || "",
          materialCodeId: edit.materialCodeId ?? null,
          materialCode: edit.materialCode || "",
          description: edit.description || "",
        };
        return (
          <Drawer onClose={() => setEdit(null)} title="Edit product">
            <ProductForm
              value={editValue}
              onChange={(next) => setEdit({
                ...edit,
                name: next.name,
                category: next.category,
                unit: next.unit,
                calculationType: next.calculationType,
                rate: Number(next.rate) || 0,
                gstPercent: Number(next.gstPercent) || 0,
                hsnSac: next.hsnSac,
                isStandard: next.isStandard,
                defaultSpecification: next.defaultSpecification || "",
                warranty: next.warranty || "",
                materialCode: next.materialCode || "",
                description: next.description || "",
              })}
              categories={categories}
              hsnCodes={hsnCodes}
            />
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
              <button onClick={() => setEdit(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-bold rounded-md">
                <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
};

const Term: React.FC<{ k: string; v: string | number | null | undefined }> = ({ k, v }) => (
  <>
    <dt className="text-[10px] uppercase text-slate-500 font-bold">{k}</dt>
    <dd className="text-slate-800">{v === null || v === undefined || v === "" ? "—" : String(v)}</dd>
  </>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
    {children}
  </div>
);
const Drawer: React.FC<{ onClose: () => void; title: string; children: React.ReactNode }> = ({ onClose, title, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-stretch justify-end" onClick={onClose}>
    <div className="relative bg-white shadow-2xl border-l border-slate-200 max-w-xl w-full overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
      </div>
      {children}
    </div>
  </div>
);

export default ProductsPanel;
