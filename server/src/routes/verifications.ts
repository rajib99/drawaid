import fs from "fs";
import { Response, Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { captureUrlForToken, generateQrPngBase64 } from "../services/qrcode";
import { generateVerificationToken } from "../services/apiKey";
import { resolveImagePath } from "../services/storage";
import { transitionStatus } from "../services/verificationService";
import { AuthenticatedRequest } from "../types";

const router = Router();

router.use(apiKeyAuth);

function serializeVerification(v: any) {
  return {
    id: v.id,
    customerType: v.customerType,
    customerId: v.customerId,
    status: v.status,
    hasFrontImage: !!v.frontImagePath,
    hasBackImage: !!v.backImagePath,
    ocrConfidence: v.ocrConfidence,
    rejectionReason: v.rejectionReason,
    expiresAt: v.expiresAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    statusHistory: (v.statusEvents ?? []).map((e: any) => ({
      status: e.status,
      label: e.label,
      actor: e.actor,
      note: e.note,
      createdAt: e.createdAt,
    })),
  };
}

// POST /api/verifications { customerType, customerId }
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  const { customerType, customerId } = req.body ?? {};
  if (!customerType || typeof customerType !== "string") {
    return res.status(400).json({ error: "customerType is required" });
  }
  if (!customerId || typeof customerId !== "string") {
    return res.status(400).json({ error: "customerId is required" });
  }

  const token = generateVerificationToken();
  const expiresAt = new Date(Date.now() + config.tokenTtlMinutes * 60_000);

  const verification = await prisma.verificationRequest.create({
    data: {
      token,
      businessId: req.business!.id,
      customerType,
      customerId,
      expiresAt,
    },
  });

  await prisma.statusEvent.create({
    data: {
      verificationRequestId: verification.id,
      status: "PENDING",
      label: "ID Verification Requested",
      actor: req.business!.name,
    },
  });

  const captureUrl = captureUrlForToken(token);
  const qrCodePngBase64 = await generateQrPngBase64(captureUrl);

  res.status(201).json({
    id: verification.id,
    token: verification.token,
    status: verification.status,
    captureUrl,
    qrCodePngBase64,
    expiresAt: verification.expiresAt,
    createdAt: verification.createdAt,
  });
});

// GET /api/verifications?status=&since=&customerId= - list / poll
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const { status, since, customerId } = req.query;

  const where: any = { businessId: req.business!.id };
  if (status && typeof status === "string") {
    where.status = status;
  }
  if (customerId && typeof customerId === "string") {
    where.customerId = customerId;
  }
  if (since && typeof since === "string") {
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: "since must be a valid ISO date" });
    }
    where.updatedAt = { gt: sinceDate };
  }

  const verifications = await prisma.verificationRequest.findMany({
    where,
    include: { statusEvents: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  res.json({ verifications: verifications.map(serializeVerification) });
});

// GET /api/verifications/:id
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  const verification = await prisma.verificationRequest.findFirst({
    where: { id: req.params.id, businessId: req.business!.id },
    include: { statusEvents: { orderBy: { createdAt: "asc" } } },
  });
  if (!verification) {
    return res.status(404).json({ error: "Verification request not found" });
  }
  res.json(serializeVerification(verification));
});

// GET /api/verifications/:id/image/:side
router.get("/:id/image/:side", async (req: AuthenticatedRequest, res: Response) => {
  const { side } = req.params;
  if (side !== "front" && side !== "back") {
    return res.status(400).json({ error: "side must be 'front' or 'back'" });
  }
  const verification = await prisma.verificationRequest.findFirst({
    where: { id: req.params.id, businessId: req.business!.id },
  });
  if (!verification) {
    return res.status(404).json({ error: "Verification request not found" });
  }
  const relativePath = side === "front" ? verification.frontImagePath : verification.backImagePath;
  if (!relativePath) {
    return res.status(404).json({ error: `${side} image not uploaded yet` });
  }
  const absolutePath = resolveImagePath(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: "Image file missing on server" });
  }
  res.sendFile(absolutePath);
});

// POST /api/verifications/:id/decision { decision: "verified"|"rejected", reason? }
router.post("/:id/decision", async (req: AuthenticatedRequest, res: Response) => {
  const { decision, reason } = req.body ?? {};
  if (decision !== "verified" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be 'verified' or 'rejected'" });
  }

  const verification = await prisma.verificationRequest.findFirst({
    where: { id: req.params.id, businessId: req.business!.id },
  });
  if (!verification) {
    return res.status(404).json({ error: "Verification request not found" });
  }
  if (!verification.frontImagePath || !verification.backImagePath) {
    return res.status(409).json({ error: "Cannot decide before both ID images are uploaded" });
  }

  const status = decision === "verified" ? "MANUALLY_VERIFIED" : "MANUALLY_REJECTED";

  if (decision === "rejected" && reason) {
    await prisma.verificationRequest.update({
      where: { id: verification.id },
      data: { rejectionReason: reason },
    });
  }

  const updated = await transitionStatus(verification.id, status, req.business!.name, reason);

  res.json(serializeVerification({ ...updated, statusEvents: [] }));
});

export default router;
