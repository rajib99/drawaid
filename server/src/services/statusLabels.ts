import type { VerificationStatus } from "@prisma/client";

/**
 * Builds the human-readable status label persisted on each StatusEvent.
 * businessName is only used for the MANUALLY_* statuses.
 */
export function statusLabel(status: VerificationStatus, businessName?: string): string {
  switch (status) {
    case "PENDING":
      return "ID Verification Requested";
    case "ID_UPLOADED":
      return "ID Uploaded";
    case "VISUALLY_VERIFIED":
      return "ID Visually Verified by DRAWAID Software";
    case "VISUALLY_REJECTED":
      return "ID Visually Rejected by DRAWAID Software";
    case "MANUALLY_VERIFIED":
      return `ID Manually Verified by ${businessName ?? "Business"}`;
    case "MANUALLY_REJECTED":
      return `ID Manually Rejected by ${businessName ?? "Business"}`;
    case "EXPIRED":
      return "ID Verification Request Expired";
    default:
      return status;
  }
}
