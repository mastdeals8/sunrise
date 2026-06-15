import React, { createContext, useContext, useState, useEffect } from "react";

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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("sunrise_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      const storedToken = localStorage.getItem("sunrise_token");
      if (!storedToken) {
        // Cookie-first transition: even without a cached token, the httpOnly
        // session cookie may still be valid — try restoring the session.
        try {
          const res = await fetch("/api/auth/user");
          if (res.ok) {
            const userData = await res.json();
            setUser(userData);
          }
        } catch { /* not logged in */ }
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/auth/user", {
          headers: {
            Authorization: `Bearer ${storedToken}`
          }
        });
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setToken(storedToken);
          // Ensure the httpOnly session cookie exists for this session so that
          // file downloads / <img> requests authenticate (set automatically on
          // login; this covers sessions created before the cookie mechanism).
          fetch("/api/auth/session-cookie", {
            method: "POST",
            headers: { Authorization: `Bearer ${storedToken}` },
          }).catch(() => {});
        } else {
          // Token expired or invalid
          localStorage.removeItem("sunrise_token");
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.error("Error loading user context:", err);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, [token]);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
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
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userData)
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
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("sunrise_token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
