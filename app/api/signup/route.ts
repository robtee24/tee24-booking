import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { createMember } from "@/services/member.service";
import { applyAccessState, computeDesiredAccessState } from "@/lib/access-sync";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Public signup endpoint. Creates the Member, MembershipSubscription, and
 * Visitor (for funnel attribution). Does NOT actually charge — that step
 * happens via Square card tokenization in the form. Once the Square payment
 * succeeds, the subscription transitions to ACTIVE via the Square webhook.
 *
 * v1 simplification: members are created in PENDING; AccessSync will lift
 * Kisi to enabled once payment + required docs are settled.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      formSlug, planId, firstName, lastName, email, phone,
      dob, addressLine1, city, state, zip,
      smsConsent, emailConsent, utm, referralCode,
    } = body;

    if (!formSlug || !planId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const prisma = getPrisma();
    const form = await prisma.signupForm.findUnique({
      where: { slug: formSlug },
      include: { location: { select: { id: true, organizationId: true } } },
    });
    if (!form || !form.active || !form.location) {
      return NextResponse.json({ error: "Form not found or inactive" }, { status: 404 });
    }

    const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

    // Optional referrer lookup
    const referrer = referralCode
      ? await prisma.member.findUnique({ where: { referralCode } })
      : null;

    const member = await createMember({
      organizationId: form.location.organizationId,
      locationId: form.location.id,
      firstName,
      lastName,
      email,
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
      },
    });

    // Subscription (PENDING until Square confirms first payment)
    const sub = await prisma.membershipSubscription.create({
      data: {
        memberId: member.id,
        planId: plan.id,
        locationId: form.location.id,
        status: "PENDING",
        startDate: new Date(),
        priceCents: plan.priceCents,
        signupFeeCents: plan.signupFeeCents,
        billingCadence: plan.billingCadence,
      },
    });

    // Visitor record for funnel
    await prisma.visitor.upsert({
      where: { convertedToMemberId: member.id },
      create: {
        organizationId: form.location.organizationId,
        locationId: form.location.id,
        stage: "CONVERTED",
        source: utm?.source ?? null,
        utmSource: utm?.source ?? null,
        utmMedium: utm?.medium ?? null,
        utmCampaign: utm?.campaign ?? null,
        utmTerm: utm?.term ?? null,
        utmContent: utm?.content ?? null,
        firstName, lastName, email, phone,
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

    // Compute initial access state (will be PENDING/disabled until payment + docs)
    const desired = await computeDesiredAccessState(member.id);
    void applyAccessState(member.id, desired);

    void audit({
      organizationId: form.location.organizationId,
      action: "membership.create",
      entityType: "MembershipSubscription",
      entityId: sub.id,
      after: { memberId: member.id, planId: plan.id, status: "PENDING" },
      metadata: { signupFormId: form.id, utm, referralCode },
    });

    return NextResponse.json({
      ok: true,
      memberId: member.id,
      subscriptionId: sub.id,
      redirectUrl: form.confirmationUrl ?? `/portal/welcome?memberId=${member.id}`,
    });
  } catch (e: any) {
    console.error("[signup] error", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
