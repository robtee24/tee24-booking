// POST /api/portal/practice/exports/sync — import every pending kiosk export
import { syncExports } from "@/services/shot-export.service";
import { ok, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withPortalMember("practice/exports/sync", async (_req, auth) => ok(await syncExports(auth.memberId)), { write: true });
