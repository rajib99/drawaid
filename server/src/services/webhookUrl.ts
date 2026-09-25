import net from "net";

/** True for loopback, link-local, private and otherwise non-routable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped. WHATWG URL normalises the dotted form to hex ("::ffff:7f00:1"), so handle both.
      const rest = lower.slice(7);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return isPrivateAddress(rest);
    }
    return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }
  return false;
}

/**
 * Validates a webhook URL supplied by a business. Returns an error message,
 * or null if acceptable. This is the first line of defence against SSRF; the
 * webhook sender re-checks the resolved IP at delivery time.
 */
export function webhookUrlError(value: string, allowPrivate = false): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "webhookUrl must be a valid URL";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "webhookUrl must start with http:// or https://";
  }
  if (url.username || url.password) {
    return "webhookUrl must not contain credentials";
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return "webhookUrl must be publicly reachable";
    }
    if (isPrivateAddress(host)) {
      return "webhookUrl must be publicly reachable";
    }
  }
  return null;
}
