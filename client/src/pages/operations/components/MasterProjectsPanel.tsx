import React, { useState, useEffect, useMemo } from "react";
import {
  Layers,
  Plus,
  Search,
  Building2,
  TrendingUp,
  Percent,
  Calendar,
  IndianRupee,
  CheckCircle,
  ExternalLink,
  Edit2,
  FileText,
} from "lucide-react";
import { formatCurrency } from "../utils/formatters";
import { fetchMasterProjects } from "../../../lib/api";
import { MasterProjectModal } from "./MasterProjectModal";
import { MasterProjectWorkspace } from "./MasterProjectWorkspace";

interface MasterProjectsPanelProps {
  clients: Array<{ id: number; name: string }>;
  brands: Array<{ id: number; name: string; clientId?: number | null }>;
  users?: Array<{ id: number; name: string }>;
}

export const MasterProjectsPanel: React.FC<MasterProjectsPanelProps> = ({
  clients,
  brands,
  users = [],
}) => {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState<number | undefined>(undefined);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any | null>(null);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const list = await fetchMasterProjects(token, {
        status: statusFilter,
        clientId: clientFilter,
      });
      setProjects(list || []);
    } catch (err) {
      console.error("Failed to load master projects:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [statusFilter, clientFilter]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.projectCode && p.projectCode.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchSearch;
    });
  }, [projects, searchQuery]);

  // Aggregate metrics
  const totalProjectsCount = projects.length;
  const activeProjectsCount = projects.filter((p) => p.status === "active").length;
  const totalQuotedValue = useMemo(() => {
    return projects.reduce((sum, p) => sum + (Number(p.totalQuotedValue) || 0), 0);
  }, [projects]);
  const totalInvoicedValue = useMemo(() => {
    return projects.reduce((sum, p) => sum + (Number(p.totalInvoicedAmount) || 0), 0);
  }, [projects]);

  if (activeProjectId !== null) {
    return (
      <MasterProjectWorkspace
        projectId={activeProjectId}
        onBack={() => {
          setActiveProjectId(null);
          loadProjects();
        }}
        clients={clients}
        brands={brands}
        users={users}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header and KPI bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-600 bg-orange-50 px-2 py-0.5 rounded">
                Costing & Profitability
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">Master Projects Register</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Consolidate multi-store campaign rollouts, allocate purchase bills, and track store-level margins.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingProject(null);
              setIsModalOpen(true);
            }}
            className="px-4 py-2 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg shadow-xs flex items-center gap-1.5 transition self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            + New Master Project
          </button>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-slate-500 block">Total Master Projects</span>
            <span className="text-lg font-bold text-slate-900 mt-0.5 block">{totalProjectsCount}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-slate-500 block">Active Rollouts</span>
            <span className="text-lg font-bold text-emerald-600 mt-0.5 block">{activeProjectsCount}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-slate-500 block">Total Quoted Value</span>
            <span className="text-lg font-bold text-slate-900 mt-0.5 block">
              {formatCurrency(totalQuotedValue)}
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
            <span className="text-[11px] font-semibold text-slate-500 block">Total Invoiced Turnover</span>
            <span className="text-lg font-bold text-blue-600 mt-0.5 block">
              {formatCurrency(totalInvoicedValue)}
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by project name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:border-orange-500 focus:outline-none"
            />
          </div>

          {/* Client Filter */}
          <select
            value={clientFilter || ""}
            onChange={(e) => setClientFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:border-orange-500 focus:outline-none"
          >
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:border-orange-500 focus:outline-none capitalize"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="completed">Completed</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <span className="text-slate-500 text-xs">
          Showing {filteredProjects.length} of {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Projects Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="py-20 text-center text-xs text-slate-500">Loading master projects...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-20 text-center text-xs text-slate-400 space-y-2">
            <p>No master projects found.</p>
            <button
              type="button"
              onClick={() => {
                setEditingProject(null);
                setIsModalOpen(true);
              }}
              className="text-xs font-semibold text-orange-600 hover:underline"
            >
              Create your first Master Project
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-600 border-b border-slate-200 uppercase whitespace-nowrap">
                <tr>
                  <th className="p-3">Project</th>
                  <th className="p-3">Client & Brand</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Estimates / Stores</th>
                  <th className="p-3 text-right">Quoted Value</th>
                  <th className="p-3 text-right">Invoiced Sales</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 whitespace-nowrap">
                {filteredProjects.map((p) => {
                  const client = clients.find((c) => c.id === (p.clientId || p.client_id));
                  const brand = brands.find((b) => b.id === (p.brandId || p.brand_id));

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <button
                              type="button"
                              onClick={() => setActiveProjectId(p.id)}
                              className="font-bold text-slate-900 hover:text-orange-600 transition flex items-center gap-1.5"
                            >
                              {p.name}
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </button>
                            {p.projectCode && (
                              <span className="text-[10px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.2 rounded uppercase mt-0.5 inline-block">
                                {p.projectCode}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="p-3 text-slate-600">
                        <div className="font-semibold text-slate-800">{client?.name || "-"}</div>
                        {brand && <div className="text-[11px] text-slate-400">{brand.name}</div>}
                      </td>

                      <td className="p-3 text-center">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            p.status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : p.status === "completed"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>

                      <td className="p-3 text-center">
                        <span className="font-bold text-slate-900">{p.estimateCount || 0}</span> estimates
                        <span className="text-slate-400 mx-1">•</span>
                        <span className="font-bold text-slate-900">{p.storeCount || 0}</span> stores
                      </td>

                      <td className="p-3 text-right font-medium text-slate-900">
                        {formatCurrency(Number(p.totalQuotedValue || 0))}
                      </td>

                      <td className="p-3 text-right font-bold text-blue-600">
                        {formatCurrency(Number(p.totalInvoicedAmount || 0))}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProject(p);
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                            title="Edit Project"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveProjectId(p.id)}
                            className="px-3 py-1 text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition"
                          >
                            Workspace
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <MasterProjectModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            setIsModalOpen(false);
            loadProjects();
          }}
          initialProject={editingProject}
          clients={clients}
          brands={brands}
          users={users}
        />
      )}
    </div>
  );
};

