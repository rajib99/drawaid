import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, credentialFingerprint, verifySessionToken } from "../src/services/session";

const base = { role: "business" as const, sub: "biz-1", fp: credentialFingerprint("hash") };

describe("session tokens", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips a valid token", () => {
    const payload = verifySessionToken(createSessionToken(base, 1));
    expect(payload).toMatchObject({ role: "business", sub: "biz-1", fp: base.fp });
  });

  it("rejects a tampered payload", () => {
    const [body, sig] = createSessionToken(base, 1).split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, sub: "someone-else", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(verifySessionToken(`${body}.AAAA`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const token = createSessionToken(base, 1);
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects garbage and missing tokens", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("not-a-token")).toBeNull();
  });

  it("fingerprints differ per credential (so a password change revokes sessions)", () => {
    expect(credentialFingerprint("a")).not.toBe(credentialFingerprint("b"));
  });
});
