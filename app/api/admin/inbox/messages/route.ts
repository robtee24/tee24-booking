import { NextRequest, NextResponse } from "next/server";
import { guardInbox, apiError } from "../_shared";
import { listMessageSources, listMessages } from "@/services/inbox.service";

export const dynamic = "force-dynamic";

/**
 * GET ?locationId=&channel=&direction=&status=&category=&source=&memberId=&search=&from=&to=&before=&take=
 * Flat log of every email/SMS. `before` is the createdAt cursor returned as nextBefore.
 */
export async function GET(req: NextRequest) {
  const g = await guardInbox(req);
  if (!g.ok) return g.response;
  const sp = req.nextUrl.searchParams;
  const date = (k: string) => {
    const v = sp.get(k);
    if (!v) return undefined;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  };
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | undefined => {
    const v = sp.get(k);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  try {
    const [page, sources] = await Promise.all([
      listMessages({
        locationIds: g.locationIds,
        channel: pick("channel", ["EMAIL", "SMS"] as const),
        direction: pick("direction", ["INBOUND", "OUTBOUND"] as const),
        category: pick("category", ["TRANSACTIONAL", "MARKETING", "SYSTEM"] as const),
        status: sp.get("status") || undefined,
        source: sp.get("source") || undefined,
        memberId: sp.get("memberId") || undefined,
        search: sp.get("search") || undefined,
        from: date("from"),
        to: date("to"),
        before: date("before"),
        take: Number(sp.get("take") ?? 100) || 100,
      }),
      sp.get("withSources") === "1" ? listMessageSources(g.locationIds) : Promise.resolve(undefined),
    ]);
    return NextResponse.json({ ...page, sources });
  } catch (e) {
    return apiError(e, 500);
  }
}
