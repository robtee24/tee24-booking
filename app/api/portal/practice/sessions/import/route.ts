// POST /api/portal/practice/sessions/import { csv | base64, fileName?, playedAt?, title?, notes? }
// Imports a GSPro / launch-monitor CSV, analyzes it and re-tunes the practice plan.
import { importSwingCsv, type ImportInput } from "@/services/mobile-practice.service";
import { ok, readJson, withPortalMember } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withPortalMember("practice/import", async (req, auth) => {
  const body = await readJson<ImportInput>(req);
  return ok(await importSwingCsv(auth.memberId, body), { status: 201 });
}, { write: true });
