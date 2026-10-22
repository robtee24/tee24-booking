/**
 * Inbox — two-way SMS/email conversations with members and leads.
 *
 * Schema notes (frozen): Conversation has no assignee or unread columns, so
 *  • "unread" = an INBOUND message in the conversation with openedAt == null
 *    (openedAt is "read by staff" for inbound rows);
 *  • "assignee" is recorded as an INTERNAL-channel Message in the thread
 *    (`body` = "assigned:<adminId>"), latest one wins.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminNotify } from "@/lib/admin-notify";
import { deliverEmail, deliverSms } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import { isOptInMessage, isOptOutMessage } from "@/lib/quo";
import { adminRoutes } from "@/lib/admin/routes";
import { findOrCreateLeadByPhone } from "./lead.service";

export type InboxFilter = {
  locationId: string;
  status?: "OPEN" | "RESOLVED" | "ALL";
  channel?: "EMAIL" | "SMS";
  unreadOnly?: boolean;
  assignedToId?: string;
  search?: string;
  take?: number;
};

const ASSIGN_PREFIX = "assigned:";

export type ConversationSummary = {
  id: string;
  subject: string | null;
  status: string;
  lastMessageAt: Date;
  memberId: string | null;
  visitorId: string | null;
  contactName: string;
  contactAddress: string | null;
  channel: "EMAIL" | "SMS" | "MIXED" | null;
  unread: number;
  preview: string;
  assignedToId: string | null;
};

export async function listConversations(filter: InboxFilter): Promise<ConversationSummary[]> {
  const prisma = getPrisma();
  const where: any = {
    OR: [{ locationId: filter.locationId }, { member: { locationId: filter.locationId } }],
  };
  if (filter.status && filter.status !== "ALL") where.status = filter.status;
  if (filter.channel) where.messages = { some: { channel: filter.channel } };
  if (filter.search) {
    const s = filter.search.trim();
    where.AND = [
      {
        OR: [
          { subject: { contains: s, mode: "insensitive" } },
          { member: { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { lastName: { contains: s, mode: "insensitive" } }, { email: { contains: s, mode: "insensitive" } }, { phone: { contains: s } }] } },
          { messages: { some: { body: { contains: s, mode: "insensitive" } } } },
        ],
      },
    ];
  }
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: filter.take ?? 100,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 25, select: { id: true, channel: true, direction: true, body: true, openedAt: true, subject: true, createdAt: true, toAddress: true, fromAddress: true } },
    },
  });

  const visitorIds = rows.map((r) => r.visitorId).filter((x): x is string => !!x);
  const visitors = visitorIds.length
    ? await prisma.visitor.findMany({ where: { id: { in: visitorIds } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } })
    : [];
  const vById = new Map(visitors.map((v) => [v.id, v]));

  const out: ConversationSummary[] = rows.map((r) => {
    const v = r.visitorId ? vById.get(r.visitorId) : null;
    const name = r.member
      ? `${r.member.firstName} ${r.member.lastName}`.trim()
      : v
        ? `${v.firstName ?? ""} ${v.lastName ?? ""}`.trim() || v.phone || v.email || "Lead"
        : r.messages.find((m) => m.fromAddress)?.fromAddress ?? "Unknown";
    const external = r.messages.filter((m) => m.channel !== "INTERNAL");
    const channels = new Set(external.map((m) => m.channel));
    const channel = channels.size === 0 ? null : channels.size === 1 ? ([...channels][0] as any) : "MIXED";
    const unread = external.filter((m) => m.direction === "INBOUND" && !m.openedAt).length;
    const assign = r.messages.find((m) => m.channel === "INTERNAL" && m.body.startsWith(ASSIGN_PREFIX));
    const latest = external[0];
    return {
      id: r.id,
      subject: r.subject,
      status: r.status,
      lastMessageAt: r.lastMessageAt,
      memberId: r.memberId,
      visitorId: r.visitorId,
      contactName: name,
      contactAddress: r.member ? (channel === "EMAIL" ? r.member.email : r.member.phone) : v ? v.phone ?? v.email ?? null : null,
      channel,
      unread,
      preview: latest ? (latest.subject && latest.channel === "EMAIL" ? latest.subject : latest.body.replace(/<[^>]+>/g, " ").slice(0, 120)) : "",
      assignedToId: assign ? assign.body.slice(ASSIGN_PREFIX.length) || null : null,
    };
  });

  let filtered = out;
  if (filter.unreadOnly) filtered = filtered.filter((c) => c.unread > 0);
  if (filter.assignedToId === "unassigned") filtered = filtered.filter((c) => !c.assignedToId);
  else if (filter.assignedToId) filtered = filtered.filter((c) => c.assignedToId === filter.assignedToId);
  // Unread first, then most recent
  filtered.sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  return filtered;
}

export async function getConversation(id: string) {
  const prisma = getPrisma();
  const c = await prisma.conversation.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, optInSmsMarketing: true, optInEmailMarketing: true, locationId: true, location: { select: { slug: true, name: true } } } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) return null;
  const visitor = c.visitorId ? await prisma.visitor.findUnique({ where: { id: c.visitorId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, stage: true, locationId: true } }) : null;
  const assign = [...c.messages].reverse().find((m) => m.channel === "INTERNAL" && m.body.startsWith(ASSIGN_PREFIX));
  return { ...c, visitor, assignedToId: assign ? assign.body.slice(ASSIGN_PREFIX.length) || null : null };
}

export async function markConversationRead(id: string) {
  const prisma = getPrisma();
  await prisma.message.updateMany({ where: { conversationId: id, direction: "INBOUND", openedAt: null }, data: { openedAt: new Date() } });
}

export async function setConversationStatus(id: string, status: "OPEN" | "RESOLVED", actorId?: string) {
  const prisma = getPrisma();
  const c = await prisma.conversation.update({ where: { id }, data: { status } });
  void audit({ actorId, action: "settings.update", entityType: "Conversation", entityId: id, after: { status } });
  return c;
}

export async function assignConversation(id: string, adminId: string | null, actorId?: string) {
  const prisma = getPrisma();
  await prisma.message.create({
    data: { conversationId: id, channel: "INTERNAL", direction: "OUTBOUND", status: "SENT", category: "SYSTEM", body: `${ASSIGN_PREFIX}${adminId ?? ""}`, sentByAdminId: actorId ?? null },
  });
  if (adminId) {
    const c = await prisma.conversation.findUnique({ where: { id }, select: { subject: true, locationId: true, member: { select: { firstName: true, lastName: true, organizationId: true, location: { select: { slug: true } } } } } });
    void adminNotify({
      organizationId: c?.member?.organizationId ?? null,
      locationId: c?.locationId ?? null,
      kind: "task.assigned",
      title: `Conversation assigned to you${c?.member ? `: ${c.member.firstName} ${c.member.lastName}` : ""}`,
      body: c?.subject ?? undefined,
      data: { conversationId: id, assignedToId: adminId },
    });
  }
}

/** Staff reply in a thread. Channel defaults to the thread's last external channel. */
export async function replyToConversation(
  id: string,
  input: { channel?: "EMAIL" | "SMS"; subject?: string | null; body: string },
  actor: { id: string },
) {
  const prisma = getPrisma();
  const c = await getConversation(id);
  if (!c) throw new Error("Conversation not found");
  const external = [...c.messages].reverse().filter((m) => m.channel === "EMAIL" || m.channel === "SMS");
  const channel = input.channel ?? (external[0]?.channel as "EMAIL" | "SMS" | undefined) ?? "SMS";

  const contact = c.member ?? c.visitor;
  const to = channel === "EMAIL" ? contact?.email : contact?.phone;
  if (!to) throw new Error(`No ${channel === "EMAIL" ? "email address" : "phone number"} on file`);

  const orgId = c.member?.locationId ? (await prisma.location.findUnique({ where: { id: c.member.locationId }, select: { organizationId: true } }))?.organizationId ?? null : null;
  const subject = channel === "EMAIL" ? input.subject ?? (c.subject ? `Re: ${c.subject}` : "Message from Tee24") : null;

  const msg = await prisma.message.create({
    data: { conversationId: id, memberId: c.memberId, channel, direction: "OUTBOUND", status: "QUEUED", category: "TRANSACTIONAL", subject, body: input.body, toAddress: to, sentByAdminId: actor.id },
  });
  const res =
    channel === "EMAIL"
      ? await deliverEmail({ to, subject: subject ?? "", html: input.body.replace(/\n/g, "<br>"), category: "TRANSACTIONAL", organizationId: orgId })
      : await deliverSms({ to, text: input.body, category: "TRANSACTIONAL", organizationId: orgId });
  await prisma.message.update({ where: { id: msg.id }, data: { status: res.ok ? "SENT" : "FAILED", providerId: res.providerId ?? null, providerError: res.ok ? null : res.error ?? null } });
  await prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date(), status: "OPEN" } });
  await markConversationRead(id);
  if (c.visitorId) await prisma.visitor.update({ where: { id: c.visitorId }, data: { lastContactedAt: new Date() } }).catch(() => {});
  void audit({ actorId: actor.id, action: "message.send", entityType: "Conversation", entityId: id, metadata: { channel, ok: res.ok, error: res.error } });
  return { ok: res.ok, error: res.error, messageId: msg.id };
}

/** Start a new conversation with a member from the inbox. */
export async function startConversation(input: { memberId: string; channel: "EMAIL" | "SMS"; subject?: string | null; body: string }, actor: { id: string }) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: input.memberId }, select: { id: true, locationId: true } });
  if (!member) throw new Error("Member not found");
  const convo = await prisma.conversation.create({
    data: { memberId: member.id, locationId: member.locationId, status: "OPEN", subject: input.subject ?? null },
  });
  const res = await replyToConversation(convo.id, input, actor);
  return { ...res, conversationId: convo.id };
}

/**
 * Inbound SMS (from the Quo webhook). Attaches to the right conversation by
 * phone: member first, then lead, else creates a lead. Handles STOP/START.
 */
export async function ingestInboundSms(input: { from: string; to?: string | null; text: string; providerId?: string | null; receivedAt?: Date }) {
  const prisma = getPrisma();
  let from = input.from;
  try { from = toE164(input.from); } catch {}
  const candidates = Array.from(new Set([from, input.from, from.replace(/^\+1/, ""), from.replace(/^\+/, "")]));

  // Idempotency on provider id
  if (input.providerId) {
    const dup = await prisma.message.findFirst({ where: { providerId: input.providerId, direction: "INBOUND" }, select: { id: true } });
    if (dup) return { duplicate: true, messageId: dup.id };
  }

  const member = await prisma.member.findFirst({ where: { phone: { in: candidates }, mergedIntoId: null }, include: { location: { select: { slug: true, organizationId: true } } } });

  // Opt-out / opt-in handling (member only — leads have no consent flags)
  let consentChange: "opt-out" | "opt-in" | null = null;
  if (member) {
    if (isOptOutMessage(input.text)) {
      consentChange = "opt-out";
      await prisma.member.update({ where: { id: member.id }, data: { optInSmsMarketing: false } });
      await prisma.message.updateMany({ where: { memberId: member.id, channel: "SMS", status: "QUEUED", category: "MARKETING" }, data: { status: "UNSUBSCRIBED", scheduledFor: null } });
      await audit({ action: "member.update", entityType: "Member", entityId: member.id, before: { optInSmsMarketing: member.optInSmsMarketing }, after: { optInSmsMarketing: false }, metadata: { source: "quo_inbound_optout" } });
    } else if (isOptInMessage(input.text) && !member.optInSmsMarketing) {
      consentChange = "opt-in";
      await prisma.member.update({ where: { id: member.id }, data: { optInSmsMarketing: true, smsConsentAt: new Date(), smsConsentSource: "quo_inbound_optin" } });
      await audit({ action: "member.update", entityType: "Member", entityId: member.id, before: { optInSmsMarketing: false }, after: { optInSmsMarketing: true }, metadata: { source: "quo_inbound_optin" } });
    }
  }

  let visitor = member ? null : await prisma.visitor.findFirst({ where: { phone: { in: candidates } }, orderBy: { updatedAt: "desc" } });
  if (!member && !visitor) {
    visitor = await findOrCreateLeadByPhone(from, { source: "Inbound SMS" });
  }

  let conversation = await prisma.conversation.findFirst({
    where: member ? { memberId: member.id, status: "OPEN" } : visitor ? { visitorId: visitor.id, status: "OPEN" } : { id: "__none__" },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        memberId: member?.id ?? null,
        visitorId: visitor?.id ?? null,
        locationId: member?.locationId ?? visitor?.locationId ?? null,
        status: "OPEN",
        subject: "SMS",
        lastMessageAt: input.receivedAt ?? new Date(),
      },
    });
  }

  const msg = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      memberId: member?.id ?? null,
      channel: "SMS",
      direction: "INBOUND",
      status: "DELIVERED",
      category: "TRANSACTIONAL",
      body: input.text,
      fromAddress: from,
      toAddress: input.to ?? null,
      providerId: input.providerId ?? null,
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: input.receivedAt ?? new Date(), status: "OPEN" } });
  if (visitor) {
    await prisma.visitorEvent.create({ data: { visitorId: visitor.id, kind: "SMS_RECEIVED", data: { messageId: msg.id } } }).catch(() => {});
  }

  const slug = member?.location?.slug ?? null;
  const name = member ? `${member.firstName} ${member.lastName}` : visitor ? `${visitor.firstName ?? ""} ${visitor.lastName ?? ""}`.trim() || from : from;
  void adminNotify({
    organizationId: member?.organizationId ?? member?.location?.organizationId ?? visitor?.organizationId ?? null,
    locationId: member?.locationId ?? visitor?.locationId ?? null,
    kind: "message.inbound",
    severity: consentChange === "opt-out" ? "WARN" : "INFO",
    title: consentChange === "opt-out" ? `${name} opted out of SMS` : `New SMS from ${name}`,
    body: input.text.slice(0, 160),
    link: slug ? `${adminRoutes.loc.marketing.inbox(slug)}?c=${conversation.id}` : undefined,
    data: { conversationId: conversation.id, messageId: msg.id, memberId: member?.id ?? null, visitorId: visitor?.id ?? null, consentChange },
  });

  return { duplicate: false, messageId: msg.id, conversationId: conversation.id, memberId: member?.id ?? null, visitorId: visitor?.id ?? null, consentChange };
}
