// GET / PUT /api/portal/practice/profile — the game-improvement survey
import { getPracticeProfile, savePracticeProfile, type ProfileInput } from "@/services/mobile-practice.service";
import { ok, readJson, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/profile", async (_req, auth) => ok(await getPracticeProfile(auth.memberId)));

export const PUT = withPortalMember("practice/profile", async (req, auth) => {
  const body = await readJson<ProfileInput>(req);
  return ok(await savePracticeProfile(auth.memberId, body));
}, { write: true });
