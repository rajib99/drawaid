import { describe, expect, it } from "vitest";
import { completionRate } from "../src/services/stats";

describe("completionRate", () => {
  it("is null with no requests", () => {
    expect(completionRate({ PENDING: 0, EXPIRED: 0 })).toBeNull();
  });

  it("counts anything past PENDING/EXPIRED as completed", () => {
    expect(completionRate({ PENDING: 1, EXPIRED: 1, ID_UPLOADED: 1, MANUALLY_VERIFIED: 1 })).toBe(0.5);
    expect(completionRate({ MANUALLY_VERIFIED: 4 })).toBe(1);
    expect(completionRate({ EXPIRED: 3 })).toBe(0);
  });
});
