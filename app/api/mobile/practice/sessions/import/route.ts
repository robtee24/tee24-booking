// POST /api/mobile/practice/sessions/import
//   { csv?: string, base64?: string, fileName?, playedAt?, title?, notes?, durationMin?, locationId? }
//   → { session, summary, unitNotes, unmatchedColumns, plan, planChanged }
import { importSwingCsv, type ImportInput } from "@/services/mobile-practice.service";
import { ok, readJson, withMobileAuth } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withMobileAuth("practice/import", async (req, auth) => {
  const body = await readJson<ImportInput>(req);
  return ok(await importSwingCsv(auth.memberId, body), { status: 201 });
});
