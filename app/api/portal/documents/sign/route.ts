// POST /api/portal/documents/sign
// Body: { token, typedName, signatureDataUrl, initialsDataUrl?, guardianName?, consent: true }
// Public by design: the signing token *is* the credential (emailed/texted
// link), so a member who isn't logged in can still sign. If a portal session
// exists it must belong to the same member.
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { PortalError, signFromPortal } from "@/services/portal.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(body.token ?? "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "token required" }, { status: 400 });

    const session = await getMemberSession().catch(() => null);
    if (session?.sub) {
      const a = await getPrisma().documentAssignment.findUnique({ where: { signingToken: token }, select: { memberId: true } });
      if (a && a.memberId !== session.sub) return NextResponse.json({ ok: false, error: "This document belongs to a different member" }, { status: 403 });
    }

    const fwd = req.headers.get("x-forwarded-for");
    const result = await signFromPortal({
      token,
      typedName: String(body.typedName ?? ""),
      signatureDataUrl: String(body.signatureDataUrl ?? ""),
      initialsDataUrl: typeof body.initialsDataUrl === "string" ? body.initialsDataUrl : null,
      guardianName: typeof body.guardianName === "string" ? body.guardianName : null,
      consent: body.consent === true,
      ipAddress: fwd ? fwd.split(",")[0]!.trim() : null,
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PortalError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[portal/documents/sign]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
