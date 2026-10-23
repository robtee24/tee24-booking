// POST /api/mobile/practice/exports/sync → { imported, failed, skipped, pendingCount, plan, planChanged }
//   Imports every pending kiosk export into analyzed practice sessions and re-tunes the plan.
import { syncExports } from "@/services/shot-export.service";
import { ok, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withMobileAuth("practice/exports/sync", async (_req, auth) => ok(await syncExports(auth.memberId)));
