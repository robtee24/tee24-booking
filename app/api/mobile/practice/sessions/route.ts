// GET  /api/mobile/practice/sessions?limit=30 → { sessions }
// POST /api/mobile/practice/sessions { playedAt, durationMin, title, notes, locationId } → { session } (manual log)
import { createManualSession, listSessions } from "@/services/mobile-practice.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/sessions", async (req, auth) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
  return ok(await listSessions(auth.memberId, Number.isFinite(limit) ? limit : 30));
});

export const POST = withMobileAuth("practice/sessions", async (req, auth) => {
  const body = await readJson<{ playedAt?: string; durationMin?: number; title?: string; notes?: string; locationId?: string | null }>(req);
  return ok(await createManualSession(auth.memberId, body), { status: 201 });
});
