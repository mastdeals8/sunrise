import React from "react";
import { Link } from "wouter";
import { FileText, AlertCircle, Plus } from "lucide-react";

/**
 * Placeholder for the Estimate Templates master. The data model already
 * supports a "format" string on every estimate (normal, ABFRL, letter_signage,
 * abfrl_multi_store). Persisted, reusable templates aren't yet implemented —
 * this page documents the gap and routes the user to the existing flows.
 *
 * Tracked in TODO_REMAINING.md.
 */
const EstimateTemplates: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <FileText className="w-7 h-7 text-orange-600" /> Estimate Templates
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Reusable starting points for new estimates by client format and project type.
        </p>
      </div>

      <div className="glass-panel p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-bold text-slate-900">Templates are not yet stored as separate records.</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              The estimate form already supports four built-in formats — pick the right one when you start a new
              estimate and the layout, columns, and validation snap to that format. A first-class "saved template"
              feature (clone last estimate, pick by name, pre-fill rows) is on the roadmap.
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Link href="/operations?new=1#estimates" className="glass-panel glass-panel-hover p-5 flex items-start gap-3 cursor-pointer">
          <Plus className="w-5 h-5 text-orange-600" />
          <div>
            <p className="font-bold text-slate-900">New Estimate</p>
            <p className="text-xs text-slate-500 mt-1">Start a fresh estimate. Pick format on Step 1.</p>
          </div>
        </Link>

        <Link href="/operations#estimates" className="glass-panel glass-panel-hover p-5 flex items-start gap-3 cursor-pointer">
          <FileText className="w-5 h-5 text-orange-600" />
          <div>
            <p className="font-bold text-slate-900">Estimate Register</p>
            <p className="text-xs text-slate-500 mt-1">Find an existing estimate to use as a starting point.</p>
          </div>
        </Link>
      </div>
    </div>
  );
};

export default EstimateTemplates;
