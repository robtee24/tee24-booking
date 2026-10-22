// lib/events.handlers.ts
//
// Consumers of member events. Loaded lazily by lib/events.ts on first emit.
// Owned by the comms/marketing module. Three independent, failure-isolated
// consumers:
//   1. System messages  — email/SMS templates for the event kind
//   2. Automations      — enroll the member in flows triggered by the kind
//   3. Admin notifications — staff-facing inbox entries for notable kinds
import { onMemberEvent, type MemberEvent, type MemberEventKind } from "./events";
import { adminNotify, type AdminNotificationKind, type AdminSeverity } from "./admin-notify";
import { adminRoutes } from "./admin/routes";
import { getPrisma } from "./db";

// ── 1. System messages ───────────────────────────────────────────────────────
onMemberEvent(async (event) => {
  if (!event.memberId) return;
  const { sendSystemMessage } = await import("@/services/system-messages.service");
  await sendSystemMessage(event.kind, event.memberId, event.vars ?? {}, { actorAdminId: event.actorAdminId ?? null });
});

// ── 2. Automations ───────────────────────────────────────────────────────────
onMemberEvent(async (event) => {
  if (!event.memberId) return;
  const { triggerAutomations } = await import("@/services/automation.service");
  await triggerAutomations({
    trigger: event.kind,
    memberId: event.memberId,
    context: {
      organizationId: event.organizationId ?? null,
      planId: (event.vars?.planId as string | undefined) ?? null,
      tagId: (event.vars?.tagId as string | undefined) ?? null,
      ...event.refs,
    },
  });
});

// ── 3. Admin notifications ───────────────────────────────────────────────────
const STAFF_VISIBLE: Partial<Record<MemberEventKind, { kind: AdminNotificationKind; severity: AdminSeverity; title: (name: string, e: MemberEvent) => string }>> = {
  "payment.failed": { kind: "payment.failed", severity: "WARN", title: (n, e) => `Payment failed for ${n}${e.vars?.amount ? ` (${e.vars.amount})` : ""}` },
  "payment.overdue": { kind: "payment.failed", severity: "WARN", title: (n, e) => `Invoice overdue for ${n}${e.vars?.amount ? ` (${e.vars.amount})` : ""}` },
  "membership.cancel-scheduled": { kind: "membership.cancel-scheduled", severity: "WARN", title: (n, e) => `${n} scheduled a cancellation${e.vars?.dueDate ? ` (ends ${e.vars.dueDate})` : ""}` },
  "membership.cancelled": { kind: "membership.cancelled", severity: "INFO", title: (n) => `${n}'s membership ended` },
  "membership.expired": { kind: "membership.expired", severity: "INFO", title: (n) => `${n}'s membership expired` },
  "trial.expired": { kind: "membership.expired", severity: "INFO", title: (n) => `${n}'s trial expired without converting` },
  "document.signed": { kind: "document.signed", severity: "INFO", title: (n, e) => `${n} signed ${e.vars?.documentName ?? "a document"}` },
  "document.expired": { kind: "document.expired", severity: "WARN", title: (n, e) => `${n}'s ${e.vars?.documentName ?? "document"} expired` },
  "member.signup": { kind: "membership.signup", severity: "INFO", title: (n) => `New signup: ${n}` },
  "member.birthday": { kind: "birthday.today", severity: "INFO", title: (n) => `🎂 ${n}'s birthday is today` },
  "lead.created": { kind: "lead.created", severity: "INFO", title: (n, e) => `New lead: ${n}${e.vars?.source ? ` via ${e.vars.source}` : ""}` },
  "payment.refunded": { kind: "payment.refunded", severity: "INFO", title: (n, e) => `Refund issued to ${n}${e.vars?.amount ? ` (${e.vars.amount})` : ""}` },
};

onMemberEvent(async (event) => {
  const spec = STAFF_VISIBLE[event.kind];
  if (!spec) return;
  const prisma = getPrisma();
  let name = "a member";
  let link: string | undefined;
  let organizationId = event.organizationId ?? null;
  let locationId = event.locationId ?? null;

  if (event.memberId) {
    const m = await prisma.member.findUnique({
      where: { id: event.memberId },
      select: { firstName: true, lastName: true, organizationId: true, locationId: true, location: { select: { slug: true } } },
    });
    if (m) {
      name = `${m.firstName} ${m.lastName}`.trim();
      organizationId = organizationId ?? m.organizationId;
      locationId = locationId ?? m.locationId;
      if (m.location?.slug) link = adminRoutes.loc.members.detail(m.location.slug, event.memberId);
    }
  } else if (event.visitorId) {
    const v = await prisma.visitor.findUnique({
      where: { id: event.visitorId },
      select: { firstName: true, lastName: true, email: true, phone: true, organizationId: true, locationId: true, location: { select: { slug: true } } },
    });
    if (v) {
      name = `${v.firstName ?? ""} ${v.lastName ?? ""}`.trim() || v.email || v.phone || "a lead";
      organizationId = organizationId ?? v.organizationId;
      locationId = locationId ?? v.locationId;
      if (v.location?.slug) link = `${adminRoutes.loc.marketing.visitors(v.location.slug)}?lead=${event.visitorId}`;
    }
  }

  await adminNotify({
    organizationId,
    locationId,
    kind: spec.kind,
    severity: spec.severity,
    title: spec.title(name, event),
    body: typeof event.vars?.reason === "string" ? event.vars.reason : undefined,
    link,
    data: { eventKind: event.kind, memberId: event.memberId ?? null, visitorId: event.visitorId ?? null, refs: event.refs ?? null },
  });
});

if (process.env.NODE_ENV !== "production") {
  onMemberEvent((event) => {
    console.log(`[events] ${event.kind}`, { memberId: event.memberId, visitorId: event.visitorId, locationId: event.locationId });
  });
}
