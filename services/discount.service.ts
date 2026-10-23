/**
 * Discount service — codes, validation, application to invoices.
 *
 * Model notes (schema is frozen):
 *  - Discount.scope: ONE_TIME | RECURRING | FOREVER
 *      ONE_TIME  → first invoice only
 *      RECURRING → `recurringMonths` consecutive invoices (null = forever)
 *      FOREVER   → every invoice
 *  - A member's *enrollment* in a recurring discount is persisted as a
 *    DiscountApplication row with `invoiceId = null` and `amountCents = 0`
 *    (the "marker" row). Each invoice the discount is applied to gets its own
 *    DiscountApplication with the invoice id + amount. `totalRedemptions`
 *    counts marker rows (i.e. members/redemptions), not invoices.
 */
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { Prisma, type Discount } from "@prisma/client";
import type { SignupPromo } from "@/lib/membership-pricing";

export type DiscountScope = "ONE_TIME" | "RECURRING" | "FOREVER";
export type DiscountType = "PERCENT" | "FIXED";

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function computeDiscountCents(d: Pick<Discount, "type" | "value">, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  if (d.type === "PERCENT") return Math.min(subtotalCents, Math.round((subtotalCents * Math.min(100, Math.max(0, d.value))) / 100));
  return Math.min(subtotalCents, Math.max(0, d.value));
}

export function describeDiscount(d: Pick<Discount, "type" | "value" | "scope" | "recurringMonths">): string {
  const amount = d.type === "PERCENT" ? `${d.value}% off` : `$${(d.value / 100).toFixed(2)} off`;
  const scope =
    d.scope === "ONE_TIME" ? "first payment" : d.scope === "FOREVER" || (d.scope === "RECURRING" && !d.recurringMonths) ? "every payment" : `first ${d.recurringMonths} payments`;
  return `${amount} · ${scope}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type DiscountInput = {
  organizationId?: string | null;
  code: string;
  name: string;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
  recurringMonths?: number | null;
  maxRedemptions?: number | null;
  perMemberLimit?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active?: boolean;
  signupFormIds?: string[] | null;
  planIds?: string[] | null;
  // Signup promotion (shown as a selectable offer on the signup form)
  showOnSignup?: boolean;
  signupTitle?: string | null;
  signupDescription?: string | null;
  requiresIdUpload?: boolean;
  idUploadLabel?: string | null;
  commitmentMonths?: number | null;
  commitmentAcknowledgement?: string | null;
  earlyCancelPolicy?: "CHARGE_DISCOUNT_BACK" | "NONE" | null;
  sortOrder?: number;
};

const PROMO_KEYS = ["showOnSignup", "signupTitle", "signupDescription", "requiresIdUpload", "idUploadLabel", "commitmentMonths", "commitmentAcknowledgement", "earlyCancelPolicy", "sortOrder"] as const;

type PromoData = Pick<Prisma.DiscountUncheckedCreateInput, "showOnSignup" | "signupTitle" | "signupDescription" | "requiresIdUpload" | "idUploadLabel" | "commitmentMonths" | "commitmentAcknowledgement" | "earlyCancelPolicy" | "sortOrder">;

function promoData(input: Partial<DiscountInput>): PromoData {
  const d: PromoData = {};
  if (input.showOnSignup !== undefined) d.showOnSignup = !!input.showOnSignup;
  if (input.signupTitle !== undefined) d.signupTitle = input.signupTitle?.trim().slice(0, 120) || null;
  if (input.signupDescription !== undefined) d.signupDescription = input.signupDescription?.trim().slice(0, 600) || null;
  if (input.requiresIdUpload !== undefined) d.requiresIdUpload = !!input.requiresIdUpload;
  if (input.idUploadLabel !== undefined) d.idUploadLabel = input.idUploadLabel?.trim().slice(0, 200) || null;
  if (input.commitmentMonths !== undefined) {
    if (input.commitmentMonths != null && (!Number.isInteger(input.commitmentMonths) || input.commitmentMonths < 1 || input.commitmentMonths > 36)) throw new Error("commitmentMonths must be between 1 and 36");
    d.commitmentMonths = input.commitmentMonths ?? null;
  }
  if (input.commitmentAcknowledgement !== undefined) d.commitmentAcknowledgement = input.commitmentAcknowledgement?.trim().slice(0, 600) || null;
  if (input.earlyCancelPolicy !== undefined) {
    if (input.earlyCancelPolicy != null && !["CHARGE_DISCOUNT_BACK", "NONE"].includes(input.earlyCancelPolicy)) throw new Error("earlyCancelPolicy must be CHARGE_DISCOUNT_BACK or NONE");
    d.earlyCancelPolicy = input.earlyCancelPolicy ?? null;
  }
  if (input.sortOrder !== undefined) d.sortOrder = Math.round(Number(input.sortOrder) || 0);
  return d;
}

function validateInput(input: Partial<DiscountInput>) {
  if (input.type && !["PERCENT", "FIXED"].includes(input.type)) throw new Error("type must be PERCENT or FIXED");
  if (input.scope && !["ONE_TIME", "RECURRING", "FOREVER"].includes(input.scope)) throw new Error("scope must be ONE_TIME, RECURRING or FOREVER");
  if (input.value !== undefined) {
    if (!Number.isFinite(input.value) || input.value <= 0) throw new Error("value must be positive");
    if (input.type === "PERCENT" && input.value > 100) throw new Error("percent discount cannot exceed 100");
  }
}

export async function createDiscount(input: DiscountInput, actorId?: string) {
  validateInput(input);
  const prisma = getPrisma();
  const code = normalizeCode(input.code);
  if (!code) throw new Error("Code is required");
  const existing = await prisma.discount.findUnique({ where: { code } });
  if (existing) throw new Error(`Code ${code} already exists`);
  const discount = await prisma.discount.create({
    data: {
      organizationId: input.organizationId ?? null,
      code,
      name: input.name.trim() || code,
      type: input.type,
      value: Math.round(input.value),
      scope: input.scope,
      recurringMonths: input.scope === "RECURRING" ? input.recurringMonths ?? null : null,
      maxRedemptions: input.maxRedemptions ?? null,
      perMemberLimit: input.perMemberLimit ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      active: input.active ?? true,
      signupFormIds: input.signupFormIds && input.signupFormIds.length ? input.signupFormIds : Prisma.JsonNull,
      planRestrictions: input.planIds && input.planIds.length ? { create: input.planIds.map((planId) => ({ planId })) } : undefined,
      ...promoData(input),
    },
    include: { planRestrictions: true },
  });
  void audit({ organizationId: input.organizationId ?? null, actorId, action: "settings.update", entityType: "Discount", entityId: discount.id, after: discount, metadata: { created: true } });
  return discount;
}

export async function updateDiscount(id: string, patch: Partial<DiscountInput>, actorId?: string) {
  validateInput(patch);
  const prisma = getPrisma();
  const before = await prisma.discount.findUnique({ where: { id }, include: { planRestrictions: true } });
  if (!before) throw new Error("Discount not found");
  const data: Prisma.DiscountUpdateInput = {};
  if (patch.code !== undefined) {
    const code = normalizeCode(patch.code);
    if (!code) throw new Error("Code is required");
    const clash = await prisma.discount.findUnique({ where: { code } });
    if (clash && clash.id !== id) throw new Error(`Code ${code} already exists`);
    data.code = code;
  }
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.value !== undefined) data.value = Math.round(patch.value);
  if (patch.scope !== undefined) {
    data.scope = patch.scope;
    data.recurringMonths = patch.scope === "RECURRING" ? patch.recurringMonths ?? before.recurringMonths : null;
  } else if (patch.recurringMonths !== undefined) data.recurringMonths = patch.recurringMonths;
  if (patch.maxRedemptions !== undefined) data.maxRedemptions = patch.maxRedemptions;
  if (patch.perMemberLimit !== undefined) data.perMemberLimit = patch.perMemberLimit;
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.signupFormIds !== undefined) data.signupFormIds = patch.signupFormIds && patch.signupFormIds.length ? patch.signupFormIds : Prisma.JsonNull;
  if (patch.planIds !== undefined) {
    data.planRestrictions = {
      deleteMany: {},
      create: (patch.planIds ?? []).map((planId) => ({ planId })),
    };
  }
  if (PROMO_KEYS.some((k) => patch[k] !== undefined)) Object.assign(data, promoData(patch));
  const after = await prisma.discount.update({ where: { id }, data, include: { planRestrictions: true } });
  void audit({ organizationId: before.organizationId, actorId, action: "settings.update", entityType: "Discount", entityId: id, before, after });
  return after;
}

export async function setDiscountActive(id: string, active: boolean, actorId?: string) {
  return updateDiscount(id, { active }, actorId);
}

export async function listDiscounts(organizationId: string | null | undefined) {
  return getPrisma().discount.findMany({
    where: { OR: [{ organizationId: organizationId ?? null }, { organizationId: null }] },
    orderBy: [{ active: "desc" }, { code: "asc" }],
    include: {
      _count: { select: { applications: { where: { invoiceId: { not: null } } }, planRestrictions: true } },
      planRestrictions: { include: { plan: { select: { id: true, name: true } } } },
    },
  });
}

/**
 * Promotions to offer on a public signup form: active, in window, flagged
 * `showOnSignup`, and not restricted to other forms. Plan restrictions are
 * returned so the form can show/hide each promo per selected plan.
 */
export async function listSignupPromos(ctx: { organizationId?: string | null; signupFormId: string; now?: Date }): Promise<SignupPromo[]> {
  const now = ctx.now ?? new Date();
  const rows = await getPrisma().discount.findMany({
    where: {
      active: true,
      showOnSignup: true,
      OR: [{ organizationId: ctx.organizationId ?? null }, { organizationId: null }],
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    include: { planRestrictions: { select: { planId: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows
    .filter((d) => {
      const formIds = (d.signupFormIds as string[] | null) ?? null;
      if (formIds && formIds.length && !formIds.includes(ctx.signupFormId)) return false;
      if (d.maxRedemptions != null && d.totalRedemptions >= d.maxRedemptions) return false;
      return true;
    })
    .map((d) => ({
      id: d.id,
      code: d.code,
      title: d.signupTitle?.trim() || d.name,
      description: d.signupDescription ?? null,
      type: d.type,
      value: d.value,
      scope: d.scope,
      recurringMonths: d.recurringMonths,
      requiresIdUpload: d.requiresIdUpload,
      idUploadLabel: d.idUploadLabel,
      commitmentMonths: d.commitmentMonths,
      commitmentAcknowledgement: d.commitmentAcknowledgement,
      planIds: d.planRestrictions.map((r) => r.planId),
    }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidateDiscountCtx = {
  planId?: string | null;
  signupFormId?: string | null;
  memberId?: string | null;
  organizationId?: string | null;
  now?: Date;
};

export type ValidateDiscountResult =
  | { ok: true; discount: Discount & { planRestrictions: { planId: string }[] } }
  | { ok: false; reason: string };

export async function validateDiscount(code: string, ctx: ValidateDiscountCtx = {}): Promise<ValidateDiscountResult> {
  const prisma = getPrisma();
  const normalized = normalizeCode(code ?? "");
  if (!normalized) return { ok: false, reason: "Enter a discount code" };
  const discount = await prisma.discount.findUnique({ where: { code: normalized }, include: { planRestrictions: { select: { planId: true } } } });
  if (!discount || !discount.active) return { ok: false, reason: "That code isn't valid" };
  if (ctx.organizationId && discount.organizationId && discount.organizationId !== ctx.organizationId) return { ok: false, reason: "That code isn't valid here" };
  const now = ctx.now ?? new Date();
  if (discount.startsAt && discount.startsAt > now) return { ok: false, reason: "That code isn't active yet" };
  if (discount.endsAt && discount.endsAt < now) return { ok: false, reason: "That code has expired" };
  if (discount.maxRedemptions != null && discount.totalRedemptions >= discount.maxRedemptions) return { ok: false, reason: "That code has reached its redemption limit" };
  if (discount.planRestrictions.length && ctx.planId && !discount.planRestrictions.some((r) => r.planId === ctx.planId)) {
    return { ok: false, reason: "That code doesn't apply to the selected plan" };
  }
  const formIds = (discount.signupFormIds as string[] | null) ?? null;
  if (formIds && formIds.length && ctx.signupFormId && !formIds.includes(ctx.signupFormId)) return { ok: false, reason: "That code can't be used on this form" };
  if (ctx.memberId && discount.perMemberLimit != null) {
    const used = await prisma.discountApplication.count({ where: { discountId: discount.id, memberId: ctx.memberId, invoiceId: null } });
    if (used >= discount.perMemberLimit) return { ok: false, reason: "You've already used this code" };
  }
  return { ok: true, discount };
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/** Enrol a member in a discount (marker row). Idempotent per (discount, member) unless perMemberLimit allows more. */
export async function redeemDiscountForMember(discountId: string, memberId: string, actorId?: string | null) {
  const prisma = getPrisma();
  const marker = await prisma.discountApplication.create({ data: { discountId, memberId, invoiceId: null, amountCents: 0 } });
  await prisma.discount.update({ where: { id: discountId }, data: { totalRedemptions: { increment: 1 } } });
  void audit({ actorId: actorId ?? undefined, action: "billing.discount-apply", entityType: "DiscountApplication", entityId: marker.id, metadata: { discountId, memberId, marker: true } });
  return marker;
}

/**
 * Apply a discount to a specific invoice: writes the DiscountApplication,
 * updates `discountCents` and recomputes tax/total. Returns the applied cents.
 */
export async function applyDiscountToInvoice(invoiceId: string, discount: Pick<Discount, "id" | "type" | "value">, actorId?: string | null): Promise<number> {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true, location: { select: { taxRateBps: true, cardSurchargeBps: true } } } });
  if (!inv) throw new Error("Invoice not found");
  if (!["SCHEDULED", "PAST_DUE", "FAILED"].includes(inv.status)) throw new Error("Only open invoices can be discounted");
  const already = await prisma.discountApplication.findFirst({ where: { invoiceId, discountId: discount.id } });
  if (already) return already.amountCents;

  const subtotal = inv.lineItems.reduce((s, l) => s + l.totalCents, 0);
  const amountCents = computeDiscountCents(discount, Math.max(0, subtotal - inv.discountCents));
  if (amountCents <= 0) return 0;

  const { computeInvoiceMath } = await import("./billing.service");
  const math = computeInvoiceMath({
    subtotalCents: subtotal,
    discountCents: inv.discountCents + amountCents,
    taxRateBps: inv.location.taxRateBps,
    surchargeBps: inv.location.cardSurchargeBps,
    applySurcharge: inv.surchargeCents > 0,
  });
  await prisma.$transaction([
    prisma.discountApplication.create({ data: { discountId: discount.id, memberId: inv.memberId, invoiceId, amountCents } }),
    prisma.invoice.update({ where: { id: invoiceId }, data: math }),
  ]);
  void audit({ organizationId: inv.organizationId, actorId: actorId ?? undefined, action: "billing.discount-apply", entityType: "Invoice", entityId: invoiceId, metadata: { discountId: discount.id, amountCents } });
  return amountCents;
}

/**
 * Validate + redeem + apply a code to an open invoice (hosted pay page, admin).
 */
export async function applyDiscountCodeToInvoice(invoiceId: string, code: string, actorId?: string | null) {
  const prisma = getPrisma();
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { subscription: { select: { planId: true } } } });
  if (!inv) throw new Error("Invoice not found");
  const result = await validateDiscount(code, { planId: inv.subscription?.planId, memberId: inv.memberId, organizationId: inv.organizationId });
  if (!result.ok) throw new Error(result.reason);
  const amountCents = await applyDiscountToInvoice(invoiceId, result.discount, actorId);
  if (amountCents > 0 && result.discount.scope !== "ONE_TIME") {
    await redeemDiscountForMember(result.discount.id, inv.memberId, actorId);
  } else if (amountCents > 0) {
    await prisma.discount.update({ where: { id: result.discount.id }, data: { totalRedemptions: { increment: 1 } } });
  }
  return { discount: result.discount, amountCents };
}

/**
 * Tiny helper for the members worker: attach a discount code to a subscription
 * so future recurring invoices pick it up (and apply it to any currently open
 * invoice on that subscription).
 */
export async function applyDiscountCode(subscriptionId: string, code: string, actorId?: string | null) {
  const prisma = getPrisma();
  const sub = await prisma.membershipSubscription.findUnique({ where: { id: subscriptionId }, include: { member: { select: { organizationId: true } } } });
  if (!sub) throw new Error("Subscription not found");
  const result = await validateDiscount(code, { planId: sub.planId, memberId: sub.memberId, organizationId: sub.member.organizationId });
  if (!result.ok) throw new Error(result.reason);
  await redeemDiscountForMember(result.discount.id, sub.memberId, actorId);
  const open = await prisma.invoice.findFirst({ where: { subscriptionId, status: { in: ["SCHEDULED", "PAST_DUE", "FAILED"] } }, orderBy: { dueDate: "asc" } });
  let appliedCents = 0;
  if (open) appliedCents = await applyDiscountToInvoice(open.id, result.discount, actorId);
  return { discount: result.discount, appliedToInvoiceId: open?.id ?? null, appliedCents };
}

/**
 * For recurring invoice generation: find the discount (if any) that should
 * apply to the member's next invoice on this plan, honouring scope limits.
 */
export async function findRecurringDiscountForMember(memberId: string, planId: string): Promise<Discount | null> {
  const prisma = getPrisma();
  const markers = await prisma.discountApplication.findMany({
    where: { memberId, invoiceId: null },
    include: { discount: { include: { planRestrictions: { select: { planId: true } } } } },
    orderBy: { appliedAt: "desc" },
  });
  for (const m of markers) {
    const d = m.discount;
    if (!d.active || d.scope === "ONE_TIME") continue;
    if (d.planRestrictions.length && !d.planRestrictions.some((r) => r.planId === planId)) continue;
    if (d.endsAt && d.endsAt < new Date()) continue;
    if (d.scope === "RECURRING" && d.recurringMonths != null) {
      const used = await prisma.discountApplication.count({ where: { memberId, discountId: d.id, invoiceId: { not: null } } });
      if (used >= d.recurringMonths) continue;
    }
    return d;
  }
  return null;
}

export async function getDiscountUsage(discountId: string) {
  const prisma = getPrisma();
  const [applications, totals] = await Promise.all([
    prisma.discountApplication.findMany({
      where: { discountId, invoiceId: { not: null } },
      orderBy: { appliedAt: "desc" },
      take: 100,
    }),
    prisma.discountApplication.aggregate({ where: { discountId, invoiceId: { not: null } }, _sum: { amountCents: true }, _count: true }),
  ]);
  const memberIds = Array.from(new Set(applications.map((a) => a.memberId).filter((x): x is string => Boolean(x))));
  const invoiceIds = applications.map((a) => a.invoiceId).filter((x): x is string => Boolean(x));
  const [members, invoices] = await Promise.all([
    prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, number: true, status: true, totalCents: true } }),
  ]);
  const mById = new Map(members.map((m) => [m.id, m]));
  const iById = new Map(invoices.map((i) => [i.id, i]));
  return {
    totalSavedCents: totals._sum.amountCents ?? 0,
    invoiceCount: totals._count,
    rows: applications.map((a) => ({
      id: a.id,
      appliedAt: a.appliedAt,
      amountCents: a.amountCents,
      member: a.memberId ? mById.get(a.memberId) ?? null : null,
      invoice: a.invoiceId ? iById.get(a.invoiceId) ?? null : null,
    })),
  };
}
