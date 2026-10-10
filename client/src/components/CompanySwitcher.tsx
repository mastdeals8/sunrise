import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Building2, ChevronDown, Check, ShieldCheck, Plus, Sparkles } from "lucide-react";

export const CompanySwitcher: React.FC = () => {
  const { user, activeCompanyId, activeCompany, availableCompanies, switchCompany } = useAuth();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const currentName = activeCompany?.displayName || activeCompany?.name || "Sunrise Media";
  const isSuperAdmin = user.isSuperAdmin;

  const handleSelect = async (companyId: number) => {
    if (companyId === activeCompanyId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setOpen(false);
    try {
      await switchCompany(companyId);
      // Small timeout for smooth state refresh
      setTimeout(() => {
        setSwitching(false);
        // Force full refresh of cached records across modules
        window.location.reload();
      }, 150);
    } catch (e) {
      console.error("Failed to switch company:", e);
      setSwitching(false);
    }
  };

  return (
    <div className="relative px-2 pt-2 pb-1" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={switching}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 hover:bg-slate-100/90 hover:border-slate-300 transition-all text-left group shadow-xs"
        title="Switch Company Workspace"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-md bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Building2 className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-bold text-slate-800 truncate leading-tight group-hover:text-orange-600 transition-colors">
                {currentName}
              </span>
              {isSuperAdmin && (
                <span className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-orange-100 text-orange-700">
                  Super
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 font-medium leading-none">
              Workspace ID #{activeCompanyId}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute left-2 right-2 top-full mt-1.5 z-50 rounded-xl bg-white border border-slate-200 shadow-xl py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Company Workspaces
            </span>
            <span className="text-[10px] font-semibold text-slate-400">
              {availableCompanies.length} available
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {availableCompanies.map((c) => {
              const isSelected = c.id === activeCompanyId;
              const cName = c.displayName || c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition-colors ${
                    isSelected ? "bg-orange-50/60 font-semibold" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                      isSelected
                        ? "bg-orange-500 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {c.id === 1 ? "SM" : c.id === 2 ? "DEL" : c.id === 3 ? "RIK" : cName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[12px] truncate ${isSelected ? "text-orange-950 font-bold" : "text-slate-700"}`}>
                        {cName}
                      </p>
                      {c.gstin ? (
                        <p className="text-[10px] text-slate-400 font-mono leading-none">
                          GST: {c.gstin}
                        </p>
                      ) : (
                        <p className="text-[10px] text-amber-600 font-medium leading-none">
                          Setup Pending
                        </p>
                      )}
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-orange-600 shrink-0 ml-2" />
                  )}
                </button>
              );
            })}
          </div>

          {isSuperAdmin && (
            <div className="border-t border-slate-100 pt-1 px-1 mt-1">
              <a
                href="/settings?tab=companies"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 hover:text-orange-600 hover:bg-orange-50/50 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />
                Manage Companies & Access
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
