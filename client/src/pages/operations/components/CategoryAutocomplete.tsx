import React, { useState } from "react";
import { normalizeDisplayName } from "../../../../../shared/textFormat";

export const categoryKey = (value: unknown) =>
  String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export const normalizeCategoryLabel = (value: unknown) => normalizeDisplayName(value);

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  categories: string[];
  placeholder?: string;
  normalizeValue?: (value: unknown) => string;
  createVerb?: string;
}

const CategoryAutocomplete: React.FC<CategoryAutocompleteProps> = ({
  value,
  onChange,
  categories,
  placeholder = "Search or create category",
  normalizeValue = normalizeCategoryLabel,
  createVerb = "Create",
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const q = value.trim().toLowerCase();
  const currentKey = categoryKey(value);
  const matches = categories
    .filter(category => !q || category.toLowerCase().includes(q))
    .slice(0, 12);
  const exactMatch = categories.find(category => categoryKey(category) === currentKey);
  const createLabel = normalizeValue(value);
  const canCreate = Boolean(createLabel && !exactMatch && matches.length === 0);

  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selectCategory = (category: string) => {
    onChange(category);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        className="input-compact"
        placeholder={placeholder}
      />
      {open && (matches.length > 0 || canCreate) && (
        <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {matches.map(category => (
            <button
              key={category}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectCategory(category);
              }}
              className="block w-full border-b border-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-orange-50"
            >
              {category}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectCategory(createLabel);
              }}
              className="block w-full px-3 py-2 text-left text-xs font-bold text-orange-700 hover:bg-orange-50"
            >
              {createVerb} &ldquo;{createLabel}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default CategoryAutocomplete;
