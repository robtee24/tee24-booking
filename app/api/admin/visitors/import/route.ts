import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../../marketing/_shared";
import { importLeadsCsv } from "@/services/lead.service";

export const dynamic = "force-dynamic";

/** POST ?slug= { csv: string, defaultSource?: string } */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, "marketing.view-visitors", { body });
  if (!g.ok) return g.response;
  if (typeof body.csv !== "string" || !body.csv.trim()) return NextResponse.json({ error: "csv required" }, { status: 400 });
  try {
    const res = await importLeadsCsv(body.csv, { locationId: g.location.id, organizationId: g.location.organizationId, defaultSource: body.defaultSource }, g.admin.id);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
