// Build + email a portal magic link for a member (mirrors app/api/portal/auth/magic/route.ts).
import { SignJWT } from "jose";
import { getPrisma } from "@/lib/db";
import { sendEmail, sendSMS } from "@/lib/notify";
import { memberBaseUrl } from "@/lib/public-url";

function getSecret() {
  const s = process.env.MEMBER_JWT_SECRET || process.env.ADMIN_JWT_SECRET || "dev-secret-member";
  return new TextEncoder().encode(s);
}

export async function buildMagicLink(memberId: string, req?: Request): Promise<string> {
  const token = await new SignJWT({ purpose: "magic" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuer("tee24-portal-magic")
    .setAudience("tee24-portal-magic")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
  return `${memberBaseUrl()}/api/portal/auth/magic/callback?token=${encodeURIComponent(token)}`;
}

export async function sendAccessLink(memberId: string, req?: Request, opts: { channel?: "EMAIL" | "SMS" } = {}) {
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({ where: { id: memberId }, select: { id: true, email: true, phone: true, firstName: true, locationId: true } });
  if (!member) throw new Error("Member not found");
  const link = await buildMagicLink(member.id, req);
  const channel = opts.channel ?? "EMAIL";
  if (channel === "SMS") {
    if (!member.phone) throw new Error("Member has no phone number");
    await sendSMS({ to: member.phone, text: `Hi ${member.firstName}, here's your Tee24 account sign-in link (expires in 15 min): ${link}`, ledger: false });
  } else {
    if (!member.email) throw new Error("Member has no email address");
    await sendEmail({
      to: member.email,
      subject: "Your Tee24 account access",
      ledger: false,
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif;padding:24px;color:#0f172a;max-width:560px;margin:auto;">
  <h1 style="font-size:20px;margin:0 0 16px;">Welcome, ${escapeHtml(member.firstName)}</h1>
  <p style="margin:0 0 16px;color:#475569;">Use the button below to sign in to your member account. This link expires in 15 minutes — you can always request a new one from the portal login page.</p>
  <a href="${link}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;">Sign in to my account</a>
  <p style="margin-top:16px;font-size:12px;color:#94a3b8;">If the button doesn't work, copy this link: ${link}</p>
</div>`,
    });
  }
  await prisma.member.update({ where: { id: member.id }, data: { magicLinkLastSentAt: new Date() } });
  await prisma.message.create({
    data: {
      memberId: member.id,
      channel,
      direction: "OUTBOUND",
      status: "SENT",
      category: "TRANSACTIONAL",
      subject: channel === "EMAIL" ? "Your Tee24 account access" : null,
      body: `Account access link sent (${channel.toLowerCase()}).`,
      toAddress: channel === "EMAIL" ? member.email : member.phone,
    },
  }).catch(() => undefined);
  return { channel };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
