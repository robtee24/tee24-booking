import { NextRequest, NextResponse } from "next/server";
import { parsePlanBody, PlanInputError } from "@/lib/admin/plan-input";
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

  let parsed;
  try {
    parsed = parsePlanBody(rest);
  } catch (e) {
    if (e instanceof PlanInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const { dayPassGuestPricing, ...planFields } = parsed;

  const plan = await getPrisma().membershipPlan.create({
    data: {
      organizationId,
      productType: "RECURRING",
      category: "MEMBER",
      billingCadence: "MONTHLY",
      ...planFields,
      name: parsed.name!,
      dayPassGuestPricing: dayPassGuestPricing ?? undefined,
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
