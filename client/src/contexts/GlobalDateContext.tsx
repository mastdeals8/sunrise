import React from "react";

export type GlobalDatePreset = "today" | "week" | "month" | "quarter" | "fy" | "custom";

export type DateRange = {
  start: string;
  end: string;
};

type StoredGlobalDate = {
  preset: GlobalDatePreset;
  customRange?: DateRange;
};

type GlobalDateContextValue = {
  preset: GlobalDatePreset;
  range: DateRange;
  label: string;
  setPreset: (preset: GlobalDatePreset) => void;
  setCustomRange: (range: DateRange) => void;
  reset: () => void;
  isInRange: (value?: string | null) => boolean;
};

const STORAGE_KEY = "sunrise.globalDateFilter.v1";

const pad = (n: number) => String(n).padStart(2, "0");

export const toYmd = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseYmd = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};

const formatDisplay = (value: string) =>
  parseYmd(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const resolveDateRange = (preset: GlobalDatePreset, customRange?: DateRange): DateRange => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (preset === "today") return { start: toYmd(start), end: toYmd(end) };

  if (preset === "week") {
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    return { start: toYmd(start), end: toYmd(end) };
  }

  if (preset === "quarter") {
    const quarterStartMonth = Math.floor(start.getMonth() / 3) * 3;
    start.setMonth(quarterStartMonth, 1);
    end.setMonth(quarterStartMonth + 3, 0);
    return { start: toYmd(start), end: toYmd(end) };
  }

  if (preset === "fy") {
    // Indian financial year: April 1 – March 31
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    start.setFullYear(year, 3, 1);   // April 1
    end.setFullYear(year + 1, 2, 31); // March 31
    return { start: toYmd(start), end: toYmd(end) };
  }

  if (preset === "custom" && customRange?.start && customRange?.end) {
    return customRange.start <= customRange.end
      ? customRange
      : { start: customRange.end, end: customRange.start };
  }

  start.setDate(1);
  end.setMonth(start.getMonth() + 1, 0);
  return { start: toYmd(start), end: toYmd(end) };
};

export const isDateInRange = (value: string | null | undefined, range: DateRange) => {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const start = parseYmd(range.start);
  const end = parseYmd(range.end);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return time >= start.getTime() && time <= end.getTime();
};

const buildLabel = (preset: GlobalDatePreset, range: DateRange) => {
  const presetLabel: Record<GlobalDatePreset, string> = {
    today: "Today",
    week: "This Week",
    month: "This Month",
    quarter: "This Quarter",
    fy: "This FY",
    custom: "Custom Range",
  };
  return `${presetLabel[preset]} · ${formatDisplay(range.start)} - ${formatDisplay(range.end)}`;
};

const GlobalDateContext = React.createContext<GlobalDateContextValue | null>(null);

export const GlobalDateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = React.useState<StoredGlobalDate>(() => {
    if (typeof window === "undefined") return { preset: "fy" };
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "");
      if (parsed?.preset) return parsed;
    } catch {
      // Ignore corrupted preferences.
    }
    return { preset: "fy" };
  });

  const range = React.useMemo(() => resolveDateRange(state.preset, state.customRange), [state]);
  const label = React.useMemo(() => buildLabel(state.preset, range), [state.preset, range]);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const value = React.useMemo<GlobalDateContextValue>(() => ({
    preset: state.preset,
    range,
    label,
    setPreset: (preset) => setState(prev => ({ ...prev, preset })),
    setCustomRange: (customRange) => setState({ preset: "custom", customRange }),
    reset: () => setState({ preset: "fy" }),
    isInRange: (date) => isDateInRange(date, range),
  }), [label, range, state.preset]);

  return <GlobalDateContext.Provider value={value}>{children}</GlobalDateContext.Provider>;
};

export const useGlobalDate = () => {
  const context = React.useContext(GlobalDateContext);
  if (!context) throw new Error("useGlobalDate must be used inside GlobalDateProvider");
  return context;
};
