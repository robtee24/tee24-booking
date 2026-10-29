import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../_shared";
import { sendTestToSelf } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { channel, subject?, body, templateId?, attachmentUrls?, sampleMemberId? } → delivers ONLY to the signed-in admin. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, ["marketing.send-bulk", "member.bulk-message"], { body });
  if (!g.ok) return g.response;
  if (body.channel !== "EMAIL" && body.channel !== "SMS" && body.channel !== "PUSH") return NextResponse.json({ error: "channel must be EMAIL, SMS or PUSH" }, { status: 400 });
  try {
    const res = await sendTestToSelf({
      channel: body.channel,
      subject: body.subject,
      body: body.body ?? "",
      templateId: body.templateId || undefined,
      attachmentUrls: body.attachmentUrls,
      sampleMemberId: body.sampleMemberId ?? null,
      adminEmail: g.admin.email,
      adminPhone: g.admin.phone,
      organizationId: g.location.organizationId,
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
