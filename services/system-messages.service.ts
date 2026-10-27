/**
 * System messages — transactional member notifications driven by MemberEvents.
 *
 * Persistence: MessageTemplate rows with category "SYSTEM" + eventKey (one per
 * channel). Rows are lazily seeded from lib/system-templates.ts the first time
 * an org's catalog is listed, so admins can toggle/edit without a migration.
 *
 * Sending: `sendSystemMessage(kind, memberId, vars)` renders the active
 * template(s) and delivers via lib/notify (which honours Organization
 * emailEnabled/smsEnabled, bcc, reply-to and footer). Member marketing opt-outs
 * are NOT consulted here — system/transactional messages always go out.
 */
import { getPrisma } from "@/lib/db";
import { appBaseUrl, deliverEmail, deliverSms } from "@/lib/notify";
import {
  NON_MEMBER_FACING_EVENTS,
  SAMPLE_MEMBER_VARS,
  SYSTEM_TEMPLATES,
  renderSystemTemplate,
  systemTemplateFor,
  type SystemTemplateDef,
} from "@/lib/system-templates";
import type { MemberEventKind } from "@/lib/events";

export type SystemTemplateRow = {
  id: string;
  eventKey: string;
  channel: "EMAIL" | "SMS";
  subject: string | null;
  body: string;
  active: boolean;
  isDefault: boolean;
};

export type SystemTemplateCatalogEntry = {
  def: SystemTemplateDef;
  email: SystemTemplateRow;
  sms: SystemTemplateRow;
};

async function findRow(organizationId: string | null, eventKey: string, channel: string) {
  return getPrisma().messageTemplate.findFirst({
    where: { organizationId: organizationId ?? null, eventKey, channel, category: "SYSTEM" },
  });
}

/** Ensure both channel rows exist for one catalog entry, seeding from defaults. */
async function ensureRows(organizationId: string | null, def: SystemTemplateDef) {
  const prisma = getPrisma();
  const out: Record<"EMAIL" | "SMS", SystemTemplateRow> = {} as Record<"EMAIL" | "SMS", SystemTemplateRow>;
  for (const channel of ["EMAIL", "SMS"] as const) {
    let row = await findRow(organizationId, def.eventKey, channel);
    if (!row) {
      const d = channel === "EMAIL" ? def.email : def.sms;
      row = await prisma.messageTemplate.create({
        data: {
          organizationId,
          name: `${def.label} (${channel === "EMAIL" ? "Email" : "SMS"})`,
          channel,
          category: "SYSTEM",
          eventKey: def.eventKey,
          subject: channel === "EMAIL" ? def.email.subject : null,
          body: d.body,
          active: d.defaultOn,
        },
      });
    }
    const d = channel === "EMAIL" ? def.email : def.sms;
    out[channel] = {
      id: row.id,
      eventKey: def.eventKey,
      channel,
      subject: row.subject,
      body: row.body,
      active: row.active,
      isDefault: row.body === d.body && (channel === "SMS" || row.subject === def.email.subject),
    };
  }
  return out;
}

/** Full catalog for an org (lazy-seeds missing rows). */
export async function listSystemTemplates(organizationId: string | null): Promise<SystemTemplateCatalogEntry[]> {
  const entries: SystemTemplateCatalogEntry[] = [];
  for (const def of SYSTEM_TEMPLATES) {
    const rows = await ensureRows(organizationId, def);
    entries.push({ def, email: rows.EMAIL, sms: rows.SMS });
  }
  return entries;
}

export async function updateSystemTemplate(
  id: string,
  patch: { active?: boolean; subject?: string | null; body?: string; resetToDefault?: boolean },
) {
  const prisma = getPrisma();
  const row = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!row || row.category !== "SYSTEM" || !row.eventKey) throw new Error("System template not found");
  const def = systemTemplateFor(row.eventKey);
  const data: Record<string, unknown> = {};
  if (patch.active != null) data.active = patch.active;
  if (patch.resetToDefault && def) {
    data.subject = row.channel === "EMAIL" ? def.email.subject : null;
    data.body = row.channel === "EMAIL" ? def.email.body : def.sms.body;
  } else {
    if (patch.subject !== undefined) data.subject = patch.subject;
    if (patch.body !== undefined) data.body = patch.body;
  }
  return prisma.messageTemplate.update({ where: { id }, data });
}

// ---------------------------------------------------------------------------
// Merge variables
// ---------------------------------------------------------------------------

export type MemberForVars = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  membershipType?: string | null;
  checkinCode?: string | null;
  referralCode?: string | null;
  organizationId?: string | null;
  location?: { name: string; slug: string; timezone?: string } | null;
};

export function buildMemberVars(member: MemberForVars, extra?: Record<string, unknown>): Record<string, string> {
  const base = appBaseUrl();
  const vars: Record<string, string> = {
    first_name: member.firstName ?? "",
    last_name: member.lastName ?? "",
    email: member.email ?? "",
    phone: member.phone ?? "",
    plan_name: member.membershipType ?? "",
    location_name: member.location?.name ?? "",
    portal_url: `${base}/portal`,
    checkin_code: member.checkinCode ?? "",
    referral_code: member.referralCode ?? "",
    amount: "",
    due_date: "",
    invoice_url: `${base}/portal/payments`,
    sign_url: `${base}/portal/documents`,
    document_name: "",
    card_last4: "",
    sale_total: "",
    previous_plan: "",
    new_price: "",
    change_summary: "",
    freeze_start: "",
    reason: "",
    // camelCase aliases for legacy {{firstName}} templates
    firstName: member.firstName ?? "",
    lastName: member.lastName ?? "",
    locationName: member.location?.name ?? "",
    portalUrl: `${base}/portal`,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined) continue;
      const snake = k.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
      vars[k] = String(v);
      vars[snake] = String(v);
    }
  }
  return vars;
}

export const MEMBER_VARS_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  membershipType: true,
  checkinCode: true,
  referralCode: true,
  organizationId: true,
  locationId: true,
  status: true,
  optInEmailMarketing: true,
  optInSmsMarketing: true,
  location: { select: { name: true, slug: true, timezone: true, organizationId: true } },
} as const;

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type SendSystemMessageResult = {
  email?: { ok: boolean; messageId?: string; error?: string; skipped?: string };
  sms?: { ok: boolean; messageId?: string; error?: string; skipped?: string };
};

/**
 * Send every active system template for `kind` to the member.
 * Returns per-channel outcome; never throws.
 */
export async function sendSystemMessage(
  kind: MemberEventKind,
  memberId: string,
  vars: Record<string, unknown> = {},
  opts?: { actorAdminId?: string | null },
): Promise<SendSystemMessageResult> {
  const result: SendSystemMessageResult = {};
  if (NON_MEMBER_FACING_EVENTS.includes(kind)) return result;
  const def = systemTemplateFor(kind);
  if (!def) return result;

  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: MEMBER_VARS_SELECT });
  if (!member) return result;
  const organizationId = member.organizationId ?? member.location?.organizationId ?? null;

  const [emailTpl, smsTpl] = await Promise.all([
    findRow(organizationId, kind, "EMAIL"),
    findRow(organizationId, kind, "SMS"),
  ]);
  const merged = buildMemberVars(member, vars);

  // Email — use seeded row if present, else catalog default (respecting defaultOn)
  const emailActive = emailTpl ? emailTpl.active : def.email.defaultOn;
  if (emailActive && member.email) {
    const subject = renderSystemTemplate(emailTpl?.subject ?? def.email.subject, merged);
    const html = renderSystemTemplate(emailTpl?.body ?? def.email.body, merged);
    result.email = await logAndDeliver({
      channel: "EMAIL",
      memberId,
      organizationId,
      to: member.email,
      subject,
      body: html,
      templateId: emailTpl?.id ?? null,
      actorAdminId: opts?.actorAdminId ?? null,
      timeZone: member.location?.timezone,
    });
  }

  const smsActive = smsTpl ? smsTpl.active : def.sms.defaultOn;
  if (smsActive && member.phone) {
    const text = renderSystemTemplate(smsTpl?.body ?? def.sms.body, merged);
    result.sms = await logAndDeliver({
      channel: "SMS",
      memberId,
      organizationId,
      to: member.phone,
      subject: null,
      body: text,
      templateId: smsTpl?.id ?? null,
      actorAdminId: opts?.actorAdminId ?? null,
      timeZone: member.location?.timezone,
    });
  }
  return result;
}

async function logAndDeliver(input: {
  channel: "EMAIL" | "SMS";
  memberId: string | null;
  organizationId: string | null;
  to: string;
  subject: string | null;
  body: string;
  templateId: string | null;
  actorAdminId: string | null;
  timeZone?: string | null;
}) {
  const prisma = getPrisma();
  const msg = await prisma.message.create({
    data: {
      memberId: input.memberId,
      channel: input.channel,
      direction: "OUTBOUND",
      status: "QUEUED",
      category: "SYSTEM",
      subject: input.subject,
      body: input.body,
      toAddress: input.to,
      templateId: input.templateId,
      sentByAdminId: input.actorAdminId,
    },
  });
  const res =
    input.channel === "EMAIL"
      ? await deliverEmail({ to: input.to, subject: input.subject ?? "", html: input.body, category: "SYSTEM", organizationId: input.organizationId, ledger: false })
      : await deliverSms({ to: input.to, text: input.body, category: "SYSTEM", organizationId: input.organizationId, timeZone: input.timeZone, ledger: false });
  await prisma.message.update({
    where: { id: msg.id },
    data: {
      status: res.ok ? "SENT" : res.skipped ? "QUEUED" : "FAILED",
      providerId: res.providerId ?? null,
      providerError: res.ok ? null : res.error ?? null,
    },
  });
  return { ok: res.ok, messageId: msg.id, error: res.error, skipped: res.skipped };
}

/**
 * "Send test to me": renders with sample data (or a real member when given)
 * and delivers ONLY to the signed-in admin's own email/phone.
 */
export async function sendSystemTestToAdmin(opts: {
  templateId?: string;
  eventKey?: string;
  channel: "EMAIL" | "SMS";
  subject?: string | null;
  body?: string | null;
  adminEmail?: string | null;
  adminPhone?: string | null;
  organizationId?: string | null;
}): Promise<{ ok: boolean; error?: string; to?: string; dryRun?: boolean }> {
  const prisma = getPrisma();
  let subject = opts.subject ?? null;
  let body = opts.body ?? null;
  if ((!body || (opts.channel === "EMAIL" && !subject)) && opts.templateId) {
    const row = await prisma.messageTemplate.findUnique({ where: { id: opts.templateId } });
    if (row) {
      subject = subject ?? row.subject;
      body = body ?? row.body;
    }
  }
  if (!body && opts.eventKey) {
    const def = systemTemplateFor(opts.eventKey);
    if (def) {
      subject = subject ?? def.email.subject;
      body = opts.channel === "EMAIL" ? def.email.body : def.sms.body;
    }
  }
  if (!body) return { ok: false, error: "Nothing to send" };

  const vars = { ...SAMPLE_MEMBER_VARS, portal_url: `${appBaseUrl()}/portal` };
  if (opts.channel === "EMAIL") {
    if (!opts.adminEmail) return { ok: false, error: "Your admin profile has no email address" };
    const res = await deliverEmail({
      to: opts.adminEmail,
      subject: `[TEST] ${renderSystemTemplate(subject ?? "", vars)}`,
      html: renderSystemTemplate(body, vars),
      category: "SYSTEM",
      organizationId: opts.organizationId,
      force: true,
      ledger: false,
    });
    return { ok: res.ok, error: res.error, to: opts.adminEmail, dryRun: res.dryRun };
  }
  if (!opts.adminPhone) return { ok: false, error: "Your admin profile has no phone number" };
  const res = await deliverSms({
    to: opts.adminPhone,
    text: `[TEST] ${renderSystemTemplate(body, vars)}`,
    category: "SYSTEM",
    organizationId: opts.organizationId,
    force: true,
    ledger: false,
  });
  return { ok: res.ok, error: res.error, to: opts.adminPhone, dryRun: res.dryRun };
}
