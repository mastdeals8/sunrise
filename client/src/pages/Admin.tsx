import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  Users as UsersIcon,
  Plus,
  Edit,
  Trash2,
  Shield,
  KeyRound,
  Mail,
  Phone,
  CheckCircle,
  XCircle,
  X,
  Search,
} from "lucide-react";

interface UserRecord {
  id: number;
  username: string;
  email: string;
  name: string;
  role: string;
  phone?: string | null;
  employeeId?: string | null;
  department?: string | null;
  designation?: string | null;
  isActive: boolean;
  createdAt?: string | null;
}

const ROLES = [
  "admin",
  "manager",
  "designer",
  "production",
  "installer",
  "accounts",
  "staff",
  "viewer",
] as const;

const DEPARTMENTS = [
  "Management",
  "Sales",
  "Design",
  "Production",
  "Installation",
  "Accounts",
  "Operations",
  "Admin",
];

interface UserFormState {
  id?: number;
  username: string;
  email: string;
  name: string;
  password: string;
  role: string;
  phone: string;
  employeeId: string;
  department: string;
  designation: string;
  isActive: boolean;
}

const emptyForm: UserFormState = {
  username: "",
  email: "",
  name: "",
  password: "",
  role: "staff",
  phone: "",
  employeeId: "",
  department: "",
  designation: "",
  isActive: true,
};

const AdminPage: React.FC = () => {
  const { token, user: me } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [resetUser, setResetUser] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error("fetch users", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (u: UserRecord) => {
    setEditId(u.id);
    setForm({
      id: u.id,
      username: u.username || "",
      email: u.email || "",
      name: u.name || "",
      password: "",
      role: u.role || "staff",
      phone: u.phone || "",
      employeeId: u.employeeId || "",
      department: u.department || "",
      designation: u.designation || "",
      isActive: u.isActive,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
  };

  const showMsg = (kind: "ok" | "err", text: string) => {
    setMessage({ kind, text });
    setTimeout(() => setMessage(null), 3500);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editId) {
        const payload: any = {
          username: form.username,
          email: form.email,
          name: form.name,
          role: form.role,
          phone: form.phone || null,
          employeeId: form.employeeId || null,
          department: form.department || null,
          designation: form.designation || null,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        const res = await fetch(`/api/users/${editId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Update failed" }));
          showMsg("err", err.message || "Update failed");
          return;
        }
        showMsg("ok", "User updated");
      } else {
        if (!form.password || form.password.length < 4) {
          showMsg("err", "Password is required (min 4 chars)");
          return;
        }
        const payload = {
          username: form.username,
          email: form.email,
          name: form.name,
          password: form.password,
          role: form.role,
          phone: form.phone || null,
          employeeId: form.employeeId || null,
          department: form.department || null,
          designation: form.designation || null,
          isActive: form.isActive,
        };
        const res = await fetch(`/api/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Create failed" }));
          showMsg("err", err.message || "Create failed");
          return;
        }
        showMsg("ok", "User created");
      }
      closeForm();
      fetchUsers();
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  const toggleActive = async (u: UserRecord) => {
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      if (res.ok) {
        showMsg("ok", !u.isActive ? "Activated" : "Deactivated");
        fetchUsers();
      }
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  const removeUser = async (u: UserRecord) => {
    if (!confirm(`Delete user "${u.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        showMsg("ok", "User deleted");
        fetchUsers();
      } else {
        showMsg("err", "Delete failed");
      }
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  const performReset = async () => {
    if (!resetUser) return;
    if (!resetPassword || resetPassword.length < 4) {
      showMsg("err", "New password must be 4+ chars");
      return;
    }
    try {
      const res = await fetch(`/api/users/${resetUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (res.ok) {
        showMsg("ok", `Password reset for ${resetUser.username}`);
        setResetUser(null);
        setResetPassword("");
      } else {
        showMsg("err", "Reset failed");
      }
    } catch (err: any) {
      showMsg("err", err.message || "Failed");
    }
  };

  const visible = users.filter((u) => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterActive === "active" && !u.isActive) return false;
    if (filterActive === "inactive" && u.isActive) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !(u.name || "").toLowerCase().includes(q) &&
        !(u.username || "").toLowerCase().includes(q) &&
        !(u.email || "").toLowerCase().includes(q) &&
        !(u.employeeId || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const roleBadge = (role: string) => {
    const map: Record<string, string> = {
      admin: "bg-red-50 text-red-700 border-red-200",
      manager: "bg-orange-50 text-orange-700 border-orange-200",
      designer: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
      production: "bg-blue-50 text-blue-700 border-blue-200",
      installer: "bg-teal-50 text-teal-700 border-teal-200",
      accounts: "bg-emerald-50 text-emerald-700 border-emerald-200",
      staff: "bg-slate-50 text-slate-700 border-slate-200",
      viewer: "bg-gray-50 text-gray-700 border-gray-200",
    };
    return map[role] || "bg-slate-50 text-slate-700 border-slate-200";
  };

  const amAdmin = me?.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-orange-600" />
            User & Role Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Add, edit, deactivate users and assign roles & departments.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreate}
            disabled={!amAdmin}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-semibold transition rounded-lg text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            title={amAdmin ? "Add user" : "Admin only"}
          >
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-2 text-sm border ${
            message.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Filters */}
      <div className="glass-panel p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, email, employee id"
            className="bg-transparent border-0 outline-none text-sm flex-1"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="all">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as any)}
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          <option value="all">All status</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <span className="text-xs text-slate-500">
          {visible.length} of {users.length} users
        </span>
      </div>

      {/* User Table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading users…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <UsersIcon className="w-8 h-8 text-slate-300" />
            No users match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">User</th>
                  <th className="text-left px-4 py-3 font-semibold">Role</th>
                  <th className="text-left px-4 py-3 font-semibold">Department</th>
                  <th className="text-left px-4 py-3 font-semibold">Contact</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center text-white font-bold text-xs">
                          {u.name?.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 leading-tight">
                            {u.name}
                            {u.id === me?.id && (
                              <span className="ml-2 text-[10px] text-orange-600 uppercase">
                                you
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500">
                            @{u.username}
                            {u.employeeId ? ` · ${u.employeeId}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold border capitalize ${roleBadge(
                          u.role
                        )}`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {u.department || <span className="text-slate-400">—</span>}
                      {u.designation && (
                        <div className="text-xs text-slate-500">{u.designation}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {u.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {u.email}
                        </div>
                      )}
                      {u.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {u.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                          <CheckCircle className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 text-xs font-semibold">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          disabled={!amAdmin}
                          className="p-2 rounded-md text-slate-600 hover:text-orange-600 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setResetUser(u);
                            setResetPassword("");
                          }}
                          disabled={!amAdmin}
                          className="p-2 rounded-md text-slate-600 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Reset password"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={!amAdmin || u.id === me?.id}
                          className="p-2 rounded-md text-slate-600 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={u.isActive ? "Deactivate" : "Activate"}
                        >
                          {u.isActive ? (
                            <XCircle className="w-4 h-4" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => removeUser(u)}
                          disabled={!amAdmin || u.id === me?.id}
                          className="p-2 rounded-md text-slate-600 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Roles legend */}
      <div className="glass-panel p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-orange-600" /> Role Permissions Reference
        </h3>
        <ul className="text-xs text-slate-600 grid grid-cols-1 md:grid-cols-2 gap-y-1">
          <li><b>Admin</b> — full access to all modules and settings</li>
          <li><b>Manager</b> — estimates, projects, masters, dashboard</li>
          <li><b>Accounts</b> — finance, invoices, payments, ledger</li>
          <li><b>Designer</b> — estimates, products, masters (read-only finance)</li>
          <li><b>Production</b> — tasks, DC, WCC, jobs</li>
          <li><b>Installer</b> — DC, WCC, photo uploads</li>
          <li><b>Staff</b> — attendance, tasks, petty cash</li>
          <li><b>Viewer</b> — read-only access to dashboards and reports</li>
        </ul>
      </div>

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editId ? "Edit User" : "Add New User"}
              </h2>
              <button
                onClick={closeForm}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Full Name *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Username *</label>
                  <input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    disabled={!!editId}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">
                    {editId ? "New Password (optional)" : "Password *"}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                    placeholder={editId ? "Leave blank to keep current" : ""}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Role *</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Department</label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white"
                  >
                    <option value="">—</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Designation</label>
                  <input
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Employee ID</label>
                  <input
                    value={form.employeeId}
                    onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase">Mobile / Phone</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input
                    id="isActive"
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  <label htmlFor="isActive" className="text-sm text-slate-700">
                    User is active
                  </label>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-md border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-gradient-to-r from-orange-600 to-amber-500 text-white font-semibold text-sm shadow"
                >
                  {editId ? "Save Changes" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-600" /> Reset Password
              </h2>
              <button
                onClick={() => {
                  setResetUser(null);
                  setResetPassword("");
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-slate-600">
                Set a new password for{" "}
                <b>
                  {resetUser.name} (@{resetUser.username})
                </b>
                .
              </p>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="New password (min 4 chars)"
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm"
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setResetUser(null);
                    setResetPassword("");
                  }}
                  className="px-4 py-2 rounded-md border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={performReset}
                  className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow"
                >
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
