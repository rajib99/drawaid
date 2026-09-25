import { describe, expect, it } from "vitest";
import { generateApiKey, generateVerificationToken, hashApiKey } from "../src/services/apiKey";

describe("apiKey", () => {
  it("generates unique, prefixed API keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toEqual(b);
    expect(a.startsWith("vtbl_")).toBe(true);
  });

  it("hashes deterministically so a stored hash can be looked up again", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toEqual(hashApiKey(key));
  });

  it("produces different hashes for different keys", () => {
    expect(hashApiKey(generateApiKey())).not.toEqual(hashApiKey(generateApiKey()));
  });

  it("generates unique verification tokens", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateVerificationToken()));
    expect(tokens.size).toBe(20);
  });
});
