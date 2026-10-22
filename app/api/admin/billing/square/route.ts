/**
 * Per-location Square account.
 *
 * GET    /api/admin/billing/square?locationSlug=   → connection status (no secrets)        (billing.view)
 * POST   /api/admin/billing/square                 → { action: "verify" } test a token and
 *                                                    list the Square locations it can see   (billing.configure)
 * PUT    /api/admin/billing/square                 → save / rotate the connection           (billing.configure)
 * DELETE /api/admin/billing/square                 → disconnect                             (billing.configure)
 */
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, guardBilling, squareStatusPayload } from "../_shared";
import { disconnectSquare, saveSquareConnection, verifySquareToken } from "@/services/square-connection.service";
import { normalizeSquareEnv } from "@/lib/square";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardBilling({ locationSlug: req.nextUrl.searchParams.get("locationSlug") }, "billing.view");
  if (!g.ok) return g.response;
  return NextResponse.json({ square: await squareStatusPayload(g.location.id) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.configure");
  if (!g.ok) return g.response;
  try {
    if (body.action !== "verify") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const r = await verifySquareToken({ locationId: g.location.id, env: normalizeSquareEnv(body.env), accessToken: typeof body.accessToken === "string" ? body.accessToken : null });
    return NextResponse.json({ ok: true, locations: r.locations });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.configure");
  if (!g.ok) return g.response;
  try {
    const r = await saveSquareConnection({
      locationId: g.location.id,
      env: String(body.env ?? "production"),
      applicationId: typeof body.applicationId === "string" ? body.applicationId : null,
      squareLocationId: String(body.squareLocationId ?? ""),
      accessToken: typeof body.accessToken === "string" ? body.accessToken : null,
      webhookSignatureKey: typeof body.webhookSignatureKey === "string" ? body.webhookSignatureKey : null,
      clearWebhookKey: body.clearWebhookKey === true,
      actorId: g.actorId,
    });
    return NextResponse.json({ ok: true, merchantName: r.merchantName, square: await squareStatusPayload(g.location.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const g = await guardBilling({ locationSlug: body.locationSlug, locationId: body.locationId }, "billing.configure");
  if (!g.ok) return g.response;
  try {
    await disconnectSquare(g.location.id, g.actorId);
    return NextResponse.json({ ok: true, square: await squareStatusPayload(g.location.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
