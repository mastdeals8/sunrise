import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, Eye, Save, X, Search, Copy, Download, Upload, Filter, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { Client, Brand, Store } from "../types";
import { normalizeDisplayName } from "../../../../../shared/textFormat";
import StoreImportModal from "./StoreImportModal";
import { CityCombobox, StateSelect } from "@/components/IndiaLocationFields";
import { isBoltMode } from "../../../lib/supabase";

// Subsequence "fuzzy" match: every char in `needle` appears in `haystack` in
// order (case-insensitive). "aun" matches "Launch" / "auntie" / "Aurangabad".
// Substring is a fast-path so typical queries don't pay the per-char cost.
function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  let i = 0;
  for (let c = 0; c < h.length && i < n.length; c++) {
    if (h[c] === n[i]) i++;
  }
  return i === n.length;
}

type SortDir = "asc" | "desc" | null;
type SortKey = "name" | "storeCode" | "client" | "brand" | "city" | null;

interface StoresPanelProps {
  stores: Store[];
  clients: Client[];
  brands: Brand[];
  token?: string | null;
  reload?: () => void;
  showStoreForm: boolean;
  setShowStoreForm: (v: boolean) => void;
  storeName: string;
  setStoreName: (v: string) => void;
  storeCode: string;
  setStoreCode: (v: string) => void;
  storeClientId: string;
  setStoreClientId: (v: string) => void;
  storeBrandId: string;
  setStoreBrandId: (v: string) => void;
  storeCity: string;
  setStoreCity: (v: string) => void;
  storeState: string;
  setStoreState: (v: string) => void;
  storeStateCode: string;
  setStoreStateCode: (v: string) => void;
  storeRegion: string;
  setStoreRegion: (v: string) => void;
  storeContact: string;
  setStoreContact: (v: string) => void;
  storePhone: string;
  setStorePhone: (v: string) => void;
  storeAltContact: string;
  setStoreAltContact: (v: string) => void;
  storeAddress: string;
  setStoreAddress: (v: string) => void;
  handleCreateStore: (e: React.FormEvent) => void;
}

const StoresPanel: React.FC<StoresPanelProps> = ({
  stores,
  clients,
  brands,
  token,
  reload,
  showStoreForm,
  setShowStoreForm,
  storeName,
  setStoreName,
  storeCode,
  setStoreCode,
  storeClientId,
  setStoreClientId,
  storeBrandId,
  setStoreBrandId,
  storeCity,
  setStoreCity,
  storeState,
  setStoreState,
  storeStateCode,
  setStoreStateCode,
  storeRegion,
  setStoreRegion,
  storeContact,
  setStoreContact,
  storePhone,
  setStorePhone,
  storeAltContact,
  setStoreAltContact,
  storeAddress,
  setStoreAddress,
  handleCreateStore,
}) => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterBrand, setFilterBrand] = useState<string>("all");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<Store | null>(null);
  const [edit, setEdit] = useState<Store | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Debounce the global search by ~120ms so typing remains smooth at 550+ rows.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 120);
    return () => clearTimeout(t);
  }, [search]);

  // Close any open header-filter popover on outside click / Escape.
  const tableRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openFilter) return;
    const onDoc = (e: MouseEvent) => {
      if (!tableRef.current?.contains(e.target as Node)) setOpenFilter(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenFilter(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openFilter]);
  const brandBelongsToClient = (brand: Brand, clientId: string | number) => {
    if (!clientId) return true;
    const id = Number(clientId);
    if (brand.parentClientId) return brand.parentClientId === id;
    const client = clients.find(c => c.id === id);
    const legacyParent = normalizeDisplayName(brand.parentBrand).toLowerCase();
    return !!client && (
      normalizeDisplayName(client.name).toLowerCase() === legacyParent
      || normalizeDisplayName(client.clientGroupName || "").toLowerCase() === legacyParent
    );
  };
  const brandsForCreate = useMemo(
    () => brands.filter(b => b.isActive && brandBelongsToClient(b, storeClientId)),
    [brands, clients, storeClientId],
  );
  const brandsForFilter = useMemo(
    () => brands.filter(b => filterClient === "all" || brandBelongsToClient(b, filterClient)),
    [brands, clients, filterClient],
  );
  const brandsForEdit = useMemo(() => {
    if (!edit) return [] as Brand[];
    const list = brands.filter(b => b.isActive && brandBelongsToClient(b, edit.clientId));
    // Always include the currently-saved brand for this store so the select
    // can preselect it even if the brand record is missing parentClientId or
    // belongs to a different client (legacy data).
    if (edit.brandId && !list.some(b => b.id === edit.brandId)) {
      const current = brands.find(b => b.id === edit.brandId);
      if (current) list.unshift(current);
    }
    return list;
  }, [brands, clients, edit?.clientId, edit?.brandId]);

  const patch = async (id: number, body: any) => {
    if (!token) return;
    if (isBoltMode) { alert("Store update migration pending."); return; }
    const r = await fetch(`/api/operations/stores/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) reload && reload();
    else alert("Update failed");
  };
  const hardDelete = async (s: Store) => {
    if (!token) return;
    if (isBoltMode) { alert("Store delete migration pending."); return; }
    if (!confirm(`Delete store "${s.name}"? Falls back to deactivation if linked to estimates.`)) return;
    const r = await fetch(`/api/operations/stores/${s.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.message || "Delete failed"); return; }
    if (j.soft) alert(j.message || "Store deactivated.");
    reload && reload();
  };
  const duplicate = async (s: Store) => {
    if (!token) return;
    if (isBoltMode) { alert("Store duplicate migration pending."); return; }
    const newName = prompt(`Duplicate store "${s.name}" — new name?`, `${s.name} (copy)`);
    if (!newName) return;
    const r = await fetch(`/api/operations/stores`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...s, id: undefined, name: normalizeDisplayName(newName), storeCode: s.storeCode ? `${s.storeCode}-COPY` : null }),
    });
    if (r.ok) reload && reload();
    else { const j = await r.json().catch(() => ({})); alert(j.message || "Duplicate failed"); }
  };

  // Memoise the per-row indexed map so we don't repeatedly look up client +
  // brand names while filtering/sorting on every keystroke.
  const decorated = useMemo(() => {
    const clientById = new Map(clients.map(c => [c.id, c]));
    const brandById = new Map(brands.map(b => [b.id, b]));
    return stores.map(s => {
      const client = clientById.get(s.clientId);
      const brand = brandById.get(s.brandId);
      const clientName = normalizeDisplayName(client?.name) || "";
      const brandName = normalizeDisplayName(brand?.name) || "";
      const storeName = normalizeDisplayName(s.name) || "";
      // Pre-built haystack used by the global search for fuzzy-match.
      const haystack = [
        storeName, s.storeCode, s.city, s.state, s.regionZone, s.location,
        s.address, s.contactPerson, s.contactPhone, clientName, brandName,
      ].filter(Boolean).join(" | ");
      return { s, client, brand, clientName, brandName, storeName, haystack };
    });
  }, [stores, clients, brands]);

  const visible = useMemo(() => {
    const q = debouncedSearch.trim();
    const headerFilters = Object.entries(colFilters).filter(([, v]) => v && v.trim());
    const list = decorated.filter(({ s, clientName, brandName, storeName, haystack }) => {
      if (!showArchived && !s.isActive) return false;
      if (filterClient !== "all" && String(s.clientId) !== filterClient) return false;
      if (filterBrand !== "all" && String(s.brandId) !== filterBrand) return false;
      if (q && !fuzzyIncludes(haystack, q)) return false;
      for (const [col, val] of headerFilters) {
        const target = val.trim();
        const field =
          col === "name" ? storeName :
          col === "storeCode" ? (s.storeCode || "") :
          col === "client" ? clientName :
          col === "brand" ? brandName :
          col === "city" ? (s.city || "") :
          col === "contact" ? `${s.contactPerson || ""} ${s.contactPhone || ""}` :
          "";
        if (!fuzzyIncludes(field, target)) return false;
      }
      return true;
    });

    if (sortKey && sortDir) {
      const dir = sortDir === "asc" ? 1 : -1;
      const cmp = (a: typeof list[number], b: typeof list[number]) => {
        const av = sortKey === "name" ? a.storeName
          : sortKey === "storeCode" ? (a.s.storeCode || "")
          : sortKey === "client" ? a.clientName
          : sortKey === "brand" ? a.brandName
          : sortKey === "city" ? (a.s.city || "")
          : "";
        const bv = sortKey === "name" ? b.storeName
          : sortKey === "storeCode" ? (b.s.storeCode || "")
          : sortKey === "client" ? b.clientName
          : sortKey === "brand" ? b.brandName
          : sortKey === "city" ? (b.s.city || "")
          : "";
        // localeCompare with numeric=true so "PE10" sorts after "PE9".
        return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * dir;
      };
      list.sort(cmp);
    }
    return list;
  }, [decorated, debouncedSearch, colFilters, filterClient, filterBrand, showArchived, sortKey, sortDir]);

  const cycleSort = (key: NonNullable<SortKey>) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") { setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortKey(null); setSortDir(null); return; }
    setSortDir("asc");
  };

  const setColFilter = (col: string, v: string) => setColFilters(prev => {
    const next = { ...prev };
    if (v.trim()) next[col] = v; else delete next[col];
    return next;
  });
  const clearAllFilters = () => {
    setSearch(""); setDebouncedSearch("");
    setColFilters({}); setFilterClient("all"); setFilterBrand("all");
    setSortKey(null); setSortDir(null);
  };

  const exportCsv = () => {
    const headers = ["Store Name", "Store Code", "Client", "Brand", "City", "State", "State Code", "Region / Zone", "Contact Person", "Phone", "Address"];
    const rows = [
      headers.join(","),
      ...visible.map(({ s, client, brand }) => [
        s.name, s.storeCode || "", client?.name || "", brand?.name || "",
        s.city || "", s.state || "", s.stateCode || "", s.regionZone || "",
        s.contactPerson || "", s.contactPhone || "", s.address || "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "stores.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex-wrap gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Retail Store Sites</h3>
          <p className="text-xs text-slate-400">Manage individual retail store locations linked to brands.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-md bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search store / code / city" className="bg-transparent outline-none text-xs w-48" />
          </div>
          <select value={filterClient} onChange={e => { setFilterClient(e.target.value); setFilterBrand("all"); }} className="px-2 py-1 border border-slate-200 rounded-md bg-white text-xs">
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
          </select>
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="px-2 py-1 border border-slate-200 rounded-md bg-white text-xs">
            <option value="all">All brands</option>
            {brandsForFilter.map(b => <option key={b.id} value={String(b.id)}>{normalizeDisplayName(b.name)}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Inactive
          </label>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => setShowStoreForm(!showStoreForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            Register Store
          </button>
        </div>
      </div>

      {showStoreForm && (
        <form onSubmit={handleCreateStore} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Store / Site Name *"><input required value={storeName} onChange={(e) => setStoreName(e.target.value)} className="input-compact" placeholder="e.g. Louis Philippe Select Citywalk" /></Field>
          <Field label="Store Code"><input value={storeCode} onChange={(e) => setStoreCode(e.target.value)} className="input-compact" placeholder="e.g. LP-MUM-01" /></Field>
          <Field label="Corporate Client *">
            <select required value={storeClientId} onChange={(e) => { setStoreClientId(e.target.value); setStoreBrandId(""); }} className="input-compact">
              <option value="">Select Corporate Client</option>
              {clients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
            </select>
          </Field>
          <Field label="Brand *">
            <select required value={storeBrandId} onChange={(e) => setStoreBrandId(e.target.value)} className="input-compact" disabled={!storeClientId}>
              <option value="">{storeClientId ? "Select Sub-Brand" : "Select client first"}</option>
              {brandsForCreate.map(b => <option key={b.id} value={String(b.id)}>{normalizeDisplayName(b.name)}</option>)}
            </select>
          </Field>
          <Field label="City">
            <CityCombobox
              value={storeCity}
              onChange={(city, inferredState, inferredCode) => {
                setStoreCity(city);
                if (inferredState && !storeState) { setStoreState(inferredState); setStoreStateCode(inferredCode || ""); }
              }}
              stateName={storeState}
              className="input-compact"
            />
          </Field>
          <Field label="State">
            <StateSelect
              value={storeState}
              onChange={(name, code) => { setStoreState(name); setStoreStateCode(code); }}
              className="input-compact"
            />
          </Field>
          <Field label="State Code">
            <input value={storeStateCode} readOnly className="input-compact bg-slate-50 text-slate-500 cursor-default" placeholder="Auto-filled" tabIndex={-1} />
          </Field>
          <Field label="Region / Zone"><input value={storeRegion} onChange={(e) => setStoreRegion(e.target.value)} className="input-compact" placeholder="West / North" /></Field>
          <Field label="Contact Person"><input value={storeContact} onChange={(e) => setStoreContact(e.target.value)} className="input-compact" /></Field>
          <Field label="Phone"><input value={storePhone} onChange={(e) => setStorePhone(e.target.value)} className="input-compact" /></Field>
          <Field label="Alt Contact"><input value={storeAltContact} onChange={(e) => setStoreAltContact(e.target.value)} className="input-compact" /></Field>
          <Field label="Full Address"><input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} className="input-compact" /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button type="button" onClick={() => setShowStoreForm(false)} className="py-2 px-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-xs font-bold">Cancel</button>
            <button type="submit" className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg">Register Store</button>
          </div>
        </form>
      )}

      <div ref={tableRef} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-visible">
        {(debouncedSearch || Object.keys(colFilters).length || filterClient !== "all" || filterBrand !== "all" || sortKey) && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/60 text-[11px] text-slate-600">
            <span>Showing <strong>{visible.length}</strong> of {stores.length} stores</span>
            <button onClick={clearAllFilters} className="text-orange-600 hover:underline font-bold text-[11px]">Clear filters</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <SortableTh label="Store / Site" sortKey="name" col="name" current={sortKey} dir={sortDir} onSort={cycleSort} hasFilter={!!colFilters.name} onFilterToggle={() => setOpenFilter(openFilter === "name" ? null : "name")} open={openFilter === "name"} value={colFilters.name || ""} onChange={v => setColFilter("name", v)} />
                <SortableTh label="Code" sortKey="storeCode" col="storeCode" current={sortKey} dir={sortDir} onSort={cycleSort} hasFilter={!!colFilters.storeCode} onFilterToggle={() => setOpenFilter(openFilter === "storeCode" ? null : "storeCode")} open={openFilter === "storeCode"} value={colFilters.storeCode || ""} onChange={v => setColFilter("storeCode", v)} />
                <SortableTh label="Client" sortKey="client" col="client" current={sortKey} dir={sortDir} onSort={cycleSort} hasFilter={!!colFilters.client} onFilterToggle={() => setOpenFilter(openFilter === "client" ? null : "client")} open={openFilter === "client"} value={colFilters.client || ""} onChange={v => setColFilter("client", v)} />
                <SortableTh label="Brand" sortKey="brand" col="brand" current={sortKey} dir={sortDir} onSort={cycleSort} hasFilter={!!colFilters.brand} onFilterToggle={() => setOpenFilter(openFilter === "brand" ? null : "brand")} open={openFilter === "brand"} value={colFilters.brand || ""} onChange={v => setColFilter("brand", v)} />
                <SortableTh label="City" sortKey="city" col="city" current={sortKey} dir={sortDir} onSort={cycleSort} hasFilter={!!colFilters.city} onFilterToggle={() => setOpenFilter(openFilter === "city" ? null : "city")} open={openFilter === "city"} value={colFilters.city || ""} onChange={v => setColFilter("city", v)} />
                <FilterableTh label="Contact" col="contact" hasFilter={!!colFilters.contact} onFilterToggle={() => setOpenFilter(openFilter === "contact" ? null : "contact")} open={openFilter === "contact"} value={colFilters.contact || ""} onChange={v => setColFilter("contact", v)} />
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visible.map(({ s, client, brand }) => {
                return (
                  <tr key={s.id} className={`hover:bg-slate-50/50 transition cursor-pointer ${s.isActive ? "" : "opacity-60 italic"}`} onClick={() => setView(s)}>
                    <td className="px-4 py-2.5 text-slate-900 font-bold">
                      <button onClick={(e) => { e.stopPropagation(); setView(s); }} className="hover:text-orange-600 hover:underline text-left">{normalizeDisplayName(s.name)}</button>
                      {!s.isActive && <span className="ml-2 px-1 py-0.5 bg-slate-100 text-slate-500 text-[9px] rounded font-normal not-italic">INACTIVE</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{s.storeCode || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{normalizeDisplayName(client?.name) || `ID: ${s.clientId}`}</td>
                    <td className="px-4 py-2.5 text-orange-600 font-semibold text-xs">{normalizeDisplayName(brand?.name) || `ID: ${s.brandId}`}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{s.city || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">{s.contactPerson || "—"}{s.contactPhone ? ` (${s.contactPhone})` : ""}</td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button title="View" onClick={() => setView(s)} className="btn-action"><Eye className="w-3.5 h-3.5 text-slate-500" /></button>
                        <button title="Edit" onClick={() => setEdit({ ...s })} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                        <button title="Duplicate" onClick={() => duplicate(s)} className="btn-action"><Copy className="w-3.5 h-3.5 text-slate-500" /></button>
                        {s.isActive ? (
                          <button title="Archive" onClick={() => confirm(`Archive store ${s.name}?`) && patch(s.id, { isActive: false })} className="btn-action"><Archive className="w-3.5 h-3.5 text-amber-600" /></button>
                        ) : (
                          <button title="Restore" onClick={() => patch(s.id, { isActive: true })} className="btn-action"><ArchiveRestore className="w-3.5 h-3.5 text-emerald-600" /></button>
                        )}
                        <button title="Delete permanently" onClick={() => hardDelete(s)} className="btn-action"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-xs text-slate-400">No stores match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {view && (
        <Modal onClose={() => setView(null)}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">Store Details</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Term k="Name" v={normalizeDisplayName(view.name)} />
            <Term k="Code" v={view.storeCode || "—"} />
            <Term k="Client" v={normalizeDisplayName(clients.find(c => c.id === view.clientId)?.name) || "—"} />
            <Term k="Brand" v={normalizeDisplayName(brands.find(b => b.id === view.brandId)?.name) || "—"} />
            <Term k="City" v={view.city || "—"} />
            <Term k="State" v={view.state || "—"} />
            <Term k="State code" v={view.stateCode || "—"} />
            <Term k="Region" v={view.regionZone || "—"} />
            <Term k="Contact" v={view.contactPerson || "—"} />
            <Term k="Phone" v={view.contactPhone || "—"} />
            <Term k="Address" v={view.address || "—"} />
            <Term k="Active?" v={view.isActive ? "yes" : "no"} />
          </dl>
        </Modal>
      )}

      {showImport && (
        <StoreImportModal
          token={token ?? null}
          clients={clients}
          brands={brands}
          stores={stores}
          onClose={() => setShowImport(false)}
          onImported={() => reload && reload()}
        />
      )}

      {edit && (
        <Modal onClose={() => setEdit(null)}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">Edit Store</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Name *"><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} className="input-compact" /></Field>
            <Field label="Code"><input value={edit.storeCode || ""} onChange={e => setEdit({ ...edit, storeCode: e.target.value })} className="input-compact" /></Field>
            <Field label="Client">
              <select
                value={edit.clientId ? String(edit.clientId) : ""}
                onChange={e => setEdit({ ...edit, clientId: Number(e.target.value), brandId: 0 })}
                className="input-compact"
              >
                <option value="">Select Client</option>
                {clients.map(c => <option key={c.id} value={String(c.id)}>{normalizeDisplayName(c.name)}</option>)}
              </select>
            </Field>
            <Field label="Brand">
              <select
                value={edit.brandId ? String(edit.brandId) : ""}
                onChange={e => setEdit({ ...edit, brandId: Number(e.target.value) })}
                className="input-compact"
                disabled={!edit.clientId}
              >
                <option value="">{edit.clientId ? "Select Sub-Brand" : "Select client first"}</option>
                {brandsForEdit.map(b => <option key={b.id} value={String(b.id)}>{normalizeDisplayName(b.name)}</option>)}
              </select>
            </Field>
            <Field label="City">
              <CityCombobox
                value={edit.city || ""}
                onChange={(city, inferredState, inferredCode) => {
                  const upd: Partial<Store> = { city };
                  if (inferredState && !edit.state) { upd.state = inferredState; upd.stateCode = inferredCode; }
                  setEdit({ ...edit, ...upd });
                }}
                stateName={edit.state || ""}
                className="input-compact"
              />
            </Field>
            <Field label="State">
              <StateSelect
                value={edit.state || ""}
                onChange={(name, code) => setEdit({ ...edit, state: name, stateCode: code })}
                className="input-compact"
              />
            </Field>
            <Field label="State code">
              <input value={edit.stateCode || ""} readOnly className="input-compact bg-slate-50 text-slate-500 cursor-default" placeholder="Auto-filled" tabIndex={-1} />
            </Field>
            <Field label="Region"><input value={edit.regionZone || ""} onChange={e => setEdit({ ...edit, regionZone: e.target.value })} className="input-compact" /></Field>
            <Field label="Contact"><input value={edit.contactPerson || ""} onChange={e => setEdit({ ...edit, contactPerson: e.target.value })} className="input-compact" /></Field>
            <Field label="Phone"><input value={edit.contactPhone || ""} onChange={e => setEdit({ ...edit, contactPhone: e.target.value })} className="input-compact" /></Field>
            <Field label="Address"><input value={edit.address || ""} onChange={e => setEdit({ ...edit, address: e.target.value })} className="input-compact" /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
            <button onClick={() => setEdit(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
            <button
              onClick={async () => {
                if (!edit.clientId || !edit.brandId) {
                  alert("Client and brand are required");
                  return;
                }
                await patch(edit.id, edit);
                setEdit(null);
              }}
              className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md"
            >
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const Term: React.FC<{ k: string; v: string | null | undefined }> = ({ k, v }) => (
  <>
    <dt className="text-[10px] uppercase text-slate-500 font-bold">{k}</dt>
    <dd className="text-slate-800">{v || "—"}</dd>
  </>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
    {children}
  </div>
);
const Modal: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
    <div className="relative bg-white rounded-md shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto p-4" onClick={e => e.stopPropagation()}>
      <button onClick={onClose} className="absolute right-3 top-3 p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
      {children}
    </div>
  </div>
);

interface SortableThProps {
  label: string;
  sortKey: NonNullable<SortKey>;
  col: string;
  current: SortKey;
  dir: SortDir;
  onSort: (key: NonNullable<SortKey>) => void;
  hasFilter: boolean;
  open: boolean;
  onFilterToggle: () => void;
  value: string;
  onChange: (v: string) => void;
}
const SortableTh: React.FC<SortableThProps> = ({ label, sortKey, current, dir, onSort, hasFilter, open, onFilterToggle, value, onChange }) => {
  const isActive = current === sortKey;
  const Icon = isActive && dir === "asc" ? ArrowUp : isActive && dir === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th className="px-4 py-3 relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`flex items-center gap-1 hover:text-orange-600 transition ${isActive ? "text-orange-600" : ""}`}
          title={`Sort by ${label} ${isActive && dir === "asc" ? "(desc)" : isActive && dir === "desc" ? "(clear)" : "(asc)"}`}
        >
          <span>{label}</span>
          <Icon className="w-3 h-3 opacity-70" />
        </button>
        <FilterToggle hasFilter={hasFilter} onClick={onFilterToggle} />
      </div>
      {open && <FilterPopover value={value} onChange={onChange} placeholder={`Filter ${label.toLowerCase()}...`} />}
    </th>
  );
};

interface FilterableThProps {
  label: string;
  col: string;
  hasFilter: boolean;
  open: boolean;
  onFilterToggle: () => void;
  value: string;
  onChange: (v: string) => void;
}
const FilterableTh: React.FC<FilterableThProps> = ({ label, hasFilter, open, onFilterToggle, value, onChange }) => (
  <th className="px-4 py-3 relative">
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <FilterToggle hasFilter={hasFilter} onClick={onFilterToggle} />
    </div>
    {open && <FilterPopover value={value} onChange={onChange} placeholder={`Filter ${label.toLowerCase()}...`} />}
  </th>
);

const FilterToggle: React.FC<{ hasFilter: boolean; onClick: () => void }> = ({ hasFilter, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`p-0.5 rounded hover:bg-slate-200 ${hasFilter ? "text-orange-600" : "text-slate-400"}`}
    title={hasFilter ? "Edit filter" : "Filter column"}
  >
    <Filter className="w-3 h-3" fill={hasFilter ? "currentColor" : "none"} />
  </button>
);

const FilterPopover: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div
    className="absolute top-full left-0 mt-1 z-30 w-56 bg-white border border-slate-200 rounded-md shadow-lg p-2 normal-case font-normal"
    onClick={e => e.stopPropagation()}
    onMouseDown={e => e.stopPropagation()}
  >
    <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded bg-slate-50">
      <Search className="w-3 h-3 text-slate-400" />
      <input
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-xs text-slate-700"
      />
      {value && (
        <button onClick={() => onChange("")} className="p-0.5 hover:bg-slate-200 rounded">
          <X className="w-3 h-3 text-slate-400" />
        </button>
      )}
    </div>
    <p className="text-[9px] text-slate-400 mt-1.5 px-1">Partial match — try a few letters.</p>
  </div>
);

export default StoresPanel;
