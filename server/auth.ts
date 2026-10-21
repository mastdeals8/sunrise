import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { pool } from "./db";
import { JWT_SECRET, NODE_ENV } from "./config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
    name: string;
    role: string;
    isSuperAdmin?: boolean;
    memberships?: any[];
  };
  companyId?: number;
  companyRole?: string;
}

export const SESSION_COOKIE_NAME = "sunrise_session";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

let _supabaseAuthServerClient: SupabaseClient | null = null;
function getSupabaseAuthServerClient(): SupabaseClient | null {
  if (!_supabaseAuthServerClient && supabaseUrl && supabaseAnonKey) {
    _supabaseAuthServerClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _supabaseAuthServerClient;
}

interface CachedUserEntry {
  user: {
    id: number;
    username: string;
    email: string;
    name: string;
    role: string;
    isSuperAdmin: boolean;
    memberships: any[];
  };
  expiresAt: number;
}

const tokenCache = new Map<string, CachedUserEntry>();

// Purge expired tokens periodically
setInterval(() => {
  const now = Date.now();
  tokenCache.forEach((val, key) => {
    if (val.expiresAt < now) {
      tokenCache.delete(key);
    }
  });
}, 60000).unref();

export const resolveUserFromToken = async (token: string) => {
  if (!token || typeof token !== "string" || token === "null" || token === "undefined") {
    return null;
  }

  // 1. Check in-memory verification cache
  const cached = tokenCache.get(token);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.user;
  }

  // 2. Fast path: try local Express JWT signed with JWT_SECRET
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded && decoded.id) {
      const user = await storage.getUser(decoded.id);
      if (user && user.isActive) {
        const memberships = await storage.getUserCompanies(user.id);
        const isSuperAdmin = user.role === "admin" || user.id === 1 || memberships.some(m => m.role === "super_admin");
        const resolved = {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
          isSuperAdmin,
          memberships,
        };
        tokenCache.set(token, { user: resolved, expiresAt: Date.now() + 30000 });
        return resolved;
      }
      return null;
    }
  } catch {
    // Not signed with local JWT_SECRET; proceed to Supabase Auth token verification
  }

  // 3. Supabase Auth token verification via official Supabase client
  const sbClient = getSupabaseAuthServerClient();
  if (sbClient) {
    try {
      const { data, error } = await sbClient.auth.getUser(token);
      if (!error && data?.user) {
        const sbUser = data.user;
        const userRes = await pool.query(
          `SELECT id, username, email, name, role, is_active, auth_user_id
           FROM public.users
           WHERE (auth_user_id = $1 OR LOWER(email) = LOWER($2))
             AND is_active = true
           ORDER BY CASE WHEN auth_user_id = $1 THEN 0 ELSE 1 END, id ASC
           LIMIT 1`,
          [sbUser.id, sbUser.email]
        );

        if (userRes.rows.length > 0) {
          const u = userRes.rows[0];
          // Backfill auth_user_id if not present
          if (!u.auth_user_id) {
            pool.query(`UPDATE public.users SET auth_user_id = $1 WHERE id = $2`, [sbUser.id, u.id]).catch(() => {});
          }
          const memberships = await storage.getUserCompanies(u.id);
          const isSuperAdmin = u.role === "admin" || u.id === 1 || memberships.some(m => m.role === "super_admin");
          const resolved = {
            id: u.id,
            username: u.username,
            email: u.email,
            name: u.name,
            role: u.role,
            isSuperAdmin,
            memberships,
          };
          tokenCache.set(token, { user: resolved, expiresAt: Date.now() + 30000 });
          return resolved;
        }
      }
    } catch (sbErr: any) {
      console.warn("[auth] Supabase token resolution warning:", sbErr?.message || sbErr);
    }
  }

  return null;
};

/**
 * Validates and attaches companyId & companyRole to the request.
 * Super Admin can access any company.
 * Company users can only access their authorized companies.
 */
export function resolveCompanyForRequest(req: AuthRequest, res: Response): boolean {
  if (!req.user) return false;
  const rawHeader = req.headers["x-company-id"] || req.query.companyId;
  const requestedCompanyId = rawHeader ? parseInt(String(rawHeader), 10) : undefined;
  const memberships = req.user.memberships || [];
  const isSuper = req.user.isSuperAdmin;

  if (isSuper) {
    req.companyId = requestedCompanyId || (memberships.find(m => m.isDefault)?.companyId) || (memberships[0]?.companyId) || 1;
    req.companyRole = "super_admin";
    return true;
  }

  if (requestedCompanyId) {
    const member = memberships.find(m => m.companyId === requestedCompanyId);
    if (!member) {
      res.status(403).json({ message: "Forbidden: You do not have access to this company workspace." });
      return false;
    }
    req.companyId = requestedCompanyId;
    req.companyRole = member.role;
    return true;
  }

  // Default company
  const def = memberships.find(m => m.isDefault) || memberships[0];
  if (!def) {
    res.status(403).json({ message: "Forbidden: No company workspace assigned." });
    return false;
  }
  req.companyId = def.companyId;
  req.companyRole = def.role;
  return true;
}

/**
 * Primary API authentication. Accepts ONLY the Authorization: Bearer header.
 * Enforces company boundary validation.
 */
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const rawHeaderToken = authHeader && authHeader.split(" ")[1];
  const headerToken = rawHeaderToken && rawHeaderToken !== "null" && rawHeaderToken !== "undefined" ? rawHeaderToken : null;
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE_NAME];
  const token = headerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    req.user = user;
    if (!resolveCompanyForRequest(req, res)) return;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

/**
 * Authentication for browser-native GET requests (<img src>, <a href> downloads,
 * print windows) that cannot attach an Authorization header. Accepts the
 * httpOnly session cookie set at login, or a Bearer header when present.
 * Used for: /uploads file serving, /api/company-assets, export/download links.
 */
export const authenticateBrowserRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const rawHeaderToken = authHeader && authHeader.split(" ")[1];
  // Guard: fetch helpers may send "Bearer null"/"Bearer undefined" when no
  // token is cached; treat junk as absent so the session cookie can be used.
  const headerToken = rawHeaderToken && rawHeaderToken !== "null" && rawHeaderToken !== "undefined" ? rawHeaderToken : null;
  const cookieToken = (req as any).cookies?.[SESSION_COOKIE_NAME];
  const token = headerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    req.user = user;
    if (!resolveCompanyForRequest(req, res)) return;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const setSessionCookie = (res: Response, token: string) => {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // matches JWT expiry
    path: "/",
  });
};

export const clearSessionCookie = (res: Response) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (req.user.isSuperAdmin || allowedRoles.includes(req.user.role)) {
      return next();
    }

    if (req.companyRole === "company_admin" && (allowedRoles.includes("admin") || allowedRoles.includes("manager"))) {
      return next();
    }

    return res.status(403).json({ message: "Insufficient permissions" });
  };
};

export const requireCompanyRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required" });
    if (req.user.isSuperAdmin || req.companyRole === "super_admin") return next();
    if (req.companyRole && allowedRoles.includes(req.companyRole)) return next();
    return res.status(403).json({ message: "Insufficient company permissions" });
  };
};

export const generateToken = (user: { id: number; username: string; role: string }) => {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
