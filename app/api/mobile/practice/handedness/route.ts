// PUT /api/mobile/practice/handedness { handedness: "RH" | "LH" }
import { saveHandedness } from "@/services/mobile-practice.service";
import { MobileError } from "@/services/mobile-auth.service";
import { ok, readJson, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withMobileAuth("practice/handedness", async (req, auth) => {
  const body = await readJson<{ handedness?: string }>(req);
  const handedness = body.handedness === "LH" ? "LH" : body.handedness === "RH" ? "RH" : null;
  if (!handedness) throw new MobileError("Choose right-handed or left-handed", 400, "BAD_REQUEST");
  const profile = await saveHandedness(auth.memberId, handedness);
  return ok({ profile });
});
