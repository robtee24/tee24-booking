// GET /api/portal/practice/drills/log (drill catalog) · POST { drillKey, planId?, minutes?, rating?, notes? }
import { listDrills, logDrill } from "@/services/mobile-practice.service";
import { ok, readJson, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/drills", async () => ok(listDrills()));

export const POST = withPortalMember("practice/drills/log", async (req, auth) => {
  const body = await readJson<{ drillKey?: string; planId?: string | null; minutes?: number; rating?: number; notes?: string }>(req);
  return ok(await logDrill(auth.memberId, body), { status: 201 });
}, { write: true });
