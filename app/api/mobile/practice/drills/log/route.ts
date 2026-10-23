// GET  /api/mobile/practice/drills/log → { drills, focusAreas } (full drill library)
// POST /api/mobile/practice/drills/log { drillKey, planId?, minutes?, rating?, notes? } → { log }
import { listDrills, logDrill } from "@/services/mobile-practice.service";
import { ok, readJson, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/drills", async () => ok(listDrills()));

export const POST = withMobileAuth("practice/drills/log", async (req, auth) => {
  const body = await readJson<{ drillKey?: string; planId?: string | null; minutes?: number; rating?: number; notes?: string }>(req);
  return ok(await logDrill(auth.memberId, body), { status: 201 });
});
