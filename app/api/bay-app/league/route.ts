import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/db";
import { kioskCheck, kioskJoin, kioskLeagueInfo, kioskLookup, kioskSubmit, LeagueError, type KioskSubmitInput, leagueScopeForLocations } from "@/services/league.service";
import type { OcrLine } from "@/lib/league/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Kiosk league endpoints (device identified by its registration).
 *
 *   GET  /api/bay-app/league?deviceId=                           → { leagues: [{ id, name, week, settings, ... }] }
 *   POST /api/bay-app/league { deviceId, action: 'lookup', leagueId, phone, weekId? }   → member, card, minor, alreadySubmitted
 *   POST /api/bay-app/league { deviceId, action: 'join',   leagueId, phone, displayName? }
 *   POST /api/bay-app/league { deviceId, action: 'check',  leagueId, weekId?, ocr: { lines } } → pre-flight: is a scorecard up, names, settings, course
 *   POST /api/bay-app/league { deviceId, action: 'submit', leagueId, weekId?, imageBase64, imageMime?, ocr: { w, h, lines }, entries: [{ phone, name }] }
 */
async function locationForDevice(deviceId: string) {
  const reg = await getPrisma().bayAppRegistration.findUnique({ where: { deviceId }, select: { locationId: true } });
  if (!reg) throw new LeagueError("Device not registered", 404, "DEVICE_NOT_REGISTERED");
  return reg.locationId;
}

function fail(e: unknown) {
  if (e instanceof LeagueError) return NextResponse.json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, { status: e.status });
  console.error("[bay-app/league]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = (searchParams.get("deviceId") ?? "").trim();
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    const locationId = await locationForDevice(deviceId);
    return NextResponse.json({ leagues: await kioskLeagueInfo(locationId) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const deviceId = String(body.deviceId ?? "").trim();
    const action = String(body.action ?? "");
    const leagueId = String(body.leagueId ?? "").trim();
    if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
    const locationId = await locationForDevice(deviceId);
    if (!leagueId) return NextResponse.json({ error: "leagueId required" }, { status: 400 });
    const league = await getPrisma().league.findFirst({ where: { id: leagueId, ...(await leagueScopeForLocations([locationId])) }, select: { id: true } });
    if (!league) return NextResponse.json({ error: "League not found", code: "LEAGUE_NOT_FOUND" }, { status: 404 });

    if (action === "lookup") return NextResponse.json(await kioskLookup(leagueId, String(body.phone ?? ""), typeof body.weekId === "string" ? body.weekId : null));
    if (action === "join") return NextResponse.json(await kioskJoin(leagueId, String(body.phone ?? ""), typeof body.displayName === "string" ? body.displayName : null));
    if (action === "check") {
      const ocr = body.ocr as { lines?: OcrLine[] } | undefined;
      return NextResponse.json(await kioskCheck(locationId, leagueId, Array.isArray(ocr?.lines) ? ocr!.lines! : [], typeof body.weekId === "string" ? body.weekId : null));
    }
    if (action === "submit") {
      const input: KioskSubmitInput = {
        leagueId,
        weekId: typeof body.weekId === "string" ? body.weekId : null,
        imageBase64: String(body.imageBase64 ?? ""),
        imageMime: typeof body.imageMime === "string" ? body.imageMime : null,
        ocr: (body.ocr as KioskSubmitInput["ocr"]) ?? { w: 0, h: 0, lines: [] },
        entries: Array.isArray(body.entries) ? (body.entries as KioskSubmitInput["entries"]).map((e) => ({ phone: String(e?.phone ?? ""), name: String(e?.name ?? "") })) : [],
      };
      if (!input.imageBase64) return NextResponse.json({ error: "Scorecard screenshot missing", code: "IMAGE_REQUIRED" }, { status: 400 });
      return NextResponse.json(await kioskSubmit(locationId, input));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
