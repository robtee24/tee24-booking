/**
 * Send a portal magic-link email. The link sets a portal session cookie when clicked.
 *
 * Security:
 *  - We always return 200 to avoid email enumeration
 *  - Magic-link tokens expire in 15 minutes and are single-use (lib/magic-link.ts)
 *  - Per-member cooldown (60s, via Member.magicLinkLastSentAt) + per-IP window so
 *    the endpoint can't be used to flood a member's inbox
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";
import { buildMagicLink } from "@/lib/magic-link";

export const dynamic = "force-dynamic";

const PER_MEMBER_COOLDOWN_MS = 60 * 1000;
const PER_IP_MAX = 10;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < PER_IP_WINDOW_MS);
  if (hits.length >= PER_IP_MAX) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json().catch(() => ({} as { email?: unknown }));
    if (!email || typeof email !== "string") return NextResponse.json({ error: "email required" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!ipAllowed(ip)) return NextResponse.json({ ok: true });

    const norm = email.trim().toLowerCase();
    const member = await getPrisma().member.findFirst({
      where: { email: norm, mergedIntoId: null },
      select: { id: true, email: true, magicLinkLastSentAt: true },
    });

    // Always pretend to send to avoid enumeration (also when cooling down).
    if (!member || !member.email) return NextResponse.json({ ok: true });
    if (member.magicLinkLastSentAt && Date.now() - member.magicLinkLastSentAt.getTime() < PER_MEMBER_COOLDOWN_MS) {
      return NextResponse.json({ ok: true });
    }

    const link = await buildMagicLink(member.id);

    await sendEmail({
      to: member.email,
      subject: "Your sign-in link",
      ledger: false, // contains a sign-in token
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif;padding:24px;color:#0f172a;">
  <h1 style="font-size:20px;margin:0 0 16px;">Sign in to your account</h1>
  <p style="margin:0 0 16px;color:#475569;">Click the button below to sign in. This link expires in 15 minutes and works once.</p>
  <a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Sign in</a>
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">If you didn't request this, ignore this email.</p>
</div>`,
    });
    await getPrisma().member.update({ where: { id: member.id }, data: { magicLinkLastSentAt: new Date() } }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[portal magic] error", e);
    return NextResponse.json({ ok: true });
  }
}
