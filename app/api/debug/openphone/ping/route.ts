// app/api/debug/openphone/ping/route.ts
import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";

export const runtime = "nodejs";

async function opGet(path: string) {
  const r = await fetch(`https://api.openphone.com${path}`, {
    headers: {
      "X-API-Key": ENV.OPENPHONE_API_KEY,
      "Content-Type": "application/json",
    },
  });
  const text = await r.text();
  return { status: r.status, ok: r.ok, text: text.slice(0, 2000) };
}

export async function GET() {
  const numbers = await opGet("/v1/phone-numbers");
  return NextResponse.json({
    key_present: !!ENV.OPENPHONE_API_KEY,
    from_number: ENV.OPENPHONE_NUMBER,
    phone_numbers: numbers,
  });
}

