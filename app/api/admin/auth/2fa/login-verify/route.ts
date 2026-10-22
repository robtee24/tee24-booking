// app/api/admin/auth/2fa/login-verify/route.ts
//
// Second login step for admins with TOTP 2FA enabled. Requires the 5-minute
// `admin_2fa_pending` cookie set by a successful OTP verify; on a valid code
// the full admin session is issued.
//
// NOTE: middleware.ts only allow-lists /api/admin/auth/{start,verify,session,logout}
// for unauthenticated requests, so until `/api/admin/auth/2fa/login-verify` is
// added to PUBLIC_ADMIN_PATHS the login page posts `{ totp }` to
// /api/admin/auth/verify, which runs this exact same logic.
import { NextResponse } from "next/server";
import { adminAuthService } from "@/services/admin-auth.service";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const code = String((body as any).code ?? (body as any).totp ?? "");
    await adminAuthService.completeTwoFactorLogin(code);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.name === "AdminAuthError") {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("admin/auth/2fa/login-verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
