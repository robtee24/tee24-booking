// app/api/admin/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearAdminSession } from "@/lib/session.server";

export const runtime = "nodejs";

export async function POST() {
  await clearAdminSession();

  return NextResponse.json({ ok: true });
}