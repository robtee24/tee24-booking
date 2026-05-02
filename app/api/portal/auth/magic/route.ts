/**
 * Send a portal magic-link email. The link sets a portal session cookie when clicked.
 *
 * Security:
 *  - We always return 200 to avoid email enumeration
 *  - Magic-link tokens expire in 15 minutes (one-time use)
 *  - Rate-limited at 5/min/email upstream (TODO: implement once redis is wired)
 */
import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

function getSecret() {
  const s = process.env.MEMBER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

    const norm = String(email).trim().toLowerCase();
    const member = await getPrisma().member.findFirst({ where: { email: norm } });

    // Always pretend to send to avoid enumeration
    if (!member) {
      return NextResponse.json({ ok: true });
    }

    const token = await new SignJWT({ purpose: "magic" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(member.id)
      .setIssuer("tee24-portal-magic")
      .setAudience("tee24-portal-magic")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(getSecret());

    const baseUrl = process.env.APP_BASE_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const link = `${baseUrl}/api/portal/auth/magic/callback?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: member.email,
      subject: "Your sign-in link",
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif;padding:24px;color:#0f172a;">
  <h1 style="font-size:20px;margin:0 0 16px;">Sign in to your account</h1>
  <p style="margin:0 0 16px;color:#475569;">Click the button below to sign in. This link expires in 15 minutes.</p>
  <a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Sign in</a>
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">If you didn't request this, ignore this email.</p>
</div>`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[portal magic] error", e);
    return NextResponse.json({ ok: true });
  }
}
