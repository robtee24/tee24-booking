/**
 * Leads pipeline (Visitor model).
 *
 * Stages: NEW → CONTACTED → BOOKED → TRIAL → CONVERTED / LOST.
 * Legacy "ENGAGED" rows are treated as CONTACTED (see lib/chart-data normalizeLeadStage).
 *
 * Visitor.tags is a Json string[] of free-form tag names (Tag rows are member-only).
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { deliverEmail, deliverSms } from "@/lib/notify";
import { LEAD_STAGES, normalizeLeadStage, type LeadStage } from "@/lib/chart-data";
import { toE164 } from "@/lib/phone";
import { createMember } from "./member.service";
import { mergeFields } from "./marketing.service";

export type LeadInput = {
  organizationId?: string | null;
  locationId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  stage?: LeadStage;
  notes?: string | null;
  tags?: string[];
  assignedToId?: string | null;
  nextFollowUpAt?: Date | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

export type LeadFilter = {
  locationId: string;
  stage?: LeadStage | "ALL";
  source?: string;
  assignedToId?: string | "unassigned";
  followUp?: "due" | "overdue" | "today" | "none";
  search?: string;
  take?: number;
};

function normPhone(p?: string | null): string | null {
  if (!p) return null;
  try {
    return toE164(p);
  } catch {
    return p.trim() || null;
  }
}

function normEmail(e?: string | null): string | null {
  const v = e?.trim().toLowerCase();
  return v || null;
}

export async function listLeads(filter: LeadFilter) {
  const prisma = getPrisma();
  const where: any = { locationId: filter.locationId };
  if (filter.stage && filter.stage !== "ALL") {
    where.stage = filter.stage === "CONTACTED" ? { in: ["CONTACTED", "ENGAGED"] } : filter.stage;
  }
  if (filter.source) where.source = filter.source;
  if (filter.assignedToId === "unassigned") where.assignedToId = null;
  else if (filter.assignedToId) where.assignedToId = filter.assignedToId;
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  if (filter.followUp === "due") where.nextFollowUpAt = { lte: endOfDay };
  if (filter.followUp === "overdue") where.nextFollowUpAt = { lt: startOfDay };
  if (filter.followUp === "today") where.nextFollowUpAt = { gte: startOfDay, lte: endOfDay };
  if (filter.followUp === "none") where.nextFollowUpAt = null;
  if (filter.search) {
    const s = filter.search.trim();
    where.OR = [
      { firstName: { contains: s, mode: "insensitive" } },
      { lastName: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
      { phone: { contains: s } },
    ];
  }
  const rows = await prisma.visitor.findMany({
    where,
    orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: filter.take ?? 300,
  });
  return rows.map((r) => ({ ...r, stage: normalizeLeadStage(r.stage), tags: Array.isArray(r.tags) ? (r.tags as string[]) : [] }));
}

export async function getLead(id: string) {
  const prisma = getPrisma();
  const v = await prisma.visitor.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (!v) return null;
  const [conversations, member] = await Promise.all([
    prisma.conversation.findMany({ where: { visitorId: id }, include: { messages: { orderBy: { createdAt: "desc" }, take: 50 } } }),
    v.convertedToMemberId ? prisma.member.findUnique({ where: { id: v.convertedToMemberId }, select: { id: true, firstName: true, lastName: true, status: true } }) : null,
  ]);
  const messages = conversations.flatMap((c) => c.messages).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { ...v, stage: normalizeLeadStage(v.stage), tags: Array.isArray(v.tags) ? (v.tags as string[]) : [], messages, member };
}

export async function createLead(input: LeadInput, actorId?: string) {
  const prisma = getPrisma();
  const lead = await prisma.visitor.create({
    data: {
      organizationId: input.organizationId ?? null,
      locationId: input.locationId,
      stage: input.stage ?? "NEW",
      source: input.source?.trim() || null,
      firstName: input.firstName?.trim() || null,
      lastName: input.lastName?.trim() || null,
      email: normEmail(input.email),
      phone: normPhone(input.phone),
      notes: input.notes?.trim() || null,
      tags: input.tags?.length ? input.tags : undefined,
      assignedToId: input.assignedToId || null,
      nextFollowUpAt: input.nextFollowUpAt ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
    },
  });
  await prisma.visitorEvent.create({ data: { visitorId: lead.id, kind: "CREATED", data: { by: actorId ?? "system", source: lead.source } } });
  void audit({ organizationId: input.organizationId ?? null, actorId, action: "member.create", entityType: "Visitor", entityId: lead.id, after: lead });
  void emitMemberEvent("lead.created", {
    visitorId: lead.id,
    locationId: lead.locationId,
    organizationId: lead.organizationId,
    actorAdminId: actorId,
    vars: { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, source: lead.source },
  });
  return lead;
}

export async function updateLead(id: string, patch: Partial<LeadInput>, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.visitor.findUnique({ where: { id } });
  if (!before) throw new Error("Lead not found");
  const data: any = {};
  if (patch.firstName !== undefined) data.firstName = patch.firstName?.trim() || null;
  if (patch.lastName !== undefined) data.lastName = patch.lastName?.trim() || null;
  if (patch.email !== undefined) data.email = normEmail(patch.email);
  if (patch.phone !== undefined) data.phone = normPhone(patch.phone);
  if (patch.source !== undefined) data.source = patch.source?.trim() || null;
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;
  if (patch.tags !== undefined) data.tags = patch.tags ?? [];
  if (patch.assignedToId !== undefined) data.assignedToId = patch.assignedToId || null;
  if (patch.nextFollowUpAt !== undefined) data.nextFollowUpAt = patch.nextFollowUpAt;
  if (patch.stage !== undefined && (LEAD_STAGES as readonly string[]).includes(patch.stage)) data.stage = patch.stage;

  const after = await prisma.visitor.update({ where: { id }, data });
  if (patch.stage && normalizeLeadStage(before.stage) !== patch.stage) {
    await prisma.visitorEvent.create({ data: { visitorId: id, kind: "STAGE_CHANGED", data: { from: normalizeLeadStage(before.stage), to: patch.stage, by: actorId ?? "system" } } });
  }
  void audit({ organizationId: before.organizationId, actorId, action: "member.update", entityType: "Visitor", entityId: id, before, after });
  return after;
}

export async function deleteLead(id: string, actorId?: string) {
  const prisma = getPrisma();
  const before = await prisma.visitor.findUnique({ where: { id } });
  if (!before) return;
  await prisma.visitor.delete({ where: { id } });
  void audit({ organizationId: before.organizationId, actorId, action: "member.delete", entityType: "Visitor", entityId: id, before });
}

export const LEAD_ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "SMS", "VISIT", "TOUR", "MEETING", "OTHER"] as const;

export async function logLeadActivity(id: string, input: { kind: string; note?: string | null; nextFollowUpAt?: Date | null; stage?: LeadStage }, actorId?: string) {
  const prisma = getPrisma();
  const ev = await prisma.visitorEvent.create({ data: { visitorId: id, kind: input.kind.toUpperCase(), data: { note: input.note ?? null, by: actorId ?? "system" } } });
  const data: any = { lastContactedAt: new Date() };
  if (input.nextFollowUpAt !== undefined) data.nextFollowUpAt = input.nextFollowUpAt;
  if (input.stage) data.stage = input.stage;
  await prisma.visitor.update({ where: { id }, data });
  return ev;
}

/** Quick SMS/email to a lead. Logs a Message on a Conversation with visitorId. */
export async function messageLead(
  id: string,
  input: { channel: "EMAIL" | "SMS"; subject?: string | null; body: string },
  actor: { id: string },
) {
  const prisma = getPrisma();
  const lead = await prisma.visitor.findUnique({ where: { id }, include: { location: { select: { name: true, slug: true, timezone: true, organizationId: true } } } });
  if (!lead) throw new Error("Lead not found");
  const to = input.channel === "EMAIL" ? lead.email : lead.phone;
  if (!to) throw new Error(input.channel === "EMAIL" ? "Lead has no email" : "Lead has no phone");

  const pseudoMember = { firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", email: lead.email ?? "", phone: lead.phone ?? "", location: lead.location };
  const subject = input.subject ? mergeFields(input.subject, pseudoMember) : null;
  const body = mergeFields(input.body, pseudoMember);

  let convo = await prisma.conversation.findFirst({ where: { visitorId: id, status: "OPEN" }, orderBy: { lastMessageAt: "desc" } });
  if (!convo) {
    convo = await prisma.conversation.create({ data: { visitorId: id, locationId: lead.locationId, status: "OPEN", subject: subject ?? `Lead: ${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() } });
  }
  const msg = await prisma.message.create({
    data: { conversationId: convo.id, channel: input.channel, direction: "OUTBOUND", status: "QUEUED", category: "TRANSACTIONAL", subject, body, toAddress: to, sentByAdminId: actor.id },
  });
  const orgId = lead.organizationId ?? lead.location?.organizationId ?? null;
  const res =
    input.channel === "EMAIL"
      ? await deliverEmail({ to, subject: subject ?? "", html: body, category: "TRANSACTIONAL", organizationId: orgId })
      : await deliverSms({ to, text: body, category: "TRANSACTIONAL", organizationId: orgId, timeZone: lead.location?.timezone });
  await prisma.message.update({ where: { id: msg.id }, data: { status: res.ok ? "SENT" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null } });
  await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });
  await prisma.visitorEvent.create({ data: { visitorId: id, kind: input.channel === "EMAIL" ? "EMAIL_SENT" : "SMS_SENT", data: { messageId: msg.id, by: actor.id, ok: res.ok } } });
  const stage = normalizeLeadStage(lead.stage);
  await prisma.visitor.update({ where: { id }, data: { lastContactedAt: new Date(), ...(stage === "NEW" ? { stage: "CONTACTED" } : {}) } });
  void audit({ organizationId: orgId, actorId: actor.id, action: "message.send", entityType: "Visitor", entityId: id, metadata: { channel: input.channel, ok: res.ok, error: res.error } });
  return { ok: res.ok, error: res.error, messageId: msg.id, conversationId: convo.id };
}

/** Convert a lead to a Member (via member.service.createMember). */
export async function convertLead(
  id: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string; status?: "PENDING" | "ACTIVE" | "VISITOR"; optInSmsMarketing?: boolean },
  actorId?: string,
) {
  const prisma = getPrisma();
  const lead = await prisma.visitor.findUnique({ where: { id } });
  if (!lead) throw new Error("Lead not found");
  if (lead.convertedToMemberId) throw new Error("Lead already converted");
  if (!lead.locationId) throw new Error("Lead has no location");
  const firstName = input.firstName ?? lead.firstName;
  const lastName = input.lastName ?? lead.lastName;
  const email = normEmail(input.email ?? lead.email);
  const phone = normPhone(input.phone ?? lead.phone);
  if (!firstName || !lastName || !email || !phone) throw new Error("First name, last name, email and phone are required to create a member");

  const existing = await prisma.member.findUnique({ where: { locationId_email: { locationId: lead.locationId, email } } });
  const member =
    existing ??
    (await createMember({
      organizationId: lead.organizationId,
      locationId: lead.locationId,
      firstName,
      lastName,
      email,
      phone,
      source: lead.source ? `lead:${lead.source}` : "LEAD",
      status: input.status ?? "PENDING",
      optInEmailMarketing: true,
      optInSmsMarketing: input.optInSmsMarketing ?? false,
      actorId,
    }));

  await prisma.visitor.update({ where: { id }, data: { stage: "CONVERTED", convertedToMemberId: member.id } });
  await prisma.visitorEvent.create({ data: { visitorId: id, kind: "CONVERTED", data: { memberId: member.id, by: actorId ?? "system", existingMember: !!existing } } });
  // Carry lead conversations over to the member
  await prisma.conversation.updateMany({ where: { visitorId: id, memberId: null }, data: { memberId: member.id } });
  await prisma.message.updateMany({ where: { conversation: { visitorId: id }, memberId: null }, data: { memberId: member.id } });

  if (!existing) {
    void emitMemberEvent("member.created", { memberId: member.id, visitorId: id, locationId: lead.locationId, organizationId: lead.organizationId, actorAdminId: actorId, vars: { source: lead.source } });
  }
  return { member, existingMember: !!existing };
}

/** CSV import: columns firstName,lastName,email,phone,source,stage,notes,tags,nextFollowUpAt (header row required; case-insensitive). */
export async function importLeadsCsv(csv: string, ctx: { locationId: string; organizationId?: string | null; defaultSource?: string }, actorId?: string) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { created: 0, skipped: 0, errors: ["CSV needs a header row and at least one data row"] };
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const col = {
    first: idx(["firstname", "first", "fname"]),
    last: idx(["lastname", "last", "lname"]),
    name: idx(["name", "fullname"]),
    email: idx(["email", "emailaddress"]),
    phone: idx(["phone", "mobile", "phonenumber", "cell"]),
    source: idx(["source", "leadsource"]),
    stage: idx(["stage", "status"]),
    notes: idx(["notes", "note", "comments"]),
    tags: idx(["tags", "tag"]),
    follow: idx(["nextfollowupat", "followup", "nextfollowup", "followupdate"]),
  };
  const prisma = getPrisma();
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (c: number) => (c >= 0 ? cells[c]?.trim() ?? "" : "");
    let first = get(col.first);
    let last = get(col.last);
    if (!first && !last && col.name >= 0) {
      const parts = get(col.name).split(/\s+/);
      first = parts.shift() ?? "";
      last = parts.join(" ");
    }
    const email = normEmail(get(col.email));
    const phone = normPhone(get(col.phone));
    if (!email && !phone && !first) {
      skipped++;
      continue;
    }
    // Skip duplicates by email/phone at this location
    const dup = await prisma.visitor.findFirst({
      where: { locationId: ctx.locationId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
      select: { id: true },
    });
    if (dup && (email || phone)) {
      skipped++;
      continue;
    }
    const stageRaw = get(col.stage).toUpperCase();
    const stage = (LEAD_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as LeadStage) : stageRaw === "ENGAGED" ? "CONTACTED" : "NEW";
    const followRaw = get(col.follow);
    const follow = followRaw ? new Date(followRaw) : null;
    try {
      await createLead(
        {
          organizationId: ctx.organizationId ?? null,
          locationId: ctx.locationId,
          firstName: first || null,
          lastName: last || null,
          email,
          phone,
          source: get(col.source) || ctx.defaultSource || "Import",
          stage,
          notes: get(col.notes) || null,
          tags: get(col.tags) ? get(col.tags).split(/[;|,]/).map((t) => t.trim()).filter(Boolean) : undefined,
          nextFollowUpAt: follow && !isNaN(follow.getTime()) ? follow : null,
        },
        actorId,
      );
      created++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e?.message ?? e}`);
    }
  }
  return { created, skipped, errors };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Find or create a lead for an unknown inbound phone number (used by the Quo webhook). */
export async function findOrCreateLeadByPhone(phone: string, ctx: { locationId?: string | null; organizationId?: string | null; source?: string }) {
  const prisma = getPrisma();
  const normalized = normPhone(phone) ?? phone;
  const existing = await prisma.visitor.findFirst({ where: { phone: { in: [normalized, phone] } }, orderBy: { updatedAt: "desc" } });
  if (existing) return existing;
  let locationId = ctx.locationId ?? null;
  if (!locationId) {
    const loc = await prisma.location.findFirst({ where: { disabled: false }, orderBy: { name: "asc" }, select: { id: true, organizationId: true } });
    locationId = loc?.id ?? null;
    if (!ctx.organizationId) ctx.organizationId = loc?.organizationId ?? null;
  }
  if (!locationId) return null;
  return createLead({ locationId, organizationId: ctx.organizationId ?? null, phone: normalized, source: ctx.source ?? "Inbound SMS", stage: "CONTACTED" });
}
