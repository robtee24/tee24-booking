import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { sendBulk, computeAudience } from "@/services/marketing.service";

export const dynamic = "force-dynamic";

/** GET ?audience=... computes the audience size without sending. */
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const audienceJson = req.nextUrl.searchParams.get("audience");
  if (!audienceJson) return NextResponse.json({ error: "audience required" }, { status: 400 });

  try {
    const filter = JSON.parse(audienceJson);
    const ids = await computeAudience(filter);
    return NextResponse.json({ size: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.audience || !body.channel) {
    return NextResponse.json({ error: "audience and channel required" }, { status: 400 });
  }

  try {
    const result = await sendBulk({
      audience: body.audience,
      channel: body.channel,
      templateId: body.templateId,
      subject: body.subject,
      body: body.body,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
      organizationId: body.organizationId ?? null,
      actorId: admin.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
