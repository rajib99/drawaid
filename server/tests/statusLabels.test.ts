import { describe, expect, it } from "vitest";
import { statusLabel } from "../src/services/statusLabels";

describe("statusLabel", () => {
  it("produces the DRAWAID software labels for automated statuses", () => {
    expect(statusLabel("ID_UPLOADED")).toBe("ID Uploaded");
    expect(statusLabel("VISUALLY_VERIFIED")).toBe("ID Visually Verified by DRAWAID Software");
    expect(statusLabel("VISUALLY_REJECTED")).toBe("ID Visually Rejected by DRAWAID Software");
  });

  it("embeds the business name for manual decisions", () => {
    expect(statusLabel("MANUALLY_VERIFIED", "Acme Corp")).toBe("ID Manually Verified by Acme Corp");
    expect(statusLabel("MANUALLY_REJECTED", "Acme Corp")).toBe("ID Manually Rejected by Acme Corp");
  });

  it("falls back to a generic business label when no name is given", () => {
    expect(statusLabel("MANUALLY_VERIFIED")).toBe("ID Manually Verified by Business");
  });
});
