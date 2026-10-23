// lib/notify.ts
//
// Outbound delivery layer shared by system messages, automations, bulk
// marketing and the inbox. Everything that leaves the building for a member
// should go through `deliverEmail` / `deliverSms` so that:
//
//   • Organization.emailEnabled / smsEnabled are honoured
//   • Organization.bccEmail / replyToEmail / emailFooter are applied
//   • MARKETING emails get an unsubscribe/preferences line
//   • MARKETING SMS respects quiet hours (9pm–9am location time) → deferred
//   • COMMS_DRY_RUN=1 logs instead of sending (safe local testing)
//
// The legacy `sendEmail({to,subject,html})` / `sendSMS(to,text)` exports are
// kept for callers outside this module (documents, compliance, magic links).
import { getPrisma } from "@/lib/db";
import { sendEmail as resendSend, type EmailAttachment } from "@/lib/sendEmail";
import { sendQuoSms } from "@/lib/quo";
import type { LedgerOption } from "@/lib/message-ledger";
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
  skipped?: "org-disabled" | "missing-address";
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
