import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { guardMarketing } from "../_shared";

export const dynamic = "force-dynamic";

/** GET ?slug=&q= — lightweight member search for pickers (enroll, assign referral, start conversation). */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["member.view", "marketing.manage-automations", "marketing.manage-referrals", "member.bulk-message"]);
  if (!g.ok) return g.response;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const items = await getPrisma().member.findMany({
    where: {
      locationId: g.location.id,
      mergedIntoId: null,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\D/g, "") || q } },
        { referralCode: { equals: q.toUpperCase() } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, referralCode: true },
    take: 10,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return NextResponse.json({ items });
}
