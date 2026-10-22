import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../_shared";
import { sendBulk, computeAudience } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

/** GET ?slug=&audience=<json> computes the audience size without sending. */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["marketing.send-bulk", "member.bulk-message"]);
  if (!g.ok) return g.response;

  const audienceJson = req.nextUrl.searchParams.get("audience");
  if (!audienceJson) return NextResponse.json({ error: "audience required" }, { status: 400 });

  try {
    const filter = JSON.parse(audienceJson);
    filter.locationId = g.location.id; // never let the client widen scope
    const ids = await computeAudience(filter);
    return NextResponse.json({ size: ids.length, sampleMemberId: ids[0] ?? null });
  } catch (e) {
    return apiError(e);
  }
}

/** POST ?slug= { audience, channel, templateId?, subject?, body?, attachmentUrls?, scheduledFor?, saveAsTemplateName? } */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, ["marketing.send-bulk", "member.bulk-message"], { body });
  if (!g.ok) return g.response;

  if (!body.audience || !body.channel) {
    return NextResponse.json({ error: "audience and channel required" }, { status: 400 });
  }
  if (!body.templateId && !body.body) return NextResponse.json({ error: "body or templateId required" }, { status: 400 });

  try {
    const result = await sendBulk({
      audience: { ...body.audience, locationId: g.location.id },
      channel: body.channel,
      templateId: body.templateId || undefined,
      subject: body.subject,
      body: body.body,
      attachmentUrls: Array.isArray(body.attachmentUrls) ? body.attachmentUrls : undefined,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
      saveAsTemplateName: body.saveAsTemplateName || undefined,
      organizationId: g.location.organizationId,
      actorId: g.admin.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
