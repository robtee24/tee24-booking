import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { getRemoteConfig } from "@/lib/remote/meshcentral";

export const dynamic = "force-dynamic";

/** GET /api/admin/remote/status — is remote support configured (no secrets returned). */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = getRemoteConfig();
  return NextResponse.json({
    configured: !!cfg,
    provider: cfg ? "meshcentral" : null,
    serverUrl: cfg?.url ?? null,
    agentDownloadReady: !!cfg?.meshId,
    singleSignOn: !!cfg?.loginTokenKey,
  });
}
