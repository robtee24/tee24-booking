// app/api/admin/auth/session/route.ts
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session.server";

export const runtime = "nodejs";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    id: session.id,
    role: session.role,
  });
}