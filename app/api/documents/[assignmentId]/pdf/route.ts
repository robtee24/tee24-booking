// GET /api/documents/[assignmentId]/pdf — stream the signed document bytes.
//
// Allowed for:
//   • the member who signed it (portal session), or
//   • an admin of the member's location holding `document.view-signed`.
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { requireLocationAdminApi } from "@/lib/api-auth";
import { getActorContext } from "@/lib/actor";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await ctx.params;
  const prisma = getPrisma();

  const assignment = await prisma.documentAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      memberId: true,
      status: true,
      signedAt: true,
      document: { select: { name: true } },
      member: { select: { locationId: true, firstName: true, lastName: true } },
    },
  });
  if (!assignment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 1. Member viewing their own document
  const sess = await getMemberSession().catch(() => null);
  let allowed = Boolean(sess && sess.sub === assignment.memberId);

  // 2. Admin with document.view-signed at the member's location
  if (!allowed) {
    const guard = await requireLocationAdminApi({ locationId: assignment.member.locationId });
    if (guard.ok) {
      const actor = await getActorContext();
      allowed = Boolean(actor && can(actor, "document.view-signed", { locationId: assignment.member.locationId }));
    }
  }
  if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const file = await prisma.documentFile.findUnique({ where: { assignmentId } });
  if (!file) return NextResponse.json({ error: "No stored file for this document" }, { status: 404 });

  const safeName = `${assignment.document.name} - ${assignment.member.firstName} ${assignment.member.lastName}`
    .replace(/[^A-Za-z0-9 _.-]+/g, "")
    .trim();
  const inline = req.nextUrl.searchParams.get("download") !== "1";
  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName || "document"}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Sha256": file.sha256,
    },
  });
}
