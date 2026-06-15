import React from "react";
import { Plus, Search, X } from "lucide-react";
import type { Client } from "../types";
import { normalizeDisplayName, normalizeGstinPan } from "../../../../../shared/textFormat";
import { composeBillingAddress, parseBillingAddress } from "../../../../../shared/billingAddress";

interface BillingProfile {
  id: number;
  legalCompanyName: string;
  branchLocationName: string | null;
  gstin: string;
  pan: string | null;
  state: string;
  stateCode: string;
  billingAddress: string;
  shippingAddress: string | null;
  contactPerson: string | null;
  mobile: string | null;
  email: string | null;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
}

interface BillingProfilesDialogProps {
  show: boolean;
  selectedClient: Client | null;
  billingProfiles: BillingProfile[];
  showBpForm: boolean;
  editingBpId: number | null;
  bpLegalName: string;
  bpBranch: string;
  bpGstin: string;
  bpPan: string;
  bpState: string;
  bpStateCode: string;
  bpBillingAddress: string;
  bpShippingAddress: string;
  bpContactPerson: string;
  bpMobile: string;
  bpEmail: string;
  bpNotes: string;
  bpIsDefault: boolean;
  bpIsActive: boolean;
  setShowBillingProfileDialog: (v: boolean) => void;
  setSelectedClientForProfiles: (v: Client | null) => void;
  setShowBpForm: (v: boolean) => void;
  setEditingBpId: (v: number | null) => void;
  setBpLegalName: (v: string) => void;
  setBpBranch: (v: string) => void;
  setBpGstin: (v: string) => void;
  setBpPan: (v: string) => void;
  setBpState: (v: string) => void;
  setBpStateCode: (v: string) => void;
  setBpBillingAddress: (v: string) => void;
  setBpShippingAddress: (v: string) => void;
  setBpContactPerson: (v: string) => void;
  setBpMobile: (v: string) => void;
  setBpEmail: (v: string) => void;
  setBpNotes: (v: string) => void;
  setBpIsDefault: (v: boolean) => void;
  setBpIsActive: (v: boolean) => void;
  handleDeleteBillingProfile: (id: number) => void;
  handleCreateOrUpdateBillingProfile: (e: React.FormEvent) => void;
}

const BillingProfilesDialog: React.FC<BillingProfilesDialogProps> = ({
  show,
  selectedClient,
  billingProfiles,
  showBpForm,
  editingBpId,
  bpLegalName,
  bpBranch,
  bpGstin,
  bpPan,
  bpState,
  bpStateCode,
  bpBillingAddress,
  bpShippingAddress,
  bpContactPerson,
  bpMobile,
  bpEmail,
  bpNotes,
  bpIsDefault,
  bpIsActive,
  setShowBillingProfileDialog,
  setSelectedClientForProfiles,
  setShowBpForm,
  setEditingBpId,
  setBpLegalName,
  setBpBranch,
  setBpGstin,
  setBpPan,
  setBpState,
  setBpStateCode,
  setBpBillingAddress,
  setBpShippingAddress,
  setBpContactPerson,
  setBpMobile,
  setBpEmail,
  setBpNotes,
  setBpIsDefault,
  setBpIsActive,
  handleDeleteBillingProfile,
  handleCreateOrUpdateBillingProfile,
}) => {
  // Search across state / GSTIN / client (legal) name / billing address text.
  const [searchQuery, setSearchQuery] = React.useState("");
  // Reset search when the dialog is reopened on a different client.
  React.useEffect(() => {
    if (show) setSearchQuery("");
  }, [show, selectedClient?.id]);

  // Structured billing-address fields owned locally. Compose into the parent's
  // single `bpBillingAddress` text whenever any field changes. On form open,
  // parse the existing text back into the 5 fields so editing legacy profiles
  // still works.
  const [addrLine1, setAddrLine1] = React.useState("");
  const [addrLine2, setAddrLine2] = React.useState("");
  const [addrCity, setAddrCity] = React.useState("");
  const [addrPincode, setAddrPincode] = React.useState("");

  // Parse-on-form-open: only when the form first opens or editingBpId changes.
  // Triggered separately from compose-on-change to avoid an infinite loop.
  const lastFormKeyRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!showBpForm) return;
    const formKey = `${editingBpId ?? "new"}`;
    if (lastFormKeyRef.current === formKey) return;
    lastFormKeyRef.current = formKey;
    const parsed = parseBillingAddress(bpBillingAddress);
    setAddrLine1(parsed.line1);
    setAddrLine2(parsed.line2);
    setAddrCity(parsed.city);
    setAddrPincode(parsed.pincode);
    if (parsed.state && !bpState) setBpState(parsed.state);
  }, [showBpForm, editingBpId]);

  // Compose-on-change: push the joined multi-line string into the parent state.
  React.useEffect(() => {
    if (!showBpForm) return;
    const composed = composeBillingAddress({
      line1: addrLine1,
      line2: addrLine2,
      city: addrCity,
      state: bpState,
      pincode: addrPincode,
    });
    if (composed !== bpBillingAddress) setBpBillingAddress(composed);
  }, [addrLine1, addrLine2, addrCity, addrPincode, bpState, showBpForm]);

  // Reset structured fields when the form closes so reopening starts clean.
  React.useEffect(() => {
    if (!showBpForm) {
      lastFormKeyRef.current = "";
      setAddrLine1(""); setAddrLine2(""); setAddrCity(""); setAddrPincode("");
    }
  }, [showBpForm]);

  if (!show || !selectedClient) return null;

  const closeDialog = () => {
    setShowBillingProfileDialog(false);
    setSelectedClientForProfiles(null);
    setShowBpForm(false);
    setEditingBpId(null);
  };

  // Filter profiles for the top-of-dialog search. Matches across state name,
  // GSTIN, legal/branch company name, and the raw billing address text.
  const q = searchQuery.trim().toLowerCase();
  const filteredProfiles = !q
    ? billingProfiles
    : billingProfiles.filter(bp => (
        (bp.legalCompanyName || "").toLowerCase().includes(q)
        || (bp.branchLocationName || "").toLowerCase().includes(q)
        || (bp.gstin || "").toLowerCase().includes(q)
        || (bp.state || "").toLowerCase().includes(q)
        || (bp.stateCode || "").toLowerCase().includes(q)
        || (bp.billingAddress || "").toLowerCase().includes(q)
        || (selectedClient.name || "").toLowerCase().includes(q)
      ));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl border border-slate-100 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Client GST Billing Profiles</h3>
            <p className="text-xs text-slate-400">Client: <span className="font-bold text-orange-600">{normalizeDisplayName(selectedClient.name)}</span></p>
          </div>
          <button
            onClick={closeDialog}
            className="text-slate-400 hover:text-slate-700 p-1 bg-slate-100 hover:bg-slate-200 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Existing profiles grid */}
          {!showBpForm && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 focus-within:border-orange-500 transition">
                <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by state, GSTIN, company name, or billing address..."
                  className="flex-1 bg-transparent outline-none text-xs text-slate-700 placeholder-slate-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-slate-400 hover:text-slate-700 text-xs font-bold"
                    title="Clear search"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Registered GST Accounts
                  {q && <span className="ml-2 text-[10px] text-slate-500 normal-case">({filteredProfiles.length} of {billingProfiles.length})</span>}
                </h4>
                <button
                  onClick={() => {
                    setShowBpForm(true);
                    setEditingBpId(null);
                    setBpLegalName(selectedClient.name);
                    setBpBranch("");
                    setBpGstin("");
                    setBpPan(selectedClient.pan || "");
                    setBpState("");
                    setBpStateCode("");
                    setBpBillingAddress(selectedClient.address || "");
                    setBpShippingAddress("");
                    setBpContactPerson("");
                    setBpMobile("");
                    setBpEmail("");
                    setBpIsDefault(false);
                    setBpIsActive(true);
                    setBpNotes("");
                  }}
                  className="flex items-center gap-1 py-1.5 px-3 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-[10px] font-black rounded-lg transition shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add GST Profile
                </button>
              </div>

              {billingProfiles.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-xs">
                  No GST billing profiles configured yet for this company. All estimates will fallback onto primary corporate fields.
                </div>
              ) : filteredProfiles.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-xs">
                  No profiles match &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredProfiles.map((bp) => (
                    <div key={bp.id} className={`p-4 rounded-xl border transition ${bp.isDefault ? "bg-orange-50/20 border-orange-200" : "bg-white border-slate-200 hover:bg-slate-50/50"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h5 className="font-bold text-slate-800 text-sm">{normalizeDisplayName(bp.legalCompanyName)}</h5>
                          {bp.branchLocationName && <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">{normalizeDisplayName(bp.branchLocationName)}</span>}
                        </div>
                        <div className="flex gap-1.5">
                          {bp.isDefault && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-black uppercase">DEFAULT</span>}
                          {!bp.isActive && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-black uppercase">INACTIVE</span>}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <div><span className="font-bold text-slate-500">GSTIN:</span> <span className="font-mono text-orange-600 font-semibold">{normalizeGstinPan(bp.gstin)}</span></div>
                        {bp.pan && <div><span className="font-bold text-slate-500">PAN:</span> <span className="font-mono">{normalizeGstinPan(bp.pan)}</span></div>}
                        <div><span className="font-bold text-slate-500">State:</span> {normalizeDisplayName(bp.state)} ({bp.stateCode})</div>
                        <div>
                          <span className="font-bold text-slate-500 block">Billing Address:</span>
                          <div className="whitespace-pre-wrap text-slate-700 mt-0.5 leading-snug">{bp.billingAddress}</div>
                        </div>
                        {bp.contactPerson && <div><span className="font-bold text-slate-500">Contact:</span> {normalizeDisplayName(bp.contactPerson)} ({bp.mobile || bp.email})</div>}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingBpId(bp.id);
                            setBpLegalName(bp.legalCompanyName);
                            setBpBranch(bp.branchLocationName || "");
                            setBpGstin(bp.gstin);
                            setBpPan(bp.pan || "");
                            setBpState(bp.state);
                            setBpStateCode(bp.stateCode);
                            setBpBillingAddress(bp.billingAddress);
                            setBpShippingAddress(bp.shippingAddress || "");
                            setBpContactPerson(bp.contactPerson || "");
                            setBpMobile(bp.mobile || "");
                            setBpEmail(bp.email || "");
                            setBpIsDefault(bp.isDefault);
                            setBpIsActive(bp.isActive);
                            setBpNotes(bp.notes || "");
                            setShowBpForm(true);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition"
                        >
                          Edit Profile
                        </button>
                        <button
                          onClick={() => handleDeleteBillingProfile(bp.id)}
                          className="px-2.5 py-1 text-[10px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add / Edit Form */}
          {showBpForm && (
            <form onSubmit={handleCreateOrUpdateBillingProfile} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4 max-w-2xl mx-auto">
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider pb-2 border-b border-slate-200 flex justify-between">
                <span>{editingBpId ? "Modify GST Registration" : "New GST Registration"}</span>
                <button type="button" onClick={() => { setShowBpForm(false); setEditingBpId(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Legal Company Name *</label>
                  <input
                    type="text"
                    required
                    value={bpLegalName}
                    onChange={(e) => setBpLegalName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Legal entity billing name..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Branch / Location Descriptor</label>
                  <input
                    type="text"
                    value={bpBranch}
                    onChange={(e) => setBpBranch(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="e.g. Maharashtra GST"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">GSTIN *</label>
                  <input
                    type="text"
                    required
                    value={bpGstin}
                    onChange={(e) => setBpGstin(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 font-mono"
                    placeholder="GST Registration No."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">PAN Number</label>
                  <input
                    type="text"
                    value={bpPan}
                    onChange={(e) => setBpPan(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 font-mono"
                    placeholder="PAN identifier"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">State *</label>
                  <input
                    type="text"
                    required
                    value={bpState}
                    onChange={(e) => setBpState(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="e.g. Maharashtra"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">State Code *</label>
                  <input
                    type="text"
                    required
                    value={bpStateCode}
                    onChange={(e) => setBpStateCode(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="e.g. 27"
                  />
                </div>
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white border border-slate-200 rounded-lg p-3">
                  <div className="sm:col-span-2 flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Billing Address *</label>
                    <span className="text-[9px] text-slate-400 font-semibold">Generated address shown in preview below</span>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Address Line 1 *</label>
                    <input
                      type="text"
                      required={!addrLine2}
                      value={addrLine1}
                      onChange={(e) => setAddrLine1(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                      placeholder="e.g. Piramal Agastya Corporate Park"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Address Line 2</label>
                    <input
                      type="text"
                      value={addrLine2}
                      onChange={(e) => setAddrLine2(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                      placeholder="e.g. Building A, Unit 401-502, LBS Road, Kurla"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">City</label>
                    <input
                      type="text"
                      value={addrCity}
                      onChange={(e) => setAddrCity(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                      placeholder="e.g. Mumbai"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Pincode</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={addrPincode}
                      onChange={(e) => setAddrPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500 font-mono"
                      placeholder="e.g. 400070"
                    />
                  </div>
                  {bpBillingAddress && (
                    <div className="sm:col-span-2 mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 whitespace-pre-wrap leading-snug">
                      {bpBillingAddress}
                    </div>
                  )}
                  <p className="sm:col-span-2 text-[10px] text-slate-400">
                    State is taken from the GST registration field above. City, State, and Pincode are combined into one line: <span className="font-mono">City, State - Pincode</span>.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Shipping Address (Optional)</label>
                  <input
                    type="text"
                    value={bpShippingAddress}
                    onChange={(e) => setBpShippingAddress(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Default shipping consignee address..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={bpContactPerson}
                    onChange={(e) => setBpContactPerson(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Billing controller name..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Mobile</label>
                  <input
                    type="text"
                    value={bpMobile}
                    onChange={(e) => setBpMobile(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Mobile number..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Email</label>
                  <input
                    type="email"
                    value={bpEmail}
                    onChange={(e) => setBpEmail(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Email for billing..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Notes</label>
                  <input
                    type="text"
                    value={bpNotes}
                    onChange={(e) => setBpNotes(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-orange-500"
                    placeholder="Custom notes or details..."
                  />
                </div>
              </div>

              <div className="flex gap-6 py-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={bpIsDefault}
                    onChange={(e) => setBpIsDefault(e.target.checked)}
                    className="rounded text-orange-500 focus:ring-orange-400 h-4 w-4"
                  />
                  Set as Default Billing Profile
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={bpIsActive}
                    onChange={(e) => setBpIsActive(e.target.checked)}
                    className="rounded text-orange-500 focus:ring-orange-400 h-4 w-4"
                  />
                  Active Profile Account
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setShowBpForm(false); setEditingBpId(null); }}
                  className="py-1.5 px-4 bg-slate-100 hover:bg-slate-200 border rounded-lg text-slate-700 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-1.5 px-5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition shadow-sm"
                >
                  {editingBpId ? "Apply Changes" : "Register GST Profile"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
          <button
            onClick={closeDialog}
            className="py-2 px-6 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition"
          >
            Close Profiles View
          </button>
        </div>
      </div>
    </div>
  );
};

export default BillingProfilesDialog;
