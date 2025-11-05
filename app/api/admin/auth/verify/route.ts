// app/api/admin/auth/verify/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT } from "jose";

import { ENV } from "@/lib/env";
import { prisma } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";

function normalizeE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { phone, code } = (await req.json()) as { phone: string; code: string };
    if (!phone || !code) {
      return NextResponse.json({ error: "phone and code are required" }, { status: 400 });
    }

    const e164 = normalizeE164(phone);

    // 1) Verify OTP
    const ok = verifyOtp(e164, String(code).trim());
    if (!ok) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    // 2) Ensure admin exists (seeded root admin will already exist; this is safe)
    let admin = await prisma.admin.findUnique({ where: { phone: e164 } });

    // Optional: allow ROOT bootstrap if configured
    if (!admin && ENV.ROOT_ADMIN_PHONE && e164 === ENV.ROOT_ADMIN_PHONE) {
      admin = await prisma.admin.create({
        data: { phone: e164, role: "ROOT" },
      });
    }

    if (!admin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // 3) Sign a session JWT (HS256) with the SAME secret used by proxy.ts
    const secretStr = process.env.ADMIN_JWT_SECRET || ENV.AUTH_SECRET || "dev-secret";
    const secret = new TextEncoder().encode(secretStr);

    const token = await new SignJWT({
      sub: admin.id,
      phone: admin.phone,
      role: admin.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    // 4) Set cookie (dev-safe)
    const isProd = process.env.NODE_ENV === "production";
    const cookieStore = await cookies();
    cookieStore.set({
      name: "admin_jwt",                // <-- proxy expects this
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,                   // false on localhost (http), true in prod (https)
      path: "/",
      maxAge: 60 * 60 * 24 * 30,        // 30 days
    });

    // 5) JSON OK (front-end can navigate to /admin or ?next=)
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("auth/verify error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
