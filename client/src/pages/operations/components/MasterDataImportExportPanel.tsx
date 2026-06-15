import React, { useMemo } from "react";
import {
  Building2, Tag, MapPin, Package, Database,
  Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle, AlertTriangle
} from "lucide-react";
import type { Client, Brand, Store, Product } from "../types";
import { importFieldsMap } from "../utils/importFieldsMap";
import { buildPreview, type ImportPreviewSummary } from "../utils/importMatching";

interface MasterDataImportExportPanelProps {
  clients: Client[];
  brands: Brand[];
  stores: Store[];
  products: Product[];
  token: string | null;
  impType: string;
  setImpType: (v: string) => void;
  impHeaders: string[];
  setImpHeaders: (v: string[]) => void;
  impPreviewRows: any[];
  setImpPreviewRows: (v: any[]) => void;
  impAllRows: any[];
  setImpAllRows: (v: any[]) => void;
  impMappings: Record<string, string>;
  setImpMappings: (v: Record<string, string>) => void;
  impStats: any;
  setImpStats: (v: any) => void;
  impIsParsing: boolean;
  impIsCommitting: boolean;
  impFileName: string;
  setImpFileName: (v: string) => void;
  handleImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleCommitImport: () => void;
}

const MasterDataImportExportPanel: React.FC<MasterDataImportExportPanelProps> = ({
  clients,
  brands,
  stores,
  products,
  token,
  impType,
  setImpType,
  impHeaders,
  setImpHeaders,
  impPreviewRows,
  setImpPreviewRows,
  impAllRows,
  setImpAllRows,
  impMappings,
  setImpMappings,
  impStats,
  setImpStats,
  impIsParsing,
  impIsCommitting,
  impFileName,
  setImpFileName,
  handleImportFileChange,
  handleCommitImport,
}) => {
  // Build the mapped objects (raw row → matcher input shape) for ALL rows
  // so the preview panel reflects the full file, not just the visible rows.
  const mappedRows = useMemo(() => {
    const fields = importFieldsMap[impType] || [];
    return impAllRows.map(row => {
      const item: Record<string, any> = {};
      fields.forEach(f => {
        const header = impMappings[f.key];
        if (header && row[header] !== undefined) item[f.key] = row[header];
      });
      return item;
    });
  }, [impAllRows, impMappings, impType]);

  // Live matching preview against current masters
  const preview: ImportPreviewSummary | null = useMemo(() => {
    if (!impHeaders.length || !mappedRows.length) return null;
    return buildPreview(impType, mappedRows, { clients, brands, stores });
  }, [impType, mappedRows, impHeaders.length, clients, brands, stores]);

  // GSTIN sanity errors retained from the prior implementation
  const previewErrors = impPreviewRows.flatMap((row, idx) => {
    if (impType !== "billing_profiles") return [];
    const get = (key: string) => {
      const header = impMappings[key];
      return header ? String(row[header] ?? "").trim() : "";
    };
    const gstin = get("gstin").toUpperCase();
    const stateCode = get("stateCode") || gstin.slice(0, 2);
    const errors: string[] = [];
    if (gstin && gstin.length !== 15) errors.push("GSTIN must be 15 characters");
    if (gstin.length === 15 && stateCode && stateCode.padStart(2, "0") !== gstin.slice(0, 2)) {
      errors.push(`State code must match GSTIN prefix ${gstin.slice(0, 2)}`);
    }
    return errors.map(message => ({ row: idx + 2, message }));
  });

  const hasBlockingProblems = !!preview && (preview.errors > 0 || preview.missingRefs > 0);
  const fields = importFieldsMap[impType] || [];

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Database className="w-5 h-5 text-orange-500" />
            Master Data Import &amp; Export Wizard
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Upload Excel/CSV with business columns (names, GSTIN, store codes). Internal IDs are optional. Preview shows what will be created vs updated before you commit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ["CLIENTS_TEMPLATE", "Clients"],
            ["CLIENT_GST_PROFILES_TEMPLATE", "GST Profiles"],
            ["BRANDS_TEMPLATE", "Brands"],
            ["STORES_TEMPLATE", "Stores"],
            ["PRODUCTS_TEMPLATE", "Products"],
            ["MATERIAL_CODES_TEMPLATE", "Material Codes"],
            ["CUSTOMER_RATE_CARDS_TEMPLATE", "Rate Cards"],
            ["CUSTOMER_RATE_CARD_ITEMS_TEMPLATE", "Rate Items"],
            ["STAFF_TEMPLATE", "Staff"],
            ["OPENING_OUTSTANDING_TEMPLATE", "Outstanding"],
          ].map(([file, label]) => (
            <a
              key={file}
              href={`/api/templates/${file}`}
              download
              className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-bold rounded-md transition"
              title={`Download sample ${label} template`}
            >
              <Download className="w-3 h-3" /> {label}
            </a>
          ))}
          <a
            href="/api/templates/ABLBL_GST_IMPORT_FORMAT"
            download
            className="flex items-center gap-1 px-2.5 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[10px] font-bold rounded-md transition"
            title="Download ABLBL-specific GST import format"
          >
            <Download className="w-3 h-3" /> Download ABLBL GST Import Format
          </a>
        </div>
      </div>

      {/* __CONTINUE_HERE__ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { id: "clients", label: "Clients / Companies", icon: Building2, count: clients.length },
          { id: "billing_profiles", label: "GST Billing Profiles", icon: Database, count: null },
          { id: "brands", label: "Brands Catalog", icon: Tag, count: brands.length },
          { id: "stores", label: "Store Sites Registry", icon: MapPin, count: stores.length },
          { id: "products", label: "Products & Rates", icon: Package, count: products.length },
        ].map(tab => {
          const IconComp = tab.icon || Database;
          const isSelected = impType === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setImpType(tab.id);
                setImpHeaders([]);
                setImpPreviewRows([]);
                setImpAllRows([]);
                setImpMappings({});
                setImpStats(null);
                setImpFileName("");
              }}
              className={`p-4 rounded-xl border text-left transition flex flex-col justify-between gap-3 ${
                isSelected
                  ? "bg-orange-50/50 border-orange-300 text-orange-700 shadow-sm"
                  : "bg-white border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-800"
              }`}
            >
              <div className="flex justify-between items-center w-full">
                <IconComp className={`w-5 h-5 ${isSelected ? "text-orange-600" : "text-slate-400"}`} />
                {tab.count !== null && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isSelected ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-500"}`}>
                    {tab.count} items
                  </span>
                )}
              </div>
              <div>
                <p className="text-xs font-bold font-sans leading-none">{tab.label}</p>
                <p className="text-[10px] text-slate-400 mt-1 uppercase font-mono font-bold tracking-wider">{tab.id.replace("_", " ")}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-6">
          <div>
            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Upload className="w-4 h-4 text-slate-400" />
              Excel / CSV Data Importer
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Upload a spreadsheet to map columns and import into <strong className="text-slate-600">{impType.replace("_", " ").toUpperCase()}</strong>. We'll match rows by business data — you don't need to fill in DB IDs.
            </p>
          </div>

          <div className="border-2 border-dashed border-slate-200 hover:border-orange-300 rounded-xl p-8 transition bg-slate-50/50 text-center relative">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={impIsParsing}
            />
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-white rounded-full shadow-sm border border-slate-155 text-slate-450">
                {impIsParsing ? (
                  <div className="w-6 h-6 border-2 border-t-orange-500 border-slate-200 rounded-full animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-6 h-6 text-orange-500" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700">
                  {impFileName ? `Uploaded: ${impFileName}` : "Drag & drop spreadsheet or click to browse"}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Supports Microsoft Excel (.xlsx, .xls) and Comma-Separated Values (.csv)</p>
              </div>
            </div>
          </div>

          {/* __CONTINUE_HERE__ */}
          {impHeaders.length > 0 && (
            <div className="space-y-6 border-t border-slate-100 pt-6">
              <div>
                <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-orange-600">
                  Step 2: Map Fields
                </h5>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Required (<span className="text-red-500 font-bold">*</span>) fields drive matching. Internal-ID columns are optional.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                {fields.map(f => {
                  return (
                    <div key={f.key} className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-200/40 pb-2 last:border-0 last:pb-0">
                      <label className={`text-xs font-bold flex items-center gap-1 ${f.reference ? "text-slate-400" : "text-slate-600"}`}>
                        {f.label}
                        {f.required && <span className="text-red-500 font-bold">*</span>}
                        {f.reference && <span className="text-[9px] uppercase tracking-wider text-slate-400">(optional)</span>}
                      </label>
                      <select
                        value={impMappings[f.key] || ""}
                        onChange={(e) => {
                          setImpMappings({
                            ...impMappings,
                            [f.key]: e.target.value
                          });
                        }}
                        className="text-xs font-semibold px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-orange-500 w-full md:w-48"
                      >
                        <option value="">-- Unmapped --</option>
                        {impHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Preview Area */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-orange-600">
                    Step 3: Preview Records (Top 20 rows)
                  </h5>
                  <span className="text-[10px] text-slate-400 font-mono">Row preview updates dynamically</span>
                </div>

                <div className="border border-slate-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-550 font-bold uppercase tracking-wider border-b border-slate-200 sticky top-0">
                      <tr>
                        {fields.map(f => (
                          <th key={f.key} className="px-3 py-2 text-[10px]">
                            {f.label} {f.required && <span className="text-red-500">*</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white font-sans">
                      {impPreviewRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-55/50">
                          {fields.map(f => {
                            const mappedCol = impMappings[f.key];
                            const rawVal = mappedCol ? row[mappedCol] : undefined;
                            const isMissing = f.required && (rawVal === undefined || rawVal === null || String(rawVal).trim() === "");
                            return (
                              <td key={f.key} className={`px-3 py-2 text-[11px] font-medium truncate max-w-[150px] ${isMissing ? "bg-red-50 text-red-500 font-bold border border-red-100" : "text-slate-700"}`}>
                                {isMissing ? "MISSING REQUIRED FIELD" : (rawVal !== undefined ? String(rawVal) : "-")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {previewErrors.length > 0 && (
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                    <p className="text-[10px] font-bold text-red-700 uppercase flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Preview validation errors
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-[10px] text-red-600 space-y-0.5">
                      {previewErrors.slice(0, 8).map((err, idx) => (
                        <li key={idx}>Row {err.row}: {err.message}</li>
                      ))}
                      {previewErrors.length > 8 && <li>and {previewErrors.length - 8} more errors...</li>}
                    </ul>
                  </div>
                )}
              </div>
              {/* __CONTINUE_HERE__ */}
              {preview && (
                <div className="space-y-3">
                  <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider text-orange-600">
                    Step 4: Match Preview ({preview.total} rows)
                  </h5>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
                    <Stat label="Total" value={preview.total} tone="slate" />
                    <Stat label="New" value={preview.toCreate} tone="emerald" />
                    <Stat label="Updates" value={preview.toUpdate} tone="orange" />
                    <Stat label="Duplicates" value={preview.duplicates} tone="amber" />
                    <Stat label="Missing refs" value={preview.missingRefs} tone="red" />
                    <Stat label="Errors" value={preview.errors} tone="red" />
                  </div>
                  {(preview.warnings > 0 || preview.duplicates > 0 || preview.missingRefs > 0 || preview.errors > 0) && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Outcome</th>
                            <th className="px-3 py-2">Subject</th>
                            <th className="px-3 py-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {preview.rows
                            .filter(r => r.warnings.length || r.errors.length || r.outcome === "duplicate" || r.outcome === "missing_ref" || r.outcome === "error")
                            .slice(0, 100)
                            .map(r => (
                              <tr key={r.index} className="hover:bg-slate-50/40">
                                <td className="px-3 py-1.5 font-mono text-slate-500">{r.excelRow}</td>
                                <td className="px-3 py-1.5">
                                  <OutcomePill outcome={r.outcome} matchedField={r.matchedField} />
                                </td>
                                <td className="px-3 py-1.5 text-slate-700 truncate max-w-[180px]">
                                  {r.primaryLabel}
                                  {r.secondaryLabel ? <span className="text-[10px] text-slate-400 ml-1">{r.secondaryLabel}</span> : null}
                                </td>
                                <td className="px-3 py-1.5 text-[10px] text-slate-500">
                                  {[...r.errors.map(e => `❌ ${e}`), ...r.warnings.map(w => `⚠ ${w}`)].join(" · ") || ""}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {hasBlockingProblems && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                      <p className="text-[11px] text-amber-800">
                        Some rows are blocked (errors / unresolved references). Fix them in the source file or map a missing column, then re-upload. Other rows can still be committed.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* __CONTINUE_HERE__ */}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => {
                    setImpHeaders([]);
                    setImpPreviewRows([]);
                    setImpAllRows([]);
                    setImpMappings({});
                    setImpFileName("");
                    setImpStats(null);
                  }}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                >
                  Clear File
                </button>
                <button
                  onClick={handleCommitImport}
                  disabled={impIsCommitting || previewErrors.length > 0}
                  className="flex items-center gap-2 py-2 px-6 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
                >
                  {impIsCommitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-t-white border-orange-300 rounded-full animate-spin" />
                      Committing Import...
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4" />
                      Commit Import Registry
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {impStats && (
            <div className="bg-emerald-50 border border-emerald-150 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <h5 className="font-black text-emerald-800 text-sm">Import Complete</h5>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-2 text-center">
                <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Processed</p>
                  <p className="text-xl font-black text-slate-700 mt-1">{impStats.total || 0}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Imported</p>
                  <p className="text-xl font-black text-slate-700 mt-1">{impStats.created ?? impStats.imported ?? 0}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-bold text-orange-600 uppercase">Updated</p>
                  <p className="text-xl font-black text-slate-700 mt-1">{impStats.updated ?? impStats.skipped ?? 0}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-bold text-amber-600 uppercase">Skipped</p>
                  <p className="text-xl font-black text-slate-700 mt-1">{impStats.skippedRows ?? 0}</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-100 shadow-sm">
                  <p className="text-[10px] font-bold text-red-500 uppercase">Errors</p>
                  <p className="text-xl font-black text-slate-700 mt-1">{(impStats.errors && impStats.errors.length) || impStats.errorsCount || 0}</p>
                </div>
              </div>
              {impStats.errors && impStats.errors.length > 0 && (
                <div className="mt-4 border-t border-emerald-100 pt-3">
                  <p className="text-xs font-bold text-red-700 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> Import Warnings &amp; Validation Failures:
                  </p>
                  <ul className="list-disc pl-5 text-[10px] text-red-600 mt-1.5 space-y-1">
                    {impStats.errors.slice(0, 10).map((err: any, idx: number) => (
                      <li key={idx}>{typeof err === "string" ? err : (err.message || JSON.stringify(err))}</li>
                    ))}
                    {impStats.errors.length > 10 && (
                      <li>and {impStats.errors.length - 10} more errors...</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* __CONTINUE_HERE__ */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-6">
          <div>
            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Download className="w-4 h-4 text-slate-400" />
              Quick Exports Registry
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Download the latest database master tables as structured spreadsheets immediately.
            </p>
          </div>

          <div className="space-y-3 font-sans">
            {[
              { id: "clients", label: "Clients Registry", desc: "Corporate accounts and profiles" },
              { id: "billing_profiles", label: "Multi-GST Profiles", desc: "State registrations & addresses" },
              { id: "brands", label: "Brands Directory", desc: "Hierarchy of corporate parent brands" },
              { id: "stores", label: "Stores / Sites", desc: "Client stores and states registry" },
              { id: "products", label: "Product & Rates", desc: "Signage categories, standard rates & rules" },
            ].map(exp => (
              <a
                key={exp.id}
                href={`/api/operations/exports/${exp.id}`}
                download
                className="flex justify-between items-center p-3 rounded-lg border border-slate-100 hover:border-orange-200 hover:bg-orange-50/20 text-left transition group"
              >
                <div>
                  <p className="text-xs font-bold text-slate-700 group-hover:text-orange-600 transition">{exp.label}</p>
                  <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{exp.desc}</p>
                </div>
                <FileSpreadsheet className="w-4 h-4 text-slate-300 group-hover:text-orange-500 transition" />
              </a>
            ))}
          </div>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/50">
            <h5 className="font-bold text-slate-700 text-xs flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-orange-500" /> Tips for Bulk Import
            </h5>
            <ul className="list-disc pl-4 text-[10px] text-slate-500 space-y-1.5 mt-2">
              <li>Internal IDs are <strong>optional</strong>. Leave them blank — we match by names, GSTIN, and store codes.</li>
              <li>Brands match by <strong>Brand Name + Client</strong>. Stores match by <strong>Store Code + Client/Brand</strong>.</li>
              <li>Near-duplicate names (e.g. <em>"Aditya Birla"</em> vs <em>"Adityabilra"</em>) trigger a warning instead of silent imports.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: "slate" | "emerald" | "orange" | "amber" | "red" }> = ({ label, value, tone }) => {
  const toneClass = {
    slate: "bg-slate-50 border-slate-200 text-slate-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    orange: "bg-orange-50 border-orange-200 text-orange-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  }[tone];
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${toneClass}`}>
      <p className="text-[9px] uppercase font-bold tracking-wider opacity-80">{label}</p>
      <p className="text-base font-black mt-0.5">{value}</p>
    </div>
  );
};

const OutcomePill: React.FC<{ outcome: string; matchedField?: string }> = ({ outcome, matchedField }) => {
  const map: Record<string, string> = {
    create: "bg-emerald-100 text-emerald-700 border-emerald-200",
    update: "bg-orange-100 text-orange-700 border-orange-200",
    duplicate: "bg-amber-100 text-amber-700 border-amber-200",
    missing_ref: "bg-red-100 text-red-700 border-red-200",
    error: "bg-red-100 text-red-700 border-red-200",
  };
  const label = outcome === "missing_ref" ? "Missing ref" : outcome.charAt(0).toUpperCase() + outcome.slice(1);
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${map[outcome] || "bg-slate-100 text-slate-700 border-slate-200"}`}>
      {label}{matchedField ? ` · ${matchedField}` : ""}
    </span>
  );
};

export default MasterDataImportExportPanel;
