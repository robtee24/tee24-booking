// app/api/debug/openphone/route.ts
import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const key = ENV.OPENPHONE_API_KEY;
  const masked = key ? `${key.slice(0,7)}***${key.slice(-4)}` : "";
  return NextResponse.json({
    OPENPHONE_API_KEY_present: !!key,
    OPENPHONE_API_KEY_masked: masked,
    OPENPHONE_NUMBER: ENV.OPENPHONE_NUMBER,
  });
}
