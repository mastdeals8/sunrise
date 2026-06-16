import "dotenv/config";
import path from "path";

if (!process.env.DATABASE_URL) {
  console.error("🚨 DATABASE_URL is missing in sunrise-media-erp/.env!");
  process.exit(1);
}

// SECURITY: hard-fail when JWT_SECRET is missing or weak. A fallback secret
// would make every token forgeable in production. (Audit issue C2)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("🚨 JWT_SECRET is missing or shorter than 32 characters. Set a strong JWT_SECRET in .env. Refusing to start.");
  process.exit(1);
}

export const config = {
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "5000", 10),
  // UPLOAD_DIR: absolute path to the uploads root. Override in production via
  // UPLOAD_DIR=/app/uploads (or whatever the persistent volume mount path is).
  UPLOAD_DIR: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "uploads"),
  UPLOAD_PATHS: {
    receipts: "uploads/receipts/",
    documents: "uploads/documents/"
  },
  // Comma-separated list of allowed cross-origin origins. Same-origin requests
  // are always allowed; this only matters if the API is called from another domain.
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Upload hardening (audit issue H2)
  UPLOAD_MAX_BYTES: parseInt(process.env.UPLOAD_MAX_BYTES || String(25 * 1024 * 1024), 10), // 25MB default
  // Optional Telegram webhook secret (audit issue H3). When set, incoming
  // webhook calls must carry the matching X-Telegram-Bot-Api-Secret-Token header.
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || "",
};

export const {
  DATABASE_URL,
  NODE_ENV,
  PORT,
  UPLOAD_DIR,
  UPLOAD_PATHS,
  JWT_SECRET,
  CORS_ORIGINS,
  UPLOAD_MAX_BYTES,
  TELEGRAM_WEBHOOK_SECRET,
} = config;
