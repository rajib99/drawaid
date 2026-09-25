import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { adminAuth, adminTokenMatches } from "../middleware/adminAuth";
import { apiKeyPreview, generateApiKey, hashApiKey } from "../services/apiKey";
import { ADMIN_COOKIE, clearSessionCookie, setSessionCookie } from "../services/cookies";
import { createSessionToken, credentialFingerprint } from "../services/session";
import { completionRate, dailyRequestSeries, statusBreakdown } from "../services/stats";
import { webhookUrlError } from "../services/webhookUrl";

const router = Router();

// --- Session endpoints (registered before adminAuth so you can log in) -------

// POST /admin/login { token } - exchanges the admin token for a session cookie (used by /superadmin)
router.post("/login", (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !adminTokenMatches(token)) {
    return res.status(401).json({ error: "Invalid admin token" });
  }
  const session = createSessionToken(
    { role: "admin", sub: "admin", fp: credentialFingerprint(config.adminToken) },
    config.adminSessionHours
  );
  setSessionCookie(res, ADMIN_COOKIE, session, config.adminSessionHours);
  res.json({ ok: true });
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res, ADMIN_COOKIE);
  res.json({ ok: true });
});

router.use(adminAuth);

router.get("/me", (_req, res) => res.json({ ok: true }));

const DAY = 86_400_000;

function serializeBusiness(b: any, stats?: { requestCount: number; requests30d: number; lastRequestAt: Date | null }) {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    hasPortalLogin: !!b.passwordHash,
    status: b.status,
    blockedAt: b.blockedAt,
    blockedReason: b.blockedReason,
    webhookUrl: b.webhookUrl,
    apiKeyPreview: b.apiKeyPreview,
    lastLoginAt: b.lastLoginAt,
    createdAt: b.createdAt,
    ...(stats ?? {}),
  };
}

// POST /admin/businesses { name, webhookUrl? } - provision a business without portal signup
router.post("/businesses", async (req, res) => {
  const { name, webhookUrl } = req.body ?? {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  if (webhookUrl !== undefined && typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "webhookUrl must be a string" });
  }
  if (webhookUrl) {
    const err = webhookUrlError(webhookUrl, config.allowPrivateWebhooks);
    if (err) return res.status(400).json({ error: err });
  }

  const apiKey = generateApiKey();
  const business = await prisma.business.create({
    data: {
      name,
      apiKeyHash: hashApiKey(apiKey),
      apiKeyPreview: apiKeyPreview(apiKey),
      webhookUrl: webhookUrl || null,
    },
  });

  res.status(201).json({
    id: business.id,
    name: business.name,
    webhookUrl: business.webhookUrl,
    apiKey, // shown once - not recoverable afterwards
    createdAt: business.createdAt,
  });
});

// GET /admin/businesses?search=&status=ACTIVE|BLOCKED - businesses with usage counts (no API keys)
router.get("/businesses", async (req, res) => {
  const { search, status } = req.query;
  const where: any = {};
  if (status === "ACTIVE" || status === "BLOCKED") where.status = status;
  if (typeof search === "string" && search.trim()) {
    where.OR = [
      { name: { contains: search.trim(), mode: "insensitive" } },
      { email: { contains: search.trim(), mode: "insensitive" } },
    ];
  }

  const businesses = await prisma.business.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
  const ids = businesses.map((b) => b.id);

  const [totals, recent] = await Promise.all([
    prisma.verificationRequest.groupBy({
      by: ["businessId"],
      where: { businessId: { in: ids } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.verificationRequest.groupBy({
      by: ["businessId"],
      where: { businessId: { in: ids }, createdAt: { gte: new Date(Date.now() - 30 * DAY) } },
      _count: { _all: true },
    }),
  ]);
  const totalById = new Map(totals.map((t) => [t.businessId, t]));
  const recentById = new Map(recent.map((t) => [t.businessId, t._count._all]));

  res.json({
    businesses: businesses.map((b) =>
      serializeBusiness(b, {
        requestCount: totalById.get(b.id)?._count._all ?? 0,
        requests30d: recentById.get(b.id) ?? 0,
        lastRequestAt: totalById.get(b.id)?._max.createdAt ?? null,
      })
    ),
  });
});

// GET /admin/businesses/:id - one business with its analytics. Never includes ID images.
router.get("/businesses/:id", async (req, res) => {
  const business = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!business) return res.status(404).json({ error: "Business not found" });

  const [byStatus, daily, recentRequests, lastRequest] = await Promise.all([
    statusBreakdown(business.id),
    dailyRequestSeries(30, business.id),
    prisma.verificationRequest.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, customerType: true, status: true, createdAt: true, updatedAt: true },
    }),
    prisma.verificationRequest.findFirst({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  res.json({
    business: serializeBusiness(business, {
      requestCount: total,
      requests30d: daily.reduce((a, d) => a + d.count, 0),
      lastRequestAt: lastRequest?.createdAt ?? null,
    }),
    byStatus,
    completionRate: completionRate(byStatus),
    daily,
    recentRequests,
  });
});

// POST /admin/businesses/:id/block { reason? }
router.post("/businesses/:id/block", async (req, res) => {
  const { reason } = req.body ?? {};
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    return res.status(400).json({ error: "reason must be a string up to 500 characters" });
  }
  const existing = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Business not found" });

  const business = await prisma.business.update({
    where: { id: existing.id },
    data: { status: "BLOCKED", blockedAt: new Date(), blockedReason: reason?.trim() || null },
  });
  res.json({ business: serializeBusiness(business) });
});

// POST /admin/businesses/:id/unblock
router.post("/businesses/:id/unblock", async (req, res) => {
  const existing = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Business not found" });

  const business = await prisma.business.update({
    where: { id: existing.id },
    data: { status: "ACTIVE", blockedAt: null, blockedReason: null },
  });
  res.json({ business: serializeBusiness(business) });
});

// POST /admin/businesses/:id/rotate-key - issues a new key (shown once); the old one stops working
router.post("/businesses/:id/rotate-key", async (req, res) => {
  const existing = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Business not found" });

  const apiKey = generateApiKey();
  const business = await prisma.business.update({
    where: { id: existing.id },
    data: { apiKeyHash: hashApiKey(apiKey), apiKeyPreview: apiKeyPreview(apiKey) },
  });
  res.json({ business: serializeBusiness(business), apiKey });
});

// GET /admin/overview - platform-wide analytics
router.get("/overview", async (_req, res) => {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const [
    businessesTotal,
    businessesBlocked,
    newBusinesses7d,
    newBusinesses30d,
    requestsTotal,
    requestsToday,
    requests7d,
    requests30d,
    byStatus,
    daily,
    topRaw,
    activeRaw,
  ] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { status: "BLOCKED" } }),
    prisma.business.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.business.count({ where: { createdAt: { gte: new Date(now - 30 * DAY) } } }),
    prisma.verificationRequest.count(),
    prisma.verificationRequest.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.verificationRequest.count({ where: { createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.verificationRequest.count({ where: { createdAt: { gte: new Date(now - 30 * DAY) } } }),
    statusBreakdown(),
    dailyRequestSeries(30),
    prisma.verificationRequest.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: new Date(now - 30 * DAY) } },
      _count: { _all: true },
      orderBy: { _count: { businessId: "desc" } },
      take: 5,
    }),
    prisma.verificationRequest.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: new Date(now - 30 * DAY) } },
    }),
  ]);

  const names = await prisma.business.findMany({
    where: { id: { in: topRaw.map((t) => t.businessId) } },
    select: { id: true, name: true, status: true },
  });
  const nameById = new Map(names.map((n) => [n.id, n]));

  res.json({
    businesses: {
      total: businessesTotal,
      active: businessesTotal - businessesBlocked,
      blocked: businessesBlocked,
      new7d: newBusinesses7d,
      new30d: newBusinesses30d,
      activeLast30d: activeRaw.length, // businesses that sent at least one request
    },
    requests: { total: requestsTotal, today: requestsToday, last7d: requests7d, last30d: requests30d },
    byStatus,
    completionRate: completionRate(byStatus),
    daily,
    topBusinesses: topRaw.map((t) => ({
      id: t.businessId,
      name: nameById.get(t.businessId)?.name ?? "(deleted)",
      status: nameById.get(t.businessId)?.status ?? null,
      requests30d: t._count._all,
    })),
  });
});

// GET /admin/activity?limit=50 - newest status events across all businesses
router.get("/activity", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
  const events = await prisma.statusEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      verificationRequest: {
        select: { id: true, customerType: true, business: { select: { id: true, name: true } } },
      },
    },
  });
  res.json({
    events: events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      status: e.status,
      label: e.label,
      actor: e.actor,
      verificationId: e.verificationRequest.id,
      customerType: e.verificationRequest.customerType,
      business: e.verificationRequest.business,
    })),
  });
});

export default router;
