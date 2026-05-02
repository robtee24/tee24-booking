import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-session";
import { updateMember } from "@/services/member.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  await updateMember(member.id, {
    optInEmailMarketing: !!body.optInEmailMarketing,
    optInSmsMarketing: !!body.optInSmsMarketing,
  }, member.id);
  return NextResponse.json({ ok: true });
}
