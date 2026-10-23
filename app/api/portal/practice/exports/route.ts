// GET /api/portal/practice/exports?all=1 — shot-data files parked by the bay kiosk for this member
import { listExports } from "@/services/shot-export.service";
import { ok, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/exports", async (req, auth) => {
  const all = req.nextUrl.searchParams.get("all") === "1";
  return ok(await listExports(auth.memberId, { includeDone: all }));
});
