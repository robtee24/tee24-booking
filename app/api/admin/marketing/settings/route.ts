import { NextRequest, NextResponse } from "next/server";
import { apiError, guardMarketing, readJson } from "../_shared";
import { getMarketingSettings, saveMarketingSettings } from "@/services/marketing.service";
import { getQuoFromNumber } from "@/lib/quo";
import { getPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET ?slug= — org marketing settings + automation/pause status + SMS sender. */
export async function GET(req: NextRequest) {
  const g = await guardMarketing(req, ["marketing.manage-automations", "marketing.manage-referrals"]);
  if (!g.ok) return g.response;
  try {
    const orgId = g.location.organizationId;
    const [settings, automations] = await Promise.all([
      getMarketingSettings(orgId),
      getPrisma().automation.groupBy({ by: ["active"], _count: { _all: true }, where: { OR: [{ organizationId: orgId }, { organizationId: null }] } }),
    ]);
    const active = automations.find((a) => a.active)?._count._all ?? 0;
    const paused = automations.find((a) => !a.active)?._count._all ?? 0;
    return NextResponse.json({
      settings,
      automations: { active, paused },
      smsFrom: getQuoFromNumber(),
      paypalConfigured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    });
  } catch (e) {
    return apiError(e, 500);
  }
}

/** PUT ?slug= Partial<MarketingSettings> */
export async function PUT(req: NextRequest) {
  const body = await readJson(req);
  const g = await guardMarketing(req, ["marketing.manage-automations", "marketing.manage-referrals"], { body });
  if (!g.ok) return g.response;
  try {
    const next = await saveMarketingSettings(g.location.organizationId, body, g.admin.id);
    return NextResponse.json({ ok: true, settings: next });
  } catch (e) {
    return apiError(e);
  }
}
