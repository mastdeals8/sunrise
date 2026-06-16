import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import path from "path";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { authenticateBrowserRequest } from "./auth";
import { NODE_ENV, CORS_ORIGINS, UPLOAD_DIR } from "./config";

const app = express();

// ── Security middleware (audit issue C4) ────────────────────────────────────
// helmet: standard security headers. CSP disabled because the Vite SPA uses
// inline styles/scripts in dev; enable a tuned CSP as a follow-up.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

// CORS allowlist: same-origin requests carry no Origin mismatch; cross-origin
// requests are only honoured for origins listed in CORS_ORIGINS (.env).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Global API rate limit — generous; protects against runaway clients/scrapers.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// ── Authenticated file serving (audit issue C1) ─────────────────────────────
// /uploads previously used express.static with NO auth: every invoice, signed
// WCC and client document was publicly downloadable. Files are now served only
// to logged-in users (httpOnly session cookie or Bearer header).
// Company branding assets remain excluded here and are served through their
// dedicated authenticated API route.
app.use('/uploads/company-assets', (_req, res) => {
  res.status(404).json({ message: "Not found" });
});
app.use(
  '/uploads',
  authenticateBrowserRequest,
  express.static(UPLOAD_DIR, {
    fallthrough: false,
    setHeaders: (res, filePath) => {
      // Force download-safe handling of anything that isn't a known inline type.
      // Prevents stored-XSS via uploaded .html/.svg being rendered in-origin.
      const inline = /\.(png|jpe?g|gif|webp|pdf)$/i.test(filePath);
      if (!inline) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  })
);

// API Access logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      if (req.method === 'HEAD' && path === '/api') {
        return;
      }
      
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Sanitize ENOENT errors: never expose server filesystem paths to the client.
    const message = err.code === 'ENOENT'
      ? (status === 404 ? "File not found" : "Internal Server Error")
      : (err.message || "Internal Server Error");

    console.error('[ERROR]', {
      status,
      message: err.message,
      stack: err.stack,
      url: _req.url,
      method: _req.method
    });

    if (!res.headersSent) {
      res.status(status).json({ message });
    }
    
    if (process.env.NODE_ENV === 'development') {
      next(err);
    }
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Bolt injects PORT=9091 for its own preview proxy — never bind to that.
  const rawPort = parseInt(process.env.PORT || '5000', 10);
  const port = rawPort === 9091 ? 5000 : rawPort;
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
    console.log(`http://localhost:${port}`);
  });
})();
