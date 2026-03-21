import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const locationSlug = req.nextUrl.searchParams.get("locationSlug");
    const status = req.nextUrl.searchParams.get("status");
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "50", 10)));
    const skip = (page - 1) * limit;

    if (!locationSlug) {
      return NextResponse.json({ error: "locationSlug is required" }, { status: 400 });
    }

    const location = await getPrisma().location.findUnique({
      where: { slug: locationSlug },
      select: { id: true },
    });
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const where: any = { locationId: location.id };

    if (status && status !== "ALL") {
      where.status = status.toUpperCase();
    }

    if (q) {
      where.OR = [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ];
    }

    const [members, total, countActive, countVisitor, countCancelled, countFrozen] = await Promise.all([
      getPrisma().member.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip,
        take: limit,
      }),
      getPrisma().member.count({ where }),
      getPrisma().member.count({ where: { locationId: location.id, status: "ACTIVE" } }),
      getPrisma().member.count({ where: { locationId: location.id, status: "VISITOR" } }),
      getPrisma().member.count({ where: { locationId: location.id, status: "CANCELLED" } }),
      getPrisma().member.count({ where: { locationId: location.id, status: "FROZEN" } }),
    ]);

    const totalAll = countActive + countVisitor + countCancelled + countFrozen;

    return NextResponse.json({
      members,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts: {
        ALL: totalAll,
        ACTIVE: countActive,
        VISITOR: countVisitor,
        CANCELLED: countCancelled,
        FROZEN: countFrozen,
      },
    });
  } catch (e: any) {
    console.error("[Members list] Error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
