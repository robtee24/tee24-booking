// lib/events.ts
//
// Single place where "something happened to a member" is announced.
// Producers (signup, billing, membership, documents, attendance, front desk)
// call `emitMemberEvent(...)`; consumers (system email/SMS templates,
// automation enrollment, admin notifications) subscribe in `lib/events.handlers.ts`.
//
// Emitting must never throw into the caller and never block the request for
// long: handlers run after the current tick and their failures are logged only.

export type MemberEventKind =
  | "member.created" // created by admin, import, or public signup
  | "member.signup" // completed public signup form
  | "member.welcome" // account access / welcome message should go out
  | "member.birthday"
  | "membership.activated"
  | "membership.renewed"
  | "membership.cancel-scheduled"
  | "membership.cancelled"
  | "membership.frozen"
  | "membership.resumed"
  | "membership.freeze-scheduled"
  | "membership.plan-changed" // upgrade / add-on applied (now)
  | "membership.downgrade-scheduled" // change queued for the next renewal
  | "access.enabled" // door access turned on
  | "access.disabled" // door access turned off
  | "membership.expiring" // fixed-term ending soon
  | "membership.expired"
  | "trial.started"
  | "trial.expired"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "payment.overdue"
  | "payment.upcoming" // reminder before a scheduled charge
  | "card.expiring"
  | "card.expired"
  | "document.assigned"
  | "document.signed"
  | "document.expired"
  | "visit.checked-in"
  | "lead.created"
  | "sale.completed";

export type MemberEventPayload = {
  memberId?: string | null;
  visitorId?: string | null;
  locationId?: string | null;
  organizationId?: string | null;
  /** Free-form merge variables for templates: amount, planName, invoiceUrl, ... */
  vars?: Record<string, string | number | null | undefined>;
  /** Related entity ids for deep links / idempotency */
  refs?: { invoiceId?: string; subscriptionId?: string; chargeId?: string; assignmentId?: string; visitId?: string; saleId?: string };
  /** Who caused it (admin id) when applicable */
  actorAdminId?: string | null;
};

export type MemberEvent = MemberEventPayload & { kind: MemberEventKind; at: Date };

export type MemberEventHandler = (event: MemberEvent) => Promise<void> | void;

const handlers: MemberEventHandler[] = [];

/** Register a consumer. Called once at module init by lib/events.handlers.ts. */
export function onMemberEvent(handler: MemberEventHandler) {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

let handlersLoaded = false;
async function ensureHandlers() {
  if (handlersLoaded) return;
  handlersLoaded = true;
  try {
    // Lazy so producers (services) don't create import cycles with consumers.
    await import("./events.handlers");
  } catch (e) {
    console.error("[events] failed to load handlers", e);
  }
}

/**
 * Announce an event. Resolves after all handlers settle (so cron jobs and API
 * routes on serverless can await it before the function freezes), but never
 * rejects.
 */
export async function emitMemberEvent(kind: MemberEventKind, payload: MemberEventPayload = {}): Promise<void> {
  const event: MemberEvent = { ...payload, kind, at: new Date() };
  try {
    await ensureHandlers();
    await Promise.allSettled(
      handlers.map(async (h) => {
        try {
          await h(event);
        } catch (e) {
          console.error(`[events] handler failed for ${kind}`, e);
        }
      }),
    );
  } catch (e) {
    console.error(`[events] emit failed for ${kind}`, e);
  }
}
