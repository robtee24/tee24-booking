// app/api/admin/bay/ping/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true });
}
