/**
 * Marketing service — audience builder, bulk send, scheduled sends, message
 * templates, and org-level marketing settings.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { deliverEmail, deliverSms, isQuietHours, nextQuietHoursEnd } from "@/lib/notify";
import type { EmailAttachment } from "@/lib/sendEmail";
import { renderSystemTemplate } from "@/lib/system-templates";
import { buildMemberVars } from "./system-messages.service";
import { LEAD_STAGES, type LeadStage } from "@/lib/chart-data";

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
  /** Explicit member ids (e.g. from a profile page "message" action) */
  memberIds?: string[];
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
  if (filter.memberIds?.length) where.id = { in: filter.memberIds };
  if (filter.status?.length) where.status = { in: filter.status };
  if (filter.tagIds?.length) where.memberTags = { some: { tagId: { in: filter.tagIds } } };
  if (filter.homeLocationId) where.homeLocationId = filter.homeLocationId;
  if (filter.signupSource) where.source = filter.signupSource;
  if (filter.joinedAfter || filter.joinedBefore) {
    where.joinDate = {};
    if (filter.joinedAfter) where.joinDate.gte = filter.joinedAfter;
    if (filter.joinedBefore) where.joinDate.lte = filter.joinedBefore;
  }
  where.mergedIntoId = null;

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

/**
 * Merge fields: supports `{{path.to.value}}` lookups on the member object
 * (legacy) and the `{first_name}` / `{{firstName}}` system-style vars.
 */
export function mergeFields(template: string, member: any, extra?: Record<string, unknown>): string {
  if (!template) return "";
  const pathPass = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path: string) => {
    if (!path.includes(".")) return m; // leave single-key tokens for the var pass
    const parts = path.split(".");
    let cur: any = member;
    for (const p of parts) {
      if (cur == null) return "";
      cur = cur[p];
    }
    return cur == null ? "" : String(cur);
  });
  const vars = buildMemberVars(
    {
      id: member?.id ?? "",
      firstName: member?.firstName ?? "",
      lastName: member?.lastName ?? "",
      email: member?.email ?? "",
      phone: member?.phone ?? "",
      membershipType: member?.membershipType ?? null,
      checkinCode: member?.checkinCode ?? null,
      referralCode: member?.referralCode ?? null,
      location: member?.location ?? null,
    },
    extra,
  );
  return renderSystemTemplate(pathPass, vars);
}

export const MARKETING_MERGE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "plan_name",
  "location_name",
  "portal_url",
  "referral_code",
] as const;

export type TemplateInput = {
  organizationId?: string | null;
  name: string;
  channel: "EMAIL" | "SMS";
  category?: "MARKETING" | "TRANSACTIONAL";
  subject?: string | null;
  body: string;
  active?: boolean;
};

export async function listMarketingTemplates(organizationId: string | null) {
  return getPrisma().messageTemplate.findMany({
    where: {
      category: { not: "SYSTEM" },
      OR: [{ organizationId }, { organizationId: null }],
    },
    orderBy: [{ active: "desc" }, { channel: "asc" }, { name: "asc" }],
  });
}

export async function createTemplate(input: TemplateInput, actorId?: string) {
  const row = await getPrisma().messageTemplate.create({
    data: {
      organizationId: input.organizationId ?? null,
      name: input.name.trim(),
      channel: input.channel,
      category: input.category ?? "MARKETING",
      subject: input.channel === "EMAIL" ? input.subject ?? null : null,
      body: input.body,
      active: input.active ?? true,
    },
  });
  void audit({ actorId, action: "settings.update", entityType: "MessageTemplate", entityId: row.id, after: row });
  return row;
}

export async function updateTemplate(id: string, patch: Partial<TemplateInput>, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!before) throw new Error("Template not found");
  if (before.category === "SYSTEM") throw new Error("Use the Communications settings page to edit system templates");
  const row = await prisma.messageTemplate.update({
    where: { id },
    data: {
      name: patch.name?.trim(),
      channel: patch.channel,
      category: patch.category,
      subject: patch.subject === undefined ? undefined : patch.subject,
      body: patch.body,
      active: patch.active,
    },
  });
  void audit({ actorId, action: "settings.update", entityType: "MessageTemplate", entityId: id, before, after: row });
  return row;
}

export async function deleteTemplate(id: string, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!before) return;
  if (before.category === "SYSTEM") throw new Error("System templates cannot be deleted — turn them off instead");
  await prisma.messageTemplate.delete({ where: { id } });
  void audit({ actorId, action: "settings.update", entityType: "MessageTemplate", entityId: id, before, metadata: { deleted: true } });
}

export async function duplicateTemplate(id: string, actorId?: string) {
  const prisma = getPrisma();
  const src = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!src) throw new Error("Template not found");
  return createTemplate(
    {
      organizationId: src.organizationId,
      name: `${src.name} (copy)`,
      channel: src.channel as "EMAIL" | "SMS",
      category: src.category === "SYSTEM" ? "MARKETING" : (src.category as any),
      subject: src.subject,
      body: src.body,
      active: src.active,
    },
    actorId,
  );
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
  /** Email attachments by URL */
  attachmentUrls?: string[];
  scheduledFor?: Date;
  actorId?: string;
  organizationId?: string | null;
  /** Save the message as a reusable template too */
  saveAsTemplateName?: string;
};

const MEMBER_SEND_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  membershipType: true,
  checkinCode: true,
  referralCode: true,
  locationId: true,
  organizationId: true,
  location: { select: { name: true, slug: true, timezone: true } },
} as const;

function attachmentsFromUrls(urls?: string[]): EmailAttachment[] | undefined {
  if (!urls?.length) return undefined;
  return urls
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .map((u) => ({ filename: decodeURIComponent(u.split("/").pop()?.split("?")[0] || "attachment"), path: u }));
}

export async function sendBulk(input: SendBulkInput) {
  const prisma = getPrisma();
  const memberIds = await computeAudience({ ...input.audience, channel: input.channel });

  if (input.saveAsTemplateName && input.body) {
    await createTemplate(
      { organizationId: input.organizationId ?? null, name: input.saveAsTemplateName, channel: input.channel, subject: input.subject, body: input.body },
      input.actorId,
    ).catch((e) => console.warn("[marketing] save-as-template failed", e));
  }

  // Hydrate members with the fields needed for merge
  const membersRaw = await prisma.member.findMany({ where: { id: { in: memberIds } }, select: MEMBER_SEND_SELECT });

  // Duplicate-recipient removal (same email / phone → send once)
  const seen = new Set<string>();
  const members = membersRaw.filter((m) => {
    const addr = (input.channel === "EMAIL" ? m.email : m.phone)?.trim().toLowerCase();
    if (!addr) return false;
    if (seen.has(addr)) return false;
    seen.add(addr);
    return true;
  });
  const deduped = membersRaw.length - members.length;

  const attachments = input.channel === "EMAIL" ? attachmentsFromUrls(input.attachmentUrls) : undefined;
  let tpl: { subject: string | null; body: string } | null = null;
  if (input.templateId) {
    const t = await prisma.messageTemplate.findUnique({ where: { id: input.templateId } });
    if (!t) throw new Error("Template not found");
    tpl = { subject: t.subject, body: t.body };
  }

  let sent = 0;
  let failed = 0;
  let queued = 0;
  const now = new Date();
  const isScheduled = !!input.scheduledFor && input.scheduledFor > now;

  for (const m of members) {
    try {
      const rawSubject = tpl ? tpl.subject : input.subject ?? null;
      const rawBody = tpl ? tpl.body : input.body ?? "";
      const subject = rawSubject ? mergeFields(rawSubject, m) : null;
      const body = mergeFields(rawBody, m);
      const to = input.channel === "EMAIL" ? m.email : m.phone;

      // Quiet hours for marketing SMS: queue to next morning instead of sending.
      let scheduledFor = isScheduled ? input.scheduledFor! : null;
      if (!scheduledFor && input.channel === "SMS" && isQuietHours(now, m.location?.timezone)) {
        scheduledFor = nextQuietHoursEnd(now, m.location?.timezone);
      }

      const msg = await prisma.message.create({
        data: {
          memberId: m.id,
          channel: input.channel,
          direction: "OUTBOUND",
          status: "QUEUED",
          category: "MARKETING",
          subject,
          body: attachments?.length ? `${body}\n<!--attachments:${JSON.stringify(input.attachmentUrls)}-->` : body,
          toAddress: to,
          templateId: input.templateId ?? null,
          sentByAdminId: input.actorId ?? null,
          scheduledFor,
        },
      });

      if (scheduledFor) {
        queued++;
        continue; // picked up by sendDueScheduledMessages()
      }

      const res =
        input.channel === "EMAIL"
          ? await deliverEmail({ to, subject: subject ?? "", html: body, category: "MARKETING", organizationId: m.organizationId, attachments })
          : await deliverSms({ to, text: body, category: "MARKETING", organizationId: m.organizationId, timeZone: m.location?.timezone });

      if (res.deferredUntil) {
        await prisma.message.update({ where: { id: msg.id }, data: { scheduledFor: res.deferredUntil } });
        queued++;
        continue;
      }
      await prisma.message.update({
        where: { id: msg.id },
        data: { status: res.ok ? "SENT" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null },
      });
      if (res.ok) sent++;
      else failed++;
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
    after: { audienceSize: memberIds.length, sent, failed, queued, deduped, channel: input.channel, scheduledFor: input.scheduledFor ?? null },
  });

  return { audienceSize: memberIds.length, sent, failed, queued, deduped };
}

/**
 * Preview-send to the signed-in admin only. Renders with the first member of
 * the audience (or sample data) so merge fields look real.
 */
export async function sendTestToSelf(input: {
  channel: "EMAIL" | "SMS";
  subject?: string | null;
  body: string;
  templateId?: string;
  attachmentUrls?: string[];
  adminEmail?: string | null;
  adminPhone?: string | null;
  sampleMemberId?: string | null;
  organizationId?: string | null;
}) {
  const prisma = getPrisma();
  let subject = input.subject ?? null;
  let body = input.body;
  if (input.templateId) {
    const t = await prisma.messageTemplate.findUnique({ where: { id: input.templateId } });
    if (t) {
      subject = t.subject;
      body = t.body;
    }
  }
  const sample = input.sampleMemberId
    ? await prisma.member.findUnique({ where: { id: input.sampleMemberId }, select: MEMBER_SEND_SELECT })
    : null;
  const member = sample ?? { firstName: "Jordan", lastName: "Sample", email: input.adminEmail ?? "", phone: input.adminPhone ?? "", membershipType: "Unlimited Monthly", location: { name: "Tee24" } };
  const renderedSubject = subject ? `[TEST] ${mergeFields(subject, member)}` : "[TEST]";
  const rendered = mergeFields(body, member);

  if (input.channel === "EMAIL") {
    if (!input.adminEmail) return { ok: false, error: "Your admin profile has no email address" };
    const res = await deliverEmail({
      to: input.adminEmail,
      subject: renderedSubject,
      html: rendered,
      category: "MARKETING",
      organizationId: input.organizationId,
      attachments: attachmentsFromUrls(input.attachmentUrls),
      force: true,
    });
    return { ok: res.ok, error: res.error, to: input.adminEmail, dryRun: res.dryRun };
  }
  if (!input.adminPhone) return { ok: false, error: "Your admin profile has no phone number" };
  const res = await deliverSms({ to: input.adminPhone, text: `[TEST] ${rendered}`, category: "MARKETING", organizationId: input.organizationId, force: true });
  return { ok: res.ok, error: res.error, to: input.adminPhone, dryRun: res.dryRun };
}

/**
 * Cron: deliver QUEUED outbound messages whose scheduledFor has passed.
 * Suggested schedule: every 5 minutes. Returns number of messages processed.
 */
export async function sendDueScheduledMessages(now = new Date()): Promise<number> {
  const prisma = getPrisma();
  const due = await prisma.message.findMany({
    where: { status: "QUEUED", direction: "OUTBOUND", scheduledFor: { lte: now }, channel: { in: ["EMAIL", "SMS"] } },
    orderBy: { scheduledFor: "asc" },
    take: 200,
    include: { member: { select: { id: true, organizationId: true, optInEmailMarketing: true, optInSmsMarketing: true, location: { select: { timezone: true } } } } },
  });

  let processed = 0;
  for (const m of due) {
    try {
      const category = (m.category as "MARKETING" | "SYSTEM" | "TRANSACTIONAL") ?? "MARKETING";
      // Opt-out may have changed since scheduling — re-check for marketing.
      if (category === "MARKETING" && m.member) {
        const optedIn = m.channel === "EMAIL" ? m.member.optInEmailMarketing : m.member.optInSmsMarketing;
        if (!optedIn) {
          await prisma.message.update({ where: { id: m.id }, data: { status: "UNSUBSCRIBED", scheduledFor: null } });
          processed++;
          continue;
        }
      }
      const to = m.toAddress ?? "";
      let body = m.body;
      let attachments: EmailAttachment[] | undefined;
      const am = body.match(/<!--attachments:(\[.*?\])-->/);
      if (am) {
        try {
          attachments = attachmentsFromUrls(JSON.parse(am[1]));
        } catch {}
        body = body.replace(am[0], "").trim();
      }
      const orgId = m.member?.organizationId ?? null;
      const res =
        m.channel === "EMAIL"
          ? await deliverEmail({ to, subject: m.subject ?? "", html: body, category, organizationId: orgId, attachments })
          : await deliverSms({ to, text: body, category, organizationId: orgId, timeZone: m.member?.location?.timezone });

      if (res.deferredUntil) {
        await prisma.message.update({ where: { id: m.id }, data: { scheduledFor: res.deferredUntil } });
      } else if (res.skipped === "org-disabled") {
        // Leave queued; will retry when org re-enables the channel. Push out 1h to avoid hot loop.
        await prisma.message.update({ where: { id: m.id }, data: { scheduledFor: new Date(now.getTime() + 3_600_000), providerError: res.error ?? null } });
      } else {
        await prisma.message.update({
          where: { id: m.id },
          data: { status: res.ok ? "SENT" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null, scheduledFor: null },
        });
      }
      processed++;
    } catch (err) {
      console.error("[marketing] scheduled send failed", m.id, err);
      await prisma.message.update({ where: { id: m.id }, data: { status: "FAILED", providerError: String((err as any)?.message ?? err) } }).catch(() => {});
    }
  }
  return processed;
}

/** Message history for a location, per channel, with open/click stats. */
export async function messageHistory(opts: { locationId: string; channel?: "EMAIL" | "SMS"; category?: string; take?: number }) {
  const prisma = getPrisma();
  const where: any = { member: { locationId: opts.locationId }, direction: "OUTBOUND" };
  if (opts.channel) where.channel = opts.channel;
  if (opts.category) where.category = opts.category;
  return prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
    include: { member: { select: { id: true, firstName: true, lastName: true } } },
  });
}

// ---------------------------------------------------------------------------
// Org-level marketing settings
//
// Schema is frozen, so settings live as a JSON blob in a MessageTemplate row
// (eventKey "org.marketing-settings", channel "SYSTEM", category "SYSTEM",
// active false). Wrapped here so it can move to a real column later.
// ---------------------------------------------------------------------------

export const DEFAULT_ACQUISITION_SOURCES = [
  "Search engine",
  "Google Maps",
  "Referral",
  "Social media",
  "Online ad",
  "Offline ad",
  "Walk-by",
  "Website",
  "Event",
  "Other",
];

export type MarketingSettings = {
  referral: {
    /** PAYMENT (PayPal payout) or CREDIT (account credit) */
    rewardKind: "PAYMENT" | "CREDIT";
    rewardCents: number;
    /** Auto-approve payouts at month end (otherwise require manual approval) */
    autoApprove: boolean;
    /** Referred member must stay active this many days before reward accrues */
    holdDays: number;
    enabled: boolean;
  };
  sources: string[];
  leadStageLabels: Record<LeadStage, string>;
  quietHours: { enabled: boolean; start: number; end: number };
  complianceText: string;
};

export const DEFAULT_MARKETING_SETTINGS: MarketingSettings = {
  referral: { rewardKind: "CREDIT", rewardCents: 2500, autoApprove: false, holdDays: 30, enabled: true },
  sources: DEFAULT_ACQUISITION_SOURCES,
  leadStageLabels: { NEW: "New", CONTACTED: "Contacted", BOOKED: "Booked", TRIAL: "Trial", CONVERTED: "Converted", LOST: "Lost" },
  quietHours: { enabled: true, start: 21, end: 9 },
  complianceText:
    "Marketing SMS is only sent to members who opted in. Reply STOP to opt out, START to re-subscribe. No marketing texts between 9pm and 9am local time.",
};

const SETTINGS_KEY = "org.marketing-settings";

export async function getMarketingSettings(organizationId: string | null): Promise<MarketingSettings> {
  const row = await getPrisma().messageTemplate.findFirst({
    where: { organizationId: organizationId ?? null, eventKey: SETTINGS_KEY, channel: "SYSTEM" },
  });
  if (!row) return DEFAULT_MARKETING_SETTINGS;
  try {
    const parsed = JSON.parse(row.body) as Partial<MarketingSettings>;
    return {
      referral: { ...DEFAULT_MARKETING_SETTINGS.referral, ...(parsed.referral ?? {}) },
      sources: Array.isArray(parsed.sources) && parsed.sources.length ? parsed.sources : DEFAULT_MARKETING_SETTINGS.sources,
      leadStageLabels: { ...DEFAULT_MARKETING_SETTINGS.leadStageLabels, ...(parsed.leadStageLabels ?? {}) },
      quietHours: { ...DEFAULT_MARKETING_SETTINGS.quietHours, ...(parsed.quietHours ?? {}) },
      complianceText: parsed.complianceText ?? DEFAULT_MARKETING_SETTINGS.complianceText,
    };
  } catch {
    return DEFAULT_MARKETING_SETTINGS;
  }
}

export async function saveMarketingSettings(organizationId: string | null, patch: Partial<MarketingSettings>, actorId?: string) {
  const prisma = getPrisma();
  const current = await getMarketingSettings(organizationId);
  const next: MarketingSettings = {
    referral: { ...current.referral, ...(patch.referral ?? {}) },
    sources: patch.sources ? patch.sources.map((s) => s.trim()).filter(Boolean) : current.sources,
    leadStageLabels: { ...current.leadStageLabels, ...(patch.leadStageLabels ?? {}) },
    quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) },
    complianceText: patch.complianceText ?? current.complianceText,
  };
  for (const s of LEAD_STAGES) if (!next.leadStageLabels[s]) next.leadStageLabels[s] = DEFAULT_MARKETING_SETTINGS.leadStageLabels[s];

  const existing = await prisma.messageTemplate.findFirst({
    where: { organizationId: organizationId ?? null, eventKey: SETTINGS_KEY, channel: "SYSTEM" },
  });
  const body = JSON.stringify(next);
  if (existing) await prisma.messageTemplate.update({ where: { id: existing.id }, data: { body } });
  else
    await prisma.messageTemplate.create({
      data: { organizationId: organizationId ?? null, name: "Marketing settings (internal)", channel: "SYSTEM", category: "SYSTEM", eventKey: SETTINGS_KEY, body, active: false },
    });
  void audit({ organizationId, actorId, action: "settings.update", entityType: "MarketingSettings", entityId: SETTINGS_KEY, before: current, after: next });
  return next;
}
