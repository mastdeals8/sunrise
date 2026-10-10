import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { JWT_SECRET, NODE_ENV } from "./config";

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

export const resolveUserFromToken = async (token: string) => {
  const decoded = jwt.verify(token, JWT_SECRET) as any;
  const user = await storage.getUser(decoded.id);
  if (!user || !user.isActive) return null;
  const memberships = await storage.getUserCompanies(user.id);
  const isSuperAdmin = user.role === "admin" || user.id === 1 || memberships.some(m => m.role === "super_admin");
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    isSuperAdmin,
    memberships,
  };
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
      return res.status(401).json({ message: "Invalid or inactive user" });
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
      return res.status(401).json({ message: "Invalid or inactive user" });
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

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
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
