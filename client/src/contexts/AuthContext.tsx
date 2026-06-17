import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase, isBoltMode, hasSupabaseConfig } from "../lib/supabase";

interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  register: (data: any) => Promise<boolean>;
  logout: () => void;
  /** Only set in Bolt mode. Explains auth failure. */
  boltAuthError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Map a Supabase Auth user → the app's User shape.
function supabaseUserToAppUser(sbUser: any): User {
  return {
    // UUID → deterministic numeric id for compatibility
    id: parseInt(sbUser.id.replace(/-/g, "").slice(0, 8), 16) || 1,
    username: sbUser.email ?? "user",
    name:
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      sbUser.email?.split("@")[0] ||
      "User",
    role: sbUser.user_metadata?.role || "admin",
    email: sbUser.email ?? "",
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [boltAuthError, setBoltAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (isBoltMode) {
      // ── Bolt mode: restore from Supabase Auth session ────────────────────
      if (!hasSupabaseConfig) {
        setBoltAuthError(
          "Missing Supabase environment variables. Add VITE_SUPABASE_URL and " +
          "VITE_SUPABASE_ANON_KEY in Bolt → Settings → Environment Variables."
        );
        setLoading(false);
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        const session = data.session as any;
        if (session?.user) {
          setUser(supabaseUserToAppUser(session.user));
          setToken(session.access_token);
        }
        setLoading(false);
      });

      const { data: authListener } = supabase.auth.onAuthStateChange(
        (_event: any, session: any) => {
          if (session?.user) {
            setUser(supabaseUserToAppUser(session.user));
            setToken(session.access_token);
          } else {
            setUser(null);
            setToken(null);
          }
        }
      );
      return () => (authListener.subscription as any).unsubscribe();
    }

    // ── Express mode: restore from localStorage / httpOnly cookie ────────
    const storedToken = localStorage.getItem("sunrise_token");
    if (!storedToken) {
      fetch("/api/auth/user")
        .then((res) => (res.ok ? res.json() : null))
        .then((userData) => { if (userData) setUser(userData); })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }

    fetch("/api/auth/user", {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setToken(storedToken);
          fetch("/api/auth/session-cookie", {
            method: "POST",
            headers: { Authorization: `Bearer ${storedToken}` },
          }).catch(() => {});
        } else {
          localStorage.removeItem("sunrise_token");
          setToken(null);
          setUser(null);
        }
      })
      .catch((err) => console.error("Error loading user context:", err))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    if (isBoltMode) {
      // ── Bolt mode: Supabase Auth (treat "username" as email) ─────────────
      if (!hasSupabaseConfig) {
        setBoltAuthError(
          "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
        );
        return false;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: username,
        password,
      });
      if (error || !data.user) {
        setBoltAuthError(
          error?.message?.includes("Invalid login credentials")
            ? "Invalid credentials. In Bolt mode, sign in with your Supabase Auth email & password. " +
              "Create a user in Supabase Dashboard → Authentication → Users."
            : (error?.message ?? "Supabase Auth error.")
        );
        return false;
      }
      setBoltAuthError(null);
      setUser(supabaseUserToAppUser(data.user));
      setToken(data.session?.access_token ?? null);
      return true;
    }

    // ── Express mode ──────────────────────────────────────────────────────
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("sunrise_token", data.token);
        setToken(data.token);
        setUser(data.user);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Login failure:", err);
      return false;
    }
  };

  const register = async (userData: any): Promise<boolean> => {
    if (isBoltMode) {
      setBoltAuthError(
        "Registration is not available in Bolt preview mode. " +
        "Create users in Supabase Dashboard → Authentication → Users."
      );
      return false;
    }
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("sunrise_token", data.token);
        setToken(data.token);
        setUser(data.user);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Registration failure:", err);
      return false;
    }
  };

  const logout = () => {
    if (isBoltMode) {
      supabase.auth.signOut().catch(() => {});
      setUser(null);
      setToken(null);
      return;
    }
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("sunrise_token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, logout, boltAuthError }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
