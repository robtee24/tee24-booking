// POST /api/portal/delete-request
// Accepts both a JSON body ({ reason }) and a plain HTML <form> post
// (application/x-www-form-urlencoded). Form posts get redirected back to the
// settings page with ?deleted=requested so the server-rendered page can
// confirm without JavaScript.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { requestDataDeletion } from "@/services/compliance.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  const ct = req.headers.get("content-type") ?? "";
  const isForm = ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data");
  if (!member) {
    if (isForm) return NextResponse.redirect(new URL("/portal/login", req.url), 303);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") {
    if (isForm) return NextResponse.redirect(new URL("/portal/settings?error=impersonating", req.url), 303);
    return NextResponse.json({ error: "Not allowed while impersonating" }, { status: 403 });
  }

  let reason: string | undefined;
  if (isForm) {
    const fd = await req.formData().catch(() => null);
    const r = fd?.get("reason");
    reason = typeof r === "string" && r.trim() ? r.trim().slice(0, 1000) : undefined;
  } else {
    const body = await req.json().catch(() => ({}));
    reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 1000) : undefined;
  }

  const result = await requestDataDeletion({ memberId: member.id, reason, actorId: member.id });
  if (isForm) return NextResponse.redirect(new URL("/portal/settings?deleted=requested", req.url), 303);
  return NextResponse.json({ ok: true, ...result });
}
