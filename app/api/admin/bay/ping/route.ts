// app/api/admin/bay/ping/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";

export async function GET() {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true });
}
