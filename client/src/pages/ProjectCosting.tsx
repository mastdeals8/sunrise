import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { fetchClients, fetchBrands, fetchUsers } from "../lib/api";
import { MasterProjectsPanel } from "./operations/components/MasterProjectsPanel";
import { Layers } from "lucide-react";

export const ProjectCostingPage: React.FC = () => {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBaseData() {
      try {
        setLoading(true);
        const [cList, bList, uList] = await Promise.all([
          fetchClients(token).catch(() => []),
          fetchBrands(token).catch(() => []),
          fetchUsers(token).catch(() => []),
        ]);
        setClients(cList || []);
        setBrands(bList || []);
        setUsers(uList || []);
      } catch (err) {
        console.error("Failed to load project costing base data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadBaseData();
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-orange-50 text-orange-600 rounded-xl">
          <Layers className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Project Costing & Rollout Register</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Manage multi-store rollouts, track committed & actual costs, store-wise profitability, and invoice readiness.
          </p>
        </div>
      </div>

      <MasterProjectsPanel clients={clients} brands={brands} users={users} />
    </div>
  );
};

export default ProjectCostingPage;
