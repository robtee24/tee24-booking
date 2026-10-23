// GET  /api/mobile/practice/profile → { profile, options, focusAreas, experience }
// PUT  /api/mobile/practice/profile { handicap, experience, sessionsPerWeek, minutesPerSession, handedness, goals[], issues[], weakClubs[], misses[] } → { profile, plan }
import { getPracticeProfile, savePracticeProfile, type ProfileInput } from "@/services/mobile-practice.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/profile", async (_req, auth) => ok(await getPracticeProfile(auth.memberId)));

export const PUT = withMobileAuth("practice/profile", async (req, auth) => {
  const body = await readJson<ProfileInput>(req);
  return ok(await savePracticeProfile(auth.memberId, body));
});
