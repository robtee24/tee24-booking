/**
 * Minimal RFC 6238 TOTP implementation.
 *
 * Used for admin 2FA. Avoids adding an external dependency.
 *  - Algorithm: HMAC-SHA1 (most authenticator apps default)
 *  - Period: 30 seconds
 *  - Digits: 6
 */
import crypto from "crypto";

const PERIOD = 30;
const DIGITS = 6;

const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a new base32 secret (160 bits) suitable for TOTP. */
export function generateSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/** Compute the current TOTP code for the given secret. */
export function generateCode(secret: string, atUnixSeconds = Math.floor(Date.now() / 1000)): string {
  const counter = Math.floor(atUnixSeconds / PERIOD);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secret);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verify a code, allowing ±window time-steps for clock drift.
 */
export function verifyCode(secret: string, code: string, window = 1): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (let i = -window; i <= window; i++) {
    if (generateCode(secret, now + i * PERIOD) === code) return true;
  }
  return false;
}

/**
 * Build an otpauth:// URL that authenticator apps can scan as a QR code.
 */
export function buildOtpAuthUrl(opts: { secret: string; account: string; issuer?: string }): string {
  const issuer = opts.issuer ?? "Tee24";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Base32 (RFC 4648) — minimal encode/decode without external deps.
// ---------------------------------------------------------------------------

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(s: string): Buffer {
  const cleaned = s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = RFC4648_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
