// PATCH /api/mobile/profile { firstName?, lastName?, email?, dob?, address... }
import { updateMobileProfile, getMemberHome } from "@/services/mobile-member.service";
import { ok, readJson, withMobileAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = withMobileAuth("profile", async (req, auth) => {
  const body = await readJson<Record<string, unknown>>(req);
  await updateMobileProfile(auth.memberId, body);
  const home = await getMemberHome(auth.memberId);
  return ok({ member: home.member });
});
