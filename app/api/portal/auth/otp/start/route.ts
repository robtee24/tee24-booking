// POST /api/portal/auth/otp/start { phone } — text a sign-in code to a member's mobile.
// Always 200 for well-formed numbers (no account enumeration); the SMS is only
// sent when a member with that number exists.
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { otpService } from "@/services/otp.service";
import { toE164 } from "@/lib/phone";
import { clientIp, otpSendAllowed } from "@/lib/otp-throttle";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json().catch(() => ({}));
    if (!phone || typeof phone !== "string") return NextResponse.json({ error: "Phone number required" }, { status: 400 });
    let e164: string;
    try {
      e164 = toE164(phone);
    } catch {
      return NextResponse.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    }
    const gate = await otpSendAllowed(e164, clientIp(req.headers));
    if (!gate.ok) return NextResponse.json({ error: `Please wait ${gate.retryInSeconds}s before requesting another code.` }, { status: 429 });

    const digits = e164.replace(/\D/g, "").slice(-10);
    const member = await getPrisma().member.findFirst({ where: { phone: { contains: digits }, mergedIntoId: null }, select: { id: true } });
    if (member) await otpService.requestOtp(e164, "customer_booking");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to send code" }, { status: 400 });
  }
}
