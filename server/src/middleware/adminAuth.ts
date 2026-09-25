import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { ADMIN_COOKIE, readCookie } from "../services/cookies";
import { credentialFingerprint, verifySessionToken } from "../services/session";

export function adminTokenMatches(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(config.adminToken).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Accepts `X-Admin-Token` (scripts/curl) or the super-admin dashboard's session cookie. */
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (adminTokenMatches(req.header("X-Admin-Token"))) return next();

  const session = verifySessionToken(readCookie(req, ADMIN_COOKIE));
  if (session?.role === "admin" && session.fp === credentialFingerprint(config.adminToken)) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.header("X-Requested-With") !== "drawaid") {
      return res.status(403).json({ error: "Missing X-Requested-With header" });
    }
    return next();
  }

  return res.status(401).json({ error: "Invalid or missing X-Admin-Token" });
}
