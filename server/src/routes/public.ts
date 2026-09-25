import path from "path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { config } from "../config";
import { allowedMimeType, saveImage } from "../services/storage";
import { transitionStatus } from "../services/verificationService";
import { verifyIdVisually } from "../services/ocr";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeType(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG or WEBP images are allowed"));
    }
    cb(null, true);
  },
});

async function findLiveVerificationByToken(token: string) {
  const verification = await prisma.verificationRequest.findUnique({
    where: { token },
    include: { business: { select: { status: true } } },
  });
  // A blocked business's outstanding capture links stop working immediately.
  if (!verification || verification.business.status === "BLOCKED") {
    return { verification: null, expired: false };
  }

  if (verification.status === "PENDING" && verification.expiresAt.getTime() < Date.now()) {
    await transitionStatus(verification.id, "EXPIRED", "system", "Capture link expired before upload");
    return { verification: null, expired: true };
  }
  return { verification, expired: false };
}

// GET /verify/:token - serves the mobile capture page
router.get("/verify/:token", async (req, res) => {
  const { verification, expired } = await findLiveVerificationByToken(req.params.token);

  if (!verification) {
    return res
      .status(expired ? 410 : 404)
      .sendFile(path.join(__dirname, "..", "public", "verify", "invalid.html"));
  }
  if (verification.status !== "PENDING") {
    return res.sendFile(path.join(__dirname, "..", "public", "verify", "already-done.html"));
  }
  res.sendFile(path.join(__dirname, "..", "public", "verify", "index.html"));
});

// GET /verify/:token/status - lightweight JSON check used by the capture page itself
router.get("/verify/:token/status", async (req, res) => {
  const { verification, expired } = await findLiveVerificationByToken(req.params.token);
  if (!verification) {
    return res.status(expired ? 410 : 404).json({ error: expired ? "expired" : "not_found" });
  }
  res.json({ status: verification.status });
});

// POST /public/verifications/:token/upload - multipart: front, back
router.post(
  "/public/verifications/:token/upload",
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
  ]),
  async (req, res) => {
    const { verification, expired } = await findLiveVerificationByToken(req.params.token);
    if (!verification) {
      return res.status(expired ? 410 : 404).json({ error: expired ? "This link has expired" : "Invalid link" });
    }
    if (verification.status !== "PENDING") {
      return res.status(409).json({ error: "This ID has already been submitted" });
    }

    const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
    const front = files?.front?.[0];
    const back = files?.back?.[0];
    if (!front || !back) {
      return res.status(400).json({ error: "Both front and back images are required" });
    }

    const frontRelativePath = saveImage(verification.id, "front", front.buffer, front.mimetype);
    const backRelativePath = saveImage(verification.id, "back", back.buffer, back.mimetype);

    await prisma.verificationRequest.update({
      where: { id: verification.id },
      data: { frontImagePath: frontRelativePath, backImagePath: backRelativePath },
    });

    await transitionStatus(verification.id, "ID_UPLOADED", "system", "Front and back images received");

    res.status(202).json({ status: "ID_UPLOADED", message: "Thank you - your ID has been submitted." });

    // Run OCR asynchronously so the customer isn't kept waiting on the
    // capture page; status transitions to VISUALLY_VERIFIED/REJECTED once done.
    runVisualVerification(verification.id, front.buffer, back.buffer).catch((err) => {
      console.error(`[ocr] visual verification failed for ${verification.id}:`, err);
    });
  }
);

async function runVisualVerification(verificationRequestId: string, frontBuffer: Buffer, backBuffer: Buffer) {
  try {
    const result = await verifyIdVisually(frontBuffer, backBuffer);

    // The business may already have decided manually while OCR was running (for
    // example from an ID_UPLOADED webhook). A manual decision is final: keep the
    // OCR data for reference, but don't overwrite the status or the reason.
    const current = await prisma.verificationRequest.findUnique({
      where: { id: verificationRequestId },
      select: { status: true },
    });
    const alreadyDecided = current?.status === "MANUALLY_VERIFIED" || current?.status === "MANUALLY_REJECTED";

    await prisma.verificationRequest.update({
      where: { id: verificationRequestId },
      data: {
        ocrConfidence: result.overallConfidence,
        ocrExtractedText: { front: result.front.text, back: result.back.text },
        ...(alreadyDecided ? {} : { rejectionReason: result.passed ? null : result.reason }),
      },
    });
    if (alreadyDecided) return;

    await transitionStatus(
      verificationRequestId,
      result.passed ? "VISUALLY_VERIFIED" : "VISUALLY_REJECTED",
      "system",
      result.reason
    );
  } catch (err) {
    // OCR crashed (corrupt image, etc.) - leave the request at ID_UPLOADED
    // so the business can still fetch the images and decide manually,
    // rather than silently mislabeling it as rejected.
    console.error(`[ocr] error running OCR for ${verificationRequestId}:`, err);
  }
}

export default router;
