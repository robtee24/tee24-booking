import { NextResponse } from "next/server";
import { getLatestKioskRelease, KIOSK_REPO } from "@/lib/kiosk/release";

export const dynamic = "force-dynamic";

/**
 * GET /desktop-app/download
 * Always resolves to the newest Windows installer. Falls back to the releases
 * page so the link never 404s, even before the first build is published.
 */
export async function GET() {
  const rel = await getLatestKioskRelease();
  const target = rel?.installerUrl ?? `https://github.com/${KIOSK_REPO}/releases`;
  return NextResponse.redirect(target, { status: 302 });
}
