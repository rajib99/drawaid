import crypto from "crypto";
import { config } from "../config";

export type SessionRole = "business" | "admin";

export interface SessionPayload {
  role: SessionRole;
  /** Business id for role=business; "admin" for the super admin. */
  sub: string;
  /** Fingerprint of the credential the session was issued against, so changing it revokes old sessions. */
  fp: string;
  /** Expiry, unix seconds. */
  exp: number;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
}

export function credentialFingerprint(secret: string): string {
  return crypto.createHash("sha256").update(`fp:${secret}`).digest("hex").slice(0, 16);
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">, ttlHours: number): string {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlHours * 3600 };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== "business" && payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}
