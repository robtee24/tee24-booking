// PATCH /api/mobile/preferences { optInSmsMarketing?, optInEmailMarketing? }
import { updatePreferences } from "@/services/mobile-member.service";
import { ok, readJson, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withMobileAuth("preferences", async (req, auth) => {
  const body = await readJson<{ optInSmsMarketing?: boolean; optInEmailMarketing?: boolean }>(req);
  return ok({ preferences: await updatePreferences(auth.memberId, body) });
});
