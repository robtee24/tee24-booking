import { NextResponse } from "next/server";
import { clearMemberSession } from "@/lib/member-session";

export const dynamic = "force-dynamic";

export async function POST() {
  await clearMemberSession();
  return NextResponse.json({ ok: true });
}
