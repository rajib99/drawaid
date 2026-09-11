import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  adminToken: required("ADMIN_TOKEN", "change-me-admin-token"),
  databaseUrl: required("DATABASE_URL", "postgresql://drawaid:drawaid@localhost:5432/drawaid"),
  uploadsDir: process.env.UPLOADS_DIR ?? "./data/uploads",
  tokenTtlMinutes: parseInt(process.env.TOKEN_TTL_MINUTES ?? "30", 10),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024), 10),
  ocrMinConfidence: parseFloat(process.env.OCR_MIN_CONFIDENCE ?? "55"),
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? "5000", 10),
};
