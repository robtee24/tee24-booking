import { NextResponse } from "next/server";
import { getMemberSession, clearMemberSession } from "@/lib/member-session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const sess = await getMemberSession();
  if (sess?.impersonatedBy) {
    void audit({
      actorId: sess.impersonatedBy,
      actorRole: "ADMIN",
      action: "member.impersonate-end",
      entityType: "Member",
      entityId: sess.sub,
    });
  }
  await clearMemberSession();
  return NextResponse.json({ ok: true });
}
