// GET   /api/admin/members/[id]/uploads/[uploadId]        → the file bytes (member.view)
// PATCH /api/admin/members/[id]/uploads/[uploadId] {status: APPROVED|REJECTED, notes?} (member.edit)
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { reviewMemberUpload } from "@/services/member-upload.service";
import { apiError, readJson, requireMemberApi } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; uploadId: string }> }) {
  const { id, uploadId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  const up = await getPrisma().memberUpload.findFirst({ where: { id: uploadId, memberId: id } });
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(up.data), {
    status: 200,
    headers: {
      "Content-Type": up.mimeType,
      "Content-Length": String(up.sizeBytes),
      "Content-Disposition": `inline; filename="id-${up.id}.${up.mimeType === "application/pdf" ? "pdf" : up.mimeType.split("/")[1] ?? "bin"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; uploadId: string }> }) {
  const { id, uploadId } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  try {
    assertCan(g.actor, "member.edit", { locationId: g.member.locationId });
    const body = await readJson(req);
    const status = body.status === "APPROVED" || body.status === "REJECTED" ? body.status : null;
    if (!status) return NextResponse.json({ error: "status must be APPROVED or REJECTED" }, { status: 400 });
    const exists = await getPrisma().memberUpload.findFirst({ where: { id: uploadId, memberId: id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const upload = await reviewMemberUpload(uploadId, status, g.admin.id, typeof body.notes === "string" ? body.notes : null);
    return NextResponse.json({ ok: true, upload });
  } catch (e) {
    return apiError(e);
  }
}
