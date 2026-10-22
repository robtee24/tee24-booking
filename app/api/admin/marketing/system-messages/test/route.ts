import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../_shared";
import { sendSystemTestToAdmin } from "@/services/system-messages.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { templateId?, eventKey?, channel, subject?, body? } → sends ONLY to the signed-in admin. */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.manage-templates", { body });
  if (!g.ok) return g.response;
  if (body.channel !== "EMAIL" && body.channel !== "SMS") return NextResponse.json({ error: "channel must be EMAIL or SMS" }, { status: 400 });
  try {
    const res = await sendSystemTestToAdmin({
      templateId: body.templateId,
      eventKey: body.eventKey,
      channel: body.channel,
      subject: body.subject,
      body: body.body,
      adminEmail: g.admin.email,
      adminPhone: g.admin.phone,
      organizationId: g.location.organizationId,
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
