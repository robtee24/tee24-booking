// Shared helpers for /api/admin/admins/* handlers.
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/permissions";
import { StaffError } from "@/services/staff.service";

export function staffApiError(err: unknown): NextResponse {
  if (err instanceof ForbiddenError) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (err instanceof StaffError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  console.error("[api/admin/admins]", err);
  return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
}

export async function paramId(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  return decodeURIComponent(String(id ?? ""));
}
