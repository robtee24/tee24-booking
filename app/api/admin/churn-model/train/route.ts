import { NextResponse } from "next/server";
import { requireFullAdminApi } from "@/lib/api-auth";
import { trainV2Model } from "@/services/churn-risk-v2.service";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST — retrain the org-wide churn model. ROOT/FULL only (reads every member). */
export async function POST() {
  const guard = await requireFullAdminApi();
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const model = await trainV2Model();
  if (!model) {
    return NextResponse.json(
      { error: "Insufficient labels (need ≥ 200)" },
      { status: 400 },
    );
  }

  void audit({
    actorId: admin.id,
    action: "admin.update",
    entityType: "MlModel",
    entityId: model.version,
    metadata: { event: "churn-model.trained", trainCount: model.trainCount },
  });

  return NextResponse.json({ ok: true, model });
}
