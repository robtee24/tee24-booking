// app/api/admin/auth/verify/route.ts
import { NextResponse } from "next/server";
import { adminAuthService } from "@/services/admin-auth.service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { phone, code } = await req.json();

    if (!phone || !code) {
      return NextResponse.json(
        { error: "phone and code are required" },
        { status: 400 }
      );
    }

    await adminAuthService.loginWithOtp(phone, code);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("admin/auth/verify error:", err);

    if (err.name === "AdminAuthError") {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}