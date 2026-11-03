/**
 * Family add-on — a member on a recurring plan (The Noonan, The Tin Cup) can add
 * up to N family members at a percentage off the plan's base price. Each family
 * member is a complete member in their own right (name, email, mobile, photo,
 * birthdate, sex, signed waiver) with their own subscription and door access,
 * but their subscription is billed to the account holder:
 *
 *   MembershipSubscription.billedToMemberId       = account holder
 *   MembershipSubscription.familyOfSubscriptionId = account holder's subscription
 *   MembershipSubscription.familyDiscountPercent  = e.g. 50
 *
 * Recurring billing folds ACTIVE family subscriptions into the holder's invoice
 * as extra lines (recurring-billing.service) and `onInvoicePaid` advances them
 * together (billing.service). The FamilyAccount / FamilyMember tables link the
 * people for the admin UI.
 *
 * Used by: POST /api/signup (family members added at checkout), the portal and
 * mobile "Add a family member" flows (added later, prorated), and removal.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { familyAddonFor, familyLineLabel, familyMemberCents, type FamilyAddon } from "@/lib/membership-pricing";
import { requiredSignupInputKeys } from "@/lib/signup-form-config";
import { createMember } from "@/services/member.service";
import { parseImageDataUrl, saveMemberPhoto, PhotoError } from "@/services/member-photo.service";
import { signDocument } from "@/services/document.service";
import { chargeInvoiceWithDefaultCard, createInvoice, ensurePayToken, publicPayUrl } from "@/services/billing.service";
import { isSquareConfigured } from "@/lib/square";
import type { FamilyRole } from "@/services/family.service";
import { addFamilyMember as linkFamilyMember, createFamily } from "@/services/family.service";
import type { Document, Member, MembershipPlan, MembershipSubscription, Prisma } from "@prisma/client";

export class FamilyAddonError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const GENDERS = new Set(["MALE", "FEMALE", "OTHER", "UNSPECIFIED"]);
const RELATIONSHIPS: FamilyRole[] = ["SPOUSE", "CHILD", "PARENT", "GUARDIAN", "OTHER"];

export function ageOn(dob: Date, on: Date): number {
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

/** What the signup form / portal / app send for one family member. */
export type FamilyMemberInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: Date | null;
  gender: string | null;
  relationship: FamilyRole;
  photoDataUrl: string | null;
  /** documentId → signature data URL (same documents as the account holder signs) */
  signatures: Map<string, string>;
  /** Parent/guardian co-signature when the family member is under 18 (the account holder usually signs). */
  guardian: { name: string; signatureSvg: string } | null;
};

type ParseCtx = {
  requiredFields: string[]; // from requiredSignupInputKeys(form.requiredFields, …)
  requiredDocs: Pick<Document, "id" | "name">[];
  /** Fallback guardian when the family member is a minor and didn't bring their own (the account holder). */
  defaultGuardian?: { name: string; signatureSvg: string } | null;
  index: number;
};

/** Validate one raw family-member object from a request body. Throws FamilyAddonError. */
export function parseFamilyMemberInput(raw: unknown, ctx: ParseCtx): FamilyMemberInput {
  const who = `Family member ${ctx.index + 1}`;
  if (!raw || typeof raw !== "object") throw new FamilyAddonError(`${who}: missing details`);
  const r = raw as Record<string, unknown>;
  const str = (k: string, max = 120) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, max) : "");

  const firstName = str("firstName", 80);
  const lastName = str("lastName", 80);
  if (!firstName || !lastName) throw new FamilyAddonError(`${who}: first and last name are required`);
  const label = `${firstName} ${lastName}`;

  const email = str("email", 160).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FamilyAddonError(`${label}: a valid email is required`);

  const phoneRaw = str("phone", 40);
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  if (phoneDigits.length < 10) throw new FamilyAddonError(`${label}: a mobile number is required (they'll use it to sign in)`);
  const phone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

  const dobStr = str("dob", 20);
  const dob = dobStr ? new Date(dobStr) : null;
  if (dob && Number.isNaN(dob.getTime())) throw new FamilyAddonError(`${label}: invalid date of birth`);
  if (ctx.requiredFields.includes("dob") && !dob) throw new FamilyAddonError(`${label}: date of birth is required`);

  const genderStr = str("gender", 20).toUpperCase();
  if (genderStr && !GENDERS.has(genderStr)) throw new FamilyAddonError(`${label}: invalid sex value`);
  if (ctx.requiredFields.includes("gender") && !genderStr) throw new FamilyAddonError(`${label}: sex is required`);

  const rel = str("relationship", 20).toUpperCase() as FamilyRole;
  const relationship: FamilyRole = RELATIONSHIPS.includes(rel) ? rel : "OTHER";

  const photoDataUrl = typeof r.photoDataUrl === "string" && r.photoDataUrl ? r.photoDataUrl : null;
  if (ctx.requiredFields.includes("photo") && !photoDataUrl) throw new FamilyAddonError(`${label}: a profile photo is required`);
  if (photoDataUrl) {
    try {
      parseImageDataUrl(photoDataUrl);
    } catch (e) {
      throw new FamilyAddonError(`${label}: ${e instanceof PhotoError ? e.message : "invalid photo"}`);
    }
  }

  const signatures = new Map<string, string>();
  if (Array.isArray(r.signatures)) {
    for (const sg of r.signatures as unknown[]) {
      if (sg && typeof sg === "object") {
        const s = sg as Record<string, unknown>;
        if (typeof s.documentId === "string" && typeof s.signatureSvg === "string" && s.signatureSvg.startsWith("data:image/")) signatures.set(s.documentId, s.signatureSvg);
      }
    }
  }
  const unsigned = ctx.requiredDocs.find((d) => !signatures.has(d.id));
  if (unsigned) throw new FamilyAddonError(`${label}: please sign the ${unsigned.name}`);

  const g = r.guardian && typeof r.guardian === "object" ? (r.guardian as Record<string, unknown>) : null;
  let guardian = g && typeof g.name === "string" && typeof g.signatureSvg === "string" && g.name.trim() && g.signatureSvg
    ? { name: String(g.name).trim().slice(0, 120), signatureSvg: String(g.signatureSvg) }
    : null;
  const isMinor = dob ? ageOn(dob, new Date()) < 18 : false;
  if (isMinor && !guardian) guardian = ctx.defaultGuardian ?? null;
  if (isMinor && !guardian) throw new FamilyAddonError(`${label} is under 18 — a parent or guardian must sign for them`);

  return { firstName, lastName, email, phone, dob, gender: genderStr || null, relationship, photoDataUrl, signatures, guardian };
}

/** Resolve the plan's family add-on or explain why there isn't one. */
export function requireFamilyAddon(plan: Pick<MembershipPlan, "name" | "productType" | "familyBundle" | "familyDiscountConfig">): FamilyAddon {
  const addon = familyAddonFor(plan);
  if (!addon) throw new FamilyAddonError(`${plan.name} doesn't include a family add-on`);
  return addon;
}

export async function countFamilySubs(primarySubscriptionId: string): Promise<number> {
  return getPrisma().membershipSubscription.count({
    where: { familyOfSubscriptionId: primarySubscriptionId, status: { in: ["PENDING", "ACTIVE", "CANCEL_SCHEDULED", "FROZEN"] } },
  });
}

/** Make sure the family member's email/mobile aren't already an account at this location. */
export async function assertFamilyMemberUnique(locationId: string, input: Pick<FamilyMemberInput, "email" | "phone" | "firstName" | "lastName">, alsoNotIn: { emails: Set<string>; phones: Set<string> }) {
  const prisma = getPrisma();
  const label = `${input.firstName} ${input.lastName}`;
  if (alsoNotIn.emails.has(input.email)) throw new FamilyAddonError(`${label}: each family member needs their own email address`);
  const digits = input.phone.replace(/\D/g, "").slice(-10);
  if (alsoNotIn.phones.has(digits)) throw new FamilyAddonError(`${label}: each family member needs their own mobile number`);
  const existingEmail = await prisma.member.findUnique({ where: { locationId_email: { locationId, email: input.email } }, select: { id: true } });
  if (existingEmail) throw new FamilyAddonError(`${label}: an account with ${input.email} already exists. They can sign in on their own.`, 409);
  const existingPhone = await prisma.member.findFirst({ where: { locationId, phone: { contains: digits }, status: { not: "CANCELLED" } }, select: { id: true } });
  if (existingPhone) throw new FamilyAddonError(`${label}: that mobile number already belongs to a member here.`, 409);
  alsoNotIn.emails.add(input.email);
  alsoNotIn.phones.add(digits);
}

export type CreateFamilyMemberOpts = {
  primary: Pick<Member, "id" | "organizationId" | "locationId" | "firstName" | "lastName" | "familyAccountId" | "optInEmailMarketing" | "optInSmsMarketing">;
  primarySub: Pick<MembershipSubscription, "id" | "planId" | "locationId" | "billingCadence" | "paidThroughDate" | "nextInvoiceDate" | "startDate">;
  plan: Pick<MembershipPlan, "id" | "name" | "productType" | "familyBundle" | "familyDiscountConfig" | "billingCadence">;
  basePriceCents: number; // plan price at this location (after override), before guests
  input: FamilyMemberInput;
  requiredDocs: Pick<Document, "id" | "version">[];
  status: "PENDING" | "ACTIVE";
  startDate: Date;
  ip?: string | null;
  userAgent?: string | null;
  source?: string;
  actorId?: string | null;
};

/**
 * Create the member + family link + billed-to subscription for one family member.
 * Does not create an invoice — the caller decides how it's billed (bundled on the
 * holder's signup invoice, or a prorated invoice when added later).
 */
export async function createFamilyMemberRecord(opts: CreateFamilyMemberOpts) {
  const prisma = getPrisma();
  const addon = requireFamilyAddon(opts.plan);
  const priceCents = familyMemberCents(opts.basePriceCents, addon.percentOff);
  const { input } = opts;

  const member = await createMember({
    organizationId: opts.primary.organizationId,
    locationId: opts.primary.locationId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    dob: input.dob,
    gender: input.gender,
    status: opts.status,
    source: opts.source ?? "family_addon",
    optInEmailMarketing: opts.primary.optInEmailMarketing,
    optInSmsMarketing: false, // they haven't consented themselves; first OTP login is transactional
    membershipType: `${opts.plan.name} (family)`,
    guardianName: input.guardian?.name,
  });

  if (input.photoDataUrl) {
    await saveMemberPhoto(member.id, input.photoDataUrl).catch((e) => console.warn("[family-addon] photo save failed", e));
  }

  for (const d of opts.requiredDocs) {
    const sig = input.signatures.get(d.id);
    if (!sig) continue;
    const assignment = await prisma.documentAssignment.create({
      data: { documentId: d.id, memberId: member.id, versionAtAssign: d.version, signingToken: crypto.randomUUID(), status: "SENT" },
    });
    await signDocument({ signingToken: assignment.signingToken!, signatureSvg: sig, ipAddress: opts.ip ?? null, userAgent: opts.userAgent ?? null, guardian: input.guardian });
  }

  // Family link (FamilyAccount is created lazily on the first add)
  let familyId = opts.primary.familyAccountId;
  if (!familyId) {
    const fam = await createFamily({ name: `${opts.primary.lastName} family`, primaryMemberId: opts.primary.id, actorId: opts.actorId ?? undefined });
    familyId = fam.id;
  }
  await linkFamilyMember({ familyId, memberId: member.id, role: input.relationship, actorId: opts.actorId ?? undefined });

  const sub = await prisma.membershipSubscription.create({
    data: {
      memberId: member.id,
      planId: opts.plan.id,
      locationId: opts.primarySub.locationId,
      status: opts.status,
      startDate: opts.startDate,
      priceCents,
      signupFeeCents: 0,
      billingCadence: opts.primarySub.billingCadence,
      autoRenew: true,
      guestCount: 0,
      guestCents: 0,
      billedToMemberId: opts.primary.id,
      familyOfSubscriptionId: opts.primarySub.id,
      familyDiscountPercent: addon.percentOff,
      paidThroughDate: opts.status === "ACTIVE" ? opts.primarySub.paidThroughDate : null,
      nextInvoiceDate: opts.primarySub.nextInvoiceDate,
    },
  });

  void audit({
    organizationId: opts.primary.organizationId,
    actorId: opts.actorId ?? undefined,
    action: "membership.create",
    entityType: "MembershipSubscription",
    entityId: sub.id,
    after: { memberId: member.id, planId: opts.plan.id, status: opts.status, priceCents },
    metadata: { familyAddon: true, billedToMemberId: opts.primary.id, familyOfSubscriptionId: opts.primarySub.id, percentOff: addon.percentOff, relationship: input.relationship },
  });

  return { member, sub, priceCents, percentOff: addon.percentOff, lineLabel: familyLineLabel(`${input.firstName} ${input.lastName}`, opts.plan.name, addon.percentOff) };
}

/* ───────────────────────── Portal / mobile: add later ───────────────────────── */

export type FamilyContext = {
  primary: Member;
  primarySub: MembershipSubscription & { plan: MembershipPlan; location: { id: string; slug: string; name: string; taxRateBps: number; cardSurchargeBps: number; timezone: string; organizationId: string | null } };
  addon: FamilyAddon;
  basePriceCents: number;
  existing: Array<{ subscriptionId: string; memberId: string; firstName: string; lastName: string; status: string; priceCents: number; relationship: string | null; paidThroughDate: Date | null; photoUrl: string | null }>;
  form: { id: string; slug: string; requiredFields: string[]; requiredDocs: Pick<Document, "id" | "name" | "version" | "bodyHtml">[] } | null;
};

/** Everything the portal / app need to render "Family" for the signed-in member. */
export async function getFamilyContext(memberId: string): Promise<FamilyContext | { unavailable: string }> {
  const prisma = getPrisma();
  const primary = await prisma.member.findUnique({ where: { id: memberId } });
  if (!primary) throw new FamilyAddonError("Member not found", 404);

  const primarySub = await prisma.membershipSubscription.findFirst({
    where: { memberId, status: { in: ["ACTIVE", "CANCEL_SCHEDULED", "PENDING"] }, billedToMemberId: null, plan: { productType: "RECURRING" } },
    include: { plan: true, location: { select: { id: true, slug: true, name: true, taxRateBps: true, cardSurchargeBps: true, timezone: true, organizationId: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!primarySub) {
    const asFamily = await prisma.membershipSubscription.findFirst({ where: { memberId, billedToMemberId: { not: null }, status: { in: ["ACTIVE", "PENDING", "CANCEL_SCHEDULED"] } }, select: { billedTo: { select: { firstName: true } } } });
    if (asFamily) return { unavailable: `Your membership is part of ${asFamily.billedTo?.firstName ?? "the account holder"}'s family plan. Changes are made from their account.` };
    return { unavailable: "Family members can be added to an active monthly membership." };
  }
  const addon = familyAddonFor(primarySub.plan);
  if (!addon) return { unavailable: `${primarySub.plan.name} doesn't include a family add-on.` };

  const override = await prisma.membershipPricingOverride.findUnique({ where: { planId_locationId: { planId: primarySub.planId, locationId: primarySub.locationId } } });
  const basePriceCents = override?.priceCents ?? primarySub.plan.priceCents;

  const existingSubs = await prisma.membershipSubscription.findMany({
    where: { familyOfSubscriptionId: primarySub.id, status: { in: ["PENDING", "ACTIVE", "CANCEL_SCHEDULED", "FROZEN"] } },
    include: { member: { select: { id: true, firstName: true, lastName: true, photoUrl: true, family: { select: { role: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  // The location's signup form tells us which fields/waivers a member needs.
  const form = await prisma.signupForm.findFirst({
    where: { locationId: primarySub.locationId, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, requiredFields: true, photoRequired: true, requiredDocumentIds: true },
  }).catch(() => null);
  const requiredDocIds = (form?.requiredDocumentIds as string[] | null) ?? [];
  const requiredDocs = requiredDocIds.length
    ? await prisma.document.findMany({ where: { id: { in: requiredDocIds }, active: true }, select: { id: true, name: true, version: true, bodyHtml: true } })
    : [];

  return {
    primary,
    primarySub,
    addon,
    basePriceCents,
    existing: existingSubs.map((s) => ({
      subscriptionId: s.id,
      memberId: s.member.id,
      firstName: s.member.firstName,
      lastName: s.member.lastName,
      status: s.status,
      priceCents: s.priceCents,
      relationship: s.member.family?.role ?? null,
      paidThroughDate: s.paidThroughDate,
      photoUrl: s.member.photoUrl,
    })),
    form: form
      ? { id: form.id, slug: form.slug, requiredFields: requiredSignupInputKeys(form.requiredFields, { photoRequired: form.photoRequired }), requiredDocs }
      : { id: "", slug: "", requiredFields: ["dob", "gender", "photo"], requiredDocs },
  };
}

/** JSON shape shared by the portal and the app. */
export type FamilyView = ReturnType<typeof serializeFamily>;
export function serializeFamily(ctx: Awaited<ReturnType<typeof getFamilyContext>>) {
  if ("unavailable" in ctx) return { available: false as const, reason: ctx.unavailable };
  return {
    available: true as const,
    planName: ctx.primarySub.plan.name,
    percentOff: ctx.addon.percentOff,
    maxAdditional: ctx.addon.maxAdditional,
    basePriceCents: ctx.basePriceCents,
    memberPriceCents: familyMemberCents(ctx.basePriceCents, ctx.addon.percentOff),
    billingCadence: ctx.primarySub.billingCadence,
    nextInvoiceDate: ctx.primarySub.nextInvoiceDate?.toISOString() ?? null,
    members: ctx.existing.map((m) => ({ ...m, paidThroughDate: m.paidThroughDate?.toISOString() ?? null })),
    requiredFields: ctx.form?.requiredFields ?? [],
    documents: (ctx.form?.requiredDocs ?? []).map((d) => ({ id: d.id, name: d.name, bodyHtml: d.bodyHtml })),
  };
}

/** Prorated charge for the days left in the holder's current period. */
export function prorateForRemainingPeriod(fullCents: number, periodStart: Date | null, periodEnd: Date | null, now = new Date()): number {
  if (!periodEnd || periodEnd <= now) return fullCents;
  const start = periodStart && periodStart < now ? periodStart : now;
  const totalMs = periodEnd.getTime() - start.getTime();
  const leftMs = periodEnd.getTime() - now.getTime();
  if (totalMs <= 0) return fullCents;
  return Math.max(0, Math.round(fullCents * Math.min(1, leftMs / totalMs)));
}

/**
 * Add a family member from the portal / app. Creates the member, bills the
 * remainder of the current period to the holder (default card if there is one,
 * otherwise a pay link), and from the next renewal the family line rides on the
 * holder's invoice.
 */
export async function addFamilyMemberToAccount(memberId: string, raw: unknown, meta: { ip?: string | null; userAgent?: string | null }) {
  const prisma = getPrisma();
  const ctx = await getFamilyContext(memberId);
  if ("unavailable" in ctx) throw new FamilyAddonError(ctx.unavailable);
  if (ctx.primarySub.status === "PENDING") throw new FamilyAddonError("Finish your own signup payment first, then add family members.");
  const used = ctx.existing.length;
  if (used >= ctx.addon.maxAdditional) throw new FamilyAddonError(`Your plan allows up to ${ctx.addon.maxAdditional} family member${ctx.addon.maxAdditional === 1 ? "" : "s"}.`);

  const input = parseFamilyMemberInput(raw, {
    requiredFields: ctx.form?.requiredFields ?? [],
    requiredDocs: ctx.form?.requiredDocs ?? [],
    index: used,
  });
  const seen = { emails: new Set<string>([ctx.primary.email.toLowerCase()]), phones: new Set<string>([ctx.primary.phone.replace(/\D/g, "").slice(-10)]) };
  await assertFamilyMemberUnique(ctx.primary.locationId, input, seen);

  const now = new Date();
  const created = await createFamilyMemberRecord({
    primary: ctx.primary,
    primarySub: ctx.primarySub,
    plan: ctx.primarySub.plan,
    basePriceCents: ctx.basePriceCents,
    input,
    requiredDocs: ctx.form?.requiredDocs ?? [],
    status: "PENDING",
    startDate: now,
    ip: meta.ip,
    userAgent: meta.userAgent,
    source: "portal_family_addon",
    actorId: memberId,
  });

  // Prorate the rest of the holder's current period.
  const periodEnd = ctx.primarySub.paidThroughDate ?? ctx.primarySub.nextInvoiceDate;
  const periodStart = periodEnd ? new Date(periodEnd.getTime() - 30 * 86_400_000) : null;
  const proratedCents = prorateForRemainingPeriod(created.priceCents, periodStart, periodEnd, now);
  const squareReady = await isSquareConfigured(ctx.primarySub.locationId);
  const defaultCard = squareReady
    ? await prisma.paymentMethod.findFirst({ where: { memberId, status: { not: "EXPIRED" }, squareCardId: { not: null } }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] })
    : null;

  const invoice = await createInvoice({
    organizationId: ctx.primary.organizationId,
    locationId: ctx.primarySub.locationId,
    memberId,
    subscriptionId: created.sub.id,
    description: `${created.lineLabel} — rest of current period`,
    dueDate: now,
    scheduledFor: now,
    discountCents: 0,
    taxRateBps: ctx.primarySub.location.taxRateBps,
    surchargeBps: ctx.primarySub.location.cardSurchargeBps,
    applySurcharge: Boolean(defaultCard) && ctx.primarySub.location.cardSurchargeBps > 0,
    lines: [{ description: `${created.lineLabel}${periodEnd ? ` — through ${periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: ctx.primarySub.location.timezone })}` : ""}`, unitCents: proratedCents }],
  }, memberId);

  let paid = false;
  let failureReason: string | null = null;
  if (invoice.totalCents <= 0) {
    const { onInvoicePaid } = await import("@/services/billing.service");
    await onInvoicePaid(invoice.id, { paidCents: 0, method: "COMP", receipt: false });
    paid = true;
  } else if (defaultCard) {
    try {
      await chargeInvoiceWithDefaultCard(invoice.id, memberId);
      paid = true;
    } catch (e) {
      failureReason = e instanceof Error ? e.message : "Card declined";
    }
  }
  const payToken = paid ? null : await ensurePayToken(invoice.id);
  const payUrl = payToken ? publicPayUrl(payToken) : null;

  if (!paid) {
    const desired = await computeDesiredAccessState(created.member.id);
    void applyAccessState(created.member.id, desired);
  }

  void emitMemberEvent("member.welcome", {
    memberId: created.member.id,
    locationId: ctx.primary.locationId,
    organizationId: ctx.primary.organizationId,
    refs: { subscriptionId: created.sub.id },
    vars: { planName: `${ctx.primarySub.plan.name} (family)`, firstName: created.member.firstName },
  });

  return {
    memberId: created.member.id,
    subscriptionId: created.sub.id,
    invoiceId: invoice.id,
    priceCents: created.priceCents,
    chargedCents: invoice.totalCents,
    paid,
    payUrl,
    failureReason,
  };
}

/** Account holder ends a family member's membership at the end of the paid period. */
export async function removeFamilyMemberFromAccount(memberId: string, familySubscriptionId: string) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: familySubscriptionId }, include: { member: { select: { id: true, firstName: true, lastName: true } } } });
  if (!sub || sub.billedToMemberId !== memberId) throw new FamilyAddonError("That family member isn't on your account", 404);
  if (sub.status === "CANCELLED") return { subscriptionId: sub.id, endsAt: sub.endDate };
  const now = new Date();
  const endsAt = sub.paidThroughDate && sub.paidThroughDate > now ? sub.paidThroughDate : now;
  const immediate = endsAt <= now;
  const data: Prisma.MembershipSubscriptionUpdateInput = immediate
    ? { status: "CANCELLED", cancelledAt: now, endDate: now, autoRenew: false }
    : { status: "CANCEL_SCHEDULED", cancelRequestedAt: now, endDate: endsAt, autoRenew: false };
  await prisma.membershipSubscription.update({ where: { id: sub.id }, data });
  void audit({ actorId: memberId, actorRole: "MEMBER", action: immediate ? "membership.cancel-immediate" : "membership.cancel-schedule", entityType: "MembershipSubscription", entityId: sub.id, metadata: { familyAddon: true, endsAt } });
  if (immediate) {
    const desired = await computeDesiredAccessState(sub.memberId);
    void applyAccessState(sub.memberId, desired);
  }
  return { subscriptionId: sub.id, endsAt, immediate, name: `${sub.member.firstName} ${sub.member.lastName}` };
}
