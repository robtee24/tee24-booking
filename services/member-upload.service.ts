/**
 * Member uploads — files a member submits for staff review, e.g. the ID that
 * backs a service / student / senior discount. Stored as bytes in
 * `MemberUpload`, served by GET /api/admin/members/[id]/uploads/[uploadId].
 */
import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

export class UploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Parse a `data:<mime>;base64,....` string into bytes (images or PDF). */
export function parseUploadDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) throw new UploadError("Upload must be an image or PDF");
  const mimeType = m[1]!.toLowerCase();
  if (!ALLOWED.has(mimeType)) throw new UploadError("Upload must be a JPEG, PNG, WebP, HEIC or PDF file");
  const buffer = Buffer.from(m[2]!.replace(/\s+/g, ""), "base64");
  if (buffer.byteLength === 0) throw new UploadError("Upload is empty");
  if (buffer.byteLength > MAX_BYTES) throw new UploadError("Upload is too large (max 6 MB)");
  return { mimeType, buffer };
}

export async function saveMemberUpload(input: { memberId: string; kind: "PROMO_ID"; label?: string | null; discountId?: string | null; dataUrl: string }) {
  const prisma = getPrisma();
  const { mimeType, buffer } = parseUploadDataUrl(input.dataUrl);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const data = new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  return prisma.memberUpload.create({
    data: { memberId: input.memberId, kind: input.kind, label: input.label ?? null, discountId: input.discountId ?? null, mimeType, sizeBytes: buffer.byteLength, sha256, data },
    select: { id: true, kind: true, label: true, mimeType: true, sizeBytes: true, status: true, createdAt: true },
  });
}

export async function reviewMemberUpload(uploadId: string, status: "APPROVED" | "REJECTED", actorId: string, notes?: string | null) {
  const prisma = getPrisma();
  const before = await prisma.memberUpload.findUnique({ where: { id: uploadId }, select: { id: true, status: true, memberId: true, member: { select: { organizationId: true } } } });
  if (!before) throw new UploadError("Upload not found", 404);
  const updated = await prisma.memberUpload.update({
    where: { id: uploadId },
    data: { status, reviewedById: actorId, reviewedAt: new Date(), reviewNotes: notes?.trim() || null },
    select: { id: true, kind: true, label: true, mimeType: true, sizeBytes: true, status: true, createdAt: true, reviewedAt: true, reviewNotes: true, discountId: true },
  });
  void audit({ organizationId: before.member.organizationId, actorId, action: "member.upload-review", entityType: "MemberUpload", entityId: uploadId, before: { status: before.status }, after: { status }, metadata: { memberId: before.memberId, notes: notes ?? null } });
  return updated;
}
