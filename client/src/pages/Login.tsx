import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const Login: React.FC = () => {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        const success = await login(username, password);
        if (!success) setError("Invalid credentials. Try admin/admin123");
      } else {
        if (!email || !name) {
          setError("Email and Name are required");
          setLoading(false);
          return;
        }
        const success = await register({ username, password, email, name, role: "admin" });
        if (!success) setError("Registration failed. Choose a unique username/email.");
      }
    } catch (err) {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-50 relative overflow-hidden">
      {/* Decorative Brand Glows */}
      <div className="absolute top-1/4 left-1/4 h-[350px] w-[350px] rounded-full bg-orange-500/5 blur-[120px] -z-10 animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-amber-500/5 blur-[140px] -z-10 animate-pulse"></div>

      <div className="w-full max-w-md p-8 bg-white border border-slate-200 shadow-2xl rounded-2xl relative">
        <div className="text-center mb-6">
          <img
            src="/brand/logo.png"
            alt="Sunrise Media"
            className="h-10 w-auto mx-auto mb-3"
          />
          <p className="text-xs font-semibold tracking-wider text-slate-500 mt-2">
            ENTERPRISE RESOURCE PLANNING
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-medium">
            {error}
          </div>
        )}

        <div className="flex border-b border-slate-200 mb-6">
          <button
            onClick={() => { setIsLogin(true); setError(""); }}
            className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${isLogin ? "border-orange-500 text-orange-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(""); }}
            className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${!isLogin ? "border-orange-500 text-orange-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                  placeholder="name@sunrisemedia.com"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Username</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 mt-6 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold rounded-lg transition-all shadow-md text-sm flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            ) : isLogin ? (
              "Sign In"
            ) : (
              "Register & Initialize"
            )}
          </button>
        </form>

        {isLogin && (
          <div className="mt-6 p-4 rounded-lg bg-orange-50 border border-orange-100 text-slate-600 text-[11px] text-center leading-normal">
            <span className="font-semibold text-orange-600">💡 Demo Access:</span> Use username <span className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">admin</span> and password <span className="font-mono text-slate-800 bg-slate-100 px-1 py-0.5 rounded">admin123</span> to bypass and sign in immediately.
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
