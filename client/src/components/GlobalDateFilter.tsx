import React from "react";
import { CalendarDays, RotateCcw } from "lucide-react";
import { useGlobalDate, type GlobalDatePreset } from "../contexts/GlobalDateContext";

const presets: Array<{ value: GlobalDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "fy", label: "This FY" },
  { value: "custom", label: "Custom Range" },
];

export const GlobalDateFilter: React.FC = () => {
  const { preset, range, label, setPreset, setCustomRange, reset } = useGlobalDate();
  const [customStart, setCustomStart] = React.useState(range.start);
  const [customEnd, setCustomEnd] = React.useState(range.end);

  React.useEffect(() => {
    setCustomStart(range.start);
    setCustomEnd(range.end);
  }, [range.start, range.end]);

  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    setCustomRange({ start: customStart, end: customEnd });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/70 px-2 py-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-orange-700">
        <CalendarDays className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <select
        value={preset}
        onChange={(event) => setPreset(event.target.value as GlobalDatePreset)}
        className="h-7 rounded border border-orange-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-orange-400"
        aria-label="Global date range"
      >
        {presets.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {preset === "custom" && (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={customStart}
            onChange={(event) => setCustomStart(event.target.value)}
            className="h-7 rounded border border-orange-200 bg-white px-2 text-xs"
            aria-label="Custom start date"
          />
          <input
            type="date"
            value={customEnd}
            onChange={(event) => setCustomEnd(event.target.value)}
            className="h-7 rounded border border-orange-200 bg-white px-2 text-xs"
            aria-label="Custom end date"
          />
          <button type="button" onClick={applyCustom} className="h-7 rounded bg-orange-600 px-2 text-xs font-black text-white hover:bg-orange-500">
            Apply
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={reset}
        title="Reset to This FY"
        className="inline-flex h-7 items-center gap-1 rounded border border-orange-200 bg-white px-2 text-xs font-bold text-orange-700 hover:bg-orange-100"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset
      </button>
    </div>
  );
};
