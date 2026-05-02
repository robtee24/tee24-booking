import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { verifyCode } from "@/lib/totp";
import { getPrisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const row = await getPrisma().admin.findUnique({
    where: { id: admin.id },
    select: { twoFactorSecret: true },
  });
  if (!row?.twoFactorSecret) {
    return NextResponse.json({ error: "Run setup first" }, { status: 400 });
  }
  if (!verifyCode(row.twoFactorSecret, code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await getPrisma().admin.update({
    where: { id: admin.id },
    data: { twoFactorEnabled: true },
  });

  void audit({
    actorId: admin.id,
    action: "admin.update",
    entityType: "Admin",
    entityId: admin.id,
    metadata: { event: "2fa.enabled" },
  });

  return NextResponse.json({ ok: true });
}
