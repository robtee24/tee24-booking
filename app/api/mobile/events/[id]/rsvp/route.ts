// PUT /api/mobile/events/:id/rsvp { status: "GOING" | "INTERESTED" | "DECLINED" | null }
import { setRsvp } from "@/services/mobile-events.service";
import { fail, ok, readJson, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUT = withMobileAuth<{ params: Promise<{ id: string }> }>("events/rsvp", async (req, auth, ctx) => {
  const { id } = await ctx.params;
  const { status } = await readJson<{ status?: string | null }>(req);
  if (status != null && !["GOING", "INTERESTED", "DECLINED"].includes(status)) return fail("Invalid status", 400, "BAD_REQUEST");
  return ok(await setRsvp(auth.memberId, id, (status ?? null) as "GOING" | "INTERESTED" | "DECLINED" | null));
});
