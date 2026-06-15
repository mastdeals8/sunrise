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
  };
}

export const SESSION_COOKIE_NAME = "sunrise_session";

const resolveUserFromToken = async (token: string) => {
  const decoded = jwt.verify(token, JWT_SECRET) as any;
  const user = await storage.getUser(decoded.id);
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
  };
};

/**
 * Primary API authentication. Accepts ONLY the Authorization: Bearer header.
 * SECURITY: query-string tokens removed (audit issue C3) — tokens in URLs leak
 * into logs, browser history and proxies. Browser-native requests that cannot
 * set headers (<img>, <a download>) authenticate via authenticateBrowserRequest.
 */
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const rawHeaderToken = authHeader && authHeader.split(" ")[1];
  // Guard: fetch helpers may send "Bearer null"/"Bearer undefined" when no
  // token is cached; treat junk as absent so the session cookie can be used.
  const headerToken = rawHeaderToken && rawHeaderToken !== "null" && rawHeaderToken !== "undefined" ? rawHeaderToken : null;
  // Cookie-first transition (Phase 2): the httpOnly session cookie is now a
  // valid primary credential, so the SPA no longer depends on localStorage.
  // CSRF: cookie is SameSite=Lax — cross-site POST/PUT/DELETE never carry it.
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
