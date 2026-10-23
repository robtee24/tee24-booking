// POST /api/portal/auth/otp/verify { phone, code } — sets the portal session cookie.
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { otpService } from "@/services/otp.service";
import { toE164 } from "@/lib/phone";
import { setMemberSession } from "@/lib/member-session";

export const dynamic = "force-dynamic";

const STATUS_RANK: Record<string, number> = { ACTIVE: 0, FROZEN: 1, PENDING: 2, VISITOR: 3, CANCELLED: 4 };

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json().catch(() => ({}));
    if (!phone || !code) return NextResponse.json({ error: "Phone and code required" }, { status: 400 });
    const e164 = toE164(String(phone));
    const result = await otpService.verifyOtp(e164, String(code));
    if (!result.ok) {
      return NextResponse.json({ error: result.reason === "EXPIRED" ? "That code expired — request a new one." : "That code isn't right. Check the text and try again." }, { status: 401 });
    }
    const digits = e164.replace(/\D/g, "").slice(-10);
    const members = await getPrisma().member.findMany({
      where: { phone: { contains: digits }, mergedIntoId: null },
      select: { id: true, status: true, updatedAt: true },
    });
    if (members.length === 0) return NextResponse.json({ error: "We couldn't find a member with that mobile number." }, { status: 404 });
    // Prefer the active record when one number belongs to several (e.g. two locations).
    members.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || b.updatedAt.getTime() - a.updatedAt.getTime());
    await setMemberSession(members[0]!.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 400 });
  }
}
