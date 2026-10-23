import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireAdminApi, requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { assertCan } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { apiError } from "@/app/api/admin/members/_shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  const includeArchived = sp.get("includeArchived") === "1";
  const guard = locationSlug ? await requireLocationAdminApi({ locationSlug }) : await requireAdminApi();
  if (!guard.ok) return guard.response;

  const where: any = {};
  if (!includeArchived) where.archived = false;

  if (locationSlug) {
    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { organizationId: true },
    });
    if (location) {
      where.OR = [{ organizationId: location.organizationId }, { organizationId: null }];
    }
  }

  const plans = await getPrisma().membershipPlan.findMany({
    where,
    orderBy: [{ archived: "asc" }, { name: "asc" }],
    include: { _count: { select: { subscriptions: true } } },
  });

  return NextResponse.json({ plans });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { locationSlug, ...rest } = body;
  const guard = locationSlug ? await requireLocationAdminApi({ locationSlug }) : await requireAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin;
  const actor = await getActorContext();

  let organizationId: string | null = null;
  let locationId: string | null = null;
  if (locationSlug) {
    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true, organizationId: true },
    });
    organizationId = location?.organizationId ?? null;
    locationId = location?.id ?? null;
  }
  try {
    assertCan(actor, "membership.create", { locationId });
  } catch (e) {
    return apiError(e);
  }

  if (!rest.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const visitsPerPeriod = rest.visitsPerPeriod == null || rest.visitsPerPeriod === "" ? null : Number(rest.visitsPerPeriod);
  if (visitsPerPeriod != null && (!Number.isInteger(visitsPerPeriod) || visitsPerPeriod < 1 || visitsPerPeriod > 365)) {
    return NextResponse.json({ error: "visitsPerPeriod must be a whole number between 1 and 365" }, { status: 400 });
  }
  const visitPeriod = rest.visitPeriod === "ROLLING_WEEK" ? "ROLLING_WEEK" : "ROLLING_MONTH";

  const plan = await getPrisma().membershipPlan.create({
    data: {
      visitsPerPeriod,
      visitPeriod,
      organizationId,
      name: rest.name,
      description: rest.description ?? null,
      productType: rest.productType ?? "RECURRING",
      category: rest.category ?? "MEMBER",
      priceCents: rest.priceCents ?? 0,
      signupFeeCents: rest.signupFeeCents ?? 0,
      billingCadence: rest.billingCadence ?? "MONTHLY",
      durationDays: rest.durationDays ?? null,
      familyBundle: rest.familyBundle ?? false,
      cancellationPolicy: rest.cancellationPolicy ?? null,
      freezePolicy: rest.freezePolicy ?? null,
      kisiDoorGroups: rest.kisiDoorGroups ?? null,
    },
  });

  void audit({
    organizationId,
    actorId: admin.id,
    action: "membership.create",
    entityType: "MembershipPlan",
    entityId: plan.id,
    after: plan,
  });

  return NextResponse.json({ plan });
}
