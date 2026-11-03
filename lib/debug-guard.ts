// lib/debug-guard.ts
//
// Gate for the /api/debug/* helper routes. They live outside /api/admin so the
// middleware never sees them, which means they MUST authenticate themselves.
// We require a signed-in ROOT/FULL admin and answer 404 to anyone else so the
// routes don't even confirm their own existence to unauthenticated callers.
import { NextResponse } from "next/server";
import { requireFullAdminApi } from "@/lib/api-auth";

export async function requireDebugAccess(): Promise<NextResponse | null> {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}
