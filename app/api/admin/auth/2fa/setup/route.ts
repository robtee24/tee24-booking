/**
 * Admin 2FA setup. Returns a fresh otpauth:// URL + secret for QR display.
 *
 * The secret is stored as a draft on the admin row but not enabled until the
 * admin posts a valid code via /verify.
 */
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { generateSecret, buildOtpAuthUrl } from "@/lib/totp";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = generateSecret();
  await getPrisma().admin.update({
    where: { id: admin.id },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  });

  const url = buildOtpAuthUrl({ secret, account: admin.phone, issuer: "Tee24" });

  void audit({
    actorId: admin.id,
    action: "admin.update",
    entityType: "Admin",
    entityId: admin.id,
    metadata: { event: "2fa.setup-init" },
  });

  return NextResponse.json({ ok: true, secret, otpauthUrl: url });
}
