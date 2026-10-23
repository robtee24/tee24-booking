/**
 * Member profile photos — stored as bytes in `MemberPhoto`, served by
 * GET /api/members/[id]/photo. `Member.photoUrl` points at that route (with a
 * cache-busting hash) so every existing <img src={photoUrl}> keeps working.
 */
import crypto from "crypto";
import { getPrisma } from "@/lib/db";

const MAX_BYTES = 2 * 1024 * 1024; // the signup form downsizes to ~512px JPEG, so this is generous
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export class PhotoError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Parse a `data:image/...;base64,....` string into bytes. */
export function parseImageDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) throw new PhotoError("Photo must be an image");
  const mimeType = m[1]!.toLowerCase();
  if (!ALLOWED.has(mimeType)) throw new PhotoError("Photo must be a JPEG, PNG or WebP image");
  const buffer = Buffer.from(m[2]!.replace(/\s+/g, ""), "base64");
  if (buffer.byteLength === 0) throw new PhotoError("Photo is empty");
  if (buffer.byteLength > MAX_BYTES) throw new PhotoError("Photo is too large (max 2 MB)");
  return { mimeType, buffer };
}

export function memberPhotoUrl(memberId: string, sha256: string): string {
  return `/api/members/${memberId}/photo?v=${sha256.slice(0, 12)}`;
}

export async function saveMemberPhoto(memberId: string, dataUrl: string): Promise<{ photoUrl: string }> {
  const prisma = getPrisma();
  const { mimeType, buffer } = parseImageDataUrl(dataUrl);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const data = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  await prisma.memberPhoto.upsert({
    where: { memberId },
    create: { memberId, mimeType, sizeBytes: buffer.byteLength, sha256, data },
    update: { mimeType, sizeBytes: buffer.byteLength, sha256, data },
  });
  const photoUrl = memberPhotoUrl(memberId, sha256);
  await prisma.member.update({ where: { id: memberId }, data: { photoUrl } });
  return { photoUrl };
}
