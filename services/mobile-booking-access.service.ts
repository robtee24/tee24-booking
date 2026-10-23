/**
 * Who may reserve a bay from the member app, and on what guest terms.
 *
 * Only members with an active membership or a valid pass can book. Everyone
 * else gets a structured "not active" answer with purchase options the app
 * renders as buttons (join a plan, buy a day pass, pay an open invoice, call).
 */
import { getPrisma } from "@/lib/db";
import { memberUrl } from "@/lib/public-url";
import { membershipDisplayName } from "@/lib/membership-pricing";

export const GUEST_PLAY_FEE_CENTS = Number(process.env.GUEST_PLAY_FEE_CENTS ?? 2500);
export const UNAUTHORIZED_GUEST_FEE_CENTS = Number(process.env.UNAUTHORIZED_GUEST_FEE_CENTS ?? 5000);
/** Hard cap on extra playing guests a member can add to one bay. */
export const MAX_EXTRA_GUESTS: Record<"SINGLE" | "GROUP", number> = { SINGLE: 3, GROUP: 5 };

export type AccessReason = "ACTIVE" | "NO_MEMBERSHIP" | "EXPIRED" | "FROZEN" | "PENDING_PAYMENT" | "CANCELLED";

export type PurchaseOption =
  | { kind: "plan"; id: string; name: string; description: string | null; priceCents: number; cadence: string; productType: string; url: string }
  | { kind: "daypass"; name: string; description: string; url: string }
  | { kind: "invoice"; id: string; totalCents: number; dueDate: string; url: string }
  | { kind: "contact"; name: string; phone: string | null; email: string | null };

export type BookingAccess = {
  eligible: boolean;
  reason: AccessReason;
  title: string;
  message: string;
  validThrough: string | null;
  planName: string | null;
  guests: {
    included: number;
    extraFeeCents: number;
    unauthorizedFeeCents: number;
    maxExtra: typeof MAX_EXTRA_GUESTS;
  };
  options: PurchaseOption[];
};

const ACTIVE = new Set(["ACTIVE", "COMP", "CANCEL_SCHEDULED"]);
const RECURRING = new Set(["RECURRING", "COMP"]);

export async function getBookingAccess(memberId: string, forDate: Date = new Date()): Promise<BookingAccess> {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { locationId: true, homeLocationId: true, organizationId: true, location: { select: { id: true, slug: true, name: true, phone: true, email: true, organizationId: true } } },
  });
  const subs = await prisma.membershipSubscription.findMany({
    where: { memberId, status: { in: ["ACTIVE", "COMP", "CANCEL_SCHEDULED", "FROZEN", "PENDING"] } },
    include: { plan: { select: { name: true, productType: true, maxGuests: true, guestAddonCents: true } } },
    orderBy: { startDate: "desc" },
  });

  const now = forDate.getTime();
  const live = subs.find((s) => {
    if (!ACTIVE.has(s.status)) return false;
    if (s.status === "CANCEL_SCHEDULED" && s.cancelScheduledFor && s.cancelScheduledFor.getTime() < now) return false;
    // Passes / one-offs are only good through their paid-through date.
    if (!RECURRING.has(s.plan.productType) && s.paidThroughDate && s.paidThroughDate.getTime() < now) return false;
    return true;
  });

  // Included playing guests = the guest add-on the member actually pays for
  // (subscription.guestCount; for a day pass, the guests bought with it).
  // A standard Gilmore / Noonan / Tin Cup covers the member only — plan.maxGuests
  // is just the purchasable cap, never an entitlement.
  const includedGuests = (s: (typeof subs)[number] | undefined) => (s ? Math.max(0, s.guestCount ?? 0) : 0);
  const guests = { included: includedGuests(live), extraFeeCents: GUEST_PLAY_FEE_CENTS, unauthorizedFeeCents: UNAUTHORIZED_GUEST_FEE_CENTS, maxExtra: MAX_EXTRA_GUESTS };

  if (live) {
    const validThrough = live.status === "CANCEL_SCHEDULED" ? live.cancelScheduledFor : !RECURRING.has(live.plan.productType) ? live.paidThroughDate : null;
    return {
      eligible: true,
      reason: "ACTIVE",
      title: membershipDisplayName(live.plan.name, live.guestCount, live.plan.productType),
      message: validThrough ? `Good through ${validThrough.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.` : guests.included > 0 ? `Your membership is active and includes ${guests.included} playing guest${guests.included === 1 ? "" : "s"} per visit.` : "Your membership is active. It covers you only — add a guest to your plan or pay the guest fee when booking.",
      validThrough: validThrough?.toISOString() ?? null,
      planName: membershipDisplayName(live.plan.name, live.guestCount, live.plan.productType),
      guests,
      options: [],
    };
  }

  // Not eligible — work out why and what to offer.
  const frozen = subs.find((s) => s.status === "FROZEN");
  const pending = subs.find((s) => s.status === "PENDING");
  const expiredPass = subs.find((s) => ACTIVE.has(s.status) && !RECURRING.has(s.plan.productType));
  const reason: AccessReason = frozen ? "FROZEN" : pending ? "PENDING_PAYMENT" : expiredPass ? "EXPIRED" : "NO_MEMBERSHIP";

  const copy: Record<AccessReason, { title: string; message: string }> = {
    ACTIVE: { title: "", message: "" },
    FROZEN: { title: "Your membership is frozen", message: `Bay reservations pause while ${frozen?.plan.name ?? "your plan"} is frozen${frozen?.freezeResumeDate ? ` (resumes ${frozen.freezeResumeDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}. Buy a day pass to play before then, or ask the front desk to resume early.` },
    PENDING_PAYMENT: { title: "Payment pending", message: "Your membership starts once the first payment clears. Pay now to unlock reservations." },
    EXPIRED: { title: "Your pass has ended", message: `Your ${expiredPass?.plan.name ?? "pass"} is no longer valid. Grab another pass or join as a member to keep booking.` },
    CANCELLED: { title: "Membership ended", message: "Rejoin or buy a pass to reserve a bay." },
    NO_MEMBERSHIP: { title: "No active membership", message: "Only active members and pass holders can reserve bays. Pick an option below to get access." },
  };

  const locId = member?.homeLocationId ?? member?.locationId ?? null;
  const loc = member?.location ?? null;
  const orgId = loc?.organizationId ?? member?.organizationId ?? null;

  const [forms, plans, openInvoice] = await Promise.all([
    prisma.signupForm.findMany({
      where: { active: true, OR: [{ locationId: locId ?? undefined }, { locationId: null, organizationId: orgId }] },
      orderBy: { name: "asc" },
      select: { slug: true, allowedPlanIds: true, locationId: true },
    }),
    prisma.membershipPlan.findMany({
      where: { archived: false, productType: { in: ["RECURRING", "DAY_PASS", "ONE_OFF", "PUNCH_CARD"] }, OR: [{ organizationId: orgId }, { organizationId: null }] },
      orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
      select: { id: true, name: true, description: true, priceCents: true, billingCadence: true, productType: true, allowedLocations: true },
      take: 12,
    }),
    prisma.invoice.findFirst({
      where: { memberId, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, totalCents: true, dueDate: true, payToken: true },
    }),
  ]);

  const options: PurchaseOption[] = [];
  if (openInvoice?.payToken) options.push({ kind: "invoice", id: openInvoice.id, totalCents: openInvoice.totalCents, dueDate: openInvoice.dueDate.toISOString(), url: memberUrl(`/pay/${openInvoice.payToken}`) });

  const formFor = (planId: string) => forms.find((f) => f.locationId === locId && ((f.allowedPlanIds as string[] | null) ?? []).includes(planId)) ?? forms.find((f) => ((f.allowedPlanIds as string[] | null) ?? []).includes(planId)) ?? forms.find((f) => !((f.allowedPlanIds as string[] | null) ?? []).length) ?? forms[0];
  for (const p of plans) {
    if (p.allowedLocations && locId && !p.allowedLocations.split(",").map((x) => x.trim()).includes(locId)) continue;
    if (p.productType === "DAY_PASS") continue; // offered once below via the day-pass page
    const form = formFor(p.id);
    if (!form) continue;
    options.push({ kind: "plan", id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, cadence: p.billingCadence, productType: p.productType, url: memberUrl(`/signup/${form.slug}?utm_source=app&utm_medium=booking_gate`) });
  }
  if (loc?.slug) options.push({ kind: "daypass", name: "Day pass", description: "Play today without a membership.", url: memberUrl(`/daypass/${loc.slug}?utm_source=app`) });
  options.push({ kind: "contact", name: loc?.name ?? "Tee24", phone: loc?.phone ?? null, email: loc?.email ?? null });

  return { eligible: false, reason, ...copy[reason], validThrough: null, planName: frozen?.plan.name ?? pending?.plan.name ?? null, guests, options };
}
