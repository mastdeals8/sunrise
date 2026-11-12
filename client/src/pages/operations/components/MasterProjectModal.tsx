import React, { useState, useEffect } from "react";
import { X, Check, Layers, Plus, Trash2, Calendar, IndianRupee, AlertCircle } from "lucide-react";
import { formatCurrency } from "../utils/formatters";
import { createMasterProject, updateMasterProject } from "../../../lib/api";
import { EstimateSelectorModal } from "./EstimateSelectorModal";

interface MasterProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialProject?: any | null;
  clients: Array<{ id: number; name: string }>;
  brands: Array<{ id: number; name: string; clientId?: number | null }>;
  users?: Array<{ id: number; name: string }>;
}

export const MasterProjectModal: React.FC<MasterProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialProject,
  clients,
  brands,
  users = [],
}) => {
  const [name, setName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [clientId, setClientId] = useState<number | undefined>(undefined);
  const [brandId, setBrandId] = useState<number | undefined>(undefined);
  const [managerId, setManagerId] = useState<number | undefined>(undefined);
  const [targetBudget, setTargetBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");
  const [selectedEstimateIds, setSelectedEstimateIds] = useState<number[]>([]);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (initialProject) {
        setName(initialProject.name || "");
        setProjectCode(initialProject.projectCode || initialProject.project_code || "");
        setClientId(initialProject.clientId || initialProject.client_id || undefined);
        setBrandId(initialProject.brandId || initialProject.brand_id || undefined);
        setManagerId(initialProject.managerId || initialProject.manager_id || undefined);
        setTargetBudget(initialProject.targetBudget ? String(initialProject.targetBudget) : "");
        setStartDate(initialProject.startDate ? String(initialProject.startDate).split("T")[0] : "");
        setTargetDate(initialProject.targetDate ? String(initialProject.targetDate).split("T")[0] : "");
        setStatus(initialProject.status || "active");
        setNotes(initialProject.notes || "");
        const existingEstIds = (initialProject.linkedEstimates || []).map((e: any) => e.estimateId || e.id);
        setSelectedEstimateIds(existingEstIds);
      } else {
        setName("");
        setProjectCode("");
        setClientId(clients[0]?.id || undefined);
        setBrandId(undefined);
        setManagerId(undefined);
        setTargetBudget("");
        setStartDate(new Date().toISOString().split("T")[0]);
        setTargetDate("");
        setStatus("active");
        setNotes("");
        setSelectedEstimateIds([]);
      }
    }
  }, [isOpen, initialProject, clients]);

  const handleEstimateSelection = (ids: number[]) => {
    setSelectedEstimateIds(ids);
    setIsSelectorOpen(false);
  };

  const removeEstimateId = (id: number) => {
    setSelectedEstimateIds((prev) => prev.filter((i) => i !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Project name is required");
      return;
    }
    if (!clientId) {
      setErrorMessage("Please select a Corporate Client");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const token = localStorage.getItem("token");

      const payload = {
        name: name.trim(),
        projectCode: projectCode.trim() || null,
        clientId,
        brandId: brandId || null,
        managerId: managerId || null,
        targetBudget: targetBudget ? Number(targetBudget) : null,
        startDate: startDate || null,
        targetDate: targetDate || null,
        status,
        notes: notes.trim() || null,
        estimateIds: selectedEstimateIds,
      };

      if (initialProject?.id) {
        await updateMasterProject(token, initialProject.id, payload);
      } else {
        await createMasterProject(token, payload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("Failed to save master project:", err);
      setErrorMessage(err.message || "Failed to save master project");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-orange-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {initialProject ? "Edit Master Project" : "Create New Master Project"}
                </h2>
                <p className="text-xs text-slate-500">
                  Group multi-store estimates for unified costing, purchase allocations, and profit tracking.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Project Name & Code */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Master Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wakefit West & South Rollout Q1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none font-medium"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Project Code</label>
                <input
                  type="text"
                  placeholder="e.g. WF-ROLLOUT-01"
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value.toUpperCase())}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none uppercase"
                />
              </div>
            </div>

            {/* Client & Brand */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Corporate Client *
                </label>
                <select
                  required
                  value={clientId || ""}
                  onChange={(e) => {
                    const cId = Number(e.target.value);
                    setClientId(cId);
                    setBrandId(undefined);
                  }}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
                >
                  <option value="">Select Client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Primary Brand</label>
                <select
                  value={brandId || ""}
                  onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
                >
                  <option value="">All Brands / Unspecified</option>
                  {brands
                    .filter((b) => !clientId || !b.clientId || b.clientId === clientId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Budget & Status & Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Budget (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={targetBudget}
                  onChange={(e) => setTargetBudget(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none capitalize"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on_hold">On Hold</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Target Date</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Linked Estimates Section */}
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-bold text-slate-900 text-xs">
                    Linked Estimates ({selectedEstimateIds.length})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Estimates grouped into this Master Project.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSelectorOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-100/70 hover:bg-orange-100 rounded-lg border border-orange-200 transition flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Select Estimates
                </button>
              </div>

              {selectedEstimateIds.length === 0 ? (
                <div className="text-center py-6 text-[11px] text-slate-400 bg-white rounded border border-dashed border-slate-200">
                  No estimates linked yet. Click "Select Estimates" to attach existing estimates.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedEstimateIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 text-slate-800 text-xs rounded-md shadow-2xs font-medium"
                    >
                      <span>Estimate #{id}</span>
                      <button
                        type="button"
                        onClick={() => removeEstimateId(id)}
                        className="text-slate-400 hover:text-red-600 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Notes / SOW */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Project Notes / Scope Description
              </label>
              <textarea
                rows={3}
                placeholder="Details on scope of work, store rollout sequence, contractors, or billing terms..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-3 focus:border-orange-500 focus:outline-none"
              />
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="px-5 py-1.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 rounded-lg shadow-xs flex items-center gap-1.5 transition"
            >
              <Check className="w-3.5 h-3.5" />
              {isSubmitting ? "Saving..." : initialProject ? "Update Master Project" : "Create Master Project"}
            </button>
          </div>
        </div>
      </div>

      {/* Estimate Selector Modal */}
      {isSelectorOpen && (
        <EstimateSelectorModal
          isOpen={isSelectorOpen}
          onClose={() => setIsSelectorOpen(false)}
          onConfirm={handleEstimateSelection}
          currentProjectEstimateIds={selectedEstimateIds}
          clientId={clientId}
          brandId={brandId}
          clients={clients}
          brands={brands}
          excludeProjectId={initialProject?.id}
        />
      )}
    </>
  );
};

