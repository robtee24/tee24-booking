/**
 * GDPR/CCPA — member-initiated data export.
 * Returns a JSON dump of all the member's personal data and activity.
 */
import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/member-session";
import { buildMemberDataExport } from "@/services/compliance.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await buildMemberDataExport(member.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tee24-data-${member.id}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
