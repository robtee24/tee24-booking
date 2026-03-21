import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MEMBERSHIP_PRICING: Record<string, { fees: string; recurrence: string }> = {
  "$250 pga membership": { fees: "$250.00", recurrence: "month" },
  "ca discount - noonan ( limited membership 3x per month)": { fees: "$42.00", recurrence: "month" },
  "ca discount - noonan (limited membership 3x per month)": { fees: "$42.00", recurrence: "month" },
  "ca discount - tin cup / mcavoy (unlimited membership)": { fees: "$70.00", recurrence: "month" },
  "ca discount - tin cup / mcavoy + guest (unlimited membership)": { fees: "$87.50", recurrence: "month" },
  "gilmore unlimited day pass | 24 hour door access sent after purchase": { fees: "$50.00", recurrence: "1-day pass" },
  "lessons | 10 pack": { fees: "$600.00", recurrence: "month" },
  "lessons | 5 pack": { fees: "$350.00", recurrence: "month" },
  "lessons | single lesson (45 min)": { fees: "$85.00", recurrence: "month" },
  "noonan ( limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "noonan (limited membership 3x per month)": { fees: "$60.00", recurrence: "month" },
  "tin cup / mcavoy (unlimited membership)": { fees: "$100.00", recurrence: "month" },
  "tin cup / mcavoy + guest (unlimited membership)": { fees: "$125.00", recurrence: "month" },
  "tin cup / mcavoy + guest discounted | first responder | vet | senior | students (unlimited membership)": { fees: "$95.00", recurrence: "month" },
  "waiting list - refundable deposit - applied toward first month": { fees: "$50.00", recurrence: "month" },
};

function lookupPricing(title: string): { fees: string; recurrence: string } | null {
  const key = title.toLowerCase().trim();
  if (MEMBERSHIP_PRICING[key]) return MEMBERSHIP_PRICING[key];
  for (const [k, v] of Object.entries(MEMBERSHIP_PRICING)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

function parseMembershipField(raw: string): { title: string; startDate: Date | null } {
  if (!raw) return { title: "", startDate: null };
  const dateMatch = raw.match(/,\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) {
    const title = raw.substring(0, dateMatch.index!).trim();
    const d = new Date(dateMatch[1]);
    return { title, startDate: isNaN(d.getTime()) ? null : d };
  }
  return { title: raw.trim(), startDate: null };
}

export async function POST(req: NextRequest) {
  try {
    const { locationSlug } = await req.json();

    const where: any = {};
    if (locationSlug) {
      const location = await getPrisma().location.findUnique({
        where: { slug: locationSlug },
        select: { id: true },
      });
      if (!location) {
        return NextResponse.json({ error: "Location not found" }, { status: 404 });
      }
      where.locationId = location.id;
    }

    const members = await getPrisma().member.findMany({
      where,
      select: { id: true, membershipType: true, membershipStartDate: true, membershipFees: true, membershipRecurrence: true },
    });

    let updated = 0;
    for (const m of members) {
      if (!m.membershipType) continue;

      const hasDate = /,\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(m.membershipType);
      const needsPricing = !m.membershipFees;

      if (!hasDate && !needsPricing) continue;

      const { title, startDate } = parseMembershipField(m.membershipType);
      const pricing = title ? lookupPricing(title) : null;

      const data: any = {};
      if (hasDate && title) {
        data.membershipType = title;
      }
      if (startDate && !m.membershipStartDate) {
        data.membershipStartDate = startDate;
      }
      if (pricing && !m.membershipFees) {
        data.membershipFees = pricing.fees;
        data.membershipRecurrence = pricing.recurrence;
      }

      if (Object.keys(data).length > 0) {
        await getPrisma().member.update({ where: { id: m.id }, data });
        updated++;
      }
    }

    return NextResponse.json({ ok: true, total: members.length, updated });
  } catch (e: any) {
    console.error("[Members reparse] Error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
