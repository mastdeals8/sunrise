import React, { useMemo, useState } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Eye, Save, X, Search, Copy, Trash2, Download } from "lucide-react";
import type { Client } from "../types";
import { displayFormatLabel, isAblblFormat, normalizeDisplayName, normalizeFormatMode, normalizeGstinPan } from "../../../../../shared/textFormat";
import ClientForm, { type ClientFormValue } from "./ClientForm";

interface ClientsPanelProps {
  clients: Client[];
  token?: string | null;
  reload?: () => void;
  showClientForm: boolean;
  setShowClientForm: (v: boolean) => void;
  clientName: string;
  setClientName: (v: string) => void;
  clientEmail: string;
  setClientEmail: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientCity: string;
  setClientCity: (v: string) => void;
  clientAddress: string;
  setClientAddress: (v: string) => void;
  clientGst: string;
  setClientGst: (v: string) => void;
  clientFormatSetting: string;
  setClientFormatSetting: (v: string) => void;
  clientGroupName: string;
  setClientGroupName: (v: string) => void;
  clientType: string;
  setClientType: (v: string) => void;
  clientPan: string;
  setClientPan: (v: string) => void;
  clientPrimaryContact: string;
  setClientPrimaryContact: (v: string) => void;
  clientPaymentTerms: string;
  setClientPaymentTerms: (v: string) => void;
  clientVendorCodeField: string;
  setClientVendorCodeField: (v: string) => void;
  handleCreateClient: (e: React.FormEvent) => void;
  setSelectedClientForProfiles: (c: Client) => void;
  fetchBillingProfiles: (clientId: number) => void;
  setShowBillingProfileDialog: (v: boolean) => void;
}

const ClientsPanel: React.FC<ClientsPanelProps> = ({
  clients,
  token,
  reload,
  showClientForm,
  setShowClientForm,
  clientName,
  setClientName,
  clientEmail,
  setClientEmail,
  clientPhone,
  setClientPhone,
  clientCity,
  setClientCity,
  clientAddress,
  setClientAddress,
  clientGst,
  setClientGst,
  clientFormatSetting,
  setClientFormatSetting,
  clientGroupName,
  setClientGroupName,
  clientType,
  setClientType,
  clientPan,
  setClientPan,
  clientPrimaryContact,
  setClientPrimaryContact,
  clientPaymentTerms,
  setClientPaymentTerms,
  clientVendorCodeField,
  setClientVendorCodeField,
  handleCreateClient,
  setSelectedClientForProfiles,
  fetchBillingProfiles,
  setShowBillingProfileDialog,
}) => {
  const [viewClient, setViewClient] = useState<Client | null>(null);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [filterFormat, setFilterFormat] = useState<string>("all");

  const patchClient = async (id: number, body: any) => {
    if (!token) return;
    const r = await fetch(`/api/operations/clients/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) reload && reload();
    else alert("Update failed");
  };
  const archive = (c: Client) => {
    if (!confirm(`Archive client "${c.name}"?`)) return;
    patchClient(c.id, { isActive: false });
  };
  const restore = (c: Client) => patchClient(c.id, { isActive: true });
  const hardDelete = async (c: Client) => {
    if (!token) return;
    if (!confirm(`Delete client "${c.name}" permanently? Falls back to deactivation if estimates exist.`)) return;
    const r = await fetch(`/api/operations/clients/${c.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.message || "Delete failed"); return; }
    if (j.soft) alert(j.message || "Client deactivated.");
    reload && reload();
  };
  const duplicate = async (c: Client) => {
    if (!token) return;
    const newName = prompt(`Duplicate client "${c.name}" — new name?`, `${c.name} (copy)`);
    if (!newName) return;
    const r = await fetch(`/api/operations/clients`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: normalizeDisplayName(newName),
        email: c.email,
        mobile: c.mobile,
        city: c.city,
        address: c.address,
        gstNumber: null, // never duplicate GSTIN
        format: normalizeFormatMode(c.format),
        clientGroupName: c.clientGroupName,
        clientType: c.clientType,
        pan: null,
        primaryContactPerson: c.primaryContactPerson,
        paymentTerms: c.paymentTerms,
        vendorCode: c.vendorCode || null,
        isActive: true,
      }),
    });
    if (r.ok) reload && reload();
    else { const j = await r.json().catch(() => ({})); alert(j.message || "Duplicate failed"); }
  };
  const exportCsv = () => {
    const rows = [
      ["Name", "Group", "Format", "Type", "GSTIN", "PAN", "Primary Contact", "Mobile", "Email", "Payment Terms", "Vendor Code", "City", "Address", "Active"].join(","),
      ...visible.map(c => [
        c.name, c.clientGroupName || "", displayFormatLabel(c.format), c.clientType || "",
        c.gstNumber || "", c.pan || "", c.primaryContactPerson || "",
        c.mobile || "", c.email || "", c.paymentTerms || "",
        c.vendorCode || "",
        c.city || "", c.address || "", c.isActive ? "yes" : "no",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "clients.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const saveEdit = async () => {
    if (!editClient) return;
    await patchClient(editClient.id, {
      name: normalizeDisplayName(editClient.name),
      email: editClient.email || null,
      mobile: editClient.mobile || null,
      address: editClient.address || null,
      format: normalizeFormatMode(editClient.format),
      clientType: editClient.clientType || "normal",
      paymentTerms: editClient.paymentTerms || null,
      vendorCode: editClient.vendorCode || null,
      isActive: editClient.isActive,
      clientGroupName: normalizeDisplayName(editClient.clientGroupName) || null,
      gstNumber: normalizeGstinPan(editClient.gstNumber) || null,
      pan: normalizeGstinPan(editClient.pan) || null,
      primaryContactPerson: normalizeDisplayName(editClient.primaryContactPerson) || null,
      city: normalizeDisplayName(editClient.city) || null,
    });
    setEditClient(null);
  };
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(c =>
      (showArchived || c.isActive)
      && (filterFormat === "all" || normalizeFormatMode(c.format) === filterFormat)
      && (!q
        || normalizeDisplayName(c.name).toLowerCase().includes(q)
        || normalizeDisplayName(c.clientGroupName || "").toLowerCase().includes(q)
        || (c.gstNumber || "").toLowerCase().includes(q)
        || (c.email || "").toLowerCase().includes(q)
        || (c.mobile || "").includes(q))
    );
  }, [clients, showArchived, search, filterFormat]);
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Clients Directory</h3>
          <p className="text-xs text-slate-400">Define if a client has normal invoices or specialized ABLBL store sheets.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 px-2 py-1 border border-slate-200 rounded-md bg-white">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / GSTIN / email" className="bg-transparent outline-none text-xs w-48" />
          </div>
          <select value={filterFormat} onChange={e => setFilterFormat(e.target.value)} className="px-2 py-1 border border-slate-200 rounded-md bg-white text-xs">
            <option value="all">All formats</option>
            <option value="normal">Standard / Normal</option>
            <option value="ABLBL">ABLBL</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button onClick={exportCsv} title="Export CSV" className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => setShowClientForm(!showClientForm)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            Add Corporate Client
          </button>
        </div>
      </div>

      {showClientForm && (() => {
        // Adapt the parent's individual setters → single ClientFormValue (mirror of ProductsPanel pattern).
        const addValue: ClientFormValue = {
          name: clientName,
          groupName: clientGroupName,
          gst: clientGst,
          pan: clientPan,
          type: clientType,
          formatSetting: clientFormatSetting,
          email: clientEmail,
          phone: clientPhone,
          city: clientCity,
          address: clientAddress,
          primaryContact: clientPrimaryContact,
          paymentTerms: clientPaymentTerms,
          vendorCode: clientVendorCodeField,
        };
        const fanOut = (n: ClientFormValue) => {
          if (n.name !== addValue.name) setClientName(n.name);
          if (n.groupName !== addValue.groupName) setClientGroupName(n.groupName);
          if (n.gst !== addValue.gst) setClientGst(n.gst);
          if (n.pan !== addValue.pan) setClientPan(n.pan);
          if (n.type !== addValue.type) setClientType(n.type);
          if (n.formatSetting !== addValue.formatSetting) setClientFormatSetting(n.formatSetting);
          if (n.email !== addValue.email) setClientEmail(n.email);
          if (n.phone !== addValue.phone) setClientPhone(n.phone);
          if (n.city !== addValue.city) setClientCity(n.city);
          if (n.address !== addValue.address) setClientAddress(n.address);
          if (n.primaryContact !== addValue.primaryContact) setClientPrimaryContact(n.primaryContact);
          if (n.paymentTerms !== addValue.paymentTerms) setClientPaymentTerms(n.paymentTerms);
          if (n.vendorCode !== addValue.vendorCode) setClientVendorCodeField(n.vendorCode);
        };
        return (
          <form
            onSubmit={handleCreateClient}
            className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 max-w-3xl mx-auto space-y-4"
          >
            <ClientForm value={addValue} onChange={fanOut} />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setShowClientForm(false)} className="py-2 px-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-xs font-bold transition">Cancel</button>
              <button type="submit" className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition">Create Client</button>
            </div>
          </form>
        );
      })()}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Format</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">GSTIN / PAN</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Payment Terms</th>
                <th className="px-4 py-3 text-center">GST Profiles</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visible.map((c) => (
                <tr key={c.id} className={`hover:bg-slate-50/50 transition cursor-pointer ${c.isActive ? "" : "opacity-60 italic"}`} onClick={() => setViewClient(c)}>
                  <td className="px-4 py-2.5 text-slate-900 font-bold">
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); setViewClient(c); }} className="hover:text-orange-600 hover:underline text-left">
                        {normalizeDisplayName(c.name)}
                      </button>
                      {!c.isActive && <span className="px-1 py-0.5 bg-slate-100 text-slate-500 text-[9px] rounded font-normal not-italic">ARCHIVED</span>}
                    </div>
                    {c.clientGroupName && <span className="text-[10px] text-slate-400 font-normal not-italic">Group: {normalizeDisplayName(c.clientGroupName)}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black border ${isAblblFormat(c.format) ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-blue-50 text-blue-700 border-blue-100"}`}>
                      {displayFormatLabel(c.format)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold capitalize text-slate-600">{c.clientType || "normal"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-orange-600 font-semibold">
                    <div>{normalizeGstinPan(c.gstNumber) || "-"}</div>
                    {c.pan && <div className="text-[10px] text-slate-400 font-normal">PAN: {normalizeGstinPan(c.pan)}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 text-xs">{c.email || "-"}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{c.paymentTerms || "-"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClientForProfiles(c);
                        fetchBillingProfiles(c.id);
                        setShowBillingProfileDialog(true);
                      }}
                      className="px-2 py-0.5 bg-orange-50 hover:bg-orange-100 text-orange-600 text-[10px] font-black border border-orange-200 rounded transition"
                    >
                      GST
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button title="View" onClick={() => setViewClient(c)} className="btn-action"><Eye className="w-3.5 h-3.5 text-slate-500" /></button>
                      <button title="Edit" onClick={() => setEditClient({ ...c })} className="btn-action"><Pencil className="w-3.5 h-3.5 text-blue-600" /></button>
                      <button title="Duplicate" onClick={() => duplicate(c)} className="btn-action"><Copy className="w-3.5 h-3.5 text-slate-500" /></button>
                      {c.isActive ? (
                        <button title="Archive" onClick={() => archive(c)} className="btn-action"><Archive className="w-3.5 h-3.5 text-amber-600" /></button>
                      ) : (
                        <button title="Restore" onClick={() => restore(c)} className="btn-action"><ArchiveRestore className="w-3.5 h-3.5 text-emerald-600" /></button>
                      )}
                      <button title="Delete permanently" onClick={() => hardDelete(c)} className="btn-action"><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-xs text-slate-400">No clients match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewClient && (
        <Modal onClose={() => setViewClient(null)}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">Client Details</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Term k="Name" v={normalizeDisplayName(viewClient.name)} />
            <Term k="Group" v={normalizeDisplayName(viewClient.clientGroupName) || "—"} />
            <Term k="Format" v={displayFormatLabel(viewClient.format)} />
            <Term k="Type" v={viewClient.clientType || "normal"} />
            <Term k="GSTIN" v={normalizeGstinPan(viewClient.gstNumber) || "—"} />
            <Term k="PAN" v={normalizeGstinPan(viewClient.pan) || "—"} />
            <Term k="Primary contact" v={normalizeDisplayName(viewClient.primaryContactPerson) || "—"} />
            <Term k="Mobile" v={viewClient.mobile || "—"} />
            <Term k="Email" v={viewClient.email || "—"} />
            <Term k="Payment terms" v={viewClient.paymentTerms || "—"} />
            <Term k="Vendor code" v={viewClient.vendorCode || "—"} />
            <Term k="City" v={normalizeDisplayName(viewClient.city) || "—"} />
            <Term k="Address" v={viewClient.address || "—"} />
            <Term k="Active?" v={viewClient.isActive ? "yes" : "ARCHIVED"} />
          </dl>
          <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
            <a
              href={`/customer-rate-cards?clientId=${viewClient.id}`}
              className="px-3 py-1.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-bold rounded-md"
            >
              View Rate Cards
            </a>
            <button
              onClick={() => {
                setSelectedClientForProfiles(viewClient);
                fetchBillingProfiles(viewClient.id);
                setShowBillingProfileDialog(true);
                setViewClient(null);
              }}
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold rounded-md"
            >
              Manage GST Profiles
            </button>
          </div>
        </Modal>
      )}

      {editClient && (
        <Modal onClose={() => setEditClient(null)}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">Edit Client</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Name *"><input value={editClient.name} onChange={e => setEditClient({ ...editClient, name: e.target.value })} className="input-compact" /></Field>
            <Field label="Group"><input value={editClient.clientGroupName || ""} onChange={e => setEditClient({ ...editClient, clientGroupName: e.target.value })} className="input-compact" /></Field>
            <Field label="GSTIN"><input value={editClient.gstNumber || ""} onChange={e => setEditClient({ ...editClient, gstNumber: e.target.value })} className="input-compact" /></Field>
            <Field label="PAN"><input value={editClient.pan || ""} onChange={e => setEditClient({ ...editClient, pan: e.target.value })} className="input-compact" /></Field>
            <Field label="Format">
              <select value={normalizeFormatMode(editClient.format)} onChange={e => setEditClient({ ...editClient, format: e.target.value })} className="input-compact">
                <option value="normal">Standard / Normal</option>
                <option value="ABLBL">ABLBL</option>
              </select>
            </Field>
            <Field label="Type">
              <select value={editClient.clientType || "normal"} onChange={e => setEditClient({ ...editClient, clientType: e.target.value })} className="input-compact">
                <option value="corporate">corporate</option>
                <option value="normal">normal</option>
                <option value="walk_in">walk_in</option>
              </select>
            </Field>
            <Field label="Email"><input value={editClient.email || ""} onChange={e => setEditClient({ ...editClient, email: e.target.value })} className="input-compact" /></Field>
            <Field label="Mobile"><input value={editClient.mobile || ""} onChange={e => setEditClient({ ...editClient, mobile: e.target.value })} className="input-compact" /></Field>
            <Field label="Primary contact"><input value={editClient.primaryContactPerson || ""} onChange={e => setEditClient({ ...editClient, primaryContactPerson: e.target.value })} className="input-compact" /></Field>
            <Field label="Payment terms"><input value={editClient.paymentTerms || ""} onChange={e => setEditClient({ ...editClient, paymentTerms: e.target.value })} className="input-compact" /></Field>
            <Field label="Vendor code"><input value={editClient.vendorCode || ""} onChange={e => setEditClient({ ...editClient, vendorCode: e.target.value })} className="input-compact font-mono" /></Field>
            <Field label="City"><input value={editClient.city || ""} onChange={e => setEditClient({ ...editClient, city: e.target.value })} className="input-compact" /></Field>
            <Field label="Address"><input value={editClient.address || ""} onChange={e => setEditClient({ ...editClient, address: e.target.value })} className="input-compact" /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-100">
            <button onClick={() => setEditClient(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-md">Cancel</button>
            <button onClick={saveEdit} className="flex items-center gap-1 px-4 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-md">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const Term: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <>
    <dt className="text-[10px] uppercase text-slate-500 font-bold">{k}</dt>
    <dd className="text-slate-800">{v}</dd>
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

export default ClientsPanel;
