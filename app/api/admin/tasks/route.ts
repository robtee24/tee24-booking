import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const task = await getPrisma().task.create({
    data: {
      title: body.title,
      body: body.body ?? null,
      assignedToId: body.assignedToId || null,
      locationId: body.locationId || null,
      memberId: body.memberId ?? null,
      priority: body.priority ?? "NORMAL",
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      createdById: admin.id,
    },
  });
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const data: any = {};
  if (body.status) {
    data.status = body.status;
    if (body.status === "DONE") data.completedAt = new Date();
  }
  if (body.assignedToId !== undefined) data.assignedToId = body.assignedToId;
  if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  const task = await getPrisma().task.update({ where: { id: body.id }, data });
  return NextResponse.json({ ok: true, task });
}
