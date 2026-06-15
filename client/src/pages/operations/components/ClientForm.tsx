import React from "react";

// Single source of truth for the client input form. Used by:
//   - Clients page Add Client
//   - Future: estimate-side "Add Client" entry point (same component, same fields)
// Mirrors the field set in client_billing_profiles + clients tables.

export interface ClientFormValue {
  name: string;
  groupName: string;
  gst: string;
  pan: string;
  type: string;            // corporate | normal | walk_in
  formatSetting: string;   // normal | ABLBL
  email: string;
  phone: string;
  city: string;
  address: string;
  primaryContact: string;
  paymentTerms: string;
  vendorCode: string;
}

export const emptyClientFormValue = (): ClientFormValue => ({
  name: "",
  groupName: "",
  gst: "",
  pan: "",
  type: "corporate",
  formatSetting: "normal",
  email: "",
  phone: "",
  city: "",
  address: "",
  primaryContact: "",
  paymentTerms: "",
  vendorCode: "",
});

interface ClientFormProps {
  value: ClientFormValue;
  onChange: (next: ClientFormValue) => void;
}

const cls = "w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500";
const lbl = "block text-xs font-bold text-slate-500 uppercase mb-1";

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className={lbl}>{label}</label>
    {children}
  </div>
);

const ClientForm: React.FC<ClientFormProps> = ({ value, onChange }) => {
  const set = <K extends keyof ClientFormValue>(key: K, v: ClientFormValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Row label="Company / Corporate Name">
        <input required value={value.name} onChange={e => set("name", e.target.value)} className={cls} placeholder="e.g. Aditya Birla Group" />
      </Row>
      <Row label="Client Group / Parent Brand">
        <input value={value.groupName} onChange={e => set("groupName", e.target.value)} className={cls} placeholder="e.g. ABLBL" />
      </Row>
      <Row label="Primary GSTIN Registration">
        <input value={value.gst} onChange={e => set("gst", e.target.value)} className={cls} placeholder="e.g. 27AAACA1234F1Z5" />
      </Row>
      <Row label="Company PAN">
        <input value={value.pan} onChange={e => set("pan", e.target.value)} className={cls} placeholder="e.g. AAACA1234F" />
      </Row>
      <Row label="Client Type Classification">
        <select value={value.type} onChange={e => set("type", e.target.value)} className={`${cls} font-bold`}>
          <option value="corporate">Corporate (Enterprise Group)</option>
          <option value="normal">Normal (Standard Business)</option>
          <option value="walk_in">Walk-in (Retail/Direct Cash)</option>
        </select>
      </Row>
      <Row label="Billing Format Setting">
        <select value={value.formatSetting} onChange={e => set("formatSetting", e.target.value)} className={`${cls} font-bold`}>
          <option value="normal">Standard / Normal</option>
          <option value="ABLBL">ABLBL</option>
        </select>
      </Row>
      <Row label="Billing Email Address">
        <input type="email" value={value.email} onChange={e => set("email", e.target.value)} className={cls} placeholder="billing@company.com" />
      </Row>
      <Row label="Mobile Contact Phone">
        <input value={value.phone} onChange={e => set("phone", e.target.value)} className={cls} placeholder="+91 9876543210" />
      </Row>
      <Row label="Primary Contact (Person)">
        <input value={value.primaryContact} onChange={e => set("primaryContact", e.target.value)} className={cls} placeholder="Procurement Lead Name" />
      </Row>
      <Row label="Payment Terms">
        <input value={value.paymentTerms} onChange={e => set("paymentTerms", e.target.value)} className={cls} placeholder="e.g. Net 30" />
      </Row>
      <Row label="City">
        <input value={value.city} onChange={e => set("city", e.target.value)} className={cls} placeholder="Mumbai" />
      </Row>
      <Row label="Vendor Code (optional)">
        <input value={value.vendorCode} onChange={e => set("vendorCode", e.target.value)} className={cls} placeholder="Vendor code on client's books" />
      </Row>
      <div className="md:col-span-2">
        <Row label="Registered Billing Address">
          <textarea rows={3} value={value.address} onChange={e => set("address", e.target.value)} className={cls} placeholder="Full registered billing address…" />
        </Row>
      </div>
    </div>
  );
};

export default ClientForm;
