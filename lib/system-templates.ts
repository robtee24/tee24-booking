// lib/system-templates.ts
//
// Catalog of member-facing "system messages": one entry per MemberEventKind
// that should produce an email and/or SMS to the member. Defaults live here;
// the org's overrides are persisted as MessageTemplate rows with
// `category: "SYSTEM"` + `eventKey` (lazily seeded from this catalog by
// services/system-messages.service.ts).
//
// Merge fields use single braces: {first_name}. See SYSTEM_MERGE_FIELDS.
// Double-brace {{firstName}} (legacy marketing style) is also accepted by the
// renderer in services/system-messages.service.ts.
import type { MemberEventKind } from "./events";

export type SystemTemplateGroup = "Members" | "Memberships" | "Payments" | "Documents" | "Attendance" | "Sales";

export type SystemTemplateDef = {
  eventKey: MemberEventKind;
  group: SystemTemplateGroup;
  label: string;
  description: string;
  email: { subject: string; body: string; defaultOn: boolean };
  sms: { body: string; defaultOn: boolean };
};

export const SYSTEM_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "plan_name", label: "Plan name" },
  { key: "amount", label: "Amount (e.g. $49.00)" },
  { key: "due_date", label: "Due / effective date" },
  { key: "invoice_url", label: "Invoice link" },
  { key: "portal_url", label: "Member portal link" },
  { key: "location_name", label: "Location name" },
  { key: "sign_url", label: "Document signing link" },
  { key: "document_name", label: "Document name" },
  { key: "card_last4", label: "Card last 4" },
  { key: "checkin_code", label: "Front-desk check-in code" },
  { key: "referral_code", label: "Referral code" },
  { key: "sale_total", label: "Sale total" },
];

const portal = "{portal_url}";

export const SYSTEM_TEMPLATES: SystemTemplateDef[] = [
  // ── Members ──────────────────────────────────────────────────────────────
  {
    eventKey: "member.welcome",
    group: "Members",
    label: "Welcome / account access",
    description: "Sent once when a member's account is ready. Includes portal link and check-in code.",
    email: {
      defaultOn: true,
      subject: "Welcome to {location_name}, {first_name}!",
      body: `Hi {first_name},<br><br>Welcome to {location_name}! Your account is ready.<br><br>Member portal: <a href="${portal}">${portal}</a><br>Front-desk check-in code: <strong>{checkin_code}</strong><br><br>Your referral code is <strong>{referral_code}</strong> — share it with friends.<br><br>See you on the sim!`,
    },
    sms: { defaultOn: true, body: `Welcome to {location_name}, {first_name}! Your check-in code is {checkin_code}. Manage your account: ${portal}` },
  },
  {
    eventKey: "member.signup",
    group: "Members",
    label: "Signup received",
    description: "Confirmation right after a public signup form is completed.",
    email: {
      defaultOn: false,
      subject: "We got your signup, {first_name}",
      body: `Hi {first_name},<br><br>Thanks for signing up at {location_name}. We'll send your welcome details shortly.<br><br>Portal: <a href="${portal}">${portal}</a>`,
    },
    sms: { defaultOn: false, body: `Thanks for signing up at {location_name}, {first_name}! Welcome details are on the way.` },
  },
  {
    eventKey: "member.birthday",
    group: "Members",
    label: "Birthday",
    description: "Sent on the member's birthday.",
    email: { defaultOn: true, subject: "Happy birthday, {first_name}! 🎉", body: `Happy birthday from all of us at {location_name}, {first_name}! Come celebrate with a round on the sim.` },
    sms: { defaultOn: true, body: `Happy birthday {first_name}! 🎉 From your friends at {location_name}.` },
  },

  // ── Memberships ──────────────────────────────────────────────────────────
  {
    eventKey: "membership.activated",
    group: "Memberships",
    label: "Membership activated",
    description: "A new membership started.",
    email: { defaultOn: true, subject: "Your {plan_name} membership is active", body: `Hi {first_name},<br><br>Your <strong>{plan_name}</strong> membership at {location_name} is now active.<br><br>Manage it any time: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Hi {first_name}, your {plan_name} membership at {location_name} is now active. ${portal}` },
  },
  {
    eventKey: "membership.renewed",
    group: "Memberships",
    label: "Membership renewed",
    description: "Recurring membership renewed for another period.",
    email: { defaultOn: false, subject: "Your {plan_name} membership renewed", body: `Hi {first_name},<br><br>Your {plan_name} membership renewed. Next billing date: {due_date}.<br><br><a href="${portal}">Manage membership</a>` },
    sms: { defaultOn: false, body: `Your {plan_name} membership renewed. Next billing: {due_date}.` },
  },
  {
    eventKey: "membership.cancel-scheduled",
    group: "Memberships",
    label: "Cancellation scheduled",
    description: "Membership will end at the period end.",
    email: { defaultOn: true, subject: "Your membership cancellation is scheduled", body: `Hi {first_name},<br><br>Your {plan_name} membership is scheduled to end on <strong>{due_date}</strong>. You keep full access until then.<br><br>Changed your mind? <a href="${portal}">Undo cancellation</a>` },
    sms: { defaultOn: false, body: `Your {plan_name} membership ends {due_date}. Changed your mind? ${portal}` },
  },
  {
    eventKey: "membership.cancelled",
    group: "Memberships",
    label: "Membership cancelled",
    description: "Membership has ended.",
    email: { defaultOn: true, subject: "Your membership has ended", body: `Hi {first_name},<br><br>Your {plan_name} membership at {location_name} has ended. We'd love to have you back any time: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Your {plan_name} membership at {location_name} has ended. Come back any time: ${portal}` },
  },
  {
    eventKey: "membership.frozen",
    group: "Memberships",
    label: "Membership frozen",
    description: "Membership placed on hold.",
    email: { defaultOn: true, subject: "Your membership is on hold", body: `Hi {first_name},<br><br>Your {plan_name} membership is frozen until <strong>{due_date}</strong>. Door access pauses during the freeze.<br><br><a href="${portal}">Manage membership</a>` },
    sms: { defaultOn: false, body: `Your {plan_name} membership is frozen until {due_date}.` },
  },
  {
    eventKey: "membership.resumed",
    group: "Memberships",
    label: "Membership resumed",
    description: "Freeze ended; access restored.",
    email: { defaultOn: true, subject: "Welcome back — your membership is active again", body: `Hi {first_name},<br><br>Your {plan_name} membership is active again and door access is restored. See you soon!` },
    sms: { defaultOn: false, body: `Your {plan_name} membership is active again. Welcome back!` },
  },
  {
    eventKey: "membership.expiring",
    group: "Memberships",
    label: "Membership expiring soon",
    description: "Fixed-term membership ending soon.",
    email: { defaultOn: true, subject: "Your membership expires {due_date}", body: `Hi {first_name},<br><br>Your {plan_name} membership expires on <strong>{due_date}</strong>. Renew to keep your access: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: true, body: `Heads up {first_name}: your {plan_name} membership expires {due_date}. Renew: ${portal}` },
  },
  {
    eventKey: "membership.expired",
    group: "Memberships",
    label: "Membership expired",
    description: "Fixed-term membership has expired.",
    email: { defaultOn: true, subject: "Your membership has expired", body: `Hi {first_name},<br><br>Your {plan_name} membership expired on {due_date}. Rejoin any time: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Your {plan_name} membership expired {due_date}. Rejoin: ${portal}` },
  },
  {
    eventKey: "trial.started",
    group: "Memberships",
    label: "Trial started",
    description: "Trial membership began.",
    email: { defaultOn: true, subject: "Your trial at {location_name} has started", body: `Hi {first_name},<br><br>Your trial is live through <strong>{due_date}</strong>. Book a bay and try it out: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: true, body: `Your trial at {location_name} is live through {due_date}. Book a bay: ${portal}` },
  },
  {
    eventKey: "trial.expired",
    group: "Memberships",
    label: "Trial expired",
    description: "Trial ended without conversion.",
    email: { defaultOn: true, subject: "Your trial has ended — keep playing?", body: `Hi {first_name},<br><br>Your trial at {location_name} ended on {due_date}. Join as a member to keep your access: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Your trial at {location_name} has ended. Join as a member: ${portal}` },
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    eventKey: "payment.succeeded",
    group: "Payments",
    label: "Payment receipt",
    description: "Receipt after a successful charge.",
    email: { defaultOn: true, subject: "Receipt: {amount} to {location_name}", body: `Hi {first_name},<br><br>We received your payment of <strong>{amount}</strong> for {plan_name}.<br><br>View invoice: <a href="{invoice_url}">{invoice_url}</a>` },
    sms: { defaultOn: false, body: `Payment received: {amount} for {plan_name}. Thanks, {first_name}!` },
  },
  {
    eventKey: "payment.failed",
    group: "Payments",
    label: "Payment failed",
    description: "A charge was declined.",
    email: { defaultOn: true, subject: "Action needed: payment of {amount} failed", body: `Hi {first_name},<br><br>Your payment of <strong>{amount}</strong> for {plan_name} didn't go through (card ending {card_last4}).<br><br>Update your card to avoid interruption: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: true, body: `Hi {first_name}, your {amount} payment to {location_name} failed. Update your card: ${portal}` },
  },
  {
    eventKey: "payment.overdue",
    group: "Payments",
    label: "Payment overdue",
    description: "Invoice is past due.",
    email: { defaultOn: true, subject: "Your {location_name} invoice is overdue", body: `Hi {first_name},<br><br>Your invoice for <strong>{amount}</strong> was due {due_date} and is still unpaid.<br><br>Pay now: <a href="{invoice_url}">{invoice_url}</a>` },
    sms: { defaultOn: true, body: `Reminder: your {amount} invoice to {location_name} is overdue. Pay now: {invoice_url}` },
  },
  {
    eventKey: "payment.upcoming",
    group: "Payments",
    label: "Upcoming charge reminder",
    description: "Sent a few days before a scheduled charge.",
    email: { defaultOn: false, subject: "Upcoming charge: {amount} on {due_date}", body: `Hi {first_name},<br><br>Heads up — your {plan_name} membership will be charged <strong>{amount}</strong> on {due_date}.<br><br><a href="${portal}">Manage payment method</a>` },
    sms: { defaultOn: false, body: `Heads up: {amount} for {plan_name} will be charged on {due_date}.` },
  },
  {
    eventKey: "payment.refunded",
    group: "Payments",
    label: "Refund issued",
    description: "A refund was processed.",
    email: { defaultOn: true, subject: "Refund of {amount} issued", body: `Hi {first_name},<br><br>We've refunded <strong>{amount}</strong> to your card ending {card_last4}. It may take 5–10 business days to appear.` },
    sms: { defaultOn: false, body: `A refund of {amount} has been issued to your card ending {card_last4}.` },
  },
  {
    eventKey: "card.expiring",
    group: "Payments",
    label: "Card expiring soon",
    description: "Payment method expires this month.",
    email: { defaultOn: true, subject: "Your card ending {card_last4} expires soon", body: `Hi {first_name},<br><br>The card ending <strong>{card_last4}</strong> on your {location_name} account expires soon. Add a new card to avoid a missed payment: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Your card ending {card_last4} expires soon. Update it: ${portal}` },
  },
  {
    eventKey: "card.expired",
    group: "Payments",
    label: "Card expired",
    description: "Payment method has expired.",
    email: { defaultOn: true, subject: "Your card on file has expired", body: `Hi {first_name},<br><br>The card ending <strong>{card_last4}</strong> has expired. Please add a new payment method: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: true, body: `Your card ending {card_last4} has expired. Add a new card: ${portal}` },
  },

  // ── Documents ────────────────────────────────────────────────────────────
  {
    eventKey: "document.assigned",
    group: "Documents",
    label: "Document to sign",
    description: "A waiver/agreement was assigned.",
    email: { defaultOn: true, subject: "Please sign: {document_name}", body: `Hi {first_name},<br><br>{location_name} needs your signature on <strong>{document_name}</strong>.<br><br>Sign now: <a href="{sign_url}">{sign_url}</a>` },
    sms: { defaultOn: true, body: `{location_name} needs your signature on {document_name}: {sign_url}` },
  },
  {
    eventKey: "document.signed",
    group: "Documents",
    label: "Document signed (copy)",
    description: "Confirmation with a link to the signed copy.",
    email: { defaultOn: true, subject: "Signed: {document_name}", body: `Hi {first_name},<br><br>Thanks — <strong>{document_name}</strong> is signed. Your copy is available in the portal: <a href="${portal}">${portal}</a>` },
    sms: { defaultOn: false, body: `Thanks {first_name} — {document_name} is signed. Copy: ${portal}` },
  },
  {
    eventKey: "document.expired",
    group: "Documents",
    label: "Document expired",
    description: "A signed document (e.g. annual waiver) has expired and needs re-signing.",
    email: { defaultOn: true, subject: "Please re-sign: {document_name}", body: `Hi {first_name},<br><br>Your signed <strong>{document_name}</strong> has expired. Please sign the current version: <a href="{sign_url}">{sign_url}</a>` },
    sms: { defaultOn: false, body: `Your {document_name} has expired. Re-sign here: {sign_url}` },
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    eventKey: "visit.checked-in",
    group: "Attendance",
    label: "Check-in confirmation",
    description: "Optional ping each time a member checks in. Off by default.",
    email: { defaultOn: false, subject: "Checked in at {location_name}", body: `Hi {first_name}, you're checked in at {location_name}. Enjoy your session!` },
    sms: { defaultOn: false, body: `Checked in at {location_name}. Enjoy, {first_name}!` },
  },

  // ── Sales ────────────────────────────────────────────────────────────────
  {
    eventKey: "sale.completed",
    group: "Sales",
    label: "Sale receipt",
    description: "Receipt for POS / day-pass / product sales.",
    email: { defaultOn: true, subject: "Your receipt from {location_name}", body: `Hi {first_name},<br><br>Thanks for your purchase at {location_name}. Total: <strong>{sale_total}</strong>.<br><br>View receipt: <a href="{invoice_url}">{invoice_url}</a>` },
    sms: { defaultOn: false, body: `Thanks for your purchase at {location_name}! Total {sale_total}. Receipt: {invoice_url}` },
  },
];

export const SYSTEM_TEMPLATE_GROUPS: SystemTemplateGroup[] = ["Members", "Memberships", "Payments", "Documents", "Attendance", "Sales"];

export function systemTemplateFor(eventKey: string): SystemTemplateDef | undefined {
  return SYSTEM_TEMPLATES.find((t) => t.eventKey === eventKey);
}

/** Event kinds that never produce a member-facing message (internal only). */
export const NON_MEMBER_FACING_EVENTS: MemberEventKind[] = ["member.created", "lead.created"];

/**
 * Render single-brace {field} and double-brace {{field}} merge fields.
 * Unknown fields render as empty strings. Also accepts camelCase aliases
 * (firstName → first_name).
 */
export function renderSystemTemplate(tpl: string | null | undefined, vars: Record<string, unknown>): string {
  if (!tpl) return "";
  const lookup = (key: string): string => {
    const snake = key.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`);
    const camel = key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    const v = vars[key] ?? vars[snake] ?? vars[camel];
    return v === null || v === undefined ? "" : String(v);
  };
  return tpl
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => lookup(k))
    .replace(/\{\s*([\w.]+)\s*\}/g, (_m, k: string) => lookup(k));
}

/** Sample data used by live previews + "send test to me". */
export const SAMPLE_MEMBER_VARS: Record<string, string> = {
  first_name: "Jordan",
  last_name: "Sample",
  email: "jordan@example.com",
  phone: "+15555550123",
  plan_name: "Unlimited Monthly",
  amount: "$149.00",
  due_date: "Nov 1, 2026",
  invoice_url: "https://tee24.golf/portal/invoices/INV-1001",
  portal_url: "https://tee24.golf/portal",
  location_name: "Tee24 Clarksville",
  sign_url: "https://tee24.golf/sign/abc123",
  document_name: "Member Waiver",
  card_last4: "4242",
  checkin_code: "4821",
  referral_code: "JS4K2P",
  sale_total: "$32.50",
};
