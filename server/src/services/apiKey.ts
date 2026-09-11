import crypto from "crypto";

const API_KEY_PREFIX = "drwd_";

/** Generates a new plaintext API key (shown to the business exactly once). */
export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

/**
 * API keys are high-entropy random tokens, not user-chosen passwords, so a
 * fast deterministic hash (rather than bcrypt) is appropriate here - it lets
 * us look a business up directly via an indexed/unique column instead of
 * scanning every row to compare salted hashes.
 */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
