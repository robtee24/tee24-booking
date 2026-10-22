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
import { resolveMemberByAddress } from "@/lib/message-ledger";
import { defaultReplyTo, parseReplyAddress, threadReplyTo } from "@/lib/inbound-email";
import { findOrCreateLeadByEmail, findOrCreateLeadByPhone } from "./lead.service";

export type InboxFilter = {
  /** Single location (location-scoped inbox). */
  locationId?: string;
  /** Several locations (org inbox). `undefined` with no locationId = every location. */
  locationIds?: string[];
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
  locationId: string | null;
  locationSlug: string | null;
  locationName: string | null;
};

export async function listConversations(filter: InboxFilter): Promise<ConversationSummary[]> {
  const prisma = getPrisma();
  const locIds = filter.locationId ? [filter.locationId] : filter.locationIds;
  const where: any = locIds
    ? { OR: [{ locationId: { in: locIds } }, { member: { locationId: { in: locIds } } }] }
    : {};
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
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, locationId: true, location: { select: { id: true, slug: true, name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 25, select: { id: true, channel: true, direction: true, body: true, openedAt: true, subject: true, createdAt: true, toAddress: true, fromAddress: true } },
    },
  });

  // Conversations without a member carry only a locationId — resolve those in one query.
  const bareLocIds = Array.from(new Set(rows.filter((r) => !r.member && r.locationId).map((r) => r.locationId as string)));
  const bareLocs = bareLocIds.length ? await prisma.location.findMany({ where: { id: { in: bareLocIds } }, select: { id: true, slug: true, name: true } }) : [];
  const locById = new Map(bareLocs.map((l) => [l.id, l]));

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
    const channel = channels.size === 0 ? null : channels.size === 1 ? ([...channels][0] as "EMAIL" | "SMS") : "MIXED";
    const unread = external.filter((m) => m.direction === "INBOUND" && !m.openedAt).length;
    const assign = r.messages.find((m) => m.channel === "INTERNAL" && m.body.startsWith(ASSIGN_PREFIX));
    const latest = external[0];
    const loc = r.member?.location ?? (r.locationId ? locById.get(r.locationId) ?? null : null);
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
      locationId: loc?.id ?? r.locationId ?? null,
      locationSlug: loc?.slug ?? null,
      locationName: loc?.name ?? null,
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
      ? await deliverEmail({ to, subject: subject ?? "", html: input.body.replace(/\n/g, "<br>"), category: "TRANSACTIONAL", organizationId: orgId, ledger: false, replyTo: threadReplyTo(id) })
      : await deliverSms({ to, text: input.body, category: "TRANSACTIONAL", organizationId: orgId, ledger: false });
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
      locationId: member?.locationId ?? visitor?.locationId ?? null,
      source: "inbound.sms",
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

/**
 * Inbound email (from the Resend `email.received` webhook). Threads by the
 * `reply+<conversationId>@` address when present, otherwise by the sender's
 * member/lead record. Unknown senders become leads so nothing is lost.
 */
export async function ingestInboundEmail(input: {
  from: string;
  fromName?: string | null;
  to: string[];
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  providerId?: string | null;
  messageId?: string | null;
  receivedAt?: Date;
  /** Message.source tag (default "inbound.email"). */
  source?: string;
  /** Lead source label when a new lead is created (default "Inbound email"). */
  leadSource?: string;
  /** Location hint (e.g. the website form's "Preferred location"). */
  locationId?: string | null;
  /** Phone supplied alongside the email (website forms) — stored on a new lead. */
  phone?: string | null;
}) {
  const prisma = getPrisma();
  const from = input.from.trim().toLowerCase();

  if (input.providerId) {
    const dup = await prisma.message.findFirst({ where: { providerId: input.providerId, direction: "INBOUND" }, select: { id: true } });
    if (dup) return { duplicate: true as const, messageId: dup.id };
  }

  const threadId = parseReplyAddress(input.to);
  let conversation = threadId
    ? await prisma.conversation.findUnique({ where: { id: threadId }, include: { member: { select: { id: true, locationId: true, organizationId: true } } } })
    : null;

  let memberId = conversation?.memberId ?? null;
  let locationId = conversation?.locationId ?? conversation?.member?.locationId ?? input.locationId ?? null;
  let organizationId = conversation?.member?.organizationId ?? null;
  let visitorId = conversation?.visitorId ?? null;

  if (!memberId && !visitorId) {
    const member = (await resolveMemberByAddress("EMAIL", from, locationId)) ?? (input.phone ? await resolveMemberByAddress("SMS", input.phone, locationId) : null);
    if (member) {
      memberId = member.id;
      locationId = locationId ?? member.locationId;
      organizationId = member.organizationId;
    } else {
      const lead = await findOrCreateLeadByEmail(from, { locationId, organizationId, source: input.leadSource ?? "Inbound email", name: input.fromName ?? null, phone: input.phone ?? null });
      if (lead) {
        visitorId = lead.id;
        locationId = locationId ?? lead.locationId;
        organizationId = organizationId ?? lead.organizationId ?? null;
      }
    }
  }

  if (!conversation) {
    conversation = await prisma.conversation.findFirst({
      where: memberId ? { memberId, status: "OPEN" } : visitorId ? { visitorId, status: "OPEN" } : { id: "__none__" },
      orderBy: { lastMessageAt: "desc" },
      include: { member: { select: { id: true, locationId: true, organizationId: true } } },
    });
  }
  const receivedAt = input.receivedAt ?? new Date();
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        memberId,
        visitorId,
        locationId,
        status: "OPEN",
        subject: input.subject?.trim() || "Email",
        lastMessageAt: receivedAt,
      },
      include: { member: { select: { id: true, locationId: true, organizationId: true } } },
    });
  }

  const body = (input.html && input.html.trim()) || (input.text ?? "").replace(/\n/g, "<br>") || "(empty message)";
  const msg = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      memberId,
      locationId,
      channel: "EMAIL",
      direction: "INBOUND",
      status: "DELIVERED",
      category: "TRANSACTIONAL",
      subject: input.subject ?? null,
      body,
      fromAddress: from,
      toAddress: input.to[0] ?? null,
      providerId: input.providerId ?? null,
      source: input.source ?? "inbound.email",
    },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: receivedAt, status: "OPEN" } });
  if (visitorId) {
    await prisma.visitorEvent.create({ data: { visitorId, kind: input.source === "website.contact" ? "FORM_SUBMITTED" : "EMAIL_RECEIVED", data: { messageId: msg.id } } }).catch(() => {});
  }

  const member = memberId ? await prisma.member.findUnique({ where: { id: memberId }, select: { firstName: true, lastName: true, location: { select: { slug: true } } } }) : null;
  const name = member ? `${member.firstName} ${member.lastName}`.trim() : input.fromName || from;
  void adminNotify({
    organizationId,
    locationId,
    kind: "message.inbound",
    severity: "INFO",
    title: `New email from ${name}`,
    body: (input.subject ? `${input.subject} — ` : "") + (input.text ?? "").replace(/\s+/g, " ").slice(0, 160),
    link: member?.location?.slug ? `${adminRoutes.loc.marketing.inbox(member.location.slug)}?c=${conversation.id}` : `${adminRoutes.inbox()}?c=${conversation.id}`,
    data: { conversationId: conversation.id, messageId: msg.id, memberId, visitorId },
  });

  return { duplicate: false as const, messageId: msg.id, conversationId: conversation.id, memberId, visitorId };
}

/* ------------------------------------------------------------------ */
/* Flat message log — every email/SMS, in or out, member or not.       */
/* ------------------------------------------------------------------ */

export type MessageLogFilter = {
  locationIds?: string[]; // undefined = all
  channel?: "EMAIL" | "SMS";
  direction?: "INBOUND" | "OUTBOUND";
  status?: string;
  category?: "TRANSACTIONAL" | "MARKETING" | "SYSTEM";
  source?: string;
  memberId?: string;
  search?: string;
  /** ISO date (inclusive) */
  from?: Date;
  to?: Date;
  take?: number;
  /** Cursor = createdAt ISO of the last row seen (keyset pagination). */
  before?: Date;
};

export type MessageLogRow = {
  id: string;
  createdAt: Date;
  channel: string;
  direction: string;
  status: string;
  category: string;
  source: string | null;
  subject: string | null;
  preview: string;
  toAddress: string | null;
  fromAddress: string | null;
  providerError: string | null;
  conversationId: string | null;
  sentByAdminName: string | null;
  automation: boolean;
  member: { id: string; firstName: string; lastName: string; email: string; phone: string | null; locationSlug: string | null } | null;
  /** Lead (Visitor) on the thread when there is no member. */
  lead: { id: string; name: string | null; stage: string } | null;
  location: { id: string; slug: string; name: string } | null;
};

export async function listMessages(filter: MessageLogFilter): Promise<{ items: MessageLogRow[]; nextBefore: string | null }> {
  const prisma = getPrisma();
  const take = Math.min(Math.max(filter.take ?? 100, 1), 500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { channel: { in: ["EMAIL", "SMS"] } };
  if (filter.locationIds) {
    where.OR = [{ locationId: { in: filter.locationIds } }, { member: { locationId: { in: filter.locationIds } } }];
  }
  if (filter.channel) where.channel = filter.channel;
  if (filter.direction) where.direction = filter.direction;
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  if (filter.source) where.source = filter.source;
  if (filter.memberId) where.memberId = filter.memberId;
  if (filter.from || filter.to || filter.before) {
    where.createdAt = {};
    if (filter.from) where.createdAt.gte = filter.from;
    if (filter.to) where.createdAt.lte = filter.to;
    if (filter.before) where.createdAt.lt = filter.before;
  }
  if (filter.search) {
    const q = filter.search.trim();
    const and = [
      {
        OR: [
          { subject: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
          { toAddress: { contains: q, mode: "insensitive" } },
          { fromAddress: { contains: q, mode: "insensitive" } },
          { member: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } },
        ],
      },
    ];
    where.AND = and;
  }

  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, locationId: true, location: { select: { id: true, slug: true, name: true } } } },
      conversation: { select: { visitorId: true } },
    },
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  const bareLocIds = Array.from(new Set(page.filter((r) => !r.member && r.locationId).map((r) => r.locationId as string)));
  const bareLocs = bareLocIds.length ? await prisma.location.findMany({ where: { id: { in: bareLocIds } }, select: { id: true, slug: true, name: true } }) : [];
  const locById = new Map(bareLocs.map((l) => [l.id, l]));
  const adminIds = Array.from(new Set(page.map((m) => m.sentByAdminId).filter(Boolean))) as string[];
  const admins = adminIds.length ? await prisma.admin.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }) : [];
  const adminName = new Map(admins.map((a) => [a.id, a.name]));
  const visitorIds = Array.from(new Set(page.filter((m) => !m.member && m.conversation?.visitorId).map((m) => m.conversation!.visitorId as string)));
  const visitors = visitorIds.length ? await prisma.visitor.findMany({ where: { id: { in: visitorIds } }, select: { id: true, firstName: true, lastName: true, stage: true } }) : [];
  const visitorById = new Map(visitors.map((v) => [v.id, v]));

  const items: MessageLogRow[] = page.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    channel: m.channel,
    direction: m.direction,
    status: m.status,
    category: m.category,
    source: m.source,
    subject: m.subject,
    preview: previewOf(m.body),
    toAddress: m.toAddress,
    fromAddress: m.fromAddress,
    providerError: m.providerError,
    conversationId: m.conversationId,
    sentByAdminName: m.sentByAdminId ? adminName.get(m.sentByAdminId) ?? "Staff" : null,
    automation: !!m.sentByAutomationId,
    member: m.member
      ? { id: m.member.id, firstName: m.member.firstName, lastName: m.member.lastName, email: m.member.email, phone: m.member.phone, locationSlug: m.member.location?.slug ?? null }
      : null,
    lead: (() => {
      const v = !m.member && m.conversation?.visitorId ? visitorById.get(m.conversation.visitorId) : null;
      return v ? { id: v.id, name: `${v.firstName ?? ""} ${v.lastName ?? ""}`.trim() || null, stage: v.stage } : null;
    })(),
    location: m.member?.location ?? (m.locationId ? locById.get(m.locationId) ?? null : null),
  }));
  return { items, nextBefore: hasMore ? page[page.length - 1].createdAt.toISOString() : null };
}

export async function getMessage(id: string) {
  const prisma = getPrisma();
  const m = await prisma.message.findUnique({
    where: { id },
    include: { member: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, locationId: true, location: { select: { id: true, slug: true, name: true } } } } },
  });
  if (!m) return null;
  const admin = m.sentByAdminId ? await prisma.admin.findUnique({ where: { id: m.sentByAdminId }, select: { name: true } }) : null;
  const location = m.member?.location ?? (m.locationId ? await prisma.location.findUnique({ where: { id: m.locationId }, select: { id: true, slug: true, name: true } }) : null);
  return { ...m, sentByAdminName: admin?.name ?? (m.sentByAdminId ? "Staff" : null), location };
}

/** Distinct `source` values seen, for filter dropdowns. */
export async function listMessageSources(locationIds?: string[]): Promise<string[]> {
  const prisma = getPrisma();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { source: { not: null } };
  if (locationIds) where.OR = [{ locationId: { in: locationIds } }, { member: { locationId: { in: locationIds } } }];
  const rows = await prisma.message.findMany({ where, distinct: ["source"], select: { source: true }, orderBy: { source: "asc" } });
  return rows.map((r) => r.source as string);
}

function previewOf(body: string): string {
  return body
    .replace(/<!--attachments:[\s\S]*?-->/, "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/* ------------------------------------------------------------------ */
/* Website contact form (tee24.golf → /api/public/contact)             */
/* ------------------------------------------------------------------ */

export type WebsiteContactInput = {
  name: string;
  email: string;
  phone?: string | null;
  /** Free text from the form, e.g. "Louisville, KY" / "Clarksville, IN" / "Both/Either". */
  location?: string | null;
  subject?: string | null;
  message: string;
  /** Page URL the form was on. */
  page?: string | null;
  /** Idempotency key from the website (so retries don't duplicate). */
  submissionId?: string | null;
  submittedAt?: Date;
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Map the form's free-text location to a Location row (by slug or name token). */
async function matchLocation(text: string | null | undefined): Promise<{ id: string; organizationId: string | null } | null> {
  const t = (text ?? "").toLowerCase();
  if (!t || /both|either|any/.test(t)) return null;
  const locs = await getPrisma().location.findMany({ where: { disabled: false }, select: { id: true, slug: true, name: true, organizationId: true } });
  const hit = locs.find((l) => t.includes(l.slug.toLowerCase()) || t.includes(l.name.toLowerCase()) || l.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(w)));
  return hit ? { id: hit.id, organizationId: hit.organizationId } : null;
}

export async function ingestWebsiteContact(input: WebsiteContactInput) {
  const loc = await matchLocation(input.location);
  const subjectLabel = input.subject?.trim() || null;
  const subject = subjectLabel ? `Website: ${subjectLabel}` : "Website contact form";
  const rows: [string, string | null | undefined][] = [
    ["Name", input.name],
    ["Email", input.email],
    ["Phone", input.phone],
    ["Location", input.location],
    ["Topic", subjectLabel],
    ["Page", input.page],
  ];
  const html =
    `<p style="white-space:pre-wrap">${esc(input.message.trim())}</p>` +
    `<hr><table style="font-size:12px;color:#555">` +
    rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `<tr><td style="padding:2px 8px 2px 0"><b>${k}</b></td><td>${esc(String(v))}</td></tr>`).join("") +
    `</table>`;
  return ingestInboundEmail({
    from: input.email,
    fromName: input.name,
    to: [defaultReplyTo() ?? "info@tee24.golf"],
    subject,
    html,
    text: input.message,
    providerId: input.submissionId ? `website:${input.submissionId}` : null,
    receivedAt: input.submittedAt,
    source: "website.contact",
    leadSource: "Website contact form",
    locationId: loc?.id ?? null,
    phone: input.phone ?? null,
  });
}
