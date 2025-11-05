// app/api/admin/admins/ping/route.ts
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Dev-only health + secret check.
 * Returns ok:true when header x-dev-root matches CRON_SECRET exactly.
 * Does NOT call getAdminSession (so it won't 403 due to auth).
 */
export async function GET(request: NextRequest) {
  const secretHeader = request.headers.get("x-dev-root") ?? "";
  const expected = process.env.CRON_SECRET ?? "";

  if (!expected) {
    // Surface misconfig quickly
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not set on server" },
      { status: 500 }
    );
  }

  if (secretHeader !== expected) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    devBypass: true,
    message: "x-dev-root matched CRON_SECRET",
  });
}
