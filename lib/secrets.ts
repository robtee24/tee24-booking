/**
 * Symmetric encryption for third-party credentials stored in the database
 * (per-location Square tokens, webhook signing keys, …).
 *
 * AES-256-GCM with a key derived from `SECRETS_ENCRYPTION_KEY` (preferred) or
 * `AUTH_SECRET` (fallback, so existing deployments work without a new env var).
 * Rotating the key requires re-saving every stored secret.
 *
 * Wire format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`
 */
import crypto from "crypto";

const PREFIX = "v1";

function keyMaterial(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!raw) throw new Error("[secrets] SECRETS_ENCRYPTION_KEY (or AUTH_SECRET) is not set");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, ivB64, tagB64, ctB64] = stored.split(":");
  if (v !== PREFIX || !ivB64 || !tagB64 || !ctB64) throw new Error("[secrets] unrecognised ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Last 4 characters for display ("••••abcd") without revealing the secret. */
export function secretHint(plain: string | null | undefined): string | null {
  if (!plain) return null;
  return plain.length > 4 ? `••••${plain.slice(-4)}` : "••••";
}
