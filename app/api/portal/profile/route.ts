// /api/portal/profile — the signed-in member's own profile.
//   GET   → { member }
//   PATCH → { member }   (name, email, phone, dob, gender, address, guardianName)
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getMemberSession } from "@/lib/member-session";
import { PortalError, updateOwnProfile } from "@/services/portal.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_FIELDS = ["id", "firstName", "lastName", "email", "phone", "dob", "gender", "addressLine1", "addressLine2", "city", "state", "zip", "country", "guardianName", "photoUrl"] as const;

function pick(m: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_FIELDS) out[k] = m[k] ?? null;
  return out;
}

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, member: pick(member as unknown as Record<string, unknown>) });
}

export async function PATCH(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await getMemberSession();
  if (session?.role === "IMPERSONATED") return NextResponse.json({ error: "Profile edits are disabled while impersonating" }, { status: 403 });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = await updateOwnProfile(member.id, body);
    return NextResponse.json({ ok: true, member: pick(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    if (err instanceof PortalError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[portal/profile]", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
