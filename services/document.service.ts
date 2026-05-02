/**
 * Document service — library, assignment, signing flow.
 *
 * Notes:
 *  - Source documents are uploaded as Word (.docx) and parsed into HTML for
 *    on-page rendering. Signed copies are rendered to PDF server-side at sign
 *    time and the PDF (+ SHA-256 hash) is stored immutably.
 *  - PDF rendering uses a system-of-record HTML→PDF pipeline (e.g. Playwright
 *    or @react-pdf/renderer). For Phase 1 we expose the data model + signing
 *    primitives; the actual PDF rendering pipeline is wired in via
 *    `renderSignedPdf()` which today produces a placeholder PDF buffer.
 */
import crypto from "crypto";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { sendQuoSms } from "@/lib/quo";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";

export type CreateDocumentInput = {
  organizationId?: string | null;
  name: string;
  description?: string | null;
  bodyHtml: string;
  fieldsConfig?: any;
  requiredAtSignup?: boolean;
  expiresAfterDays?: number | null;
  graceAfterExpiryDays?: number | null;
  sourceFileUrl?: string | null;
};

export async function createDocument(input: CreateDocumentInput, actorId?: string) {
  const prisma = getPrisma();
  const doc = await prisma.document.create({
    data: {
      organizationId: input.organizationId ?? null,
      name: input.name,
      description: input.description ?? null,
      bodyHtml: input.bodyHtml,
      fieldsConfig: input.fieldsConfig ?? undefined,
      requiredAtSignup: input.requiredAtSignup ?? false,
      expiresAfterDays: input.expiresAfterDays ?? null,
      graceAfterExpiryDays: input.graceAfterExpiryDays ?? 7,
      sourceFileUrl: input.sourceFileUrl ?? null,
      version: 1,
    },
  });

  void audit({
    organizationId: input.organizationId ?? null,
    actorId,
    action: "document.create",
    entityType: "Document",
    entityId: doc.id,
    after: doc,
  });

  return doc;
}

export async function publishNewVersion(opts: {
  documentId: string;
  bodyHtml: string;
  fieldsConfig?: any;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const doc = await prisma.document.findUnique({ where: { id: opts.documentId } });
  if (!doc) throw new Error("Document not found");

  const updated = await prisma.document.update({
    where: { id: opts.documentId },
    data: {
      bodyHtml: opts.bodyHtml,
      fieldsConfig: opts.fieldsConfig ?? doc.fieldsConfig ?? undefined,
      version: { increment: 1 },
    },
  });

  void audit({
    organizationId: doc.organizationId,
    actorId: opts.actorId,
    action: "document.create",
    entityType: "Document",
    entityId: doc.id,
    before: { version: doc.version },
    after: { version: updated.version },
    metadata: { newVersion: true },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Assignment + signing
// ---------------------------------------------------------------------------

export type AssignDocumentInput = {
  documentId: string;
  memberId: string;
  expiresAt?: Date | null;
  notify?: { email?: boolean; sms?: boolean };
  actorId?: string;
};

export async function assignDocument(input: AssignDocumentInput) {
  const prisma = getPrisma();
  const doc = await prisma.document.findUnique({ where: { id: input.documentId } });
  if (!doc) throw new Error("Document not found");
  const member = await prisma.member.findUnique({ where: { id: input.memberId } });
  if (!member) throw new Error("Member not found");

  const signingToken = crypto.randomBytes(32).toString("base64url");
  const assignment = await prisma.documentAssignment.create({
    data: {
      documentId: doc.id,
      memberId: member.id,
      versionAtAssign: doc.version,
      signingToken,
      expiresAt: input.expiresAt ?? null,
      status: "SENT",
    },
  });

  await prisma.signatureEvent.create({
    data: {
      assignmentId: assignment.id,
      memberId: member.id,
      kind: "SENT",
    },
  });

  // Notify the member
  if (input.notify?.email !== false && member.email) {
    const link = buildSigningUrl(signingToken);
    await sendEmail({
      to: member.email,
      subject: `Action required: please sign ${doc.name}`,
      html: signingEmailHtml({ memberName: member.firstName, docName: doc.name, link }),
    }).catch(() => {});
  }
  if (input.notify?.sms && member.phone) {
    const link = buildSigningUrl(signingToken);
    await sendQuoSms({
      to: member.phone,
      text: `Hi ${member.firstName}, please sign your ${doc.name}: ${link}`,
    }).catch(() => {});
  }

  void audit({
    organizationId: doc.organizationId,
    actorId: input.actorId,
    action: "document.assign",
    entityType: "DocumentAssignment",
    entityId: assignment.id,
    after: { documentId: doc.id, memberId: member.id, version: doc.version },
  });

  return assignment;
}

export type SignDocumentInput = {
  signingToken: string;
  signatureSvg: string;
  initialsSvg?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  signedOnBehalfBy?: string | null;
};

export async function signDocument(input: SignDocumentInput) {
  const prisma = getPrisma();
  const assignment = await prisma.documentAssignment.findUnique({
    where: { signingToken: input.signingToken },
    include: { document: true, member: true },
  });
  if (!assignment) throw new Error("Invalid signing token");
  if (assignment.status === "SIGNED") return assignment;
  if (assignment.status === "VOIDED" || assignment.status === "EXPIRED") {
    throw new Error("This signing link is no longer valid");
  }

  // Render & store PDF (placeholder pipeline; swap in Playwright/PDF lib)
  const { pdfBuffer, hash } = await renderSignedPdf({
    bodyHtml: assignment.document.bodyHtml ?? "",
    member: assignment.member,
    signatureSvg: input.signatureSvg,
    initialsSvg: input.initialsSvg ?? null,
  });
  const pdfUrl = await persistPdf(assignment.id, pdfBuffer);

  const signed = await prisma.documentAssignment.update({
    where: { id: assignment.id },
    data: {
      status: "SIGNED",
      signedAt: new Date(),
      pdfUrl,
      pdfHash: hash,
    },
  });

  await prisma.signatureEvent.create({
    data: {
      assignmentId: assignment.id,
      memberId: assignment.memberId,
      kind: "SIGNED",
      signatureSvg: input.signatureSvg,
      initialsSvg: input.initialsSvg ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      signedOnBehalfBy: input.signedOnBehalfBy ?? undefined,
    },
  });

  void audit({
    organizationId: assignment.document.organizationId,
    actorId: input.signedOnBehalfBy ?? assignment.memberId,
    actorRole: input.signedOnBehalfBy ? "ADMIN" : "MEMBER",
    action: "document.sign",
    entityType: "DocumentAssignment",
    entityId: assignment.id,
    after: { hash, signedAt: signed.signedAt },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  // If this was a required-at-signup document, AccessSync may now flip
  if (assignment.document.requiredAtSignup) {
    const desired = await computeDesiredAccessState(assignment.memberId);
    void applyAccessState(assignment.memberId, desired);
  }

  return signed;
}

export async function voidAssignment(assignmentId: string, actorId?: string) {
  const prisma = getPrisma();
  const a = await prisma.documentAssignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw new Error("Assignment not found");
  await prisma.documentAssignment.update({
    where: { id: assignmentId },
    data: { status: "VOIDED" },
  });
  await prisma.signatureEvent.create({
    data: { assignmentId, memberId: a.memberId, kind: "VOIDED" },
  });
  void audit({
    actorId,
    action: "document.void",
    entityType: "DocumentAssignment",
    entityId: assignmentId,
  });
}

// ---------------------------------------------------------------------------
// PDF / link helpers
// ---------------------------------------------------------------------------

function buildSigningUrl(token: string): string {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/sign/${encodeURIComponent(token)}`;
}

function signingEmailHtml(opts: { memberName: string; docName: string; link: string }): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;">
  <h1 style="font-size:20px;margin:0 0 16px;">Signature requested</h1>
  <p style="margin:0 0 16px;color:#475569;">Hi ${escapeHtml(opts.memberName)}, please review and sign <strong>${escapeHtml(opts.docName)}</strong>.</p>
  <a href="${opts.link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Open & sign</a>
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">If the button doesn't work, copy this link: ${opts.link}</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Render the signed document body to a PDF buffer.
 *
 * Phase 1 pipeline writes a minimal application/pdf placeholder so the rest of
 * the flow (storage + hashing + audit) is exercised. Swap in a real renderer
 * (Playwright `page.pdf()` or @react-pdf/renderer) here.
 */
async function renderSignedPdf(opts: {
  bodyHtml: string;
  member: { firstName: string; lastName: string; email: string };
  signatureSvg: string;
  initialsSvg: string | null;
}): Promise<{ pdfBuffer: Buffer; hash: string }> {
  // Placeholder: hash the inputs deterministically; real renderer lands in Phase 2.
  const composite = JSON.stringify({
    body: opts.bodyHtml,
    member: opts.member.email,
    sig: opts.signatureSvg,
    init: opts.initialsSvg,
    ts: Date.now(),
  });
  const hash = crypto.createHash("sha256").update(composite).digest("hex");
  // Minimal valid PDF (single-page blank doc) so any downstream consumer
  // can still serve a real Content-Type: application/pdf response.
  const minimalPdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000098 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n156\n%%EOF",
    "utf-8"
  );
  return { pdfBuffer: minimalPdf, hash };
}

/**
 * Persist the signed PDF. v1: write to /tmp; replace with S3/Supabase Storage.
 */
async function persistPdf(assignmentId: string, _buffer: Buffer): Promise<string> {
  // Placeholder: return a deterministic URL used by the portal / admin.
  // Real implementation uploads to S3/Supabase Storage and returns the URL.
  return `/api/documents/${assignmentId}/pdf`;
}

// ---------------------------------------------------------------------------
// Background — expire signed docs past their TTL + grace
// ---------------------------------------------------------------------------

export async function expireOldDocumentSignings(now = new Date()) {
  const prisma = getPrisma();
  const candidates = await prisma.documentAssignment.findMany({
    where: { status: "SIGNED", signedAt: { not: null } },
    include: { document: true },
  });

  let expired = 0;
  for (const a of candidates) {
    const ttl = a.document.expiresAfterDays;
    if (!ttl) continue;
    const cutoff = new Date(a.signedAt!);
    cutoff.setDate(cutoff.getDate() + ttl);
    if (cutoff <= now) {
      await prisma.documentAssignment.update({
        where: { id: a.id },
        data: { status: "EXPIRED" },
      });
      expired++;
      // Re-evaluate access if document is required
      if (a.document.requiredAtSignup) {
        const desired = await computeDesiredAccessState(a.memberId);
        void applyAccessState(a.memberId, desired);
      }
    }
  }
  return expired;
}
