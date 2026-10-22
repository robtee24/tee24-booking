// /api/portal/membership — self-service membership requests.
//   GET  → { sub, openInvoice, lastPaid, history, plans }
//   POST { action: "cancel" | "freeze" | "change-plan", reason?, resumeDate?, targetPlanId? }
// Requests never change billing directly: they stamp cancelRequestedAt (cancel),
// open a staff Task, and raise an AdminNotification.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { getMembershipOverview, PortalError, submitMembershipRequest } from "@/services/portal.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await getMembershipOverview(member.id)) });
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") return NextResponse.json({ error: "Requests are disabled while impersonating" }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action !== "cancel" && action !== "freeze" && action !== "change-plan") return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    const result = await submitMembershipRequest(member.id, action, {
      reason: typeof body.reason === "string" ? body.reason : undefined,
      resumeDate: typeof body.resumeDate === "string" ? body.resumeDate : undefined,
      targetPlanId: typeof body.targetPlanId === "string" ? body.targetPlanId : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PortalError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[portal/membership]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
