import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-session";
import { requestDataDeletion } from "@/services/compliance.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = await requestDataDeletion({
    memberId: member.id,
    reason: body.reason,
    actorId: member.id,
  });
  return NextResponse.json({ ok: true, ...result });
}
