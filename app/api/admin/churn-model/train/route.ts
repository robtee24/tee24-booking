import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/access";
import { trainV2Model } from "@/services/churn-risk-v2.service";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
