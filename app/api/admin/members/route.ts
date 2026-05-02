import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { listMembers, createMember } from "@/services/member.service";
import { getCurrentAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const locationSlug = sp.get("locationSlug");
    const status = sp.get("status");
    const search = (sp.get("search") || sp.get("q"))?.trim() || undefined;
    const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "100", 10)));

    if (!locationSlug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }

    const prisma = getPrisma();
    const location = await prisma.location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const result = await listMembers({
      locationId: location.id,
      status: status && status !== "ALL" ? (status.toUpperCase() as any) : undefined,
      search,
      sortBy: "name",
      sortDir: "asc",
      limit,
    });

    const [countActive, countVisitor, countCancelled, countFrozen, countPending] = await Promise.all([
      prisma.member.count({ where: { locationId: location.id, status: "ACTIVE" } }),
      prisma.member.count({ where: { locationId: location.id, status: "VISITOR" } }),
      prisma.member.count({ where: { locationId: location.id, status: "CANCELLED" } }),
      prisma.member.count({ where: { locationId: location.id, status: "FROZEN" } }),
      prisma.member.count({ where: { locationId: location.id, status: "PENDING" } }),
    ]);
    const total = countActive + countVisitor + countCancelled + countFrozen + countPending;

    return NextResponse.json({
      items: result.items,
      nextCursor: result.nextCursor,
      counts: {
        ALL: total,
        ACTIVE: countActive,
        VISITOR: countVisitor,
        CANCELLED: countCancelled,
        FROZEN: countFrozen,
        PENDING: countPending,
      },
      // Back-compat: keep .members and .total fields for callers that haven't migrated
      members: result.items,
      total,
    });
  } catch (e: any) {
    console.error("[Members list] Error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await getCurrentAdmin();
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { locationSlug, ...rest } = body;
    if (!locationSlug) return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true, organizationId: true },
    });
    if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

    if (!rest.firstName || !rest.lastName || !rest.email || !rest.phone) {
      return NextResponse.json({ error: "firstName, lastName, email and phone are required" }, { status: 400 });
    }

    const member = await createMember({
      locationId: location.id,
      organizationId: location.organizationId,
      firstName: rest.firstName,
      lastName: rest.lastName,
      email: rest.email,
      phone: rest.phone,
      dob: rest.dob ? new Date(rest.dob) : null,
      gender: rest.gender ?? null,
      status: rest.status ?? "PENDING",
      membershipType: rest.membershipType ?? null,
      optInEmailMarketing: rest.optInEmailMarketing ?? true,
      optInSmsMarketing: rest.optInSmsMarketing ?? false,
      actorId: admin.id,
    });

    return NextResponse.json({ member });
  } catch (e: any) {
    console.error("[Members create] Error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
