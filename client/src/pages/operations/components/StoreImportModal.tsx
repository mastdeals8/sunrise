import React, { useMemo, useRef, useState } from "react";
import {
  X, FileSpreadsheet, Upload, Database, Download,
  CheckCircle, AlertCircle, AlertTriangle,
} from "lucide-react";
import { getStateCode, normalizeStateName } from "@/utils/indiaLocations";
import type { Brand, Client, Store } from "../types";
import { importFieldsMap } from "../utils/importFieldsMap";
import { buildPreview, type ImportPreviewSummary } from "../utils/importMatching";

// ── helpers ──────────────────────────────────────────────────────────────────

const normalizeHeader = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

function autoMap(headers: string[]): Record<string, string> {
  const fields = importFieldsMap.stores ?? [];
  const mappings: Record<string, string> = {};
  fields.forEach(f => {
    const synonyms = [
      f.key.toLowerCase(),
      f.label.toLowerCase(),
      f.key.replace(/([A-Z])/g, "_$1").toLowerCase(),
      f.label.replace(/\s+/g, "_").toLowerCase(),
      f.label.replace(/\s+/g, "").toLowerCase(),
      ...(f.synonyms ?? []),
    ].map(normalizeHeader);
    const matched = headers.find(h => synonyms.includes(normalizeHeader(h)));
    if (matched) mappings[f.key] = matched;
  });
  return mappings;
}

// ── sub-components ────────────────────────────────────────────────────────────

const Stat: React.FC<{
  label: string; value: number;
  tone: "slate" | "emerald" | "orange" | "amber" | "red";
}> = ({ label, value, tone }) => {
  const cls = {
    slate:   "bg-slate-50  border-slate-200  text-slate-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    orange:  "bg-orange-50  border-orange-200  text-orange-700",
    amber:   "bg-amber-50   border-amber-200   text-amber-700",
    red:     "bg-red-50     border-red-200     text-red-700",
  }[tone];
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${cls}`}>
      <p className="text-[9px] uppercase font-bold tracking-wider opacity-80">{label}</p>
      <p className="text-base font-black mt-0.5">{value}</p>
    </div>
  );
};

const OutcomePill: React.FC<{ outcome: string; matchedField?: string }> = ({ outcome, matchedField }) => {
  const map: Record<string, string> = {
    create:      "bg-emerald-100 text-emerald-700 border-emerald-200",
    update:      "bg-orange-100  text-orange-700  border-orange-200",
    duplicate:   "bg-amber-100   text-amber-700   border-amber-200",
    missing_ref: "bg-red-100     text-red-700     border-red-200",
    error:       "bg-red-100     text-red-700     border-red-200",
  };
  const label = outcome === "missing_ref" ? "Missing ref" : outcome.charAt(0).toUpperCase() + outcome.slice(1);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${map[outcome] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>
      {label}{matchedField ? ` · ${matchedField}` : ""}
    </span>
  );
};

// ── main component ─────────────────────────────────────────────────────────

interface Props {
  token: string | null;
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  onClose: () => void;
  onImported: () => void;
}

const FIELDS = importFieldsMap.stores ?? [];

const StoreImportModal: React.FC<Props> = ({ token, clients, brands, stores, onClose, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName]           = useState("");
  const [headers, setHeaders]             = useState<string[]>([]);
  const [allRows, setAllRows]             = useState<Record<string, any>[]>([]);
  const [previewRows, setPreviewRows]     = useState<Record<string, any>[]>([]);
  const [mappings, setMappings]           = useState<Record<string, string>>({});
  const [isParsing, setIsParsing]         = useState(false);
  const [isCommitting, setIsCommitting]   = useState(false);
  const [stats, setStats]                 = useState<null | {
    total: number; created: number; updated: number; skippedRows: number;
    errors: Array<{ row: number; message: string }>;
  }>(null);

  // Map raw rows → field-keyed objects for live preview
  const mappedRows = useMemo(() =>
    allRows.map(row => {
      const out: Record<string, any> = {};
      FIELDS.forEach(f => {
        const col = mappings[f.key];
        if (col && row[col] !== undefined) out[f.key] = row[col];
      });
      // Auto-fill stateCode from state if missing, and state from stateCode if missing
      if (out.state && !out.stateCode) {
        const resolved = normalizeStateName(out.state);
        if (resolved.code) out.stateCode = resolved.code;
      } else if (out.stateCode && !out.state) {
        // stateCode provided but no state name — leave as-is, backend resolves
      }
      return out;
    }),
  [allRows, mappings]);

  const preview: ImportPreviewSummary | null = useMemo(() => {
    if (!headers.length || !mappedRows.length) return null;
    return buildPreview("stores", mappedRows, { clients, brands, stores });
  }, [mappedRows, headers.length, clients, brands, stores]);

  const hasBlockers = !!preview && (preview.errors > 0 || preview.missingRefs > 0);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setIsParsing(true);
    setStats(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/operations/imports/parse-file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) { const e = await res.json(); alert(e.message || "Parse failed"); return; }
      const data = await res.json();
      setHeaders(data.headers);
      setAllRows(data.allRows);
      setPreviewRows(data.previewRows);
      setMappings(autoMap(data.headers));
    } catch (err) {
      alert("Error reading file.");
    } finally {
      setIsParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleCommit = async () => {
    if (!allRows.length) return;
    setIsCommitting(true);
    const items = mappedRows;
    try {
      const res = await fetch("/api/operations/imports/stores", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) { const e = await res.json(); alert(e.message || "Import failed"); return; }
      const s = await res.json();
      setStats({
        total: s.total ?? items.length,
        created: s.created ?? s.imported ?? 0,
        updated: s.updated ?? 0,
        skippedRows: s.skippedRows ?? 0,
        errors: s.errors ?? [],
      });
      onImported();
      // Keep modal open to show results; user can close manually
      setHeaders([]);
      setAllRows([]);
      setPreviewRows([]);
      setMappings({});
      setFileName("");
    } catch (err) {
      alert("Import failed unexpectedly.");
    } finally {
      setIsCommitting(false);
    }
  };

  const clearFile = () => {
    setHeaders([]); setAllRows([]); setPreviewRows([]);
    setMappings({}); setFileName(""); setStats(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Import Stores / Sites from CSV or Excel</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Upload a spreadsheet, map columns, preview, then commit.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const headers = ["Store Name", "Store Code", "Client", "Brand", "City", "State", "State Code", "Region / Zone", "Contact Person", "Phone", "Address"];
                const exampleRow = ["Andheri West Store", "LP-MUM-01", "Levi's", "Levi's India", "Mumbai", "Maharashtra", "27", "West", "Rahul Sharma", "9876543210", "Shop 5, Link Road, Andheri West"];
                const csv = [headers, exampleRow].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "stores_import_template.csv";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-bold rounded-md transition"
              title="Download stores CSV template"
            >
              <Download className="w-3 h-3" /> Template
            </button>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-md">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {/* Step 1 — Upload */}
          {!stats && (
            <div
              className="border-2 border-dashed border-slate-200 hover:border-orange-300 rounded-xl p-7 transition bg-slate-50/50 text-center relative cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFile}
                className="hidden"
                disabled={isParsing}
              />
              <div className="flex flex-col items-center gap-3 pointer-events-none">
                <div className="p-3 bg-white rounded-full shadow-sm border border-slate-200">
                  {isParsing
                    ? <div className="w-6 h-6 border-2 border-t-orange-500 border-slate-200 rounded-full animate-spin" />
                    : <FileSpreadsheet className="w-6 h-6 text-orange-500" />
                  }
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    {fileName ? `Uploaded: ${fileName}` : "Click to browse or drag & drop"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">Supports .xlsx, .xls, .csv</p>
                </div>
              </div>
            </div>
          )}

          {/* Required columns reference */}
          {!headers.length && !stats && (
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Required columns</p>
              <div className="flex flex-wrap gap-1.5">
                {FIELDS.filter(f => f.required).map(f => (
                  <span key={f.key} className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold rounded">
                    {f.synonyms?.[0] ?? f.key} <span className="text-red-400">*</span>
                  </span>
                ))}
                {FIELDS.filter(f => !f.required && !f.reference).map(f => (
                  <span key={f.key} className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-500 text-[10px] rounded">
                    {f.synonyms?.[0] ?? f.key}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Column mapping */}
          {headers.length > 0 && !stats && (
            <div className="space-y-4">
              <div>
                <h5 className="text-xs font-bold text-orange-600 uppercase tracking-wider">
                  Step 2 — Map Columns
                </h5>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Required (<span className="text-red-500 font-bold">*</span>) fields drive client/brand matching.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                {FIELDS.map(f => (
                  <div key={f.key} className="flex items-center justify-between gap-2 border-b border-slate-200/40 pb-2 last:border-0 last:pb-0">
                    <label className={`text-xs font-bold shrink-0 ${f.reference ? "text-slate-400" : "text-slate-600"}`}>
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      {f.reference && <span className="text-[9px] text-slate-400 ml-1">(opt)</span>}
                    </label>
                    <select
                      value={mappings[f.key] ?? ""}
                      onChange={e => setMappings(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="text-xs font-semibold px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-orange-500 w-44 shrink-0"
                    >
                      <option value="">-- Unmapped --</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* Step 3 — Row preview */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h5 className="text-xs font-bold text-orange-600 uppercase tracking-wider">
                    Step 3 — Row Preview (top {previewRows.length} rows)
                  </h5>
                  <span className="text-[10px] text-slate-400 font-mono">Updates as you map columns</span>
                </div>
                <div className="border border-slate-100 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-200 sticky top-0">
                      <tr>
                        {FIELDS.map(f => (
                          <th key={f.key} className="px-3 py-2 whitespace-nowrap">
                            {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {previewRows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          {FIELDS.map(f => {
                            const col = mappings[f.key];
                            const val = col ? row[col] : undefined;
                            const missing = f.required && (val === undefined || val === null || String(val).trim() === "");
                            return (
                              <td key={f.key} className={`px-3 py-2 text-[11px] font-medium truncate max-w-[130px] ${missing ? "bg-red-50 text-red-500 font-bold border border-red-100" : "text-slate-700"}`}>
                                {missing ? "MISSING" : val !== undefined ? String(val) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Step 4 — Match preview */}
              {preview && (
                <div className="space-y-3">
                  <h5 className="text-xs font-bold text-orange-600 uppercase tracking-wider">
                    Step 4 — Match Preview ({preview.total} rows)
                  </h5>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    <Stat label="Total"        value={preview.total}       tone="slate"   />
                    <Stat label="New"           value={preview.toCreate}    tone="emerald" />
                    <Stat label="Update"        value={preview.toUpdate}    tone="orange"  />
                    <Stat label="Duplicates"    value={preview.duplicates}  tone="amber"   />
                    <Stat label="Missing refs"  value={preview.missingRefs} tone="red"     />
                    <Stat label="Errors"        value={preview.errors}      tone="red"     />
                  </div>

                  {(preview.warnings > 0 || preview.duplicates > 0 || preview.missingRefs > 0 || preview.errors > 0) && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Outcome</th>
                            <th className="px-3 py-2">Store</th>
                            <th className="px-3 py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {preview.rows
                            .filter(r => r.warnings.length || r.errors.length || r.outcome === "duplicate" || r.outcome === "missing_ref" || r.outcome === "error")
                            .slice(0, 80)
                            .map(r => (
                              <tr key={r.index} className="hover:bg-slate-50/40">
                                <td className="px-3 py-1.5 font-mono text-slate-500">{r.excelRow}</td>
                                <td className="px-3 py-1.5"><OutcomePill outcome={r.outcome} matchedField={r.matchedField} /></td>
                                <td className="px-3 py-1.5 text-slate-700 truncate max-w-[160px]">{r.primaryLabel}</td>
                                <td className="px-3 py-1.5 text-[10px] text-slate-500">
                                  {[...r.errors.map(e => `❌ ${e}`), ...r.warnings.map(w => `⚠ ${w}`)].join(" · ")}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {hasBlockers && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-amber-800">
                        Some rows are blocked (unresolved client/brand references or errors). Fix them in the source file or map a missing column, then re-upload. Rows without blockers will still be committed.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={clearFile}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                >
                  Clear File
                </button>
                <button
                  onClick={handleCommit}
                  disabled={isCommitting}
                  className="flex items-center gap-2 py-2 px-6 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
                >
                  {isCommitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-t-white border-orange-300 rounded-full animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4" />
                      Confirm Import
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Results panel */}
          {stats && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <h5 className="font-black text-emerald-800 text-sm">Import Complete</h5>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Processed</p>
                    <p className="text-xl font-black text-slate-700 mt-1">{stats.total}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase">Created</p>
                    <p className="text-xl font-black text-slate-700 mt-1">{stats.created}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-orange-100 shadow-sm">
                    <p className="text-[10px] font-bold text-orange-600 uppercase">Updated</p>
                    <p className="text-xl font-black text-slate-700 mt-1">{stats.updated}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-amber-100 shadow-sm">
                    <p className="text-[10px] font-bold text-amber-600 uppercase">Skipped</p>
                    <p className="text-xl font-black text-slate-700 mt-1">{stats.skippedRows}</p>
                  </div>
                </div>
                {stats.errors.length > 0 && (
                  <div className="border-t border-emerald-100 pt-3">
                    <p className="text-xs font-bold text-red-700 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" /> Row errors ({stats.errors.length}):
                    </p>
                    <ul className="list-disc pl-5 text-[10px] text-red-600 mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                      {stats.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>Row {e.row}: {e.message}</li>
                      ))}
                      {stats.errors.length > 20 && (
                        <li>and {stats.errors.length - 20} more…</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center">
                <button
                  onClick={clearFile}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                >
                  Import Another File
                </button>
                <button
                  onClick={onClose}
                  className="py-2 px-5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StoreImportModal;
