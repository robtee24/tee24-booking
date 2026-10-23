import { NextRequest, NextResponse } from "next/server";
import { assertCan } from "@/lib/permissions";
import { editSubscription } from "@/services/membership.service";
import { apiError, readJson } from "@/app/api/admin/members/_shared";
import { requireSubscriptionApi } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/memberships/[id]/edit
 * { guestCount?, priceCents?, autoRenew?, clearCommitment? }
 * Edits an existing subscription in place (no plan change). Permission membership.edit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireSubscriptionApi(id);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  try {
    assertCan(g.actor, "membership.edit", { locationId: g.sub.locationId });
    const guestCount = body.guestCount === undefined || body.guestCount === null || body.guestCount === "" ? undefined : Number(body.guestCount);
    if (guestCount !== undefined && (!Number.isInteger(guestCount) || guestCount < 0)) return NextResponse.json({ error: "guestCount must be a whole number" }, { status: 400 });
    const priceCents = body.priceCents === undefined || body.priceCents === null || body.priceCents === "" ? undefined : Number(body.priceCents);
    if (priceCents !== undefined && (!Number.isFinite(priceCents) || priceCents < 0)) return NextResponse.json({ error: "priceCents must be zero or more" }, { status: 400 });
    const subscription = await editSubscription(
      {
        subscriptionId: id,
        guestCount,
        priceCents,
        autoRenew: typeof body.autoRenew === "boolean" ? body.autoRenew : undefined,
        clearCommitment: body.clearCommitment === true,
      },
      g.admin.id,
    );
    return NextResponse.json({ ok: true, subscription });
  } catch (e) {
    return apiError(e);
  }
}
