import { describe, expect, it } from "vitest";
import { isPrivateAddress, webhookUrlError } from "../src/services/webhookUrl";

describe("webhookUrlError", () => {
  it("accepts public http(s) URLs", () => {
    expect(webhookUrlError("https://example.com/hook")).toBeNull();
    expect(webhookUrlError("http://api.example.com:8080/x?y=1")).toBeNull();
  });

  it.each([
    "not a url",
    "ftp://example.com/x",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "http://localhost:3000/hook",
    "http://foo.localhost/hook",
    "http://printer.local/hook",
    "http://127.0.0.1/hook",
    "http://10.0.0.5/hook",
    "http://192.168.1.10/hook",
    "http://172.20.0.1/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/hook",
    "http://[fd00::1]/hook",
    "http://[::ffff:127.0.0.1]/hook",
  ])("rejects %s", (url) => {
    expect(webhookUrlError(url)).not.toBeNull();
  });

  it("allows private targets only when explicitly enabled (local development)", () => {
    expect(webhookUrlError("http://localhost:4000/hook", true)).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("classifies addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});
