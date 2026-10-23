// GET /api/mobile/practice/exports?all=1 → { exports, pendingCount }
//   Shot-data files the bay kiosk exported for this member, waiting to be synced.
import { listExports } from "@/services/shot-export.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/exports", async (req, auth) => {
  const all = new URL(req.url).searchParams.get("all") === "1";
  return ok(await listExports(auth.memberId, { includeDone: all }));
});
