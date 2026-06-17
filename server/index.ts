import "dotenv/config";
import { createServer } from "http";
import express, { type Request, Response, NextFunction } from "express";

// Global error handlers — surface DOMException / uncaught errors with full detail.
process.on("uncaughtException", (err: any) => {
  console.error("UNCAUGHT_EXCEPTION name:", err?.name);
  console.error("UNCAUGHT_EXCEPTION message:", err?.message);
  console.error("UNCAUGHT_EXCEPTION stack:", err?.stack ?? "(no stack)");
  if (err?.name === "DataCloneError") {
    console.warn("[startup] DataCloneError suppressed — WebContainer MessagePort limitation, server continues");
    return;
  }
  process.exit(1);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("UNHANDLED_REJECTION:", reason?.message ?? reason);
  console.error("UNHANDLED_REJECTION stack:", reason?.stack ?? "(no stack)");
});

// ── Bolt preview mode ────────────────────────────────────────────────────────
// BOLT_PREVIEW=true: serve a static info page + stub API endpoints.
// Nothing from routes/db/storage/vite/postcss is imported in this branch.
if (process.env.BOLT_PREVIEW === "true") {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/notifications", (_req, res) => res.json([]));
  app.get("/api/finance/dashboard", (_req, res) =>
    res.json({ stats: {}, estimates: [], invoices: [], deliveryChallans: [], payments: [] })
  );
  app.use("/api", (_req, res) => {
    res.status(503).json({
      message: "Bolt preview mode: real database disabled. Use npm run dev:full locally.",
    });
  });

  const previewHtml = `<!doctype html>
<html>
  <head>
    <title>Sunrise ERP - Bolt Preview</title>
    <style>
      body { font-family: system-ui; background:#f8fafc; color:#0f172a; padding:40px; }
      .card { max-width:720px; margin:auto; background:white; padding:32px; border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.08); }
      h1 { margin-top:0; }
      code { background:#f1f5f9; padding:4px 8px; border-radius:6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Sunrise ERP Preview Running</h1>
      <p>Bolt preview mode is active.</p>
      <p>Database and full ERP routes are disabled inside Bolt WebContainer.</p>
      <p>Use <code>npm run dev:full</code> locally for real Supabase data.</p>
      <p>Health check: <code>/api/health</code></p>
    </div>
  </body>
</html>`;

  app.get("*", (_req, res) => res.type("html").send(previewHtml));

  const previewPort = parseInt(process.env.PORT || "5000", 10);
  server.listen(previewPort, "0.0.0.0", () => {
    console.log(`✓ Bolt preview ready at http://localhost:${previewPort}`);
  });

// ── Full app mode ────────────────────────────────────────────────────────────
} else {
  (async () => {
    const [
      { default: helmet },
      { default: rateLimit },
      { default: cookieParser },
      { registerRoutes },
      { setupVite, serveStatic, log },
      { authenticateBrowserRequest },
      { NODE_ENV: _NODE_ENV, CORS_ORIGINS, UPLOAD_DIR },
    ] = await Promise.all([
      import("helmet"),
      import("express-rate-limit"),
      import("cookie-parser"),
      import("./routes"),
      import("./vite"),
      import("./auth"),
      import("./config"),
    ]);

    const app = express();

    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: "same-origin" },
      })
    );

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
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: false, limit: "50mb" }));

    app.use("/uploads/company-assets", (_req, res) => {
      res.status(404).json({ message: "Not found" });
    });
    app.use(
      "/uploads",
      authenticateBrowserRequest,
      express.static(UPLOAD_DIR, {
        fallthrough: false,
        setHeaders: (res, filePath) => {
          const inline = /\.(png|jpe?g|gif|webp|pdf)$/i.test(filePath);
          if (!inline) {
            res.setHeader("Content-Disposition", "attachment");
            res.setHeader("Content-Type", "application/octet-stream");
          }
          res.setHeader("X-Content-Type-Options", "nosniff");
        },
      })
    );

    app.use((req, res, next) => {
      const start = Date.now();
      const p = req.path;
      let capturedJsonResponse: Record<string, any> | undefined = undefined;

      const originalResJson = res.json;
      res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
      };

      res.on("finish", () => {
        const duration = Date.now() - start;
        if (p.startsWith("/api")) {
          if (req.method === "HEAD" && p === "/api") return;
          let logLine = `${req.method} ${p} ${res.statusCode} in ${duration}ms`;
          if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
          log(logLine);
        }
      });

      next();
    });

    console.log("[startup] registering routes...");
    const server = await registerRoutes(app);
    console.log("[startup] routes registered");

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message =
        err.code === "ENOENT"
          ? status === 404
            ? "File not found"
            : "Internal Server Error"
          : err.message || "Internal Server Error";

      console.error("[ERROR]", { status, message: err.message, stack: err.stack, url: _req.url, method: _req.method });

      if (!res.headersSent) res.status(status).json({ message });
      if (process.env.NODE_ENV === "development") next(err);
    });

    if (app.get("env") === "development") {
      console.log("[startup] starting Vite...");
      try {
        await setupVite(app, server);
        console.log("[startup] Vite ready");
      } catch (err: any) {
        console.error("[startup] Vite failed:", err?.message ?? err);
        console.error("[startup] Vite stack:", err?.stack ?? "(no stack)");
        try { serveStatic(app); } catch { /* dist may not exist in dev */ }
      }
    } else {
      serveStatic(app);
    }

    const rawPort = parseInt(process.env.PORT || "5000", 10);
    const port = rawPort === 9091 ? 5000 : rawPort;
    console.log("[startup] binding port", port);
    server.listen({ port, host: "0.0.0.0" }, async () => {
      log(`serving on port ${port}`);
      if (process.env.SKIP_DB_STARTUP !== "true") {
        try {
          const { pool } = await import("./db");
          const client = await pool.connect();
          console.log("✓ Connected to Supabase database successfully");
          client.release();
        } catch (err: any) {
          console.error("✗ Supabase connection failed:", err.message);
        }
      }
      console.log(`✓ Server ready at http://localhost:${port}`);
    });
  })();
}
