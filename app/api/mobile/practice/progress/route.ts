// GET /api/mobile/practice/progress → trends per club, flag history, weekly minutes
import { getProgress } from "@/services/mobile-practice.service";
import { ok, withMobileAuth } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withMobileAuth("practice/progress", async (_req, auth) => ok(await getProgress(auth.memberId)));
