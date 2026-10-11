import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase, isBoltMode, hasSupabaseConfig } from "../lib/supabase";
import { fetchCompanies, getActiveCompanyId, setActiveCompanyId } from "../lib/api";

export interface UserMembership {
  companyId: number;
  companyName: string;
  role: string;
  isDefault?: boolean;
}

export interface User {
  id: number;
  username: string;
  name: string;
  role: string;
  email: string;
  isSuperAdmin?: boolean;
  activeCompanyId?: number;
  companyRole?: string;
  memberships?: UserMembership[];
}

export interface Company {
  id: number;
  name: string;
  legalName?: string | null;
  tradeName?: string | null;
  displayName?: string | null;
  address?: string | null;
  email?: string | null;
  mobile?: string | null;
  gstin?: string | null;
  pan?: string | null;
  state?: string | null;
  stateCode?: string | null;
  logoPath?: string | null;
  signatureStampPath?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankBranch?: string | null;
  termsAndConditions?: string | null;
  defaultGstPercent?: number | null;
  defaultImplementationPercent?: number | null;
  defaultPackingPercent?: number | null;
  defaultLocalTransport?: number | null;
  defaultOutstationTransportRate?: number | null;
  estimatePrefix?: string | null;
  invoicePrefix?: string | null;
  dcPrefix?: string | null;
  docHeaderText?: string | null;
  docFooterText?: string | null;
  isActive?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  activeCompanyId: number;
  activeCompany: Company | null;
  availableCompanies: Company[];
  switchCompany: (companyId: number) => Promise<void>;
  refreshCompanies: () => Promise<void>;
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
    id: parseInt(sbUser.id.replace(/-/g, "").slice(0, 8), 16) || 1,
    username: sbUser.email ?? "user",
    name:
      sbUser.user_metadata?.name ||
      sbUser.user_metadata?.full_name ||
      sbUser.email?.split("@")[0] ||
      "User",
    role: sbUser.user_metadata?.role || "staff",
    email: sbUser.email ?? "",
    isSuperAdmin: false,
  };
}

async function fetchUserProfile(authToken: string | null, sbUser?: any): Promise<User> {
  if (isBoltMode) {
    try {
      const { data: profile, error } = await supabase.rpc("get_current_user_profile");
      if (!error && profile && profile.id) {
        return {
          id: profile.id,
          username: profile.username || sbUser?.email || "user",
          name: profile.name || sbUser?.user_metadata?.name || "User",
          role: profile.role || "staff",
          email: profile.email || sbUser?.email || "",
          isSuperAdmin: profile.isSuperAdmin === true,
          activeCompanyId: profile.activeCompanyId,
          memberships: profile.memberships || [],
        };
      }
    } catch (e) {
      console.warn("[AuthContext] get_current_user_profile RPC error:", e);
    }
    // Fallback: query public.users directly
    if (sbUser?.id) {
      try {
        const { data: u } = await supabase
          .from("users")
          .select("id, username, name, role, email")
          .eq("auth_user_id", sbUser.id)
          .maybeSingle();
        if (u) {
          const isSuper = u.role === "admin" || u.id === 1;
          return {
            id: u.id,
            username: u.username,
            name: u.name,
            role: u.role,
            email: u.email,
            isSuperAdmin: isSuper,
          };
        }
      } catch {}
    }
  }
  return supabaseUserToAppUser(sbUser);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [boltAuthError, setBoltAuthError] = useState<string | null>(null);
  const [activeCompanyId, setActiveCompanyIdState] = useState<number>(() => getActiveCompanyId());
  const [availableCompanies, setAvailableCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);

  const loadCompanies = useCallback(async (authToken: string | null, userProfile?: User | null) => {
    try {
      const comps = await fetchCompanies(authToken);
      if (Array.isArray(comps)) {
        setAvailableCompanies(comps);
        const currentId = getActiveCompanyId();
        let target = comps.find((c: any) => c.id === currentId);
        if (!target) {
          // If current stored company is unauthorized, switch to user's assigned company
          if (userProfile?.activeCompanyId) {
            target = comps.find((c: any) => c.id === userProfile.activeCompanyId);
          }
          if (!target && comps.length > 0) {
            target = comps[0];
          }
        }
        if (target) {
          setActiveCompany(target);
          if (target.id !== currentId) {
            setActiveCompanyId(target.id);
            setActiveCompanyIdState(target.id);
          }
        }
      }
    } catch (err) {
      console.warn("[AuthContext] loadCompanies error:", err);
    }
  }, []);

  const switchCompany = useCallback(async (companyId: number) => {
    setActiveCompanyId(companyId);
    setActiveCompanyIdState(companyId);
    const target = availableCompanies.find(c => c.id === companyId);
    if (target) {
      setActiveCompany(target);
    } else {
      // Fetch fresh in case it was newly added
      try {
        const comps = await fetchCompanies(token);
        if (Array.isArray(comps)) {
          setAvailableCompanies(comps);
          const f = comps.find((c: any) => c.id === companyId);
          if (f) setActiveCompany(f);
        }
      } catch {}
    }
    // Notify window components and listeners
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("company-switched", { detail: { companyId } }));
    }
  }, [availableCompanies, token]);

  const refreshCompanies = useCallback(async () => {
    await loadCompanies(token, user);
  }, [loadCompanies, token, user]);

  useEffect(() => {
    if (isBoltMode) {
      // ── Bolt mode: restore from Supabase Auth session ────────────────────
      if (!hasSupabaseConfig) {
        setLoading(false);
        return;
      }

      supabase.auth.getSession().then(async ({ data }) => {
        const session = data.session as any;
        if (session?.user && session?.access_token) {
          setToken(session.access_token);
          const appUser = await fetchUserProfile(session.access_token, session.user);
          setUser(appUser);
          await loadCompanies(session.access_token, appUser);
        }
        setLoading(false);
      });

      const { data: authListener } = supabase.auth.onAuthStateChange(
        async (_event: any, session: any) => {
          if (session?.user && session?.access_token) {
            setToken(session.access_token);
            const appUser = await fetchUserProfile(session.access_token, session.user);
            setUser(appUser);
            await loadCompanies(session.access_token, appUser);
          } else {
            setUser(null);
            setToken(null);
            setAvailableCompanies([]);
            setActiveCompany(null);
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
        .then((userData) => {
          if (userData) {
            setUser(userData);
            loadCompanies(null, userData);
          }
        })
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
          await loadCompanies(storedToken, userData);
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
  }, [loadCompanies]);

  const login = async (username: string, password: string): Promise<boolean> => {
    if (isBoltMode) {
      if (!hasSupabaseConfig) {
        setBoltAuthError(
          "System configuration missing. Please add Supabase environment variables in Bolt."
        );
        return false;
      }

      setBoltAuthError(null);

      // 1. Secure server-side credential verification and auth email resolution
      const { data: resolvedEmail, error: rpcErr } = await supabase.rpc(
        "verify_and_resolve_login",
        { p_identifier: username, p_password: password }
      );

      if (rpcErr || !resolvedEmail) {
        setBoltAuthError("Invalid username or password.");
        return false;
      }

      // 2. Official Supabase password grant with the verified email
      const { data, error } = await supabase.auth.signInWithPassword({
        email: resolvedEmail as string,
        password,
      });

      if (error || !data.user || !data.session) {
        setBoltAuthError("Invalid username or password.");
        return false;
      }

      const accessToken = data.session.access_token;
      setToken(accessToken);

      // 3. Load full application user profile and authorized company memberships
      const appUser = await fetchUserProfile(accessToken, data.user);
      setUser(appUser);

      // 4. Load authorized companies and enforce company workspace assignment
      await loadCompanies(accessToken, appUser);
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
        if (data.user.activeCompanyId) {
          setActiveCompanyId(data.user.activeCompanyId);
          setActiveCompanyIdState(data.user.activeCompanyId);
        }
        await loadCompanies(data.token);
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
        await loadCompanies(data.token);
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
      setAvailableCompanies([]);
      setActiveCompany(null);
      return;
    }
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("sunrise_token");
    setToken(null);
    setUser(null);
    setAvailableCompanies([]);
    setActiveCompany(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        activeCompanyId,
        activeCompany,
        availableCompanies,
        switchCompany,
        refreshCompanies,
        login,
        register,
        logout,
        boltAuthError,
      }}
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
