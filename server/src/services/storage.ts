import fs from "fs";
import path from "path";
import { config } from "../config";

fs.mkdirSync(config.uploadsDir, { recursive: true });

const ALLOWED_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function allowedMimeType(mimeType: string): boolean {
  return mimeType in ALLOWED_EXTENSIONS;
}

/**
 * Saves an uploaded image buffer under a per-verification-request directory,
 * keyed by side ("front" | "back"). Returns the path stored in the DB
 * (relative to uploadsDir, so the storage root can move without a migration).
 */
export function saveImage(
  verificationRequestId: string,
  side: "front" | "back",
  buffer: Buffer,
  mimeType: string
): string {
  const ext = ALLOWED_EXTENSIONS[mimeType];
  if (!ext) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
  const dir = path.join(config.uploadsDir, verificationRequestId);
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = path.join(verificationRequestId, `${side}${ext}`);
  const absolutePath = path.join(config.uploadsDir, relativePath);
  fs.writeFileSync(absolutePath, buffer);
  return relativePath;
}

export function resolveImagePath(relativePath: string): string {
  const resolved = path.resolve(config.uploadsDir, relativePath);
  const root = path.resolve(config.uploadsDir);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid image path");
  }
  return resolved;
}
