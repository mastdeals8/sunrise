import React from "react";
import CategoryAutocomplete from "./CategoryAutocomplete";

// The single source of truth for the Product input form. Used by:
//   - Product Master (Add + Edit)
//   - Estimate Builder's Create Product drawer (compact mode)
//
// Same fields, same validation, same submit shape. Only `compact` toggles
// whether the optional fields are collapsed behind a "More options" link.

export interface ProductFormValue {
  name: string;
  category: string;
  unit: string;
  calculationType: string;
  rate: string;
  gstPercent: string;
  hsnSac: string;
  isStandard: boolean;
  defaultSpecification?: string;
  warranty?: string;
  materialCodeId?: number | null;
  materialCode?: string;
  description?: string;
}

export const emptyProductFormValue = (): ProductFormValue => ({
  name: "",
  category: "",
  unit: "sqft",
  calculationType: "sqft",
  rate: "",
  gstPercent: "18",
  hsnSac: "",
  isStandard: true,
  defaultSpecification: "",
  warranty: "",
  materialCodeId: null,
  materialCode: "",
  description: "",
});

interface ProductFormProps {
  value: ProductFormValue;
  onChange: (next: ProductFormValue) => void;
  categories: string[];
  hsnCodes: string[];
  compact?: boolean;
}

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className}>
    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{label}</label>
    {children}
  </div>
);

const ProductForm: React.FC<ProductFormProps> = ({ value, onChange, categories, hsnCodes, compact = false }) => {
  const [showOptional, setShowOptional] = React.useState(!compact);
  const set = <K extends keyof ProductFormValue>(key: K, v: ProductFormValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Alias *">
        <input
          required
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          className="input-compact"
          placeholder="e.g. Backlit Fabric"
        />
      </Field>
      <Field label="Category">
        <CategoryAutocomplete
          value={value.category}
          onChange={(v) => set("category", v)}
          categories={categories}
          placeholder="Search or create category"
        />
      </Field>
      <Field label="Unit (UOM)">
        <select value={value.unit} onChange={(e) => set("unit", e.target.value)} className="input-compact font-bold">
          <option value="sqft">sqft</option>
          <option value="inch">running inch</option>
          <option value="nos">nos</option>
          <option value="job">job</option>
          <option value="km">km</option>
          <option value="percentage">percentage</option>
          <option value="manual">manual</option>
        </select>
      </Field>
      <Field label="Calculation rule">
        <select value={value.calculationType} onChange={(e) => set("calculationType", e.target.value)} className="input-compact font-bold">
          <option value="sqft">sqft: (W*H*Q / 144) * Rate</option>
          <option value="running_inch">running inch: (H*Letters*Q) * Rate</option>
          <option value="fixed">fixed amount: Rate</option>
          <option value="percentage">percentage of base</option>
          <option value="per_km">per km: KM * Rate</option>
          <option value="manual">manual amount</option>
        </select>
      </Field>
      <Field label="Rate ₹">
        <input
          type="number"
          required
          value={value.rate}
          onChange={(e) => set("rate", e.target.value)}
          className="input-compact font-bold"
        />
      </Field>
      <Field label="GST %">
        <input
          type="number"
          required
          value={value.gstPercent}
          onChange={(e) => set("gstPercent", e.target.value)}
          className="input-compact font-bold"
        />
      </Field>
      <Field label="HSN / SAC">
        <CategoryAutocomplete
          value={value.hsnSac}
          onChange={(v) => set("hsnSac", v)}
          categories={hsnCodes}
          placeholder="Search or create HSN"
          normalizeValue={(v) => String(v ?? "").trim().toUpperCase()}
        />
      </Field>
      <Field label="Standard product">
        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 mt-1">
          <input
            type="checkbox"
            checked={value.isStandard}
            onChange={(e) => set("isStandard", e.target.checked)}
            className="rounded text-orange-500"
          />
          Mark as standard
        </label>
      </Field>

      {!compact || showOptional ? (
        <>
          <Field label="Default specification" className="sm:col-span-2">
            <textarea
              value={value.defaultSpecification || ""}
              onChange={(e) => set("defaultSpecification", e.target.value)}
              rows={2}
              className="input-compact"
              placeholder="Default printed description for this product"
            />
          </Field>
          <Field label="Warranty">
            <input
              value={value.warranty || ""}
              onChange={(e) => set("warranty", e.target.value)}
              className="input-compact"
              placeholder="e.g. 1 year"
            />
          </Field>
          <Field label="Material code (legacy)">
            <input
              value={value.materialCode || ""}
              onChange={(e) => set("materialCode", e.target.value)}
              className="input-compact font-mono"
              placeholder="optional"
            />
          </Field>
          <Field label="Description / notes" className="sm:col-span-2">
            <textarea
              value={value.description || ""}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
              className="input-compact"
              placeholder="Internal notes — not printed"
            />
          </Field>
        </>
      ) : (
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setShowOptional(true)}
            className="text-xs font-bold text-orange-600 hover:text-orange-800"
          >
            + Show optional fields (spec, warranty, material code, notes)
          </button>
        </div>
      )}
    </div>
  );
};

export default ProductForm;
