import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const log = await getPrisma().maintenanceLog.create({
    data: {
      locationId: body.locationId,
      bayId: body.bayId || null,
      kind: body.kind,
      body: body.body,
      reporterId: admin.id,
      resolvedAt: body.kind === "RESOLVED" ? new Date() : null,
    },
  });
  return NextResponse.json({ ok: true, log });
}
