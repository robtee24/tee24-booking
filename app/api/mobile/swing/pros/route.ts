// GET /api/mobile/swing/pros?view=face_on|down_the_line&handedness=RH|LH
//     → { enabled, pros: ProOption[], players }
//     `handedness` is the member's; pros of the opposite hand are flagged
//     `mirrored` because swinglab flips their clip to match.
import { listPros } from "@/services/mobile-swing.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("swing/pros", async (req) => {
  const q = req.nextUrl.searchParams;
  return ok(await listPros({ view: q.get("view"), handedness: q.get("handedness") }));
});
