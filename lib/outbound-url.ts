// lib/outbound-url.ts
//
// Guard for URLs that admins type into the product and the server later
// fetches (automation webhooks, email attachment URLs). Blocks the classic
// SSRF targets: non-http schemes, loopback / link-local / private ranges,
// cloud metadata hosts, and embedded credentials.
import { isIP } from "net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("::ffff:")) {
    // v4-mapped: either dotted (::ffff:10.0.0.1) or, after URL normalisation,
    // two hex groups (::ffff:a00:1).
    const rest = v.slice(7);
    if (rest.includes(".")) return isPrivateIPv4(rest);
    const [hi = "0", lo = "0"] = rest.split(":");
    const n = (parseInt(hi, 16) << 16) | parseInt(lo, 16);
    return isPrivateIPv4(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
  }
  return false;
}

/** Returns null when the URL is safe to fetch, otherwise a human-readable reason. */
export function outboundUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Not a valid URL";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Only http(s) URLs are allowed";
  if (u.username || u.password) return "URLs must not embed credentials";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return "Missing host";
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return "Internal hosts are not allowed";
  }
  const family = isIP(host);
  if (family === 4 && isPrivateIPv4(host)) return "Private network addresses are not allowed";
  if (family === 6 && isPrivateIPv6(host)) return "Private network addresses are not allowed";
  return null;
}

export function isSafeOutboundUrl(raw: string): boolean {
  return outboundUrlProblem(raw) === null;
}
