/**
 * Member portal — card vault (uses the member session cookie).
 *
 * GET    /api/portal/billing/card                 → cards on file + Square public config
 * POST   /api/portal/billing/card { sourceId, verificationToken?, setDefault? }  → add card
 * PATCH  /api/portal/billing/card { id }          → make default
 * DELETE /api/portal/billing/card?id=             → remove card
 *
 * Impersonated sessions (admin "view as member") are read-only here.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { getMemberSession } from "@/lib/member-session";
import { getSquarePublicConfig } from "@/lib/square";
import { listPaymentMethods, removePaymentMethod, setDefaultPaymentMethod, vaultCard } from "@/services/billing.service";

export const dynamic = "force-dynamic";

async function session() {
  const s = await getMemberSession();
  if (!s) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { s };
}

function readOnly(s: { role: string }) {
  return s.role === "IMPERSONATED" ? NextResponse.json({ error: "Read-only while viewing as member" }, { status: 403 }) : null;
}

export async function GET() {
  const { s, error } = await session();
  if (error) return error;
  return NextResponse.json({ paymentMethods: await listPaymentMethods(s.sub), square: getSquarePublicConfig() });
}

export async function POST(req: NextRequest) {
  const { s, error } = await session();
  if (error) return error;
  const ro = readOnly(s);
  if (ro) return ro;
  const body = await req.json().catch(() => ({}));
  try {
    const pm = await vaultCard({ memberId: s.sub, sourceId: String(body.sourceId ?? ""), verificationToken: body.verificationToken ?? null, setDefault: body.setDefault === undefined ? true : Boolean(body.setDefault), source: "portal" });
    return NextResponse.json({ ok: true, paymentMethod: pm, paymentMethods: await listPaymentMethods(s.sub) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save card" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const { s, error } = await session();
  if (error) return error;
  const ro = readOnly(s);
  if (ro) return ro;
  const body = await req.json().catch(() => ({}));
  const pm = await getPrisma().paymentMethod.findFirst({ where: { id: String(body.id ?? ""), memberId: s.sub } });
  if (!pm) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  await setDefaultPaymentMethod(s.sub, pm.id);
  return NextResponse.json({ ok: true, paymentMethods: await listPaymentMethods(s.sub) });
}

export async function DELETE(req: NextRequest) {
  const { s, error } = await session();
  if (error) return error;
  const ro = readOnly(s);
  if (ro) return ro;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const pm = await getPrisma().paymentMethod.findFirst({ where: { id, memberId: s.sub } });
  if (!pm) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  try {
    await removePaymentMethod(pm.id);
    return NextResponse.json({ ok: true, paymentMethods: await listPaymentMethods(s.sub) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not remove card" }, { status: 400 });
  }
}
