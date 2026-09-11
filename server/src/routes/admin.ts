import { Router } from "express";
import { prisma } from "../db";
import { adminAuth } from "../middleware/adminAuth";
import { generateApiKey, hashApiKey } from "../services/apiKey";

const router = Router();

router.use(adminAuth);

// POST /admin/businesses { name, webhookUrl? }
router.post("/businesses", async (req, res) => {
  const { name, webhookUrl } = req.body ?? {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  if (webhookUrl !== undefined && typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "webhookUrl must be a string" });
  }

  const apiKey = generateApiKey();
  const business = await prisma.business.create({
    data: {
      name,
      apiKeyHash: hashApiKey(apiKey),
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

// GET /admin/businesses - list businesses (no API keys returned)
router.get("/businesses", async (_req, res) => {
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true, webhookUrl: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ businesses });
});

export default router;
