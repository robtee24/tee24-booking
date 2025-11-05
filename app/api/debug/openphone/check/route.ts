// app/api/debug/openphone/check/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.OPENPHONE_API_KEY || "";
  const from = process.env.OPENPHONE_FROM || ""; // can be a phone ID or an E.164 number

  // We consider the configuration "ok" if both values are present.
  // Delivery can be validated with /api/debug/openphone/send-test.
  const ok = Boolean(key && from);

  return NextResponse.json({
    ok,
    env: {
      hasKey: !!key,
      hasFrom: !!from,
      fromValueLooksLike: from.startsWith("+") ? "E164_number" : "phone_id",
      // For security, we don't echo the actual key or number back.
    },
    nextSteps: {
      validateDelivery: "POST /api/debug/openphone/send-test",
      bodyExample: {
        to: "+1XXXXXXXXXX",
        text: "Test from Tee24 debug",
      },
      note: "OPENPHONE_FROM may be either a phone ID or an E.164 number. Our sender will handle both.",
    },
  });
}

