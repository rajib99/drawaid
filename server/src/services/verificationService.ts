import { VerificationStatus } from "@prisma/client";
import { prisma } from "../db";
import { statusLabel } from "./statusLabels";
import { sendWebhook } from "./webhook";

/**
 * Moves a verification request to a new status, appends the audit-trail
 * StatusEvent with its human-readable label, and (best-effort) notifies
 * the owning business's webhook if one is configured.
 */
export async function transitionStatus(
  verificationRequestId: string,
  status: VerificationStatus,
  actor: string,
  note?: string
) {
  const updated = await prisma.verificationRequest.update({
    where: { id: verificationRequestId },
    data: { status },
    include: { business: true },
  });

  const label = statusLabel(status, updated.business.name);

  await prisma.statusEvent.create({
    data: {
      verificationRequestId,
      status,
      label,
      actor,
      note,
    },
  });

  if (updated.business.webhookUrl && updated.business.status !== "BLOCKED") {
    // Fire and forget - do not block the request/response cycle on a
    // third-party endpoint.
    void sendWebhook(updated.business.webhookUrl, {
      verificationId: updated.id,
      customerType: updated.customerType,
      customerId: updated.customerId,
      status,
      statusLabel: label,
      timestamp: new Date().toISOString(),
    });
  }

  return updated;
}
