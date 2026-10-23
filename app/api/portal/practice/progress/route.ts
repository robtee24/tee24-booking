// GET /api/portal/practice/progress — per-club trends, flag history, weekly minutes
import { getProgress } from "@/services/mobile-practice.service";
import { ok, withPortalMember } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPortalMember("practice/progress", async (_req, auth) => ok(await getProgress(auth.memberId)));
