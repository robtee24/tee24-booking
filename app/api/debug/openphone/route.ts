// app/api/debug/openphone/route.ts
import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { requireDebugAccess } from "@/lib/debug-guard";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireDebugAccess();
  if (denied) return denied;
  const key = ENV.OPENPHONE_API_KEY;
  return NextResponse.json({
    OPENPHONE_API_KEY_present: !!key,
    OPENPHONE_API_KEY_hint: key ? `••••${key.slice(-4)}` : "",
    OPENPHONE_NUMBER: ENV.OPENPHONE_NUMBER,
  });
}
