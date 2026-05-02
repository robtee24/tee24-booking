/**
 * Marketing service — audience builder, bulk send, message templates.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { sendQuoSms } from "@/lib/quo";

export type AudienceFilter = {
  locationId?: string;
  organizationId?: string;
  status?: string[]; // ACTIVE, VISITOR, FROZEN, CANCELLED
  membershipPlanIds?: string[];
  tagIds?: string[];
  ageMin?: number;
  ageMax?: number;
  joinedAfter?: Date;
  joinedBefore?: Date;
  /** Only members who haven't visited in N days (at-risk) */
  inactiveDays?: number;
  /** Only members visited within N days */
  visitedWithinDays?: number;
  /** Only members with churn risk score >= threshold */
  churnRiskMin?: number;
  homeLocationId?: string;
  signupSource?: string;
  /** Channel filter — only members opted in for this channel */
  channel: "EMAIL" | "SMS" | "PUSH";
};

/**
 * Compute an audience based on the filter. Returns matching member ids.
 *
 * Always respects per-channel opt-in.
 */
export async function computeAudience(filter: AudienceFilter): Promise<string[]> {
  const prisma = getPrisma();

  const where: any = {};
  if (filter.locationId) where.locationId = filter.locationId;
  if (filter.organizationId) where.organizationId = filter.organizationId;
  if (filter.status?.length) where.status = { in: filter.status };
  if (filter.tagIds?.length) where.memberTags = { some: { tagId: { in: filter.tagIds } } };
  if (filter.homeLocationId) where.homeLocationId = filter.homeLocationId;
  if (filter.signupSource) where.source = filter.signupSource;
  if (filter.joinedAfter || filter.joinedBefore) {
    where.joinDate = {};
    if (filter.joinedAfter) where.joinDate.gte = filter.joinedAfter;
    if (filter.joinedBefore) where.joinDate.lte = filter.joinedBefore;
  }

  // Channel opt-in
  if (filter.channel === "EMAIL") where.optInEmailMarketing = true;
  if (filter.channel === "SMS") where.optInSmsMarketing = true;

  // Age range — derive DOB cutoffs
  if (filter.ageMin != null || filter.ageMax != null) {
    const now = new Date();
    where.dob = {};
    if (filter.ageMin != null) {
      const upper = new Date(now.getFullYear() - filter.ageMin, now.getMonth(), now.getDate());
      where.dob.lte = upper;
    }
    if (filter.ageMax != null) {
      const lower = new Date(now.getFullYear() - filter.ageMax - 1, now.getMonth(), now.getDate());
      where.dob.gte = lower;
    }
  }

  // Membership plan
  if (filter.membershipPlanIds?.length) {
    where.membershipSubscriptions = {
      some: { planId: { in: filter.membershipPlanIds }, status: { in: ["ACTIVE", "FROZEN", "CANCEL_SCHEDULED"] } },
    };
  }

  const select: any = { id: true };
  if (filter.inactiveDays || filter.visitedWithinDays) {
    select.visits = { orderBy: { enteredAt: "desc" }, take: 1, select: { enteredAt: true } };
  }
  if (filter.churnRiskMin != null) {
    select.churnRiskScores = { orderBy: { computedAt: "desc" }, take: 1, select: { score: true } };
  }
  const candidates: any[] = await (prisma.member.findMany({ where, select }) as any);

  const now = Date.now();
  return candidates
    .filter((m: any) => {
      if (filter.inactiveDays != null) {
        const last = m.visits?.[0]?.enteredAt;
        if (!last) return true;
        const days = (now - last.getTime()) / 86_400_000;
        if (days < filter.inactiveDays) return false;
      }
      if (filter.visitedWithinDays != null) {
        const last = m.visits?.[0]?.enteredAt;
        if (!last) return false;
        const days = (now - last.getTime()) / 86_400_000;
        if (days > filter.visitedWithinDays) return false;
      }
      if (filter.churnRiskMin != null) {
        const score = m.churnRiskScores?.[0]?.score ?? 0;
        if (score < filter.churnRiskMin) return false;
      }
      return true;
    })
    .map((m: any) => m.id as string);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function applyTemplate(opts: {
  templateId: string;
  member: any; // hydrated member with relations needed for merge
}): Promise<{ subject: string | null; body: string }> {
  const prisma = getPrisma();
  const tpl = await prisma.messageTemplate.findUnique({ where: { id: opts.templateId } });
  if (!tpl) throw new Error("Template not found");

  const merged = mergeFields(tpl.body, opts.member);
  const subject = tpl.subject ? mergeFields(tpl.subject, opts.member) : null;
  return { subject, body: merged };
}

export function mergeFields(template: string, member: any): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split(".");
    let cur: any = member;
    for (const p of parts) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur == null ? "" : String(cur);
  });
}

// ---------------------------------------------------------------------------
// Bulk send
// ---------------------------------------------------------------------------

export type SendBulkInput = {
  audience: AudienceFilter;
  channel: "EMAIL" | "SMS";
  templateId?: string;
  subject?: string;
  body?: string;
  scheduledFor?: Date;
  actorId?: string;
  organizationId?: string | null;
};

export async function sendBulk(input: SendBulkInput) {
  const prisma = getPrisma();
  const memberIds = await computeAudience({ ...input.audience, channel: input.channel });
  let sent = 0;
  let failed = 0;

  // Hydrate members with the fields needed for merge
  const members = await prisma.member.findMany({
    where: { id: { in: memberIds } },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      membershipType: true, locationId: true, location: { select: { name: true } },
      organizationId: true,
    },
  });

  for (const m of members) {
    try {
      let subject = input.subject ?? null;
      let body = input.body ?? "";
      if (input.templateId) {
        const merged = await applyTemplate({ templateId: input.templateId, member: m });
        subject = merged.subject;
        body = merged.body;
      } else {
        // mergeFields directly from raw subject/body
        if (subject) subject = mergeFields(subject, m);
        body = mergeFields(body, m);
      }

      const msg = await prisma.message.create({
        data: {
          memberId: m.id,
          channel: input.channel,
          direction: "OUTBOUND",
          status: "QUEUED",
          category: "MARKETING",
          subject,
          body,
          toAddress: input.channel === "EMAIL" ? m.email : m.phone,
          sentByAdminId: input.actorId ?? null,
          scheduledFor: input.scheduledFor ?? null,
        },
      });

      if (input.scheduledFor && input.scheduledFor > new Date()) {
        // Will be picked up by the scheduled-send worker
        continue;
      }

      if (input.channel === "EMAIL") {
        await sendEmail({ to: m.email, subject: subject ?? "", html: body });
      } else {
        await sendQuoSms({ to: m.phone, text: body });
      }

      await prisma.message.update({
        where: { id: msg.id },
        data: { status: "SENT" },
      });
      sent++;
    } catch (err: any) {
      failed++;
      console.error("[marketing] send failed for", m.id, err);
    }
  }

  void audit({
    organizationId: input.organizationId ?? null,
    actorId: input.actorId,
    action: "message.bulk-send",
    entityType: "Audience",
    entityId: `bulk_${Date.now()}`,
    after: { audienceSize: memberIds.length, sent, failed, channel: input.channel },
  });

  return { audienceSize: memberIds.length, sent, failed };
}
