import { Request, Response } from "express";
import { config } from "../config";

export const BUSINESS_COOKIE = "drawaid_session";
export const ADMIN_COOKIE = "drawaid_admin";

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// SameSite=Strict + HttpOnly: the session is never readable by page JS and is
// not sent on cross-site requests, which is our CSRF defence (see requireXhr).
export function setSessionCookie(res: Response, name: string, value: string, maxAgeHours: number) {
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    maxAge: maxAgeHours * 3600 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response, name: string) {
  res.clearCookie(name, { httpOnly: true, sameSite: "strict", secure: config.cookieSecure, path: "/" });
}
