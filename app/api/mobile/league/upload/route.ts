// POST /api/mobile/league/upload { base64, mime } → { url } (scorecard photo)
import { uploadScorecardPhoto } from "@/services/mobile-events.service";
import { fail, ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withMobileAuth("league/upload", async (req) => {
  const { base64, mime } = await readJson<{ base64?: string; mime?: string }>(req);
  if (!base64) return fail("base64 image required", 400, "BAD_REQUEST");
  return ok(await uploadScorecardPhoto(base64, mime ?? "image/jpeg"));
});
