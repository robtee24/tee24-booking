/**
 * Message ledger — the single place every email / SMS that leaves (or enters)
 * the building is recorded, so it shows up under the member and in the inbox.
 *
 * Wired into the lowest-level senders (`lib/sendEmail.ts`, `lib/quo.ts`,
 * `lib/openphone.ts`) so no call site can forget to log. Callers that already
 * create their own `Message` row (inbox replies, campaigns, automations,
 * system templates) pass `ledger: false` to avoid a duplicate; callers sending
 * secrets (OTP codes, magic links) also pass `ledger: false`.
 *
 * Member resolution: explicit `memberId` wins; otherwise the recipient address
 * is matched against Member.email / Member.phone (un-merged members only).
 * When the same person exists at both locations we prefer the location hint,
 * then ACTIVE status, then most recently updated.
 */
import { getPrisma } from "@/lib/db";

export type LedgerChannel = "EMAIL" | "SMS" | "PUSH";
export type LedgerCategory = "TRANSACTIONAL" | "MARKETING" | "SYSTEM";

export type LedgerHint = {
  /** Link directly to this member (skips address lookup). */
  memberId?: string | null;
  /** Location context; also used to disambiguate members at multiple locations. */
  locationId?: string | null;
  category?: LedgerCategory;
  /** Short origin key, e.g. "booking.confirmation", "billing.receipt". */
  source?: string;
  /** Replace the stored body (e.g. redact a code) while still logging the send. */
  bodyOverride?: string;
};

/** `false` disables logging for this send. */
export type LedgerOption = LedgerHint | false | undefined;

export type RecordOutboundInput = {
  channel: LedgerChannel;
  to: string;
  subject?: string | null;
  body: string;
  ok: boolean;
  providerId?: string | null;
  error?: string | null;
  dryRun?: boolean;
  hint?: LedgerHint;
};

function phoneCandidates(raw: string): string[] {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return [raw];
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const e164 = national.length === 10 ? `+1${national}` : `+${digits}`;
  return Array.from(new Set([raw, e164, e164.replace(/^\+/, ""), national, digits]));
}

/**
 * Find the best member for an address. Exported so inbound handlers can reuse
 * the same disambiguation rules.
 */
export async function resolveMemberByAddress(
  channel: LedgerChannel,
  address: string,
  locationId?: string | null,
): Promise<{ id: string; locationId: string; organizationId: string | null } | null> {
  const prisma = getPrisma();
  const where =
    channel === "EMAIL"
      ? { email: { equals: address.trim().toLowerCase(), mode: "insensitive" as const }, mergedIntoId: null }
      : { phone: { in: phoneCandidates(address) }, mergedIntoId: null };
  const rows = await prisma.member.findMany({
    where,
    select: { id: true, locationId: true, organizationId: true, status: true, updatedAt: true },
    take: 10,
  });
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const rank = (m: (typeof rows)[number]) =>
    (locationId && m.locationId === locationId ? 100 : 0) + (m.status === "ACTIVE" ? 10 : m.status === "FROZEN" ? 5 : 0);
  rows.sort((a, b) => rank(b) - rank(a) || b.updatedAt.getTime() - a.updatedAt.getTime());
  return rows[0];
}

/**
 * Record an outbound send. Never throws — a logging failure must not break a
 * booking confirmation or receipt.
 */
export async function recordOutbound(input: RecordOutboundInput): Promise<string | null> {
  try {
    const prisma = getPrisma();
    const hint = input.hint ?? {};
    let memberId = hint.memberId ?? null;
    let locationId = hint.locationId ?? null;

    if (!memberId && input.channel !== "PUSH") {
      const m = await resolveMemberByAddress(input.channel, input.to, locationId);
      if (m) {
        memberId = m.id;
        locationId = locationId ?? m.locationId;
      }
    } else if (!locationId && memberId) {
      const m = await prisma.member.findUnique({ where: { id: memberId }, select: { locationId: true } });
      locationId = m?.locationId ?? null;
    }

    // Keep thread context: attach to the member's open conversation if one exists.
    let conversationId: string | null = null;
    if (memberId) {
      const c = await prisma.conversation.findFirst({
        where: { memberId, status: "OPEN" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      conversationId = c?.id ?? null;
    }

    const msg = await prisma.message.create({
      data: {
        memberId,
        conversationId,
        locationId,
        channel: input.channel,
        direction: "OUTBOUND",
        status: input.ok ? "SENT" : "FAILED",
        category: hint.category ?? "TRANSACTIONAL",
        subject: input.channel === "SMS" ? null : input.subject ?? null,
        body: hint.bodyOverride ?? input.body,
        toAddress: input.to,
        providerId: input.providerId ?? null,
        providerError: input.ok ? null : input.error ?? null,
        source: hint.source ?? null,
      },
      select: { id: true },
    });
    if (conversationId) {
      await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
    }
    return msg.id;
  } catch (err) {
    console.warn("[message-ledger] failed to record outbound message", err);
    return null;
  }
}
