import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { User, Shield, Mail, AtSign, Lock, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";

const MyProfile: React.FC = () => {
  const { user, token } = useAuth();
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  if (!user) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!pwForm.current) { setMsg({ text: "Current password is required.", ok: false }); return; }
    if (pwForm.next.length < 6) { setMsg({ text: "New password must be at least 6 characters.", ok: false }); return; }
    if (pwForm.next !== pwForm.confirm) { setMsg({ text: "New passwords do not match.", ok: false }); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/staff/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pwForm.next }),
      });
      if (res.ok) {
        setMsg({ text: "Password updated successfully.", ok: true });
        setPwForm({ current: "", next: "", confirm: "" });
      } else {
        const data = await res.json().catch(() => ({}));
        setMsg({ text: data.message || "Failed to update password.", ok: false });
      }
    } catch {
      setMsg({ text: "Network error. Please try again.", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const initials = user.name.slice(0, 2).toUpperCase();
  const roleBadgeColor = user.role === "admin"
    ? "bg-rose-100 text-rose-700 border-rose-200"
    : user.role === "manager"
    ? "bg-purple-100 text-purple-700 border-purple-200"
    : "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="max-w-lg mx-auto space-y-5 py-2">
      <div>
        <h1 className="text-base font-black text-slate-900">My Profile</h1>
        <p className="text-xs text-slate-400 mt-0.5">Your account information</p>
      </div>

      {/* Identity card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center font-black text-white text-xl shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-lg font-black text-slate-900 leading-tight">{user.name}</p>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded border capitalize ${roleBadgeColor}`}>
              {user.role}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">@{user.username}</p>
        </div>
      </div>

      {/* Account details */}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <div className="flex items-center gap-3 px-5 py-3.5">
          <User className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Full Name</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5">{user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <AtSign className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Username</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5">{user.username}</p>
          </div>
        </div>
        {user.email && (
          <div className="flex items-center gap-3 px-5 py-3.5">
            <Mail className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Email</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5">{user.email}</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 px-5 py-3.5">
          <Shield className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Role</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{user.role}</p>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-black text-slate-700">Change Password</h3>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={pwForm.current}
                onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 pr-9"
                placeholder="Enter current password"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">New Password</label>
            <input
              type={showPw ? "text" : "password"}
              value={pwForm.next}
              onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Confirm New Password</label>
            <input
              type={showPw ? "text" : "password"}
              value={pwForm.confirm}
              onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </div>
          {msg && (
            <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${msg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"}`}>
              {msg.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              {msg.text}
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold rounded-lg transition"
          >
            {saving ? "Updating…" : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default MyProfile;
