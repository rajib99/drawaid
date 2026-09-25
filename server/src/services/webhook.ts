import dns from "dns/promises";
import { config } from "../config";
import { isPrivateAddress } from "./webhookUrl";

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
  try {
    if (!config.allowPrivateWebhooks) {
      // Re-check at delivery time: the hostname may have been public when the
      // URL was saved and point at an internal address now.
      const host = new URL(webhookUrl).hostname.replace(/^\[|\]$/g, "");
      const addresses = await dns.lookup(host, { all: true });
      if (addresses.some((a) => isPrivateAddress(a.address))) {
        console.warn(`[webhook] refusing to deliver to non-public address for ${host}`);
        return;
      }
    }
  } catch (err) {
    console.warn(`[webhook] could not resolve ${webhookUrl}:`, (err as Error).message);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.webhookTimeoutMs);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "manual", // a redirect could point at an internal address
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
