import React from "react";
import { Shield, Check, Minus } from "lucide-react";

const ROLES = ["Admin", "Manager", "Accounts", "Designer", "Production", "Installer", "Staff", "Viewer"] as const;

interface PermissionRow {
  area: string;
  description: string;
  perms: Partial<Record<typeof ROLES[number], "full" | "read" | "none">>;
}

const ROWS: PermissionRow[] = [
  { area: "Dashboard", description: "Pipeline counters & overview", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "read", Production: "read", Installer: "read", Staff: "read", Viewer: "read" } },
  { area: "Sales & Estimates", description: "Create / edit / approve estimates", perms: { Admin: "full", Manager: "full", Designer: "full", Accounts: "read", Production: "read", Staff: "read", Viewer: "read", Installer: "none" } },
  { area: "Production Tasks", description: "Kanban + task assignment", perms: { Admin: "full", Manager: "full", Production: "full", Designer: "full", Installer: "full", Staff: "full", Accounts: "read", Viewer: "read" } },
  { area: "PO Uploads", description: "Upload purchase orders against estimates", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "read", Production: "read", Staff: "none", Installer: "none", Viewer: "read" } },
  { area: "Delivery Challans / WCC", description: "Create DC & WCC, attach photos", perms: { Admin: "full", Manager: "full", Production: "full", Installer: "full", Accounts: "read", Designer: "read", Staff: "none", Viewer: "read" } },
  { area: "Project Documents", description: "View / download project files", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "read", Production: "read", Installer: "read", Staff: "none", Viewer: "read" } },
  { area: "Invoice Builder & Packet", description: "Issue invoices, assemble packets", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Submitted Invoices", description: "View / filter all invoices", perms: { Admin: "full", Manager: "read", Accounts: "full", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Pending Payments", description: "Record customer receipts", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Client Ledger", description: "Per-client running balance", perms: { Admin: "full", Manager: "read", Accounts: "full", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Petty Cash", description: "OCR proof, approvals", perms: { Admin: "full", Manager: "full", Accounts: "full", Staff: "full", Designer: "read", Production: "read", Installer: "read", Viewer: "read" } },
  { area: "Staff & Attendance", description: "Touch attendance, master", perms: { Admin: "full", Manager: "full", Accounts: "read", Designer: "read", Production: "read", Installer: "read", Staff: "read", Viewer: "read" } },
  { area: "Salary / Advances", description: "Payroll, advance tracking", perms: { Admin: "full", Accounts: "full", Manager: "read", Designer: "none", Production: "none", Installer: "none", Staff: "read", Viewer: "read" } },
  { area: "Masters (Clients, Brands, Stores, Products)", description: "Master data editing", perms: { Admin: "full", Manager: "full", Designer: "full", Accounts: "read", Production: "read", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Material Codes", description: "ABFRL Capex code master", perms: { Admin: "full", Manager: "full", Designer: "full", Accounts: "full", Production: "read", Installer: "none", Staff: "none", Viewer: "read" } },
  { area: "Import / Export", description: "Bulk master upload/download", perms: { Admin: "full", Manager: "full", Accounts: "full", Designer: "read", Production: "none", Installer: "none", Staff: "none", Viewer: "none" } },
  { area: "Users & Roles", description: "User CRUD, password reset", perms: { Admin: "full", Manager: "none", Accounts: "none", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "none" } },
  { area: "Settings", description: "Company info, GST, prefixes", perms: { Admin: "full", Manager: "read", Accounts: "read", Designer: "none", Production: "none", Installer: "none", Staff: "none", Viewer: "read" } },
];

const cell = (val?: "full" | "read" | "none") => {
  if (val === "full") return <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-bold"><Check className="w-3 h-3" /> Full</span>;
  if (val === "read") return <span className="inline-flex items-center gap-1 text-blue-700 text-xs font-bold">Read</span>;
  return <span className="text-slate-300 text-xs"><Minus className="w-3 h-3" /></span>;
};

const RolesPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Shield className="w-7 h-7 text-orange-600" /> Role Permissions Matrix
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Reference of which roles can do what. Set a user's role from Admin → Users & Roles.
        </p>
      </div>

      <div className="glass-panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="text-left px-3 py-3 font-semibold sticky left-0 bg-slate-50 min-w-[220px]">Module</th>
              {ROLES.map((r) => (
                <th key={r} className="px-3 py-3 font-semibold">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.area} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="px-3 py-2 sticky left-0 bg-white">
                  <div className="font-semibold text-slate-900">{row.area}</div>
                  <div className="text-xs text-slate-500">{row.description}</div>
                </td>
                {ROLES.map((r) => (
                  <td key={r} className="px-3 py-2 text-center">{cell(row.perms[r])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass-panel p-4 text-xs text-slate-600 space-y-1">
        <p><b>Full</b>: create / edit / delete in that module.</p>
        <p><b>Read</b>: view-only.</p>
        <p><b>—</b>: no access.</p>
        <p className="text-slate-400 italic mt-2">Important destructive actions (user delete, settings save, material code delete) are enforced on the server. Read-only restrictions are currently enforced in the UI; future passes should add API guards for all create/update endpoints.</p>
      </div>
    </div>
  );
};

export default RolesPage;
