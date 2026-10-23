// GET /api/admin/members/[id]/uploads — files the member uploaded for review (metadata only).
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { requireMemberApi } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireMemberApi(id);
  if (!g.ok) return g.response;
  const uploads = await getPrisma().memberUpload.findMany({
    where: { memberId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, label: true, mimeType: true, sizeBytes: true, status: true, createdAt: true, reviewedAt: true, reviewNotes: true, discountId: true },
  });
  return NextResponse.json({ uploads });
}
