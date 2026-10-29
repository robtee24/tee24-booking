// lib/notify.ts
//
// Outbound delivery layer shared by system messages, automations, bulk
// marketing and the inbox. Everything that leaves the building for a member
// should go through `deliverEmail` / `deliverSms` so that:
//
//   • Organization.emailEnabled / smsEnabled are honoured
//   • Organization.bccEmail / replyToEmail / emailFooter are applied
//   • MARKETING emails get an unsubscribe/preferences line
//   • MARKETING SMS / push respects quiet hours (9pm–9am location time) → deferred
//   • `deliverPush` sends to a member's app devices via Expo
//   • `deliverMemberMessage` picks push (app installed + notifications on) or
//     falls back to SMS — the one call every "text the member" path should use
//   • COMMS_DRY_RUN=1 logs instead of sending (safe local testing)
//
// The legacy `sendEmail({to,subject,html})` / `sendSMS(to,text)` exports are
// kept for callers outside this module (documents, compliance, magic links).
import { getPrisma } from "@/lib/db";
import { sendEmail as resendSend, type EmailAttachment } from "@/lib/sendEmail";
import { sendQuoSms } from "@/lib/quo";
import { clampPushBody, isExpoPushToken, sendExpoPush } from "@/lib/expo-push";
import { recordOutbound, resolveMemberByAddress, type LedgerOption } from "@/lib/message-ledger";
import { defaultReplyTo } from "@/lib/inbound-email";
import { memberBaseUrl } from "@/lib/public-url";

export type MessageCategory = "TRANSACTIONAL" | "MARKETING" | "SYSTEM";

type EmailArgs = { to: string; subject: string; html: string; ledger?: LedgerOption; replyTo?: string | null };
type SMSArgs = { to: string; text: string; ledger?: LedgerOption };

// ---------- Legacy wrappers (kept for compatibility) ----------
export async function sendEmail({ to, subject, html, ledger, replyTo }: EmailArgs): Promise<void> {
  const res = await resendSend({ to, subject, html, ledger, replyTo: replyTo ?? undefined });
  if (!res.ok) console.error("[notify] Resend email failed:", res.error);
}

export async function sendSMS(to: string, text: string): Promise<void>;
export async function sendSMS(args: SMSArgs): Promise<void>;
export async function sendSMS(a: string | SMSArgs, b?: string): Promise<void> {
  const payload: SMSArgs = typeof a === "string" ? { to: a, text: b ?? "" } : a;
  const res = await sendQuoSms({ to: payload.to, text: payload.text, ledger: payload.ledger });
  if (!res.ok) console.error("[notify] SMS failed:", res.error);
}

// ---------- Organization comms settings ----------
export type CommsSettings = {
  organizationId: string | null;
  emailEnabled: boolean;
  smsEnabled: boolean;
  /** Prefer app push over SMS for members who have the app with notifications on. */
  pushEnabled: boolean;
  bccEmail: string | null;
  replyToEmail: string | null;
  emailFooter: string | null;
  orgName: string | null;
};

const settingsCache = new Map<string, { at: number; value: CommsSettings }>();
const CACHE_MS = 30_000;

export async function getCommsSettings(organizationId?: string | null): Promise<CommsSettings> {
  const key = organizationId ?? "__default__";
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: CommsSettings = {
    organizationId: organizationId ?? null,
    emailEnabled: true,
    smsEnabled: true,
    pushEnabled: true,
    bccEmail: null,
    replyToEmail: null,
    emailFooter: null,
    orgName: null,
  };
  try {
    const org = organizationId
      ? await getPrisma().organization.findUnique({ where: { id: organizationId } })
      : await getPrisma().organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (org) {
      value = {
        organizationId: org.id,
        emailEnabled: org.emailEnabled,
        smsEnabled: org.smsEnabled,
        pushEnabled: org.pushEnabled,
        bccEmail: org.bccEmail,
        replyToEmail: org.replyToEmail,
        emailFooter: org.emailFooter,
        orgName: org.name,
      };
    }
  } catch (e) {
    console.warn("[notify] could not load org comms settings", e);
  }
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateCommsSettingsCache() {
  settingsCache.clear();
}

/** Member-facing base URL (portal, pay links, signup). */
export function appBaseUrl(): string {
  return memberBaseUrl();
}

// ---------- Quiet hours (marketing SMS) ----------
export const QUIET_HOURS = { start: 21, end: 9 }; // 9pm → 9am local

function hourInTz(d: Date, timeZone: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(d);
    return Number(s) % 24;
  } catch {
    return d.getHours();
  }
}

export function isQuietHours(d: Date, timeZone = "America/New_York"): boolean {
  const h = hourInTz(d, timeZone);
  return h >= QUIET_HOURS.start || h < QUIET_HOURS.end;
}

/** Next 9:00am local (approximate: walks forward in 15-min steps). */
export function nextQuietHoursEnd(from: Date, timeZone = "America/New_York"): Date {
  const d = new Date(from.getTime());
  for (let i = 0; i < 24 * 4 + 1; i++) {
    if (!isQuietHours(d, timeZone)) return d;
    d.setMinutes(d.getMinutes() + 15);
  }
  return d;
}

// ---------- Rich delivery ----------
export type DeliverEmailInput = {
  to: string;
  subject: string;
  html: string;
  category: MessageCategory;
  organizationId?: string | null;
  attachments?: EmailAttachment[];
  /** Skip the org emailEnabled gate (e.g. admin test sends). */
  force?: boolean;
  /** Message-ledger hint; `false` when the caller writes its own Message row. */
  ledger?: LedgerOption;
  /** Override Reply-To (e.g. a per-thread inbound address). */
  replyTo?: string | null;
};

export type DeliverResult = {
  ok: boolean;
  providerId?: string | null;
  error?: string;
  skipped?: "org-disabled" | "missing-address" | "no-device" | "no-channel";
  deferredUntil?: Date;
  dryRun?: boolean;
};

export function buildEmailHtml(opts: { html: string; category: MessageCategory; footer?: string | null; orgName?: string | null }): string {
  const parts: string[] = [opts.html];
  const footerBits: string[] = [];
  if (opts.footer) footerBits.push(opts.footer.replace(/\n/g, "<br>"));
  if (opts.category === "MARKETING") {
    footerBits.push(
      `You're receiving this because you're a member${opts.orgName ? ` of ${opts.orgName}` : ""}. ` +
        `<a href="${appBaseUrl()}/portal/settings">Manage preferences or unsubscribe</a>.`,
    );
  }
  if (footerBits.length) {
    parts.push(
      `<hr style="border:0;border-top:1px solid #e5e5ea;margin:24px 0">` +
        `<div style="font:12px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#8e8e93">${footerBits.join("<br>")}</div>`,
    );
  }
  return parts.join("\n");
}

export async function deliverEmail(input: DeliverEmailInput): Promise<DeliverResult> {
  if (!input.to || !input.to.includes("@")) return { ok: false, skipped: "missing-address", error: "No email address" };
  const settings = await getCommsSettings(input.organizationId);
  if (!settings.emailEnabled && !input.force) return { ok: false, skipped: "org-disabled", error: "Email sending is disabled for this organization" };

  const html = buildEmailHtml({ html: input.html, category: input.category, footer: settings.emailFooter, orgName: settings.orgName });
  const res = await resendSend({
    to: input.to,
    subject: input.subject,
    html,
    bcc: settings.bccEmail || undefined,
    // Inbound domain wins so replies thread into the inbox; org Reply-To is the fallback.
    replyTo: input.replyTo ?? defaultReplyTo() ?? settings.replyToEmail ?? undefined,
    attachments: input.attachments,
    tags: [{ name: "category", value: input.category.toLowerCase() }],
    ledger: input.ledger === false ? false : { category: input.category, ...(input.ledger ?? {}) },
  });
  return { ok: res.ok, providerId: res.id ?? null, error: res.error, dryRun: res.dryRun };
}

export type DeliverSmsInput = {
  to: string;
  text: string;
  category: MessageCategory;
  organizationId?: string | null;
  /** Location timezone for quiet-hours evaluation (MARKETING only). */
  timeZone?: string | null;
  /** Skip the org smsEnabled gate + quiet hours (admin test sends). */
  force?: boolean;
  /** Message-ledger hint; `false` when the caller writes its own Message row. */
  ledger?: LedgerOption;
};

export async function deliverSms(input: DeliverSmsInput): Promise<DeliverResult> {
  if (!input.to) return { ok: false, skipped: "missing-address", error: "No phone number" };
  const settings = await getCommsSettings(input.organizationId);
  if (!settings.smsEnabled && !input.force) return { ok: false, skipped: "org-disabled", error: "SMS sending is disabled for this organization" };

  if (input.category === "MARKETING" && !input.force) {
    const now = new Date();
    if (isQuietHours(now, input.timeZone ?? undefined)) {
      return { ok: false, deferredUntil: nextQuietHoursEnd(now, input.timeZone ?? undefined), error: "Quiet hours" };
    }
  }

  const res = await sendQuoSms({ to: input.to, text: input.text, category: input.category, ledger: input.ledger });
  return { ok: res.ok, providerId: res.providerId ?? null, error: res.error, dryRun: res.dryRun };
}

// ---------- Push (members app) ----------
export type DeliverPushInput = {
  memberId: string;
  title?: string | null;
  body: string;
  /** Deep-link payload, e.g. { url: "/book/abc" } (expo-router path). */
  data?: Record<string, unknown>;
  category: MessageCategory;
  organizationId?: string | null;
  /** Location timezone for quiet-hours evaluation (MARKETING only). */
  timeZone?: string | null;
  /** Skip the org pushEnabled gate + quiet hours (admin test sends). */
  force?: boolean;
  /** Message-ledger hint; `false` when the caller writes its own Message row. */
  ledger?: LedgerOption;
};

export type DeliverPushResult = DeliverResult & {
  /** Device rows that were targeted */
  deviceCount?: number;
};

const PUSH_DEVICE_WHERE = { revokedAt: null, pushEnabled: true, pushToken: { not: null } } as const;

/** Push-capable (bound, not revoked, permission granted, token on file) devices for a member. */
export async function getPushDevices(memberId: string) {
  const rows = await getPrisma().memberDevice.findMany({
    where: { memberId, ...PUSH_DEVICE_WHERE },
    select: { id: true, pushToken: true, platform: true },
    orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
  });
  return rows.filter((r) => isExpoPushToken(r.pushToken)) as Array<{ id: string; pushToken: string; platform: string }>;
}

/** Cheap existence check used by the router + admin UI. */
export async function memberHasPush(memberId: string): Promise<boolean> {
  const n = await getPrisma().memberDevice.count({ where: { memberId, ...PUSH_DEVICE_WHERE } });
  return n > 0;
}

/**
 * Bulk "who can receive push" lookup: returns the set of memberIds (from the
 * input) that have at least one push-capable device.
 */
export async function membersWithPush(memberIds: string[]): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const rows = await getPrisma().memberDevice.findMany({
    where: { memberId: { in: memberIds }, ...PUSH_DEVICE_WHERE },
    select: { memberId: true },
    distinct: ["memberId"],
  });
  return new Set(rows.map((r) => r.memberId));
}

export async function deliverPush(input: DeliverPushInput): Promise<DeliverPushResult> {
  const settings = await getCommsSettings(input.organizationId);
  if (!settings.pushEnabled && !input.force) return { ok: false, skipped: "org-disabled", error: "Push notifications are disabled for this organization" };

  const devices = await getPushDevices(input.memberId);
  if (devices.length === 0) return { ok: false, skipped: "no-device", error: "Member has no device with push enabled", deviceCount: 0 };

  if (input.category === "MARKETING" && !input.force) {
    const now = new Date();
    if (isQuietHours(now, input.timeZone ?? undefined)) {
      return { ok: false, deferredUntil: nextQuietHoursEnd(now, input.timeZone ?? undefined), error: "Quiet hours", deviceCount: devices.length };
    }
  }

  const body = clampPushBody(input.body);
  const title = input.title?.trim() || settings.orgName || "Tee24";
  const tickets = await sendExpoPush(
    devices.map((d) => ({ to: d.pushToken, title, body, data: input.data, sound: "default", priority: "high" })),
  );

  let okCount = 0;
  let firstError: string | undefined;
  let providerId: string | null = null;
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === "ok") {
      okCount++;
      providerId ??= t.id;
    } else {
      firstError ??= t.message;
      if (t.details?.error === "DeviceNotRegistered") dead.push(devices[i].id);
    }
  });
  if (dead.length) {
    await getPrisma()
      .memberDevice.updateMany({ where: { id: { in: dead } }, data: { pushEnabled: false, pushToken: null, pushUpdatedAt: new Date() } })
      .catch((e) => console.warn("[notify] could not disable dead push tokens", e));
  }

  const ok = okCount > 0;
  const dryRun = tickets.some((t) => t.status === "ok" && t.id.startsWith("dry_"));
  if (input.ledger !== false) {
    await recordOutbound({
      channel: "PUSH",
      to: `${devices.length} device${devices.length === 1 ? "" : "s"}`,
      subject: title,
      body,
      ok,
      providerId,
      error: ok ? null : firstError ?? "Push failed",
      dryRun,
      hint: { memberId: input.memberId, category: input.category, ...(input.ledger ?? {}) },
    });
  }
  return { ok, providerId, error: ok ? undefined : firstError ?? "Push failed", dryRun, deviceCount: devices.length };
}

// ---------- Smart member delivery (push → SMS) ----------
export type DeliverMemberMessageInput = {
  /** Known member; when omitted we resolve by phone (booking guests etc.). */
  memberId?: string | null;
  /** Fallback SMS destination. Also used to resolve the member when memberId is missing. */
  phone?: string | null;
  /** Message text (SMS body / push body). */
  text: string;
  /** Push title (defaults to org name). Ignored for SMS. */
  title?: string | null;
  /** Deep-link payload for the app. */
  data?: Record<string, unknown>;
  category: MessageCategory;
  organizationId?: string | null;
  locationId?: string | null;
  timeZone?: string | null;
  force?: boolean;
  /** Ledger hint applied to whichever channel is used. */
  ledger?: LedgerOption;
  /** Restrict which channels may be used (default: both, push preferred). */
  channels?: Array<"PUSH" | "SMS">;
};

export type DeliverMemberMessageResult = DeliverResult & {
  /** Channel that was actually used (null when nothing could be sent). */
  channel: "PUSH" | "SMS" | null;
  memberId: string | null;
};

/**
 * Decide how to reach a member and send once:
 *   1. member has the app with notifications enabled → push
 *   2. otherwise (or push hard-fails) → SMS to `phone` / member.phone
 * Honors org toggles and quiet hours for MARKETING on both channels.
 */
export async function deliverMemberMessage(input: DeliverMemberMessageInput): Promise<DeliverMemberMessageResult> {
  const prisma = getPrisma();
  const allow = new Set(input.channels ?? ["PUSH", "SMS"]);
  let memberId = input.memberId ?? null;
  let phone = input.phone ?? null;
  let organizationId = input.organizationId ?? null;
  let timeZone = input.timeZone ?? null;

  if (!memberId && phone) {
    const m = await resolveMemberByAddress("SMS", phone, input.locationId ?? null).catch(() => null);
    if (m) {
      memberId = m.id;
      organizationId ??= m.organizationId;
    }
  }
  if (memberId && (!phone || !timeZone || !organizationId)) {
    const m = await prisma.member.findUnique({
      where: { id: memberId },
      select: { phone: true, organizationId: true, location: { select: { timezone: true, organizationId: true } } },
    });
    if (m) {
      phone ??= m.phone;
      organizationId ??= m.organizationId ?? m.location?.organizationId ?? null;
      timeZone ??= m.location?.timezone ?? null;
    }
  }

  const ledger = input.ledger === false ? false : { ...(input.ledger ?? {}), memberId: memberId ?? input.ledger?.memberId ?? null, locationId: input.locationId ?? input.ledger?.locationId ?? null };

  // 1) Push
  if (memberId && allow.has("PUSH")) {
    const push = await deliverPush({
      memberId,
      title: input.title,
      body: input.text,
      data: input.data,
      category: input.category,
      organizationId,
      timeZone,
      force: input.force,
      ledger,
    });
    if (push.ok || push.deferredUntil) return { ...push, channel: "PUSH", memberId };
    // Hard failure on a device that claims push → fall through to SMS so the member still hears from us.
    if (push.skipped === "org-disabled" && !allow.has("SMS")) return { ...push, channel: null, memberId };
  }

  // 2) SMS
  if (allow.has("SMS") && phone) {
    const sms = await deliverSms({ to: phone, text: input.text, category: input.category, organizationId, timeZone, force: input.force, ledger });
    return { ...sms, channel: sms.ok || sms.deferredUntil ? "SMS" : null, memberId };
  }

  return { ok: false, channel: null, memberId, skipped: "no-channel", error: phone ? "No eligible channel" : "No phone number or push device" };
}

/** Summarise how a set of members would be reached (for admin previews). */
export async function previewMemberChannels(memberIds: string[]): Promise<{ push: number; sms: number; unreachable: number }> {
  if (memberIds.length === 0) return { push: 0, sms: 0, unreachable: 0 };
  const [pushSet, members] = await Promise.all([
    membersWithPush(memberIds),
    getPrisma().member.findMany({ where: { id: { in: memberIds } }, select: { id: true, phone: true } }),
  ]);
  let push = 0;
  let sms = 0;
  let unreachable = 0;
  for (const m of members) {
    if (pushSet.has(m.id)) push++;
    else if (m.phone?.trim()) sms++;
    else unreachable++;
  }
  return { push, sms, unreachable };
}
