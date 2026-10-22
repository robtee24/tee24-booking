// app/api/admin/auth/verify/route.ts
//
// Public (middleware allow-listed) login endpoint.
//   • `{ phone, code }`  → verify the SMS OTP. For admins with 2FA enabled this
//                          returns `{ ok: true, requires2fa: true }` and sets a
//                          5-minute pending cookie instead of a session.
//   • `{ totp }`         → second step: verify the authenticator code against
//                          the pending cookie and issue the session. This is
//                          the same handler as /api/admin/auth/2fa/login-verify
//                          (kept here because middleware only allow-lists
//                          /api/admin/auth/verify for unauthenticated calls).
import { NextResponse } from "next/server";
import { adminAuthService } from "@/services/admin-auth.service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { phone, code, totp } = body as { phone?: string; code?: string; totp?: string };

    if (totp !== undefined) {
      await adminAuthService.completeTwoFactorLogin(String(totp));
      return NextResponse.json({ ok: true });
    }

    if (!phone || !code) {
      return NextResponse.json(
        { error: "phone and code are required" },
        { status: 400 }
      );
    }

    const result = await adminAuthService.loginWithOtp(phone, code);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("admin/auth/verify error:", err);

    if (err.name === "AdminAuthError") {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
