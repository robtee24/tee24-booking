import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { createMember } from "@/services/member.service";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { audit } from "@/lib/audit";
import { emitMemberEvent } from "@/lib/events";
import { isSquareConfigured } from "@/lib/square";
import { createInvoice, ensurePayToken, publicPayUrl, runCharge, vaultCard } from "@/services/billing.service";
import { computeDiscountCents, describeDiscount, redeemDiscountForMember, stackedDiscountCents, validateDiscount } from "@/services/discount.service";
import { recordReferral } from "@/services/referral.service";
import { requiredSignupInputKeys } from "@/lib/signup-form-config";
import { SIGNUP_PHONE_AUDIENCE, verifyPhoneVerificationToken } from "@/lib/phone-verification";
import { parseImageDataUrl, saveMemberPhoto, PhotoError } from "@/services/member-photo.service";
import { signDocument } from "@/services/document.service";
import { isRecurringCadence } from "@/services/recurring-billing.service";
import { addPeriods, familyAddonFor, guestCentsFor, guestLineLabel, maxGuestsFor, membershipDisplayName } from "@/lib/membership-pricing";
import { assertFamilyMemberUnique, assertFamilyPhoneVerified, createFamilyMemberRecord, FamilyAddonError, parseFamilyMemberInput, type FamilyMemberInput } from "@/services/family-addon.service";
import { parseUploadDataUrl, saveMemberUpload, UploadError } from "@/services/member-upload.service";

const GENDERS = new Set(["MALE", "FEMALE", "OTHER", "UNSPECIFIED"]);

function ageOn(dob: Date, on: Date): number {
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

export const dynamic = "force-dynamic";

/**
 * Public signup endpoint (3-step form: plan → details → payment).
 *
 * Requires a `phoneToken` from /api/signup/phone/verify that matches `phone` —
 * the verified mobile number is the member's login. Waivers configured on the
 * form are signed inline (`signatures[]`, plus a parent/guardian co-signature
 * when the member is under 18) and the profile photo (`photoDataUrl`) is stored.
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
 * GET /api/signup?formSlug=&planId=&guestCount=&code=     → discount code preview
 * GET /api/signup?formSlug=&planId=&guestCount=&promoId=  → signup promotion preview
 * The discount is computed on the plan price including any guest add-on.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const formSlug = sp.get("formSlug") ?? "";
  const code = sp.get("code") ?? "";
  const promoId = sp.get("promoId") ?? "";
  const planId = sp.get("planId");
  const guestCount = Math.max(0, Math.floor(Number(sp.get("guestCount") ?? 0)) || 0);
  const prisma = getPrisma();
  const form = await prisma.signupForm.findUnique({ where: { slug: formSlug }, include: { location: { select: { id: true, organizationId: true } } } });
  // /signup-staging previews unpublished forms; the staging flag lets those previews price out too.
  const staging = sp.get("staging") === "1";
  if (!form || (!form.active && !staging)) return NextResponse.json({ ok: false, reason: "Form not found" }, { status: 404 });
  let lookupCode = code;
  if (promoId) {
    const promo = await prisma.discount.findUnique({ where: { id: promoId }, select: { code: true, showOnSignup: true, active: true } });
    if (!promo || !promo.active || !promo.showOnSignup) return NextResponse.json({ ok: false, reason: "That promotion isn't available" });
    lookupCode = promo.code;
  } else if (!form.allowDiscountCode) {
    return NextResponse.json({ ok: false, reason: "Discount codes aren't accepted on this form" });
  }
  const r = await validateDiscount(lookupCode, { planId, signupFormId: form.id, organizationId: form.location?.organizationId ?? null });
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason });
  const plan = planId ? await prisma.membershipPlan.findUnique({ where: { id: planId } }) : null;
  const override = plan && form.location ? await prisma.membershipPricingOverride.findUnique({ where: { planId_locationId: { planId: plan.id, locationId: form.location.id } } }) : null;
  const subtotal = plan ? (override?.priceCents ?? plan.priceCents) + guestCentsFor(plan, guestCount) : null;
  return NextResponse.json({
    ok: true,
    code: r.discount.code,
    id: r.discount.id,
    scope: r.discount.scope,
    description: describeDiscount(r.discount),
    amountCents: subtotal != null ? computeDiscountCents(r.discount, subtotal) : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      formSlug, planId, firstName, lastName, email, phone, phoneToken,
      dob, gender, addressLine1, addressLine2, city, state, zip,
      photoDataUrl, signatures, guardian, emergencyContact,
      smsConsent, emailConsent, utm, referralCode,
      discountCode, sourceId, verificationToken, customFields,
      guestCount: guestCountRaw, promoDiscountId, promoIdDataUrl, promoAcknowledged,
      promoDiscountIds, discountCodes, familyMembers,
      staging,
    } = body;

    if (!formSlug || !planId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The mobile number must have been verified by SMS in this session.
    const verifiedPhone = await verifyPhoneVerificationToken(phoneToken, String(phone), SIGNUP_PHONE_AUDIENCE);
    if (!verifiedPhone) return NextResponse.json({ error: "Please verify your mobile number before continuing." }, { status: 400 });

    if (gender !== undefined && gender !== null && gender !== "" && !GENDERS.has(String(gender))) {
      return NextResponse.json({ error: "Invalid sex value" }, { status: 400 });
    }
    const dobDate = dob ? new Date(dob) : null;
    if (dobDate && Number.isNaN(dobDate.getTime())) return NextResponse.json({ error: "Invalid date of birth" }, { status: 400 });
    const isMinor = dobDate ? ageOn(dobDate, new Date()) < 18 : false;
    const guardianInput = guardian && typeof guardian === "object" && typeof guardian.name === "string" && typeof guardian.signatureSvg === "string" && guardian.name.trim() && guardian.signatureSvg
      ? { name: String(guardian.name).trim().slice(0, 120), signatureSvg: String(guardian.signatureSvg) }
      : null;
    if (isMinor && !guardianInput) return NextResponse.json({ error: "A parent or guardian must sign for members under 18." }, { status: 400 });
    if (photoDataUrl && typeof photoDataUrl !== "string") return NextResponse.json({ error: "Invalid photo" }, { status: 400 });

    const prisma = getPrisma();
    const form = await prisma.signupForm.findUnique({
      where: { slug: formSlug },
      include: { location: true },
    });
    // Submissions from /signup-staging may target forms that are not yet published.
    if (!form || (!form.active && staging !== true) || !form.location) {
      return NextResponse.json({ error: "Form not found or inactive" }, { status: 404 });
    }
    const location = form.location;

    // Required-field overrides configured on the form
    const requiredFields = requiredSignupInputKeys(form.requiredFields, { photoRequired: form.photoRequired });
    const ec = emergencyContact && typeof emergencyContact === "object"
      ? { name: String(emergencyContact.name ?? "").trim().slice(0, 120), phone: String(emergencyContact.phone ?? "").trim().slice(0, 40), relationship: String(emergencyContact.relationship ?? "").trim().slice(0, 60) }
      : null;
    const provided: Record<string, unknown> = { dob, gender, addressLine1, city, state, zip, photo: photoDataUrl, emergencyContact: ec?.name && ec?.phone ? ec : null };
    const labels: Record<string, string> = { dob: "Date of birth", gender: "Sex", addressLine1: "Address", city: "City", state: "State", zip: "ZIP", photo: "Profile photo", emergencyContact: "Emergency contact" };
    for (const key of requiredFields) {
      if (key in provided && !provided[key]) return NextResponse.json({ error: `${labels[key] ?? key} is required` }, { status: 400 });
    }
    if (photoDataUrl) {
      try {
        parseImageDataUrl(photoDataUrl); // validate before we create anything
      } catch (e) {
        return NextResponse.json({ error: e instanceof PhotoError ? e.message : "Invalid photo" }, { status: 400 });
      }
    }

    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const allowed = (form.allowedPlanIds as string[] | null) ?? null;
    if (allowed && allowed.length && !allowed.includes(plan.id)) return NextResponse.json({ error: "Plan not available on this form" }, { status: 400 });

    // Waivers configured on the form must be signed inline.
    const requiredDocIds = (form.requiredDocumentIds as string[] | null) ?? [];
    const requiredDocs = requiredDocIds.length ? await prisma.document.findMany({ where: { id: { in: requiredDocIds }, active: true } }) : [];
    const sigByDoc = new Map<string, string>();
    if (Array.isArray(signatures)) {
      for (const sg of signatures) {
        if (sg && typeof sg.documentId === "string" && typeof sg.signatureSvg === "string" && sg.signatureSvg.startsWith("data:image/")) sigByDoc.set(sg.documentId, sg.signatureSvg);
      }
    }
    const unsigned = requiredDocs.find((d) => !sigByDoc.has(d.id));
    if (unsigned) return NextResponse.json({ error: `Please sign the ${unsigned.name} to continue.` }, { status: 400 });

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.member.findUnique({ where: { locationId_email: { locationId: location.id, email: normalizedEmail } }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists. Sign in to the member portal with your mobile number instead." }, { status: 409 });
    }
    const phoneDigits = verifiedPhone.replace(/\D/g, "").slice(-10);
    const existingPhone = await prisma.member.findFirst({ where: { locationId: location.id, phone: { contains: phoneDigits }, status: { not: "CANCELLED" } }, select: { id: true } });
    if (existingPhone) {
      return NextResponse.json({ error: "This mobile number already belongs to a member here. Sign in to the member portal instead." }, { status: 409 });
    }

    // Location pricing override
    const override = await prisma.membershipPricingOverride.findUnique({ where: { planId_locationId: { planId: plan.id, locationId: location.id } } });
    const basePriceCents = override?.priceCents ?? plan.priceCents;
    const signupFeeCents = override?.signupFeeCents ?? plan.signupFeeCents;

    // Guests: "+ Guest" add-on on memberships, tiered guest pricing on day passes
    const guestCount = Math.max(0, Math.floor(Number(guestCountRaw ?? 0)) || 0);
    if (guestCount > maxGuestsFor(plan)) return NextResponse.json({ error: `${plan.name} allows up to ${maxGuestsFor(plan)} guest${maxGuestsFor(plan) === 1 ? "" : "s"}` }, { status: 400 });
    const guestCents = guestCentsFor(plan, guestCount);
    const priceCents = basePriceCents + guestCents;
    const displayName = membershipDisplayName(plan.name, guestCount, plan.productType);

    // Discounts stack: any number of signup promotions + discount codes (+ the form's
    // auto-apply discount). Each is computed on the membership subtotal; the total is
    // capped at the subtotal. Legacy singular fields are still accepted.
    type Validated = Extract<Awaited<ReturnType<typeof validateDiscount>>, { ok: true }>;
    const applied: Array<{ discount: Validated["discount"]; promo: NonNullable<Awaited<ReturnType<typeof prisma.discount.findUnique>>> | null }> = [];
    const seenDiscountIds = new Set<string>();
    const promoIds = [
      ...(Array.isArray(promoDiscountIds) ? promoDiscountIds : []),
      ...(promoDiscountId ? [promoDiscountId] : []),
    ].map(String).filter((v, i, a) => v && a.indexOf(v) === i);
    const promoIdUploads: Record<string, string> = body.promoIdDataUrls && typeof body.promoIdDataUrls === "object" ? body.promoIdDataUrls : {};
    for (const pid of promoIds) {
      const promo = await prisma.discount.findUnique({ where: { id: pid } });
      if (!promo || !promo.active || !promo.showOnSignup) return NextResponse.json({ error: "That promotion isn't available" }, { status: 400 });
      const v = await validateDiscount(promo.code, { planId: plan.id, signupFormId: form.id, organizationId: location.organizationId });
      if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });
      if (promo.requiresIdUpload) {
        const upload = promoIdUploads[pid] ?? (promoIds.length === 1 ? promoIdDataUrl : null);
        if (typeof upload !== "string" || !upload) return NextResponse.json({ error: `${promo.idUploadLabel ?? "An ID upload"} is required for ${promo.signupTitle ?? promo.name}.` }, { status: 400 });
        try {
          parseUploadDataUrl(upload);
        } catch (e) {
          return NextResponse.json({ error: e instanceof UploadError ? e.message : "Invalid ID upload" }, { status: 400 });
        }
        promoIdUploads[pid] = upload;
      }
      if (promo.commitmentMonths && promo.commitmentAcknowledgement && promoAcknowledged !== true) {
        return NextResponse.json({ error: "Please confirm you understand the promotion terms." }, { status: 400 });
      }
      if (seenDiscountIds.has(v.discount.id)) continue;
      seenDiscountIds.add(v.discount.id);
      applied.push({ discount: v.discount, promo });
    }
    const codes = [
      ...(Array.isArray(discountCodes) ? discountCodes : []),
      ...(discountCode ? [discountCode] : []),
    ].map((c) => String(c).trim()).filter((v, i, a) => v && a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
    if (codes.length && form.allowDiscountCode) {
      for (const code of codes) {
        const v = await validateDiscount(code, { planId: plan.id, signupFormId: form.id, organizationId: location.organizationId });
        if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });
        if (seenDiscountIds.has(v.discount.id)) continue;
        seenDiscountIds.add(v.discount.id);
        applied.push({ discount: v.discount, promo: null });
      }
    }
    if (form.autoApplyDiscountId && !seenDiscountIds.has(form.autoApplyDiscountId)) {
      const auto = await prisma.discount.findUnique({ where: { id: form.autoApplyDiscountId } });
      if (auto?.active) {
        const v = await validateDiscount(auto.code, { planId: plan.id, signupFormId: form.id, organizationId: location.organizationId });
        if (v.ok) {
          seenDiscountIds.add(v.discount.id);
          applied.push({ discount: v.discount, promo: null });
        }
      }
    }
    const discountCents = stackedDiscountCents(applied.map((a) => a.discount), priceCents);
    const promos = applied.filter((a) => a.promo).map((a) => a.promo!);
    const promo = promos[0] ?? null; // kept on the subscription for the admin "promo" tag
    const isRecurringPlan = isRecurringCadence(plan.billingCadence) && plan.productType === "RECURRING";
    const commitmentMonths = isRecurringPlan ? promos.reduce<number | null>((m, p) => (p.commitmentMonths && p.commitmentMonths > (m ?? 0) ? p.commitmentMonths : m), null) : null;
    const earlyCancelFeeCents = commitmentMonths
      ? Math.min(discountCents, promos.filter((p) => p.commitmentMonths && p.earlyCancelPolicy !== "NONE").reduce((sum, p) => sum + computeDiscountCents(p, priceCents), 0))
      : null;

    // Family add-on: extra members at a % off the plan's base price, billed to this account.
    const familyAddon = familyAddonFor(plan);
    const familyRaw: unknown[] = Array.isArray(familyMembers) ? familyMembers : [];
    if (familyRaw.length && !familyAddon) return NextResponse.json({ error: `${plan.name} doesn't include a family add-on` }, { status: 400 });
    if (familyRaw.length && isMinor) return NextResponse.json({ error: "The account holder must be 18 or older to add family members." }, { status: 400 });
    if (familyAddon && familyRaw.length > familyAddon.maxAdditional) return NextResponse.json({ error: `${plan.name} allows up to ${familyAddon.maxAdditional} family members` }, { status: 400 });
    const familyInputs: FamilyMemberInput[] = [];
    try {
      const seen = { emails: new Set<string>([normalizedEmail]), phones: new Set<string>([phoneDigits]) };
      for (let i = 0; i < familyRaw.length; i++) {
        const fi = parseFamilyMemberInput(familyRaw[i], {
          requiredFields,
          requiredDocs,
          index: i,
          // The account holder signs for their minors unless the form collected a separate guardian.
          defaultGuardian: guardianInput ?? { name: `${String(firstName).trim()} ${String(lastName).trim()}`, signatureSvg: sigByDoc.values().next().value ?? "" },
        });
        await assertFamilyPhoneVerified(fi);
        await assertFamilyMemberUnique(location.id, fi, seen);
        familyInputs.push(fi);
      }
    } catch (e) {
      if (e instanceof FamilyAddonError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }

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
      phone: verifiedPhone,
      dob: dobDate,
      status: "PENDING",
      source: utm?.source ?? "signup_form",
      optInEmailMarketing: !!emailConsent,
      optInSmsMarketing: !!smsConsent,
      membershipType: displayName,
    });

    // Set address & referrer link
    await prisma.member.update({
      where: { id: member.id },
      data: {
        gender: gender ? String(gender) : null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        referredById: referrer?.id ?? null,
        smsConsentSource: smsConsent ? "signup_form" : undefined,
        smsConsentAt: smsConsent ? new Date() : undefined,
        guardianName: guardianInput?.name ?? undefined,
      },
    });

    if (ec?.name) {
      await prisma.emergencyContact.create({ data: { memberId: member.id, name: ec.name, phone: ec.phone || null, relationship: ec.relationship || null, isEmergency: true, isPrimary: true } }).catch((e) => console.warn("[signup] emergency contact failed", e));
    }

    // Profile photo
    if (photoDataUrl) {
      try {
        await saveMemberPhoto(member.id, photoDataUrl);
      } catch (e) {
        console.warn("[signup] photo save failed", e);
      }
    }

    // Promotion ID (military / first responder / student / senior …) for staff review
    for (const p of promos) {
      const upload = promoIdUploads[p.id];
      if (p.requiresIdUpload && upload) {
        await saveMemberUpload({ memberId: member.id, kind: "PROMO_ID", label: p.idUploadLabel ?? p.signupTitle ?? p.name, discountId: p.id, dataUrl: upload });
      }
    }

    // Waivers: assign + sign in one go (signatures were collected on the form)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ua = req.headers.get("user-agent");
    for (const d of requiredDocs) {
      const assignment = await prisma.documentAssignment.create({
        data: { documentId: d.id, memberId: member.id, versionAtAssign: d.version, signingToken: crypto.randomUUID(), status: "SENT" },
      });
      await signDocument({ signingToken: assignment.signingToken!, signatureSvg: sigByDoc.get(d.id)!, ipAddress: ip, userAgent: ua, guardian: guardianInput });
    }

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
        autoRenew: isRecurringPlan,
        guestCount,
        guestCents,
        promoDiscountId: promo?.id ?? null,
        commitmentMonths,
        commitmentEndsAt: commitmentMonths ? addPeriods(startDate, plan.billingCadence, commitmentMonths) : null,
        earlyCancelFeeCents: earlyCancelFeeCents && earlyCancelFeeCents > 0 ? earlyCancelFeeCents : null,
      },
    });

    // Family members: full member records, each with a subscription billed to this account.
    const familyCreated: Awaited<ReturnType<typeof createFamilyMemberRecord>>[] = [];
    const primaryForFamily = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
    for (const fi of familyInputs) {
      familyCreated.push(await createFamilyMemberRecord({
        primary: primaryForFamily,
        primarySub: sub,
        plan,
        basePriceCents,
        input: fi,
        requiredDocs,
        status: "PENDING",
        startDate,
        ip,
        userAgent: ua,
        source: utm?.source ?? "signup_form",
      }));
      primaryForFamily.familyAccountId = primaryForFamily.familyAccountId ?? (await prisma.member.findUnique({ where: { id: member.id }, select: { familyAccountId: true } }))?.familyAccountId ?? null;
    }
    // One-off plans (passes, prepaid blocks) are good for plan.durationDays, not a billing period.
    const oneOffPaidThrough = !isRecurringCadence(plan.billingCadence) || plan.productType !== "RECURRING"
      ? new Date(startDate.getTime() + Math.max(1, plan.durationDays ?? 30) * 86_400_000)
      : null;
    const fixOneOffDates = async () => {
      if (!oneOffPaidThrough) return;
      await prisma.membershipSubscription.update({ where: { id: sub.id }, data: { paidThroughDate: oneOffPaidThrough, endDate: oneOffPaidThrough, nextInvoiceDate: null, autoRenew: false } });
    };

    // First invoice: first period + signup fee (− discount, + tax, + surcharge when paying by card)
    const squareReady = await isSquareConfigured(location.id);
    const payingByCard = squareReady && Boolean(sourceId);
    const lines = [{ description: oneOffPaidThrough ? plan.name : `${plan.name} — first ${plan.billingCadence === "YEARLY" ? "year" : plan.billingCadence === "WEEKLY" ? "week" : "month"}`, unitCents: basePriceCents }];
    if (guestCents > 0) lines.push({ description: `Guest add-on — ${guestLineLabel(guestCount, plan.productType)}`, unitCents: guestCents });
    for (const fc of familyCreated) lines.push({ description: fc.lineLabel, unitCents: fc.priceCents });
    if (signupFeeCents > 0) lines.push({ description: "Signup fee", unitCents: signupFeeCents });
    const invoice = await createInvoice({
      organizationId: location.organizationId,
      locationId: location.id,
      memberId: member.id,
      subscriptionId: sub.id,
      description: `${displayName}${familyCreated.length ? ` + ${familyCreated.length} family` : ""} — signup`,
      dueDate: startDate,
      scheduledFor: startDate,
      discountCents,
      taxRateBps: form.collectTax ? location.taxRateBps : 0,
      surchargeBps: location.cardSurchargeBps,
      applySurcharge: payingByCard,
      lines,
    });
    let discountAppliedId: string | null = null;
    let remainingDiscount = discountCents;
    for (const { discount: d } of applied) {
      const cents = Math.min(remainingDiscount, computeDiscountCents(d, priceCents));
      if (cents <= 0) continue;
      remainingDiscount -= cents;
      const app = await prisma.discountApplication.create({ data: { discountId: d.id, memberId: member.id, invoiceId: invoice.id, amountCents: cents } });
      discountAppliedId ??= app.id;
      if (d.scope !== "ONE_TIME") await redeemDiscountForMember(d.id, member.id);
      else await prisma.discount.update({ where: { id: d.id }, data: { totalRedemptions: { increment: 1 } } });
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
        firstName, lastName, email: normalizedEmail, phone: verifiedPhone,
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
      metadata: { signupFormId: form.id, utm, referralCode, discountCodes: applied.map((a) => a.discount.code), promoDiscountIds: promos.map((p) => p.id), guestCount, familyMemberIds: familyCreated.map((f) => f.member.id), commitmentMonths, payingByCard },
    });

    await emitMemberEvent("member.signup", {
      memberId: member.id,
      locationId: location.id,
      organizationId: location.organizationId,
      refs: { subscriptionId: sub.id, invoiceId: invoice.id },
      vars: { planName: displayName, amount: (invoice.totalCents / 100).toFixed(2), firstName, signupFormId: form.id },
    });
    void emitMemberEvent("member.welcome", {
      memberId: member.id,
      locationId: location.id,
      organizationId: location.organizationId,
      refs: { subscriptionId: sub.id },
      vars: { planName: displayName, firstName },
    });

    const payToken = await ensurePayToken(invoice.id);
    const payUrl = publicPayUrl(payToken);
    const redirectUrl = form.confirmationUrl ?? `/portal/welcome?memberId=${member.id}`;

    // Payment step
    if (payingByCard) {
      try {
        const pm = await vaultCard({ memberId: member.id, sourceId: String(sourceId), verificationToken: verificationToken ?? null, setDefault: true, source: "signup" });
        if (invoice.totalCents > 0) await runCharge({ invoiceId: invoice.id, paymentMethodId: pm.id, note: `Signup — ${displayName}` });
        else {
          const { onInvoicePaid } = await import("@/services/billing.service");
          await onInvoicePaid(invoice.id, { paidCents: 0, method: "COMP", receipt: false });
        }
        await fixOneOffDates();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Payment failed";
        const desired = await computeDesiredAccessState(member.id);
        void applyAccessState(member.id, desired);
        for (const fc of familyCreated) void computeDesiredAccessState(fc.member.id).then((d) => applyAccessState(fc.member.id, d)).catch(() => {});
        return NextResponse.json(
          { error: `We couldn't process your card: ${message}`, memberId: member.id, subscriptionId: sub.id, invoiceId: invoice.id, payToken, payUrl, paid: false, redirectUrl },
          { status: 402 },
        );
      }
      return NextResponse.json({ ok: true, memberId: member.id, subscriptionId: sub.id, invoiceId: invoice.id, paid: true, payUrl, redirectUrl, familyMemberIds: familyCreated.map((f) => f.member.id) });
    }

    // Nothing to pay (free pass / 100% discount): activate right away.
    if (invoice.totalCents <= 0) {
      const { onInvoicePaid } = await import("@/services/billing.service");
      await onInvoicePaid(invoice.id, { paidCents: 0, method: "COMP", receipt: false });
      await fixOneOffDates();
      return NextResponse.json({ ok: true, memberId: member.id, subscriptionId: sub.id, invoiceId: invoice.id, paid: true, payUrl, redirectUrl, familyMemberIds: familyCreated.map((f) => f.member.id) });
    }

    // Not paying online: PENDING, access computed (disabled until payment + docs)
    const desired = await computeDesiredAccessState(member.id);
    void applyAccessState(member.id, desired);
    for (const fc of familyCreated) void computeDesiredAccessState(fc.member.id).then((d) => applyAccessState(fc.member.id, d)).catch(() => {});

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
