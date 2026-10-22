import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { createMember } from "@/services/member.service";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { isSquareConfigured } from "@/lib/square";
import { createInvoice, ensurePayToken, publicPayUrl, runCharge, vaultCard } from "@/services/billing.service";
import { computeDiscountCents, describeDiscount, redeemDiscountForMember, validateDiscount } from "@/services/discount.service";
import { recordReferral } from "@/services/referral.service";
import { requiredSignupInputKeys } from "@/lib/signup-form-config";

export const dynamic = "force-dynamic";

/**
 * Public signup endpoint.
 *
 * Always: creates Member (PENDING) + MembershipSubscription (PENDING) + Visitor
 * (funnel) + the first Invoice (signup fee + first period, discount, tax).
 *
 * When Square is configured and the client sent a card token (`sourceId`):
 * vault the card → charge the first invoice → on success the subscription is
 * ACTIVE with paidThroughDate/nextInvoiceDate set (via onInvoicePaid), and
 * `membership.activated` fires. On decline we return 402 with the hosted pay
 * link so the member can retry with another card.
 *
 * When Square is NOT configured the member/subscription stay PENDING (today's
 * behaviour) and the invoice is SCHEDULED for the front desk to collect.
 *
 * GET /api/signup?formSlug=&planId=&code=  → discount code preview for the form.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const formSlug = sp.get("formSlug") ?? "";
  const code = sp.get("code") ?? "";
  const planId = sp.get("planId");
  const prisma = getPrisma();
  const form = await prisma.signupForm.findUnique({ where: { slug: formSlug }, include: { location: { select: { organizationId: true } } } });
  if (!form || !form.active) return NextResponse.json({ ok: false, reason: "Form not found" }, { status: 404 });
  if (!form.allowDiscountCode) return NextResponse.json({ ok: false, reason: "Discount codes aren't accepted on this form" });
  const r = await validateDiscount(code, { planId, signupFormId: form.id, organizationId: form.location?.organizationId ?? null });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason });
  const plan = planId ? await prisma.membershipPlan.findUnique({ where: { id: planId } }) : null;
  return NextResponse.json({
    ok: true,
    code: r.discount.code,
    description: describeDiscount(r.discount),
    amountCents: plan ? computeDiscountCents(r.discount, plan.priceCents) : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      formSlug, planId, firstName, lastName, email, phone,
      dob, addressLine1, city, state, zip,
      smsConsent, emailConsent, utm, referralCode,
      discountCode, sourceId, verificationToken, customFields,
    } = body;

    if (!formSlug || !planId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const prisma = getPrisma();
    const form = await prisma.signupForm.findUnique({
      where: { slug: formSlug },
      include: { location: true },
    });
    if (!form || !form.active || !form.location) {
      return NextResponse.json({ error: "Form not found or inactive" }, { status: 404 });
    }
    const location = form.location;

    // Required-field overrides configured on the form
    const requiredFields = requiredSignupInputKeys(form.requiredFields, { photoRequired: form.photoRequired });
    const provided: Record<string, unknown> = { dob, addressLine1, city, state, zip };
    for (const key of requiredFields) {
      if (key in provided && !provided[key]) return NextResponse.json({ error: `${key} is required` }, { status: 400 });
    }

    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const allowed = (form.allowedPlanIds as string[] | null) ?? null;
    if (allowed && allowed.length && !allowed.includes(plan.id)) return NextResponse.json({ error: "Plan not available on this form" }, { status: 400 });

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.member.findUnique({ where: { locationId_email: { locationId: location.id, email: normalizedEmail } }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists. Sign in to the member portal or contact the front desk." }, { status: 409 });
    }

    // Location pricing override
    const override = await prisma.membershipPricingOverride.findUnique({ where: { planId_locationId: { planId: plan.id, locationId: location.id } } });
    const priceCents = override?.priceCents ?? plan.priceCents;
    const signupFeeCents = override?.signupFeeCents ?? plan.signupFeeCents;

    // Discount: explicit code (if allowed) or the form's auto-apply discount
    let discount: Awaited<ReturnType<typeof validateDiscount>> | null = null;
    if (discountCode && form.allowDiscountCode) {
      discount = await validateDiscount(String(discountCode), { planId: plan.id, signupFormId: form.id, organizationId: location.organizationId });
      if (!discount.ok) return NextResponse.json({ error: discount.reason }, { status: 400 });
    } else if (form.autoApplyDiscountId) {
      const auto = await prisma.discount.findUnique({ where: { id: form.autoApplyDiscountId } });
      if (auto?.active) discount = await validateDiscount(auto.code, { planId: plan.id, signupFormId: form.id, organizationId: location.organizationId });
      if (discount && !discount.ok) discount = null;
    }
    const discountCents = discount?.ok ? computeDiscountCents(discount.discount, priceCents) : 0;

    // Optional referrer lookup
    const referrer = referralCode
      ? await prisma.member.findUnique({ where: { referralCode: String(referralCode) } })
      : null;

    const member = await createMember({
      organizationId: location.organizationId,
      locationId: location.id,
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      dob: dob ? new Date(dob) : null,
      status: "PENDING",
      source: utm?.source ?? "signup_form",
      optInEmailMarketing: !!emailConsent,
      optInSmsMarketing: !!smsConsent,
      membershipType: plan.name,
    });

    // Set address & referrer link
    await prisma.member.update({
      where: { id: member.id },
      data: {
        addressLine1: addressLine1 || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        referredById: referrer?.id ?? null,
        smsConsentSource: smsConsent ? "signup_form" : undefined,
      },
    });

    // Custom field values configured on the form
    const customFieldIds = (form.customFieldIds as string[] | null) ?? [];
    if (customFieldIds.length && customFields && typeof customFields === "object") {
      const defs = await prisma.customFieldDefinition.findMany({ where: { id: { in: customFieldIds } } });
      for (const def of defs) {
        const raw = (customFields as Record<string, unknown>)[def.id];
        if (raw === undefined || raw === null || raw === "") {
          if (def.required) return NextResponse.json({ error: `${def.name} is required` }, { status: 400 });
          continue;
        }
        const data: { valueText?: string; valueNumber?: number; valueDate?: Date; valueJson?: unknown } = {};
        if (def.type === "NUMBER") data.valueNumber = Number(raw);
        else if (def.type === "DATE") data.valueDate = new Date(String(raw));
        else if (def.type === "BOOLEAN") data.valueJson = Boolean(raw);
        else if (def.type === "MULTI_SELECT") data.valueJson = Array.isArray(raw) ? raw : [raw];
        else data.valueText = String(raw);
        await prisma.customFieldValue.create({ data: { fieldId: def.id, memberId: member.id, ...(data as Record<string, never>) } }).catch(() => {});
      }
    }

    // Subscription (PENDING until the first invoice is paid)
    const startDate = new Date();
    const sub = await prisma.membershipSubscription.create({
      data: {
        memberId: member.id,
        planId: plan.id,
        locationId: location.id,
        status: "PENDING",
        startDate,
        priceCents,
        signupFeeCents,
        billingCadence: plan.billingCadence,
        autoRenew: true,
      },
    });

    // First invoice: first period + signup fee (− discount, + tax, + surcharge when paying by card)
    const squareReady = await isSquareConfigured(location.id);
    const payingByCard = squareReady && Boolean(sourceId);
    const lines = [{ description: `${plan.name} — first ${plan.billingCadence === "YEARLY" ? "year" : plan.billingCadence === "WEEKLY" ? "week" : "month"}`, unitCents: priceCents }];
    if (signupFeeCents > 0) lines.push({ description: "Signup fee", unitCents: signupFeeCents });
    const invoice = await createInvoice({
      organizationId: location.organizationId,
      locationId: location.id,
      memberId: member.id,
      subscriptionId: sub.id,
      description: `${plan.name} — signup`,
      dueDate: startDate,
      scheduledFor: startDate,
      discountCents,
      taxRateBps: form.collectTax ? location.taxRateBps : 0,
      surchargeBps: location.cardSurchargeBps,
      applySurcharge: payingByCard,
      lines,
    });
    let discountAppliedId: string | null = null;
    if (discount?.ok && discountCents > 0) {
      const app = await prisma.discountApplication.create({ data: { discountId: discount.discount.id, memberId: member.id, invoiceId: invoice.id, amountCents: discountCents } });
      discountAppliedId = app.id;
      if (discount.discount.scope !== "ONE_TIME") await redeemDiscountForMember(discount.discount.id, member.id);
      else await prisma.discount.update({ where: { id: discount.discount.id }, data: { totalRedemptions: { increment: 1 } } });
    }

    // Visitor record for funnel
    await prisma.visitor.upsert({
      where: { convertedToMemberId: member.id },
      create: {
        organizationId: location.organizationId,
        locationId: location.id,
        stage: "CONVERTED",
        source: utm?.source ?? null,
        utmSource: utm?.source ?? null,
        utmMedium: utm?.medium ?? null,
        utmCampaign: utm?.campaign ?? null,
        utmTerm: utm?.term ?? null,
        utmContent: utm?.content ?? null,
        firstName, lastName, email: normalizedEmail, phone,
        convertedToMemberId: member.id,
      },
      update: { stage: "CONVERTED" },
    });

    // Auto-tags from form config
    const autoTagIds = (form.autoTagIds as string[] | null) ?? null;
    if (autoTagIds && autoTagIds.length > 0) {
      await Promise.all(autoTagIds.map((tagId) =>
        prisma.memberTag.create({ data: { memberId: member.id, tagId } }).catch(() => {})
      ));
    }

    // Required docs from form config — assign each
    const requiredDocIds = (form.requiredDocumentIds as string[] | null) ?? null;
    if (requiredDocIds && requiredDocIds.length > 0) {
      const docs = await prisma.document.findMany({ where: { id: { in: requiredDocIds }, active: true } });
      await Promise.all(docs.map((d) =>
        prisma.documentAssignment.create({
          data: {
            documentId: d.id,
            memberId: member.id,
            versionAtAssign: d.version,
            signingToken: crypto.randomUUID(),
            status: "SENT",
          },
        })
      ));
    }

    // Referral attribution (reward kind/amount is configured via REFERRAL_REWARD_CENTS; 0 = attribution only)
    if (referrer && referrer.id !== member.id) {
      const earnedCents = Math.max(0, Math.floor(Number(process.env.REFERRAL_REWARD_CENTS ?? 0)) || 0);
      await recordReferral({ referrerId: referrer.id, referredMemberId: member.id, signupFormId: form.id, earnedCents, earnedKind: "CREDIT", discountAppliedId }).catch((e) => console.warn("[signup] recordReferral failed", e));
    }

    void audit({
      organizationId: location.organizationId,
      action: "membership.create",
      entityType: "MembershipSubscription",
      entityId: sub.id,
      after: { memberId: member.id, planId: plan.id, status: "PENDING", invoiceId: invoice.id },
      metadata: { signupFormId: form.id, utm, referralCode, discountCode: discount?.ok ? discount.discount.code : null, payingByCard },
    });

    await emitMemberEvent("member.signup", {
      memberId: member.id,
      locationId: location.id,
      organizationId: location.organizationId,
      refs: { subscriptionId: sub.id, invoiceId: invoice.id },
      vars: { planName: plan.name, amount: (invoice.totalCents / 100).toFixed(2), firstName, signupFormId: form.id },
    });

    const payToken = await ensurePayToken(invoice.id);
    const payUrl = publicPayUrl(payToken);
    const redirectUrl = form.confirmationUrl ?? `/portal/welcome?memberId=${member.id}`;

    // Payment step
    if (payingByCard) {
      try {
        const pm = await vaultCard({ memberId: member.id, sourceId: String(sourceId), verificationToken: verificationToken ?? null, setDefault: true, source: "signup" });
        if (invoice.totalCents > 0) await runCharge({ invoiceId: invoice.id, paymentMethodId: pm.id, note: `Signup — ${plan.name}` });
        else {
          const { onInvoicePaid } = await import("@/services/billing.service");
          await onInvoicePaid(invoice.id, { paidCents: 0, method: "COMP", receipt: false });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Payment failed";
        const desired = await computeDesiredAccessState(member.id);
        void applyAccessState(member.id, desired);
        return NextResponse.json(
          { error: `We couldn't process your card: ${message}`, memberId: member.id, subscriptionId: sub.id, invoiceId: invoice.id, payToken, payUrl, paid: false, redirectUrl },
          { status: 402 },
        );
      }
      return NextResponse.json({ ok: true, memberId: member.id, subscriptionId: sub.id, invoiceId: invoice.id, paid: true, payUrl, redirectUrl });
    }

    // Not paying online: PENDING, access computed (disabled until payment + docs)
    const desired = await computeDesiredAccessState(member.id);
    void applyAccessState(member.id, desired);

    return NextResponse.json({
      ok: true,
      memberId: member.id,
      subscriptionId: sub.id,
      invoiceId: invoice.id,
      paid: false,
      payUrl,
      redirectUrl,
    });
  } catch (e: unknown) {
    console.error("[signup] error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
