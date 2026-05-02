import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await getPrisma().automation.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { steps: true, enrollments: true } } },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const a = await getPrisma().automation.create({
    data: {
      organizationId: body.organizationId ?? null,
      name: body.name,
      description: body.description ?? null,
      trigger: body.trigger,
      triggerConfig: body.triggerConfig ?? undefined,
      goalConfig: body.goalConfig ?? undefined,
      active: body.active ?? false,
      steps: body.steps?.length
        ? {
            create: body.steps.map((s: any, i: number) => ({
              order: s.order ?? i,
              kind: s.kind,
              config: s.config ?? {},
            })),
          }
        : undefined,
    },
    include: { steps: true },
  });
  void audit({
    actorId: admin.id,
    action: "automation.enroll",
    entityType: "Automation",
    entityId: a.id,
    after: a,
  });
  return NextResponse.json({ ok: true, automation: a });
}
