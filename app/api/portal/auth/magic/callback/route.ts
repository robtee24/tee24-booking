import { NextRequest, NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/magic-link";
import { setMemberSession } from "@/lib/member-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/portal/login?error=missing-token", req.url));

  try {
    // Single-use: a replayed or forwarded link is rejected after first click.
    const memberId = await consumeMagicToken(token);
    if (!memberId) return NextResponse.redirect(new URL("/portal/login?error=invalid-token", req.url));
    await setMemberSession(memberId);
    return NextResponse.redirect(new URL("/portal", req.url));
  } catch (e) {
    console.error("[magic callback] verify failed", e);
    return NextResponse.redirect(new URL("/portal/login?error=invalid-token", req.url));
  }
}
