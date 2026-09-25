import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const adminToken = required("ADMIN_TOKEN", "change-me-admin-token");

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  publicBaseUrl,
  adminToken,
  brandName: process.env.BRAND_NAME ?? "DRAWAID",
  // Signs portal / super-admin session cookies. Falls back to a value derived
  // from ADMIN_TOKEN so a fresh deploy works, but set SESSION_SECRET explicitly
  // in production so rotating one secret doesn't rotate the other.
  sessionSecret:
    // `||` not `??`: docker-compose passes an unset variable through as "", and an empty signing key must never be used.
    process.env.SESSION_SECRET ||
    crypto.createHash("sha256").update(`drawaid-session:${adminToken}`).digest("hex"),
  businessSessionHours: parseInt(process.env.BUSINESS_SESSION_HOURS ?? String(24 * 7), 10),
  adminSessionHours: parseInt(process.env.ADMIN_SESSION_HOURS ?? "12", 10),
  cookieSecure: publicBaseUrl.startsWith("https://"),
  signupEnabled: (process.env.SIGNUP_ENABLED ?? "true").toLowerCase() !== "false",
  allowPrivateWebhooks: (process.env.ALLOW_PRIVATE_WEBHOOKS ?? "false").toLowerCase() === "true",
  databaseUrl: required("DATABASE_URL", "postgresql://drawaid:drawaid@localhost:5432/drawaid"),
  uploadsDir: process.env.UPLOADS_DIR ?? "./data/uploads",
  tokenTtlMinutes: parseInt(process.env.TOKEN_TTL_MINUTES ?? "30", 10),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024), 10),
  ocrMinConfidence: parseFloat(process.env.OCR_MIN_CONFIDENCE ?? "55"),
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? "5000", 10),
};
