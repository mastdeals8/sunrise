import { useEffect, useRef, useState } from "react";
import { INDIA_STATES, getCitiesForState, getStateCode, lookupStateForCity } from "@/utils/indiaLocations";

interface StateSelectProps {
  value: string;
  onChange: (stateName: string, stateCode: string) => void;
  required?: boolean;
  className?: string;
  placeholder?: string;
}

export function StateSelect({ value, onChange, required, className = "input-compact", placeholder = "Select state" }: StateSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const name = e.target.value;
        const code = getStateCode(name);
        onChange(name, code);
      }}
      required={required}
      className={className}
    >
      <option value="">{placeholder}</option>
      {INDIA_STATES.map((s) => (
        <option key={s.code} value={s.name}>
          {s.name} ({s.code})
        </option>
      ))}
    </select>
  );
}

interface CityComboboxProps {
  value: string;
  onChange: (city: string, inferredState?: string, inferredCode?: string) => void;
  stateName?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
}

export function CityCombobox({
  value,
  onChange,
  stateName,
  required,
  className = "input-compact",
  placeholder = "Type or select city",
}: CityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Keep query in sync when value is programmatically changed
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const cities = stateName ? getCitiesForState(stateName) : [];
  const filtered = query.length >= 1
    ? cities.filter((c) => c.toLowerCase().startsWith(query.toLowerCase()))
    : cities;

  function handleInput(raw: string) {
    setQuery(raw);
    setOpen(true);
    // Don't infer state on every keystroke — only on explicit selection
    onChange(raw);
  }

  function selectCity(city: string) {
    setQuery(city);
    setOpen(false);
    const inferred = lookupStateForCity(city);
    if (inferred) {
      onChange(city, inferred.name, inferred.code);
    } else {
      onChange(city);
    }
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Commit typed value on blur even if not from dropdown
          setTimeout(() => setOpen(false), 150);
        }}
        required={required}
        className={className}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-slate-200 rounded shadow-md max-h-48 overflow-y-auto text-xs mt-0.5">
          {filtered.slice(0, 50).map((city) => (
            <li
              key={city}
              onMouseDown={() => selectCity(city)}
              className="px-3 py-1.5 hover:bg-slate-100 cursor-pointer"
            >
              {city}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Convenience group: State dropdown + auto-filled StateCode + City combobox. */
interface IndiaLocationFieldsProps {
  city: string;
  state: string;
  stateCode: string;
  onCityChange: (city: string) => void;
  onStateChange: (state: string, code: string) => void;
  cityRequired?: boolean;
  stateRequired?: boolean;
  fieldClassName?: string;
  labelClassName?: string;
  showLabels?: boolean;
}

export function IndiaLocationFields({
  city,
  state,
  stateCode,
  onCityChange,
  onStateChange,
  cityRequired,
  stateRequired,
  fieldClassName = "input-compact",
  labelClassName = "block text-[10px] font-bold text-slate-500 uppercase mb-1",
  showLabels = true,
}: IndiaLocationFieldsProps) {
  function handleCityChange(newCity: string, inferredState?: string, inferredCode?: string) {
    onCityChange(newCity);
    if (inferredState && inferredCode && !state) {
      onStateChange(inferredState, inferredCode);
    }
  }

  return (
    <>
      <div>
        {showLabels && <label className={labelClassName}>City</label>}
        <CityCombobox
          value={city}
          onChange={handleCityChange}
          stateName={state}
          required={cityRequired}
          className={fieldClassName}
          placeholder="Type or select city"
        />
      </div>
      <div>
        {showLabels && <label className={labelClassName}>State</label>}
        <StateSelect
          value={state}
          onChange={onStateChange}
          required={stateRequired}
          className={fieldClassName}
        />
      </div>
      <div>
        {showLabels && <label className={labelClassName}>State Code</label>}
        <input
          type="text"
          value={stateCode}
          readOnly
          className={`${fieldClassName} bg-slate-50 text-slate-500 cursor-default`}
          placeholder="Auto-filled"
          tabIndex={-1}
        />
      </div>
    </>
  );
}
