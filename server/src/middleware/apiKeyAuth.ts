import { NextFunction, Response } from "express";
import { prisma } from "../db";
import { hashApiKey } from "../services/apiKey";
import { BUSINESS_COOKIE, readCookie } from "../services/cookies";
import { credentialFingerprint, verifySessionToken } from "../services/session";
import { AuthenticatedRequest } from "../types";

function blocked(res: Response, reason: string | null) {
  return res.status(403).json({
    error: "This account has been blocked. Contact support.",
    code: "ACCOUNT_BLOCKED",
    reason: reason ?? undefined,
  });
}

/**
 * Authenticates a business either by `X-API-Key` (server-to-server) or by the
 * portal session cookie (the browser UI calls the same endpoints). Blocked
 * businesses are refused on both paths.
 */
export async function businessAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const apiKey = req.header("X-API-Key");

  if (apiKey) {
    const business = await prisma.business.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    if (!business) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (business.status === "BLOCKED") return blocked(res, business.blockedReason);
    req.business = business;
    return next();
  }

  const session = verifySessionToken(readCookie(req, BUSINESS_COOKIE));
  if (session?.role === "business") {
    // Cookie auth is ambient, so mutating requests must prove they came from
    // our own JS (a cross-site form post cannot set this header).
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.header("X-Requested-With") !== "drawaid") {
      return res.status(403).json({ error: "Missing X-Requested-With header" });
    }
    const business = await prisma.business.findUnique({ where: { id: session.sub } });
    if (business?.passwordHash && credentialFingerprint(business.passwordHash) === session.fp) {
      if (business.status === "BLOCKED") return blocked(res, business.blockedReason);
      req.business = business;
      return next();
    }
  }

  return res.status(401).json({ error: "Authentication required: send an X-API-Key header or sign in to the portal" });
}

/** @deprecated kept so existing imports keep working; use businessAuth. */
export const apiKeyAuth = businessAuth;
