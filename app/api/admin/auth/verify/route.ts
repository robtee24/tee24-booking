// app/api/admin/auth/verify/route.ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { setAdminSession } from "@/lib/session.server";
import { verifyOtp, normalizePhone } from "@/lib/otp";
import { ENV } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phone: rawPhone, code } = body as { phone?: string; code?: string };

    if (!rawPhone || !code) {
      return NextResponse.json(
        { error: "phone and code are required" },
        { status: 400 }
      );
    }

    const phone = normalizePhone(rawPhone);
    const codeStr = String(code).trim();

    if (!phone || codeStr.length !== 6 || !/^\d+$/.test(codeStr)) {
      return NextResponse.json(
        { error: "Invalid phone or code format" },
        { status: 400 }
      );
    }

    // 1. Verify OTP
    const verifyResult = await verifyOtp(phone, codeStr);
    if (!verifyResult.ok) {
      const reason = verifyResult.reason;
      return NextResponse.json(
        {
          error:
            reason === "EXPIRED"
              ? "Code has expired"
              : reason === "MISMATCH"
              ? "Invalid code"
              : "Code not found",
        },
        { status: 401 }
      );
    }

    // 2. Find or create admin
    let admin = await getPrisma().admin.findUnique({
      where: { phone },
      select: { id: true, role: true, phone: true },
    });

    // Allow ROOT bootstrap
    if (
      !admin &&
      ENV.ROOT_ADMIN_PHONE &&
      phone === normalizePhone(ENV.ROOT_ADMIN_PHONE)
    ) {
      admin = await getPrisma().admin.create({
        data: { phone, role: "ROOT" },
        select: { id: true, role: true, phone: true },
      });
    }

    if (!admin) {
      return NextResponse.json(
        { error: "Not authorized" },
        { status: 403 }
      );
    }

    // 3. Use shared session helper (handles both cookies, secret, expiration)
    await setAdminSession(admin.id, admin.role);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("auth/verify error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}