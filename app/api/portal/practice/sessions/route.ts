// GET /api/portal/practice/sessions?limit=  · POST { playedAt?, durationMin?, title?, notes? } (manual session)
import { createManualSession, listSessions } from "@/services/mobile-practice.service";
import { ok, readJson, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/sessions", async (req, auth) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  return ok(await listSessions(auth.memberId, Number.isFinite(limit) ? limit : 30));
});

export const POST = withPortalMember("practice/sessions", async (req, auth) => {
  const body = await readJson<{ playedAt?: string; durationMin?: number; title?: string; notes?: string }>(req);
  return ok(await createManualSession(auth.memberId, body), { status: 201 });
}, { write: true });
