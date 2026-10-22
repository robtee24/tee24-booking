// POST /api/admin/auth/pin-verify  { pin }
//
// Re-verifies the signed-in admin's front-desk PIN. Intended for shared
// front-desk computers: the browser keeps one admin session, and sensitive
// actions ask for the PIN again. Returns { ok: true } or 401.
// Simple in-memory throttle: 5 failures per admin per 5 minutes.
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/api-auth";
import { verifyAdminPin } from "@/services/staff.service";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.response;
  const adminId = guard.admin.id;

  const now = Date.now();
  const f = failures.get(adminId);
  if (f && f.resetAt > now && f.count >= MAX_FAILURES) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({} as { pin?: string }));
  const pin = String(body.pin ?? "").trim();
  const ok = await verifyAdminPin(adminId, pin);

  if (!ok) {
    const cur = f && f.resetAt > now ? f : { count: 0, resetAt: now + WINDOW_MS };
    cur.count += 1;
    failures.set(adminId, cur);
    void audit({ actorId: adminId, action: "admin.login", entityType: "Admin", entityId: adminId, metadata: { event: "pin.verify-failed" } });
    return NextResponse.json({ ok: false, error: "Incorrect PIN" }, { status: 401 });
  }

  failures.delete(adminId);
  void audit({ actorId: adminId, action: "admin.login", entityType: "Admin", entityId: adminId, metadata: { event: "pin.verified" } });
  return NextResponse.json({ ok: true, adminId, name: guard.admin.name, role: guard.admin.role });
}
