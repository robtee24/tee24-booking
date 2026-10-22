import { NextRequest, NextResponse } from "next/server";
import { guardInbox } from "../_shared";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET ?q= — members across every accessible location (for "New message"). */
export async function GET(req: NextRequest) {
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const digits = q.replace(/\D/g, "");
  const items = await getPrisma().member.findMany({
    where: {
      mergedIntoId: null,
      ...(g.locationIds ? { locationId: { in: g.locationIds } } : {}),
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: [{ status: "asc" }, { lastName: "asc" }],
    take: 12,
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, location: { select: { name: true, slug: true } } },
  });
  return NextResponse.json({ items: items.map((m) => ({ ...m, phone: m.phone ?? "" })) });
}
