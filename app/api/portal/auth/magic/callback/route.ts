import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { setMemberSession } from "@/lib/member-session";

export const dynamic = "force-dynamic";

function getSecret() {
  const s = process.env.MEMBER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/portal/login?error=missing-token", req.url));

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "tee24-portal-magic",
      audience: "tee24-portal-magic",
    });
    if (!payload.sub) throw new Error("no sub");
    await setMemberSession(payload.sub as string);
    return NextResponse.redirect(new URL("/portal", req.url));
  } catch (e) {
    console.error("[magic callback] verify failed", e);
    return NextResponse.redirect(new URL("/portal/login?error=invalid-token", req.url));
  }
}
