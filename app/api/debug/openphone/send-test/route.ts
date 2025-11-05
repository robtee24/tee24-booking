// app/api/debug/openphone/send-test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendSms } from "@/lib/sendSms";

export const dynamic = "force-dynamic";

/**
 * Test endpoint to send an SMS via OpenPhone.
 *
 * Usage:
 *   GET  /api/debug/openphone/send-test?to=+15551234567&text=Hello
 *   POST /api/debug/openphone/send-test   { "to": "+15551234567", "text": "Hello" }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const to = (searchParams.get("to") || "").trim();
  const text = (searchParams.get("text") || "").trim();
  return handleSend(to, text);
}

export async function POST(req: NextRequest) {
  let to = "";
  let text = "";
  try {
    const body = await req.json();
    to = (body?.to || "").trim();
    text = (body?.text || "").trim();
  } catch {
    // fall through; handled by validation below
  }
  return handleSend(to, text);
}

function normalizePhoneE164(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && /^\+\d{7,15}$/.test(raw)) return raw;
  if (digits.length === 10) return `+1${digits}`;
  if (/^\d{7,15}$/.test(digits)) return `+${digits}`;
  return null;
}

async function handleSend(toRaw: string, text: string) {
  const to = normalizePhoneE164(toRaw);
  if (!to) {
    return NextResponse.json(
      { ok: false, error: "Invalid or missing 'to' (expect E.164 like +15551234567)" },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "Missing 'text' content" },
      { status: 400 }
    );
  }

  try {
    await sendSms({
      from: process.env.OPENPHONE_FROM || "system",
      to: [to],
      content: text,
    });
    return NextResponse.json(
      { ok: true, sentTo: to, length: text.length },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "SMS send threw" },
      { status: 500 }
    );
  }
}
