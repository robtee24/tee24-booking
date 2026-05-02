import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/access";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const locationSlug = sp.get("locationSlug");
  const includeArchived = sp.get("includeArchived") === "1";

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
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { locationSlug, ...rest } = body;

  let organizationId: string | null = null;
  if (locationSlug) {
    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { organizationId: true },
    });
    organizationId = location?.organizationId ?? null;
  }

  if (!rest.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const plan = await getPrisma().membershipPlan.create({
    data: {
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
