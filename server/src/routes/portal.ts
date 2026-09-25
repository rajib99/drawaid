import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { businessAuth } from "../middleware/apiKeyAuth";
import { apiKeyPreview, generateApiKey, hashApiKey } from "../services/apiKey";
import { BUSINESS_COOKIE, clearSessionCookie, setSessionCookie } from "../services/cookies";
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from "../services/password";
import { createSessionToken, credentialFingerprint } from "../services/session";
import { completionRate, dailyRequestSeries, statusBreakdown } from "../services/stats";
import { webhookUrlError } from "../services/webhookUrl";
import { AuthenticatedRequest } from "../types";

/**
 * Backend for the company web portal (/portal). Account management lives here;
 * verification requests themselves are served by /api/verifications, which
 * accepts the same session cookie.
 */
const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serializeBusiness(b: {
  id: string;
  name: string;
  email: string | null;
  webhookUrl: string | null;
  apiKeyPreview: string | null;
  createdAt: Date;
}) {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    webhookUrl: b.webhookUrl,
    apiKeyPreview: b.apiKeyPreview,
    createdAt: b.createdAt,
  };
}

function startSession(res: any, business: { id: string; passwordHash: string | null }) {
  const token = createSessionToken(
    { role: "business", sub: business.id, fp: credentialFingerprint(business.passwordHash ?? "") },
    config.businessSessionHours
  );
  setSessionCookie(res, BUSINESS_COOKIE, token, config.businessSessionHours);
}

// Used by the UI to render the brand name and hide signup when disabled.
router.get("/config", (_req, res) => {
  res.json({ brandName: config.brandName, signupEnabled: config.signupEnabled, baseUrl: config.publicBaseUrl });
});

// POST /portal/api/signup { name, email, password, webhookUrl? }
router.post("/signup", async (req, res) => {
  if (!config.signupEnabled) {
    return res.status(403).json({ error: "Signups are currently closed" });
  }
  const { name, email, password, webhookUrl } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return res.status(400).json({ error: "Company name must be 2-100 characters" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim()) || email.length > 254) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  let cleanWebhook: string | null = null;
  if (webhookUrl) {
    if (typeof webhookUrl !== "string") return res.status(400).json({ error: "webhookUrl must be a string" });
    const err = webhookUrlError(webhookUrl, config.allowPrivateWebhooks);
    if (err) return res.status(400).json({ error: err });
    cleanWebhook = webhookUrl;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (await prisma.business.findUnique({ where: { email: normalizedEmail } })) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const apiKey = generateApiKey();
  const business = await prisma.business.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPreview: apiKeyPreview(apiKey),
      webhookUrl: cleanWebhook,
      lastLoginAt: new Date(),
    },
  });

  startSession(res, business);
  // The plaintext key is returned exactly once, here.
  res.status(201).json({ business: serializeBusiness(business), apiKey });
});

// POST /portal/api/login { email, password }
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password are required" });
  }
  const business = await prisma.business.findUnique({ where: { email: email.trim().toLowerCase() } });

  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = business?.passwordHash
    ? await verifyPassword(password, business.passwordHash)
    : (await verifyPassword(password, "scrypt$00$00"), false);
  if (!business || !ok) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (business.status === "BLOCKED") {
    return res.status(403).json({
      error: "This account has been blocked. Contact support.",
      code: "ACCOUNT_BLOCKED",
      reason: business.blockedReason ?? undefined,
    });
  }

  const updated = await prisma.business.update({ where: { id: business.id }, data: { lastLoginAt: new Date() } });
  startSession(res, updated);
  res.json({ business: serializeBusiness(updated) });
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res, BUSINESS_COOKIE);
  res.json({ ok: true });
});

// Everything below needs a portal session (not an API key - account changes are a human action).
router.use((req, res, next) => {
  if (req.header("X-API-Key")) {
    return res.status(403).json({ error: "This endpoint requires a portal session, not an API key" });
  }
  next();
});
router.use(businessAuth);

router.get("/me", (req: AuthenticatedRequest, res) => {
  res.json({ business: serializeBusiness(req.business!) });
});

// GET /portal/api/stats
router.get("/stats", async (req: AuthenticatedRequest, res) => {
  const businessId = req.business!.id;
  const now = Date.now();
  const [byStatus, daily, last7d, last30d] = await Promise.all([
    statusBreakdown(businessId),
    dailyRequestSeries(30, businessId),
    prisma.verificationRequest.count({ where: { businessId, createdAt: { gte: new Date(now - 7 * 86_400_000) } } }),
    prisma.verificationRequest.count({ where: { businessId, createdAt: { gte: new Date(now - 30 * 86_400_000) } } }),
  ]);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  res.json({ total, last7d, last30d, byStatus, completionRate: completionRate(byStatus), daily });
});

// PATCH /portal/api/settings { name?, webhookUrl? }  (webhookUrl "" clears it)
router.patch("/settings", async (req: AuthenticatedRequest, res) => {
  const { name, webhookUrl } = req.body ?? {};
  const data: { name?: string; webhookUrl?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: "Company name must be 2-100 characters" });
    }
    data.name = name.trim();
  }
  if (webhookUrl !== undefined) {
    if (webhookUrl === "" || webhookUrl === null) {
      data.webhookUrl = null;
    } else {
      if (typeof webhookUrl !== "string") return res.status(400).json({ error: "webhookUrl must be a string" });
      const err = webhookUrlError(webhookUrl, config.allowPrivateWebhooks);
      if (err) return res.status(400).json({ error: err });
      data.webhookUrl = webhookUrl;
    }
  }

  const updated = await prisma.business.update({ where: { id: req.business!.id }, data });
  res.json({ business: serializeBusiness(updated) });
});

// POST /portal/api/api-key/rotate - old key stops working immediately
router.post("/api-key/rotate", async (req: AuthenticatedRequest, res) => {
  const apiKey = generateApiKey();
  const updated = await prisma.business.update({
    where: { id: req.business!.id },
    data: { apiKeyHash: hashApiKey(apiKey), apiKeyPreview: apiKeyPreview(apiKey) },
  });
  res.json({ business: serializeBusiness(updated), apiKey });
});

// POST /portal/api/password { currentPassword, newPassword }
router.post("/password", async (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 200) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (!(await verifyPassword(currentPassword, req.business!.passwordHash!))) {
    // 400, not 401: the session is fine, only the submitted value is wrong.
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  const updated = await prisma.business.update({
    where: { id: req.business!.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  // Changing the password changes the session fingerprint, so re-issue for this browser only.
  startSession(res, updated);
  res.json({ ok: true });
});

export default router;
