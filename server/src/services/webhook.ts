import { config } from "../config";

interface WebhookPayload {
  verificationId: string;
  customerType: string;
  customerId: string;
  status: string;
  statusLabel: string;
  timestamp: string;
}

/**
 * Best-effort webhook delivery: one attempt, short timeout, failures are
 * logged but never thrown - businesses can always fall back to polling
 * GET /api/verifications?since=... so a dropped webhook is not fatal.
 */
export async function sendWebhook(webhookUrl: string, payload: WebhookPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.webhookTimeoutMs);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[webhook] ${webhookUrl} responded with status ${res.status}`);
    }
  } catch (err) {
    console.warn(`[webhook] delivery to ${webhookUrl} failed:`, (err as Error).message);
  } finally {
    clearTimeout(timeout);
  }
}
