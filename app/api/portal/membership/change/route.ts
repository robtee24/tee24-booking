// Self-service plan / guest changes from the clubhouse.
//   GET  /api/portal/membership/change?planId=&guestCount=  → { preview, plans }
//   POST /api/portal/membership/change { planId?, guestCount }  → { result }
//   DELETE /api/portal/membership/change                         → cancel a scheduled downgrade
// Upgrades charge the prorated difference to the card on file immediately;
// downgrades are scheduled for the next renewal. See services/portal-membership.service.ts.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { PortalError } from "@/services/portal.service";
import { applyChange, cancelPendingChange, listSelfServicePlans, previewChange } from "@/services/portal-membership.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof PortalError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  console.error("[portal/membership/change]", err);
  return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sp = req.nextUrl.searchParams;
    const planId = sp.get("planId") || null;
    const guestCount = Number(sp.get("guestCount") ?? 0);
    const [{ plans }, preview] = await Promise.all([listSelfServicePlans(member.id), previewChange(member.id, { planId, guestCount: Number.isFinite(guestCount) ? guestCount : 0 })]);
    return NextResponse.json({ ok: true, preview, plans });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") return NextResponse.json({ ok: false, error: "Changes are disabled while impersonating" }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const planId = typeof body.planId === "string" && body.planId ? body.planId : null;
    const guestCount = Number(body.guestCount ?? 0);
    if (!Number.isInteger(guestCount) || guestCount < 0) return NextResponse.json({ ok: false, error: "guestCount must be a whole number" }, { status: 400 });
    const result = await applyChange(member.id, { planId, guestCount });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") return NextResponse.json({ ok: false, error: "Changes are disabled while impersonating" }, { status: 403 });
  try {
    await cancelPendingChange(member.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
