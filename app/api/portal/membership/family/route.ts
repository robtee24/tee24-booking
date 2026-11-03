// Family add-on from the clubhouse (web portal). Same engine as the app.
//   GET    /api/portal/membership/family
//   POST   /api/portal/membership/family { ...member }
//   DELETE /api/portal/membership/family { subscriptionId }
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { PortalError } from "@/services/portal.service";
import { addFamilyMemberToAccount, FamilyAddonError, getFamilyContext, removeFamilyMemberFromAccount, serializeFamily } from "@/services/family-addon.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof PortalError || err instanceof FamilyAddonError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  console.error("[portal/membership/family]", err);
  return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, family: serializeFamily(await getFamilyContext(member.id)) });
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
    const body = await req.json().catch(() => ({}));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const result = await addFamilyMemberToAccount(member.id, body, { ip, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true, result, family: serializeFamily(await getFamilyContext(member.id)) });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") return NextResponse.json({ ok: false, error: "Changes are disabled while impersonating" }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as { subscriptionId?: string };
    if (!body.subscriptionId) return NextResponse.json({ ok: false, error: "subscriptionId is required" }, { status: 400 });
    const result = await removeFamilyMemberFromAccount(member.id, body.subscriptionId);
    return NextResponse.json({ ok: true, result, family: serializeFamily(await getFamilyContext(member.id)) });
  } catch (err) {
    return fail(err);
  }
}
