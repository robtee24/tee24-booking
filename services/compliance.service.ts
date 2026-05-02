/**
 * Compliance workflows.
 *
 * - GDPR / CCPA: member-initiated data export (full personal data) and
 *   deletion request (admin reviews; deletes after billing/legal hold expires).
 * - TCPA: STOP/HELP keyword handling already lives in the Quo webhook receiver;
 *   this service exposes the per-member opt-out + consent log.
 * - Year-end tax summary: total spent during the calendar year for any member,
 *   emailed via Resend.
 *
 * Audit-logged.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { adminNotify } from "@/lib/admin-notify";

export async function buildMemberDataExport(memberId: string): Promise<Record<string, any>> {
  const prisma = getPrisma();
  const [member, contacts, subscriptions, invoices, charges, refunds, visits, docs, notes, messages, tags, credits] = await Promise.all([
    prisma.member.findUnique({ where: { id: memberId } }),
    prisma.emergencyContact.findMany({ where: { memberId } }),
    prisma.membershipSubscription.findMany({ where: { memberId }, include: { plan: true } }),
    prisma.invoice.findMany({ where: { memberId }, include: { lineItems: true } }),
    prisma.charge.findMany({ where: { memberId } }),
    prisma.refund.findMany({ where: { charge: { memberId } } }),
    prisma.visit.findMany({ where: { memberId } }),
    prisma.documentAssignment.findMany({ where: { memberId }, include: { document: { select: { name: true, version: true } } } }),
    prisma.memberNote.findMany({ where: { memberId } }),
    prisma.message.findMany({ where: { memberId } }),
    prisma.memberTag.findMany({ where: { memberId }, include: { tag: true } }),
    prisma.memberCredit.findMany({ where: { memberId } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    member,
    emergencyContacts: contacts,
    memberships: subscriptions,
    invoices,
    payments: { charges, refunds },
    visits,
    documents: docs,
    notes,
    messages,
    tags: tags.map((t) => t.tag.name),
    credits,
  };
}

/** Member-initiated data deletion: marks for deletion, admin must approve. */
export async function requestDataDeletion(opts: {
  memberId: string;
  reason?: string;
  actorId?: string;
}) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: opts.memberId } });
  if (!member) throw new Error("Member not found");

  const task = await prisma.task.create({
    data: {
      title: `Data deletion request: ${member.firstName} ${member.lastName}`,
      body: opts.reason ?? "(no reason supplied)",
      memberId: opts.memberId,
      organizationId: member.organizationId,
      locationId: member.locationId,
      priority: "HIGH",
      createdById: opts.actorId,
    },
  });

  void audit({
    organizationId: member.organizationId,
    actorId: opts.actorId ?? opts.memberId,
    action: "member.update",
    entityType: "DataDeletionRequest",
    entityId: opts.memberId,
    metadata: { taskId: task.id, reason: opts.reason },
  });

  void adminNotify({
    organizationId: member.organizationId,
    locationId: member.locationId,
    kind: "task.assigned",
    severity: "WARN",
    title: `Data deletion request from ${member.firstName} ${member.lastName}`,
    body: opts.reason ?? "No reason supplied",
    link: `/admin/tasks`,
    data: { taskId: task.id, memberId: opts.memberId },
  });

  return { taskId: task.id };
}

/**
 * Final purge: scrub PII while preserving the audit trail. Run by admin after
 * legal/billing hold expires and the deletion task is marked DONE.
 */
export async function purgeMemberPii(memberId: string, actorId: string) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  const scrubbed = `deleted-${memberId.slice(0, 8)}`;
  await prisma.member.update({
    where: { id: memberId },
    data: {
      firstName: "Deleted",
      lastName: "Member",
      fullName: scrubbed,
      email: `${scrubbed}@deleted.local`,
      phone: "0000000000",
      dob: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      zip: null,
      photoUrl: null,
      passwordHash: null,
      kisiUserId: null,
      squareCustomerId: null,
      status: "CANCELLED",
    },
  });

  void audit({
    organizationId: member.organizationId,
    actorId,
    action: "member.delete",
    entityType: "Member",
    entityId: memberId,
    metadata: { gdpr: true },
  });
}

/**
 * Year-end member tax summary: total spent in the calendar year (paid invoices
 * minus refunds), emailed to the member.
 */
export async function sendYearEndSummary(memberId: string, year: number) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const invoices = await prisma.invoice.findMany({
    where: { memberId, paidAt: { gte: start, lt: end }, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
  });
  const totalCents = invoices.reduce((s, i) => s + i.totalCents - i.refundedCents, 0);
  const total = (totalCents / 100).toFixed(2);

  await sendEmail({
    to: member.email,
    subject: `Your ${year} membership summary`,
    html: `
<div style="font-family:-apple-system,Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto">
  <h1 style="margin:0 0 12px;font-size:20px;">Your ${year} summary</h1>
  <p style="margin:0 0 12px;color:#475569;">Hi ${escape(member.firstName)},</p>
  <p style="margin:0 0 12px;color:#475569;">Here's your total membership spending for ${year}:</p>
  <p style="margin:12px 0;font-size:32px;font-weight:600;">$${total}</p>
  <p style="margin:0 0 12px;color:#94a3b8;font-size:12px;">${invoices.length} invoice${invoices.length === 1 ? "" : "s"}.</p>
</div>`,
  });
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
